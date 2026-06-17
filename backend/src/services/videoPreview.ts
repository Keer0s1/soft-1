import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { env, ASPECT_SIZES } from '../env.js';
import { audioDuration, renderSceneClip, stitchClips, applyGrading, mixAudioWithDucking, overlayVideos, overlaySfx } from '../lib/ffmpeg.js';
import { buildZoomFilter, staticFilter, resolveEffects, EffectOverrides } from '../lib/effects.js';
import { rel, abs, projectDir } from '../lib/paths.js';
import { emitToProject } from '../lib/socket.js';
import { writeWordASS, writeASS, writeCtaASS, writeOverlayASS } from '../lib/subtitles.js';
import { getValidVoicePath, getWordTimestamps } from './voice.js';
import { computeClipHash } from '../lib/hash.js';

const PREVIEW_SIZES: Record<string, [number, number]> = {
  '16:9': [480, 270],
  '9:16': [270, 480],
  '1:1': [270, 270],
  '4:3': [360, 270],
  '3:4': [270, 360],
};

const PREVIEW_QUALITY = { preset: 'ultrafast', crf: 30 };

export async function computePreviewHash(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return '';
  const scenes = await prisma.scene.findMany({
    where: { projectId },
    orderBy: { order: 'asc' },
    select: { imagePath: true, voiceText: true, effectOverrides: true, durationOverride: true },
  });
  const overlays = await prisma.overlay.findMany({ where: { projectId }, orderBy: { timeSec: 'asc' }, select: { type: true, filePath: true, text: true, timeSec: true, durationSec: true, x: true, y: true, scale: true, soundFile: true, soundVolume: true } });
  const ctas = await prisma.ctaOverlay.findMany({ where: { projectId }, orderBy: { timeSec: 'asc' }, select: { text: true, timeSec: true, durationSec: true, x: true, y: true, scale: true, imagePath: true } });
  const sfx = await prisma.sfxPlacement.findMany({ where: { projectId }, orderBy: { timeSec: 'asc' }, select: { soundFile: true, timeSec: true, volume: true } });

  const data = JSON.stringify({
    scenes: scenes.map(s => ({ ip: s.imagePath, vt: s.voiceText, eo: s.effectOverrides, d: s.durationOverride })),
    z: [project.zoomEnabled, project.zoomIntensity, project.zoomPresets],
    t: [project.transitionEnabled, project.transitionDuration, project.transitionPresets],
    g: [project.grainEnabled, project.grainIntensity, project.vignetteEnabled, project.vignetteIntensity, project.lutFile],
    cc: [(project as any).ccBrightness, (project as any).ccContrast, (project as any).ccSaturation, (project as any).ccTemperature],
    s: [project.subtitlesEnabled, project.subtitlesStyle, project.subtitlesFontSize, (project as any).subtitlesColor,
        (project as any).subtitlesOutline, (project as any).subtitlesAnimation, (project as any).subtitlesX, (project as any).subtitlesY],
    m: [project.bgMusicPath, project.bgMusicVolume, project.bgMusicDucking],
    voice: project.voicePreviewPath,
    ov: overlays,
    cta: ctas,
    sfx: sfx,
  });
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

export async function runVideoPreview(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error('Проект не найден');

  const audioPath = await getValidVoicePath(projectId);
  if (!audioPath) throw new Error('Нет озвучки — сначала сгенерируйте голос');

  await prisma.project.update({ where: { id: projectId }, data: { videoPreviewStatus: 'rendering', videoPreviewError: '' } });
  emitToProject(projectId, 'videoPreview:progress', { step: 'Подготовка' });

  try {
    const scenes = await prisma.scene.findMany({ where: { projectId }, orderBy: { order: 'asc' } });
    if (scenes.length === 0 || scenes.some(s => !s.imagePath)) throw new Error('Не у всех сцен есть картинка');

    const hash = await computePreviewHash(projectId);
    if (project.videoPreviewHash === hash && project.videoPreviewPath && fs.existsSync(abs(project.videoPreviewPath))) {
      await prisma.project.update({ where: { id: projectId }, data: { videoPreviewStatus: 'done' } });
      emitToProject(projectId, 'videoPreview:done', { path: project.videoPreviewPath });
      return;
    }

    const [w, h] = PREVIEW_SIZES[project.aspectRatio] ?? [640, 360];
    const [fullW, fullH] = ASPECT_SIZES[project.aspectRatio] ?? [1920, 1080];
    const scaleFactor = w / fullW;
    const fps = env.VIDEO_FPS;
    const total = await audioDuration(audioPath);

    // Длительности сцен
    const charCounts = scenes.map(s => Math.max(s.voiceText.length, 1));
    const totalChars = charCounts.reduce((a, b) => a + b, 0);
    const durations = scenes.map((s, i) => {
      const override = s.durationOverride as number | null;
      return override != null && override > 0 ? override : (total * charCounts[i]) / totalChars;
    });

    // Resolve effects
    const scenesForResolve = scenes.map(s => ({ effectOverrides: s.effectOverrides as EffectOverrides | null }));
    const resolved = resolveEffects(scenesForResolve, project, projectId);
    const transOn = project.transitionEnabled && scenes.length > 1;

    // Длительности клипов с overlap для переходов (как в полном рендере)
    const clipLens = durations.map((d, i) => {
      const tDur = transOn && i < resolved.transDurations.length ? resolved.transDurations[i] : 0;
      return d + tDur;
    });

    // Preview clips dir
    const prevDir = path.join(projectDir(projectId, project.folderName), 'preview');
    fs.mkdirSync(path.join(prevDir, 'clips'), { recursive: true });

    // Render clips (cached by hash)
    const clipPaths: string[] = [];
    let rendered = 0;
    const totalSteps = scenes.length + 2; // clips + stitch + grading
    const cores = Math.max(1, Math.min(os.cpus().length, scenes.length));
    let next = 0;

    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= scenes.length) return;
        const zoomPreset = resolved.zoomSeq[i];
        const clipHash = computeClipHash({
          imagePath: scenes[i].imagePath!,
          durationSec: clipLens[i],
          zoomPreset,
          zoomIntensity: resolved.zoomIntensities[i],
          zoomSpeed: resolved.zoomSpeeds[i],
          zoomEasing: resolved.zoomEasings[i],
          zoomFocusX: resolved.zoomFocusX[i],
          zoomFocusY: resolved.zoomFocusY[i],
          zoomShake: resolved.zoomShakes[i],
          width: w, height: h, fps,
          quality: 'preview',
        });
        const clipPath = path.join(prevDir, 'clips', `clip_${String(i).padStart(3, '0')}_${clipHash}.mp4`);
        clipPaths[i] = clipPath;
        if (fs.existsSync(clipPath)) { rendered++; emitToProject(projectId, 'videoPreview:progress', { percent: Math.round((rendered / totalSteps) * 100) }); continue; }

        const nFrames = Math.max(2, Math.round(clipLens[i] * fps));
        const vf = zoomPreset
          ? buildZoomFilter(zoomPreset, nFrames, resolved.zoomIntensities[i], w, h, fps,
              resolved.zoomSpeeds[i], resolved.zoomEasings[i], resolved.zoomFocusX[i], resolved.zoomFocusY[i], resolved.zoomShakes[i])
          : staticFilter(w, h);
        await renderSceneClip({
          imagePath: abs(scenes[i].imagePath!),
          outPath: clipPath, w, h, fps,
          durationSec: clipLens[i], vf, zoom: !!zoomPreset,
          quality: PREVIEW_QUALITY,
        });
        rendered++;
        emitToProject(projectId, 'videoPreview:progress', { percent: Math.round((rendered / totalSteps) * 100) });
      }
    };
    await Promise.all(Array.from({ length: cores }, worker));

    // Background music + SFX готовится ДО stitch, как в полном рендере
    let finalAudioPath = audioPath;
    if (project.bgMusicPath) {
      const musicAbs = abs(project.bgMusicPath);
      if (fs.existsSync(musicAbs)) {
        finalAudioPath = path.join(prevDir, 'voice_mixed.mp3');
        if (!fs.existsSync(finalAudioPath)) {
          await mixAudioWithDucking({
            voicePath: audioPath, musicPath: musicAbs, outputPath: finalAudioPath,
            musicVolume: project.bgMusicVolume, ducking: project.bgMusicDucking, totalDuration: total,
          });
        }
      }
    }

    // SFX overlay + overlay sounds
    const sfxPlacements = await prisma.sfxPlacement.findMany({ where: { projectId }, orderBy: { timeSec: 'asc' } });
    const allOverlaysForSound = await prisma.overlay.findMany({ where: { projectId, OR: [{ soundFile: { not: null } }, { type: 'audio' }] }, orderBy: { timeSec: 'asc' } });
    const sfxItems = [
      ...sfxPlacements.map((s: any) => ({ filePath: abs(s.soundFile), timeSec: s.timeSec, volume: s.volume })),
      ...allOverlaysForSound.filter((o: any) => o.soundFile).map((o: any) => ({ filePath: abs(o.soundFile), timeSec: o.timeSec, volume: o.soundVolume ?? 1.0 })),
      ...allOverlaysForSound.filter((o: any) => o.type === 'audio' && o.filePath).map((o: any) => ({ filePath: abs(o.filePath), timeSec: o.timeSec, volume: o.soundVolume ?? 1.0 })),
    ].filter(s => fs.existsSync(s.filePath));
    if (sfxItems.length > 0) {
      const sfxOut = path.join(prevDir, 'voice_sfx.mp3');
      await overlaySfx(finalAudioPath, sfxItems, sfxOut);
      finalAudioPath = sfxOut;
    }

    // Stitch with transitions (как в полном рендере)
    const tSeq = transOn ? resolved.transSeq.map(t => t ?? 'fade') : null;
    const tDur = transOn ? project.transitionDuration : 0;
    const stitchHashData = clipPaths.map(p => path.basename(p)).join('|') + `|t:${transOn ? tSeq?.join(',') : 'off'}|d:${tDur}|sfx:${sfxItems.length}|m:${project.bgMusicPath || 'none'}`;
    const stitchHash = crypto.createHash('sha256').update(stitchHashData).digest('hex').slice(0, 12);
    const rawPath = path.join(prevDir, `raw_${stitchHash}.mp4`);

    if (!fs.existsSync(rawPath)) {
      for (const f of fs.readdirSync(prevDir)) {
        if (f.startsWith('raw_') && f.endsWith('.mp4')) fs.rmSync(path.join(prevDir, f), { force: true });
      }
      await stitchClips({
        clips: clipPaths.map((cp, i) => ({ path: cp, durationSec: clipLens[i] })),
        audioPath: finalAudioPath,
        outPath: rawPath,
        fps,
        quality: PREVIEW_QUALITY,
        transitions: tSeq,
        transitionDur: tDur,
        workDir: prevDir,
      });
    }
    rendered++;
    emitToProject(projectId, 'videoPreview:progress', { percent: Math.round((rendered / totalSteps) * 100) });

    // Grading + subtitles — cached by raw hash + grading settings
    emitToProject(projectId, 'videoPreview:progress', { step: 'Пост-обработка' });
    const isVertical = h > w;
    const hasCC = ((project as any).ccBrightness ?? 0) !== 0 || ((project as any).ccContrast ?? 0) !== 0 ||
                  ((project as any).ccSaturation ?? 0) !== 0 || ((project as any).ccTemperature ?? 0) !== 0;
    const needsGrading = project.grainEnabled || project.vignetteEnabled || project.lutFile || project.subtitlesEnabled || hasCC;

    let finalPath = rawPath;
    if (needsGrading) {
      let subsFile: string | null = null;
      if (project.subtitlesEnabled) {
        let wordTs = getWordTimestamps(projectId, project.folderName);
        if (!wordTs) {
          const fullText = scenes.map(s => s.voiceText).join(' ');
          const words = fullText.split(/\s+/).filter(w => w.trim());
          if (words.length && total > 0) {
            const perWord = total / words.length;
            wordTs = words.map((word, i) => ({ word, startSec: +(i * perWord).toFixed(3), endSec: +((i + 1) * perWord).toFixed(3) }));
          }
        }
        if (wordTs) {
          const baseFontSize = isVertical ? Math.round((project.subtitlesFontSize ?? 48) * 1.4) : (project.subtitlesFontSize ?? 48);
          subsFile = writeWordASS(wordTs, {
            style: (project.subtitlesStyle as any) ?? 'modern',
            fontSize: Math.round(baseFontSize * scaleFactor),
            position: isVertical ? 'center' : ((project.subtitlesPosition as any) ?? 'bottom'),
            x: project.subtitlesX ?? 50, y: isVertical ? 55 : (project.subtitlesY ?? 85),
            resX: w, resY: h,
            color: (project as any).subtitlesColor ?? '#FFFFFF',
            outline: Math.max(1, Math.round(((project as any).subtitlesOutline ?? 3) * scaleFactor)),
            outlineColor: (project as any).subtitlesOutlineColor ?? '#000000',
            shadow: Math.max(0, Math.round(((project as any).subtitlesShadow ?? 2) * scaleFactor)),
            animation: ((project as any).subtitlesAnimation ?? 'fade') as any,
            bgEnabled: (project as any).subtitlesBgEnabled ?? false,
            bgColor: (project as any).subtitlesBgColor ?? '#000000',
            bgOpacity: (project as any).subtitlesBgOpacity ?? 0.5,
            spacing: Math.round(((project as any).subtitlesSpacing ?? 4) * scaleFactor),
          }, prevDir);
        } else {
          // Fallback: scene-level subtitles (как в полном рендере)
          let accTime = 0;
          const subScenes = scenes.map((s, i) => {
            const start = accTime;
            accTime += durations[i];
            return { text: s.voiceText, startSec: start, endSec: accTime };
          });
          subsFile = writeASS(subScenes, {
            style: (project.subtitlesStyle as any) ?? 'modern',
            fontSize: Math.round((project.subtitlesFontSize ?? 48) * scaleFactor),
            position: (project.subtitlesPosition as any) ?? 'bottom',
            x: project.subtitlesX ?? 50, y: project.subtitlesY ?? 85,
            resX: w, resY: h,
            color: (project as any).subtitlesColor ?? '#FFFFFF',
            outline: Math.max(1, Math.round(((project as any).subtitlesOutline ?? 3) * scaleFactor)),
            outlineColor: (project as any).subtitlesOutlineColor ?? '#000000',
            shadow: Math.max(0, Math.round(((project as any).subtitlesShadow ?? 2) * scaleFactor)),
            animation: ((project as any).subtitlesAnimation ?? 'fade') as any,
            bgEnabled: (project as any).subtitlesBgEnabled ?? false,
            bgColor: (project as any).subtitlesBgColor ?? '#000000',
            bgOpacity: (project as any).subtitlesBgOpacity ?? 0.5,
            spacing: Math.round(((project as any).subtitlesSpacing ?? 4) * scaleFactor),
          }, prevDir);
        }
      }

      // CTA subtitles
      const allCtaItems = await prisma.ctaOverlay.findMany({ where: { projectId }, orderBy: { timeSec: 'asc' } });
      const textCtaItems = allCtaItems.filter((c: any) => !c.imagePath || !/\.(mp4|webm|mov)$/i.test(c.imagePath));
      if (textCtaItems.length > 0) {
        const ctaFile = writeCtaASS(textCtaItems, w, h, prevDir);
        if (ctaFile) {
          if (subsFile) {
            const ctaContent = fs.readFileSync(ctaFile, 'utf-8');
            const ctaEvents = ctaContent.split('\n').filter(l => l.startsWith('Dialogue:'));
            const subsContent = fs.readFileSync(subsFile, 'utf-8');
            fs.writeFileSync(subsFile, subsContent.trimEnd() + '\n' + ctaEvents.join('\n') + '\n', 'utf-8');
          } else {
            subsFile = ctaFile;
          }
        }
      }

      const gradedPath = path.join(prevDir, 'graded.mp4');
      const lutsDir = path.join(env.DATA_DIR, 'luts');
      await applyGrading(rawPath, gradedPath, {
        grainEnabled: project.grainEnabled,
        grainIntensity: project.grainIntensity,
        vignetteEnabled: project.vignetteEnabled,
        vignetteIntensity: project.vignetteIntensity,
        lutFile: project.lutFile ? path.join(lutsDir, project.lutFile) : null,
        subtitlesFile: subsFile,
        ccBrightness: (project as any).ccBrightness ?? 0,
        ccContrast: (project as any).ccContrast ?? 0,
        ccSaturation: (project as any).ccSaturation ?? 0,
        ccTemperature: (project as any).ccTemperature ?? 0,
        quality: PREVIEW_QUALITY,
      });
      finalPath = gradedPath;
    }
    rendered++;
    emitToProject(projectId, 'videoPreview:progress', { percent: 100 });

    // Video CTA overlays (как в полном рендере)
    const allCtaOverlays = await prisma.ctaOverlay.findMany({ where: { projectId }, orderBy: { timeSec: 'asc' } });
    const videoCtaItems = allCtaOverlays.filter((c: any) => c.imagePath && /\.(mp4|webm|mov)$/i.test(c.imagePath));
    if (videoCtaItems.length > 0) {
      const overlays = videoCtaItems
        .map((c: any) => ({ filePath: abs(c.imagePath), timeSec: c.timeSec, durationSec: c.durationSec, x: c.x, y: c.y, scale: c.scale, resX: w, resY: h }))
        .filter((o: any) => fs.existsSync(o.filePath));
      if (overlays.length > 0) {
        const ovOut = path.join(prevDir, 'video_cta.mp4');
        await overlayVideos(finalPath, overlays, ovOut);
        finalPath = ovOut;
      }
    }

    // Media overlays (image/video)
    const allOverlays = await prisma.overlay.findMany({ where: { projectId }, orderBy: { timeSec: 'asc' } });
    const mediaOvs = allOverlays
      .filter((o: any) => (o.type === 'image' || o.type === 'video') && o.filePath)
      .map((o: any) => ({ filePath: abs(o.filePath), timeSec: o.timeSec, durationSec: o.durationSec, x: o.x, y: o.y, scale: o.scale, resX: w, resY: h }))
      .filter((o: any) => fs.existsSync(o.filePath));
    if (mediaOvs.length > 0) {
      const ovOut = path.join(prevDir, 'overlays.mp4');
      await overlayVideos(finalPath, mediaOvs, ovOut);
      finalPath = ovOut;
    }

    // Text overlays (как в полном рендере)
    const textOverlays = allOverlays.filter((o: any) => o.type === 'text' && o.text);
    if (textOverlays.length > 0) {
      const assFile = writeOverlayASS(textOverlays, w, h, prevDir);
      if (assFile) {
        const textOut = path.join(prevDir, 'text_ov.mp4');
        await applyGrading(finalPath, textOut, { subtitlesFile: assFile, quality: PREVIEW_QUALITY });
        finalPath = textOut;
      }
    }

    // Move to final preview path
    const outputPath = path.join(prevDir, 'preview.mp4');
    if (finalPath !== outputPath) {
      fs.copyFileSync(finalPath, outputPath);
    }
    // Cleanup temp files (keep raw_*.mp4 and clips for cache)
    for (const f of ['graded.mp4', 'overlays.mp4', 'video_cta.mp4', 'text_ov.mp4']) {
      const p = path.join(prevDir, f);
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    }

    const relPath = rel(outputPath);
    await prisma.project.update({
      where: { id: projectId },
      data: { videoPreviewPath: relPath, videoPreviewStatus: 'done', videoPreviewHash: hash, videoPreviewError: '' },
    });
    emitToProject(projectId, 'videoPreview:done', { path: relPath });

  } catch (e: any) {
    await prisma.project.update({
      where: { id: projectId },
      data: { videoPreviewStatus: 'error', videoPreviewError: String(e?.message ?? e) },
    });
    emitToProject(projectId, 'videoPreview:error', { error: String(e?.message ?? e) });
  }
}