// Сборка ролика (ФАЗА 2): берёт уже готовые картинки сцен + озвучивает текст
// одним куском + склеивает в MP4. Картинки тут НЕ генерируются — они делаются
// заранее, поштучно (services/images.ts). Сборка доступна только когда у всех
// сцен есть готовая картинка.

import path from 'node:path';
import os from 'node:os';
import { prisma } from '../db.js';
import { JOBS_DIR, env, ASPECT_SIZES } from '../env.js';
import * as voicer from '../lib/voicer.js';
import { audioDuration, saveAudio, renderSceneClip, stitchClips, qualityOf, applyGrading, mixAudioWithDucking, overlaySfx, overlayVideos, isValidVideo, detectSilences } from '../lib/ffmpeg.js';
import { buildZoomFilter, staticFilter, pickSequence, validZoomPresets, validTransitionPresets, resolveEffects, EffectOverrides } from '../lib/effects.js';
import { rel, abs, projectDir } from '../lib/paths.js';
import { emitToProject } from '../lib/socket.js';
import { writeASS, writeWordASS, writeCtaASS } from '../lib/subtitles.js';
import { getValidVoicePath, getWordTimestamps, getSilences } from './voice.js';
import { computeClipHash } from '../lib/hash.js';
import { computeSceneDurations } from '../lib/sceneTiming.js';
import fs from 'node:fs';

async function appendLog(jobId: string, msg: string) {
  const stamp = new Date().toLocaleTimeString('ru-RU', { hour12: false });
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { log: true } });
  const log = Array.isArray(job?.log) ? (job!.log as string[]) : [];
  log.push(`[${stamp}] ${msg}`);
  await prisma.job.update({ where: { id: jobId }, data: { log } });
}

const setStep = (jobId: string, step: string, projectId?: string) => {
  if (projectId) emitToProject(projectId, 'job:step', { jobId, step });
  return prisma.job.update({ where: { id: jobId }, data: { step } });
};

/** Можно ли собирать: у всех сцен картинка готова. Возвращает причину, если нельзя. */
export async function assemblyBlockReason(projectId: string): Promise<string | null> {
  const scenes = await prisma.scene.findMany({ where: { projectId }, select: { imageStatus: true } });
  if (scenes.length === 0) return 'В проекте нет сцен';
  const notDone = scenes.filter((s) => s.imageStatus !== 'done').length;
  if (notDone > 0) return `Не у всех сцен готова картинка: осталось ${notDone} из ${scenes.length}`;
  return null;
}

/** Создать Job (снимок сцен и настроек). Гейт: все картинки должны быть готовы. */
export async function createJob(projectId: string, opts?: { format?: string }): Promise<string> {
  const reason = await assemblyBlockReason(projectId);
  if (reason) throw new Error(reason);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { scenes: { orderBy: { order: 'asc' } } },
  });
  if (!project) throw new Error('Проект не найден');

  const job = await prisma.job.create({
    data: {
      projectId,
      status: 'queued',
      scenesCount: project.scenes.length,
      provider: project.provider,
      model: project.model,
      aspectRatio: opts?.format || project.aspectRatio,
      results: {
        create: project.scenes.map((s) => ({
          order: s.order,
          voiceText: s.voiceText,
          imagePrompt: s.imagePrompt,
          imagePath: s.imagePath, // снимок готовой картинки
          status: 'done',
        })),
      },
    },
  });
  return job.id;
}

/** Полный прогон сборки. Вызывать НЕ дожидаясь (фоном) — клиент опрашивает статус. */
export async function runJob(jobId: string): Promise<void> {
  const jobDir = path.join(JOBS_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  // Получаем projectId до try, чтобы emit работал и в catch
  const jobMeta = await prisma.job.findUnique({ where: { id: jobId }, select: { projectId: true } });
  const projectId = jobMeta?.projectId ?? '';

  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { results: { orderBy: { order: 'asc' } }, project: true },
    });
    if (!job) throw new Error('Job не найден');

    await prisma.job.update({ where: { id: jobId }, data: { status: 'running' } });

    const scenes = job.results;
    if (scenes.some((s) => !s.imagePath)) throw new Error('У части сцен нет картинки — сборка невозможна');

    const fullText = scenes.map((s) => s.voiceText).join('\n\n');

    // 1) Озвучка: переиспользуем только если текст НЕ менялся.
    // Если текст изменился — генерим новую (это нормально, текст другой).
    let audioPath: string;
    const existingVoice = await getValidVoicePath(job.projectId);

    if (existingVoice) {
      await setStep(jobId, 'Озвучка: используем готовую', job.projectId);
      audioPath = existingVoice;
      await appendLog(jobId, `Озвучка переиспользована (текст не менялся)`);
    } else {
      await setStep(jobId, 'Озвучка: отправка задачи в Voicer', job.projectId);
      await appendLog(jobId, `Сцен: ${scenes.length}, символов текста: ${fullText.length}`);
      const voice = job.project.voiceTemplateId ? { template_uuid: job.project.voiceTemplateId } : undefined;
      const taskId = await voicer.createTask(fullText, voice);
      await prisma.job.update({ where: { id: jobId }, data: { voicerTaskId: String(taskId) } });

      await setStep(jobId, 'Озвучка: ожидание синтеза', job.projectId);
      await voicer.waitUntilReady(taskId);
      const raw = await voicer.downloadResult(taskId);

      // Сохраняем озвучку в постоянное место проекта (не в jobs/)
      const voiceDir = path.join(projectDir(job.project.id, job.project.folderName), 'voice');
      fs.mkdirSync(voiceDir, { recursive: true });
      audioPath = await saveAudio(raw, voiceDir);
      await appendLog(jobId, `Озвучка сгенерирована`);

      // Try to get word-level timestamps
      const timestamps = await voicer.downloadTimestamps(taskId);
      if (timestamps && timestamps.length > 0) {
        fs.writeFileSync(path.join(voiceDir, 'timestamps.json'), JSON.stringify(timestamps), 'utf-8');
      }

      // Детект пауз для точной привязки границ сцен
      try {
        const silences = await detectSilences(audioPath, 0.2, -30);
        fs.writeFileSync(path.join(voiceDir, 'silences.json'), JSON.stringify(silences), 'utf-8');
      } catch {}

      // Сохраняем как project voice для будущих сборок
      const crypto = await import('node:crypto');
      const hash = crypto.createHash('sha256').update(`${job.project.voiceTemplateId ?? ''}:${fullText.trim()}`).digest('hex').slice(0, 16);
      await prisma.project.update({
        where: { id: job.projectId },
        data: { voicePreviewPath: rel(audioPath), voicePreviewStatus: 'done', voiceTextHash: hash },
      });
    }

    const total = await audioDuration(audioPath);
    await prisma.job.update({ where: { id: jobId }, data: { audioPath: rel(audioPath) } });
    await appendLog(jobId, `Длительность аудио: ${total.toFixed(1)} с`);

    // 2) Длительности: per-scene durationOverride приоритетнее пропорционального расчёта.
    //    Внутренние границы сцен привязываются к серединам реальных пауз в озвучке,
    //    чтобы картинки не «уезжали» от голоса (паузы и пунктуация не учитывались
    //    при простом пропорциональном расчёте по символам).

    // Fetch original scenes to get overrides (SceneResult doesn't store them yet)
    const originalScenes = await prisma.scene.findMany({
      where: { projectId: job.projectId },
      orderBy: { order: 'asc' },
      select: { effectOverrides: true, durationOverride: true },
    });

    const silences = await getSilences(job.projectId, job.project.folderName);
    if (silences.length > 0) {
      await appendLog(jobId, `Найдено пауз в озвучке: ${silences.length} (привязка границ сцен)`);
    }

    const timing = computeSceneDurations(
      scenes.map((s, i) => ({
        voiceText: s.voiceText,
        durationOverride: (originalScenes[i]?.durationOverride as number | null) ?? null,
      })),
      total,
      silences,
    );
    const durations = timing.durations;
    await Promise.all(
      scenes.map((s, i) =>
        prisma.sceneResult.update({ where: { id: s.id }, data: { durationSec: durations[i] } }),
      ),
    );
    await prisma.job.update({ where: { id: jobId }, data: { imagesDone: scenes.length } });

    // 3) Сборка видео: каждая сцена -> отдельный клип (параллельно по ядрам),
    //    затем сшивка (с переходами или встык).
    const p = job.project;
    const [w, h] = ASPECT_SIZES[job.aspectRatio] ?? [1920, 1080];
    const isVertical = h > w;
    const fps = env.VIDEO_FPS;
    const quality = qualityOf(p.renderQuality);

    // Resolve per-scene effects (overrides + project defaults)
    const scenesForResolve = originalScenes.map((s) => ({
      effectOverrides: s.effectOverrides as EffectOverrides | null,
    }));
    const resolved = resolveEffects(scenesForResolve, p, job.projectId);
    const transOn = p.transitionEnabled && scenes.length > 1;

    // длительность клипа: при переходах добавляем нахлёст, чтобы тайминг не плыл
    const clipLens = durations.map((d, i) => {
      const tDur = transOn && i < resolved.transDurations.length ? resolved.transDurations[i] : 0;
      return d + tDur;
    });

    const clipsDir = path.join(projectDir(job.project.id, job.project.folderName), 'clips');
    fs.mkdirSync(clipsDir, { recursive: true });

    // Compute hashes and check cache
    const clipInfos = await Promise.all(scenes.map(async (s, i) => {
      const zoomPreset = resolved.zoomSeq[i];
      const hash = computeClipHash({
        imagePath: s.imagePath!,
        durationSec: clipLens[i],
        zoomPreset,
        zoomIntensity: resolved.zoomIntensities[i],
        zoomSpeed: resolved.zoomSpeeds[i],
        zoomEasing: resolved.zoomEasings[i],
        zoomFocusX: resolved.zoomFocusX[i],
        zoomFocusY: resolved.zoomFocusY[i],
        zoomShake: resolved.zoomShakes[i],
        width: w, height: h, fps,
        quality: p.renderQuality,
      });
      const cachedPath = path.join(clipsDir, `clip_${String(i).padStart(3, '0')}_${hash}.mp4`);
      let cached = fs.existsSync(cachedPath);
      if (cached) {
        const ok = await isValidVideo(cachedPath);
        if (!ok) {
          try { fs.unlinkSync(cachedPath); } catch {}
          cached = false;
        }
      }
      return { hash, cachedPath, cached, zoomPreset };
    }));

    const fromCache = clipInfos.filter((c) => c.cached).length;
    const toRender = clipInfos.filter((c) => !c.cached).length;
    if (fromCache > 0) {
      await appendLog(jobId, `Кеш клипов: ${fromCache} из кеша, ${toRender} на рендер`);
    }

    const clipPaths = clipInfos.map((c) => c.cachedPath);

    await setStep(jobId, `Рендер сцен (0/${toRender})`, job.projectId);
    let renderedCount = 0;
    let next = 0;
    const cores = Math.max(1, Math.min(os.cpus().length, toRender || 1));
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= scenes.length) return;
        if (clipInfos[i].cached) continue; // skip cached
        const nFrames = Math.max(2, Math.round(clipLens[i] * fps));
        const zoomPreset = clipInfos[i].zoomPreset;
        const vf = zoomPreset
          ? buildZoomFilter(zoomPreset, nFrames, resolved.zoomIntensities[i], w, h, fps,
              resolved.zoomSpeeds[i], resolved.zoomEasings[i], resolved.zoomFocusX[i], resolved.zoomFocusY[i], resolved.zoomShakes[i])
          : staticFilter(w, h);
        await renderSceneClip({
          imagePath: abs(scenes[i].imagePath!),
          outPath: clipPaths[i],
          w, h, fps,
          durationSec: clipLens[i],
          vf,
          zoom: !!zoomPreset,
          quality,
        });
        renderedCount += 1;
        await setStep(jobId, `Рендер сцен (${renderedCount}/${toRender})`, job.projectId);
      }
    };
    await Promise.all(Array.from({ length: cores }, worker));

    // Save hashes to SceneResult for audit
    await Promise.all(
      scenes.map((s, i) =>
        prisma.sceneResult.update({ where: { id: s.id }, data: { clipPath: rel(clipPaths[i]), contentHash: clipInfos[i].hash } }),
      ),
    );

    await setStep(jobId, transOn ? 'Сшивка с переходами' : 'Сшивка ролика', job.projectId);

    // Кладём готовый ролик в папку проекта: projects/<имя>/output/<дата>.mp4
    const outDir = path.join(projectDir(job.project.id, job.project.folderName), 'output');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    // Аудио: если есть фоновая музыка — микшируем с ducking
    let finalAudioPath = audioPath;
    if (p.bgMusicPath) {
      const musicAbs = abs(p.bgMusicPath);
      if (fs.existsSync(musicAbs)) {
        await setStep(jobId, 'Микширование музыки', job.projectId);
        finalAudioPath = path.join(jobDir, 'voice_mixed.mp3');
        await mixAudioWithDucking({
          voicePath: audioPath,
          musicPath: musicAbs,
          outputPath: finalAudioPath,
          musicVolume: p.bgMusicVolume,
          ducking: p.bgMusicDucking,
          totalDuration: total,
        });
        await appendLog(jobId, `Музыка смикширована (vol=${p.bgMusicVolume}, ducking=${p.bgMusicDucking})`);
      }
    }

    // SFX overlay + overlay sounds
    const sfxPlacements = await prisma.sfxPlacement.findMany({ where: { projectId: job.projectId }, orderBy: { timeSec: 'asc' } });
    const allOverlaysForSound = await prisma.overlay.findMany({ where: { projectId: job.projectId, OR: [{ soundFile: { not: null } }, { type: 'audio' }] }, orderBy: { timeSec: 'asc' } });
    const sfxItems = [
      ...sfxPlacements.map(s => ({ filePath: abs(s.soundFile), timeSec: s.timeSec, volume: s.volume })),
      ...allOverlaysForSound.filter((o: any) => o.soundFile).map((o: any) => ({ filePath: abs(o.soundFile), timeSec: o.timeSec, volume: o.soundVolume ?? 1.0 })),
      ...allOverlaysForSound.filter((o: any) => o.type === 'audio' && o.filePath).map((o: any) => ({ filePath: abs(o.filePath), timeSec: o.timeSec, volume: o.soundVolume ?? 1.0 })),
    ].filter(s => fs.existsSync(s.filePath));
    if (sfxItems.length > 0) {
      await setStep(jobId, 'Наложение звуковых эффектов', job.projectId);
      const sfxOut = path.join(jobDir, 'voice_sfx.mp3');
      await overlaySfx(finalAudioPath, sfxItems, sfxOut);
      finalAudioPath = sfxOut;
      await appendLog(jobId, `SFX наложено: ${sfxItems.length} звуков`);
    }

    // Build per-transition data for stitcher
    // Transitions: keep nulls as 'fade' fallback (null means disabled → use cut/zero-dur)
    const tSeq = transOn ? resolved.transSeq.map(t => t ?? 'fade') : null;
    const tDur = transOn ? p.transitionDuration : 0;

    const rawPath = path.join(outDir, `video-${stamp}-raw.mp4`);
    await stitchClips({
      clips: clipPaths.map((cp, i) => ({ path: cp, durationSec: clipLens[i] })),
      audioPath: finalAudioPath,
      outPath: rawPath,
      fps,
      quality,
      transitions: tSeq,
      transitionDur: tDur,
      workDir: jobDir,
    });

    // Пост-обработка: субтитры + грейдинг (grain/vignette/LUT/цветокоррекция)
    const hasCC = ((p as any).ccBrightness ?? 0) !== 0 || ((p as any).ccContrast ?? 0) !== 0 ||
                  ((p as any).ccSaturation ?? 0) !== 0 || ((p as any).ccTemperature ?? 0) !== 0;
    const hasCta = await prisma.ctaOverlay.count({ where: { projectId: job.projectId } }) > 0;
    const allCtaItems = await prisma.ctaOverlay.findMany({ where: { projectId: job.projectId }, orderBy: { timeSec: 'asc' } });
    const needsGrading = p.grainEnabled || p.vignetteEnabled || p.lutFile || p.subtitlesEnabled || hasCC || hasCta;
    let finalPath: string;

    if (needsGrading) {
      await setStep(jobId, 'Пост-обработка', job.projectId);

      let subsFile: string | null = null;
      if (p.subtitlesEnabled) {
        // Try word-level timestamps first (CapCut-style precise subtitles)
        let wordTs = getWordTimestamps(job.projectId, job.project.folderName);
        // Fallback: generate proportional timestamps from text + audio duration
        if (!wordTs) {
          const fullText2 = scenes.map(s => s.voiceText).join(' ');
          const words = fullText2.split(/\s+/).filter(w => w.trim());
          if (words.length && total > 0) {
            const perWord = total / words.length;
            wordTs = words.map((word, i) => ({ word, startSec: +(i * perWord).toFixed(3), endSec: +((i + 1) * perWord).toFixed(3) }));
            await appendLog(jobId, `Сгенерированы пропорциональные таймстемпы (${words.length} слов)`);
          }
        }
        if (wordTs) {
          subsFile = writeWordASS(wordTs, {
            style: (p.subtitlesStyle as any) ?? 'modern',
            fontSize: isVertical ? Math.round((p.subtitlesFontSize ?? 48) * 1.4) : (p.subtitlesFontSize ?? 48),
            position: isVertical ? 'center' : ((p.subtitlesPosition as any) ?? 'bottom'),
            x: p.subtitlesX ?? 50,
            y: isVertical ? 55 : (p.subtitlesY ?? 85),
            resX: w,
            resY: h,
            color: (p as any).subtitlesColor ?? '#FFFFFF',
            outline: (p as any).subtitlesOutline ?? 3,
            outlineColor: (p as any).subtitlesOutlineColor ?? '#000000',
            shadow: (p as any).subtitlesShadow ?? 2,
            animation: ((p as any).subtitlesAnimation ?? 'fade') as any,
            bgEnabled: (p as any).subtitlesBgEnabled ?? false,
            bgColor: (p as any).subtitlesBgColor ?? '#000000',
            bgOpacity: (p as any).subtitlesBgOpacity ?? 0.5,
            spacing: (p as any).subtitlesSpacing ?? 4,
          }, jobDir);
          await appendLog(jobId, 'Субтитры: пословный тайминг');
        } else {
          // Fallback: scene-level proportional timing
          let accTime = 0;
          const subScenes = scenes.map((s, i) => {
            const start = accTime;
            accTime += durations[i];
            return { text: s.voiceText, startSec: start, endSec: accTime };
          });
          subsFile = writeASS(subScenes, {
            style: (p.subtitlesStyle as any) ?? 'modern',
            fontSize: p.subtitlesFontSize ?? 48,
            position: (p.subtitlesPosition as any) ?? 'bottom',
            x: p.subtitlesX ?? 50,
            y: p.subtitlesY ?? 85,
            resX: w,
            resY: h,
            color: (p as any).subtitlesColor ?? '#FFFFFF',
            outline: (p as any).subtitlesOutline ?? 3,
            outlineColor: (p as any).subtitlesOutlineColor ?? '#000000',
            shadow: (p as any).subtitlesShadow ?? 2,
            animation: ((p as any).subtitlesAnimation ?? 'fade') as any,
            bgEnabled: (p as any).subtitlesBgEnabled ?? false,
            bgColor: (p as any).subtitlesBgColor ?? '#000000',
            bgOpacity: (p as any).subtitlesBgOpacity ?? 0.5,
            spacing: (p as any).subtitlesSpacing ?? 4,
          }, jobDir);
        }
      }

      // CTA overlays — text/image CTAs go to ASS, video CTAs handled separately
      const textCtaItems = allCtaItems.filter((c: any) => !c.imagePath || !/\.(mp4|webm|mov)$/i.test(c.imagePath));
      if (textCtaItems.length > 0) {
        const ctaFile = writeCtaASS(textCtaItems, w, h, jobDir);
        if (ctaFile) {
          if (subsFile) {
            // Append CTA events to existing subtitle file
            const ctaContent = fs.readFileSync(ctaFile, 'utf-8');
            const ctaEvents = ctaContent.split('\n').filter(l => l.startsWith('Dialogue:'));
            const subsContent = fs.readFileSync(subsFile, 'utf-8');
            fs.writeFileSync(subsFile, subsContent.trimEnd() + '\n' + ctaEvents.join('\n') + '\n', 'utf-8');
          } else {
            subsFile = ctaFile;
          }
        }
      }

      finalPath = path.join(outDir, `video-${stamp}.mp4`);
      const lutsDir = path.join(env.DATA_DIR, 'luts');
      await applyGrading(rawPath, finalPath, {
        grainEnabled: p.grainEnabled,
        grainIntensity: p.grainIntensity,
        vignetteEnabled: p.vignetteEnabled,
        vignetteIntensity: p.vignetteIntensity,
        lutFile: p.lutFile ? path.join(lutsDir, p.lutFile) : null,
        subtitlesFile: subsFile,
        ccBrightness: (p as any).ccBrightness ?? 0,
        ccContrast: (p as any).ccContrast ?? 0,
        ccSaturation: (p as any).ccSaturation ?? 0,
        ccTemperature: (p as any).ccTemperature ?? 0,
        quality,
      });
      fs.rmSync(rawPath, { force: true });
      await appendLog(jobId, 'Пост-обработка применена');
    } else {
      finalPath = path.join(outDir, `video-${stamp}.mp4`);
      fs.renameSync(rawPath, finalPath);
    }

    // Video overlays (CTA with video files)
    const videoCtaItems = allCtaItems.filter((c: any) => c.imagePath && /\.(mp4|webm|mov)$/i.test(c.imagePath));
    if (videoCtaItems.length > 0) {
      await setStep(jobId, 'Наложение видео-оверлеев (CTA)', job.projectId);
      const overlays = videoCtaItems
        .map((c: any) => ({ filePath: abs(c.imagePath), timeSec: c.timeSec, durationSec: c.durationSec, x: c.x, y: c.y, scale: c.scale, resX: w, resY: h }))
        .filter((o: any) => fs.existsSync(o.filePath));
      if (overlays.length > 0) {
        const ovOut = path.join(outDir, `video-ov-${stamp}.mp4`);
        await overlayVideos(finalPath, overlays, ovOut);
        finalPath = ovOut;
        await appendLog(jobId, `Видео-оверлеев (CTA) наложено: ${overlays.length}`);
      }
    }

    // Custom overlays (photo/video/text with animations)
    const allOverlays = await prisma.overlay.findMany({ where: { projectId: job.projectId }, orderBy: { timeSec: 'asc' } });
    if (allOverlays.length > 0) {
      // Image overlays → ffmpeg overlay filter
      const imgOverlays = allOverlays.filter((o: any) => o.type === 'image' && o.filePath);
      const vidOverlays = allOverlays.filter((o: any) => o.type === 'video' && o.filePath);
      const mediaOverlays = [...imgOverlays, ...vidOverlays]
        .map((o: any) => ({ filePath: abs(o.filePath), timeSec: o.timeSec, durationSec: o.durationSec, x: o.x, y: o.y, scale: o.scale, resX: w, resY: h }))
        .filter((o: any) => fs.existsSync(o.filePath));
      if (mediaOverlays.length > 0) {
        await setStep(jobId, 'Наложение оверлеев (медиа)', job.projectId);
        const mediaOut = path.join(outDir, `video-overlays-${stamp}.mp4`);
        await overlayVideos(finalPath, mediaOverlays, mediaOut);
        finalPath = mediaOut;
        await appendLog(jobId, `Медиа-оверлеев наложено: ${mediaOverlays.length}`);
      }

      // Text overlays → ASS subtitles (burned into video via applyGrading pass)
      const textOverlays = allOverlays.filter((o: any) => o.type === 'text' && o.text);
      if (textOverlays.length > 0) {
        await setStep(jobId, 'Наложение текстовых оверлеев', job.projectId);
        const { writeOverlayASS } = await import('../lib/subtitles.js');
        const assFile = writeOverlayASS(textOverlays, w, h, jobDir);
        if (assFile) {
          const textOut = path.join(outDir, `video-text-ov-${stamp}.mp4`);
          await applyGrading(finalPath, textOut, { subtitlesFile: assFile, quality });
          finalPath = textOut;
          await appendLog(jobId, `Текстовых оверлеев наложено: ${textOverlays.length}`);
        }
      }
    }

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'done', step: 'Готово', outputPath: rel(finalPath), finishedAt: new Date() },
    });
    await appendLog(jobId, `Видео собрано: ${path.basename(finalPath)}`);
    emitToProject(projectId, 'job:done', { jobId });
  } catch (e: any) {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'error', error: String(e?.message ?? e), finishedAt: new Date() },
    });
    await appendLog(jobId, `ОШИБКА: ${e?.message ?? e}`);
    emitToProject(projectId, 'job:error', { jobId, error: String(e?.message ?? e) });
  }
}
