// Обёртки над ffmpeg/ffprobe. Бинарники берём из npm-пакетов ffmpeg-static и
// ffprobe-static, чтобы не требовать установки ffmpeg в систему.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { env } from '../env.js';

const FFMPEG = (ffmpegPath as unknown as string) || 'ffmpeg';
const FFPROBE = ffprobeStatic.path || 'ffprobe';

const posix = (p: string) => p.split(path.sep).join('/');

function run(bin: string, args: string[], errPrefix: string, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, cwd ? { cwd } : undefined);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (e) => reject(new Error(`${errPrefix}: ${e.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${errPrefix}: ${stderr.slice(-1200)}`));
    });
  });
}

/** Длительность аудио в секундах. */
export async function audioDuration(file: string): Promise<number> {
  const out = await run(
    FFPROBE,
    ['-v', 'error', '-show_entries', 'format=duration', '-of',
      'default=noprint_wrappers=1:nokey=1', file],
    'ffprobe не смог определить длительность аудио',
  );
  return parseFloat(out.trim());
}

export interface SilenceRange {
  start: number;
  end: number;
  duration: number;
}

/**
 * Найти паузы в аудио через ffmpeg silencedetect. Используется чтобы привязать
 * границы сцен к реальным паузам в речи, а не к пропорциональному расчёту по
 * количеству символов.
 *
 * minDuration — минимальная длительность паузы в секундах (короче — игнор).
 * noiseDb — порог тишины в дБ (-30 это мягко, -40 строже).
 */
export async function detectSilences(
  file: string,
  minDuration = 0.2,
  noiseDb = -30,
): Promise<SilenceRange[]> {
  // ffmpeg silencedetect пишет в stderr строки вида:
  //   [silencedetect @ ...] silence_start: 1.234
  //   [silencedetect @ ...] silence_end: 2.345 | silence_duration: 1.111
  let stderr = '';
  await new Promise<void>((resolve) => {
    const proc = spawn(FFMPEG, [
      '-hide_banner', '-nostats',
      '-i', file,
      '-af', `silencedetect=noise=${noiseDb}dB:d=${minDuration}`,
      '-f', 'null', '-',
    ]);
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });

  const ranges: SilenceRange[] = [];
  let pendingStart: number | null = null;
  const startRe = /silence_start:\s*(-?[\d.]+)/;
  const endRe = /silence_end:\s*(-?[\d.]+)[\s\S]*?silence_duration:\s*([\d.]+)/;
  for (const line of stderr.split('\n')) {
    const ms = line.match(startRe);
    if (ms) { pendingStart = parseFloat(ms[1]); continue; }
    const me = line.match(endRe);
    if (me) {
      const end = parseFloat(me[1]);
      const duration = parseFloat(me[2]);
      const start = pendingStart != null ? pendingStart : Math.max(0, end - duration);
      ranges.push({ start, end, duration });
      pendingStart = null;
    }
  }
  return ranges.filter((r) => r.duration >= minDuration);
}

/** Проверить что mp4 валидный (есть moov-атом, читается ffprobe). */
export async function isValidVideo(file: string): Promise<boolean> {
  if (!fs.existsSync(file)) return false;
  try {
    const st = fs.statSync(file);
    if (st.size < 1024) return false;
  } catch { return false; }
  try {
    await run(
      FFPROBE,
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
        'stream=codec_type', '-of', 'csv=p=0', file],
      'invalid',
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Сохранить результат Voicer. Если это ZIP с чанками — распаковать и склеить в один mp3.
 * Возвращает путь к итоговому voice.mp3.
 */
export async function saveAudio(raw: Buffer, jobDir: string): Promise<string> {
  const out = path.join(jobDir, 'voice.mp3');
  // ZIP начинается с сигнатуры "PK"
  if (!(raw[0] === 0x50 && raw[1] === 0x4b)) {
    fs.writeFileSync(out, raw);
    return out;
  }

  const chunksDir = path.join(jobDir, 'audio_chunks');
  fs.mkdirSync(chunksDir, { recursive: true });
  const zip = new AdmZip(raw);
  const names = zip
    .getEntries()
    .map((e) => e.entryName)
    .filter((n) => n.toLowerCase().endsWith('.mp3'))
    .sort();
  if (names.length === 0) throw new Error('ZIP от Voicer не содержит mp3-файлов');

  const paths: string[] = [];
  names.forEach((name, i) => {
    const p = path.join(chunksDir, `chunk_${String(i).padStart(4, '0')}.mp3`);
    fs.writeFileSync(p, zip.readFile(name)!);
    paths.push(p);
  });

  if (paths.length === 1) {
    fs.copyFileSync(paths[0], out);
    return out;
  }
  const listPath = path.join(jobDir, 'audio_concat.txt');
  fs.writeFileSync(listPath, paths.map((p) => `file '${posix(p)}'\n`).join(''));
  await run(
    FFMPEG,
    ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'libmp3lame', '-q:a', '2', out],
    'ffmpeg не смог склеить аудио-чанки',
  );
  return out;
}

/** Масштабировать картинку под нужный кадр (с паддингом) — один раз перед рендером. */
async function scaleImage(src: string, dst: string, w: number, h: number): Promise<void> {
  await run(
    FFMPEG,
    ['-y', '-i', src, '-vf',
      `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
      dst],
    'ffmpeg не смог подготовить картинку',
  );
}


// ───────────────────────── новый движок: клипы + переходы ─────────────────────────

export interface QualitySettings {
  preset: string;
  crf: number;
}
export function qualityOf(q: string): QualitySettings {
  if (q === 'fast') return { preset: 'ultrafast', crf: 28 };
  if (q === 'quality') return { preset: 'medium', crf: 20 };
  return { preset: 'veryfast', crf: 23 }; // balance
}

function videoCodecArgs(q: QualitySettings): string[] {
  const codec = env.VIDEO_CODEC || 'libx264';
  if (codec === 'h264_nvenc') {
    const preset = env.VIDEO_PRESET || 'p4';
    const cq = q.crf <= 20 ? 20 : q.crf <= 23 ? 24 : 28;
    return ['-c:v', 'h264_nvenc', '-preset', preset, '-rc', 'vbr', '-cq', String(cq), '-pix_fmt', 'yuv420p'];
  }
  if (codec !== 'libx264') {
    return ['-c:v', codec, '-pix_fmt', 'yuv420p'];
  }
  return ['-c:v', 'libx264', '-preset', q.preset, '-crf', String(q.crf), '-pix_fmt', 'yuv420p'];
}

export interface SceneClipOpts {
  imagePath: string;
  outPath: string;
  w: number;
  h: number;
  fps: number;
  durationSec: number;
  /** Готовый видеофильтр (zoompan или статичный scale/crop), без format. */
  vf: string;
  /** true — фильтр уже задаёт длительность (zoompan d=n); иначе нужен -loop/-t. */
  zoom: boolean;
  quality: QualitySettings;
}

/** Отрендерить одну сцену в отдельный mp4-клип (без звука). */
export async function renderSceneClip(o: SceneClipOpts): Promise<void> {
  const vf = `${o.vf},format=yuv420p`;
  const tmpPath = o.outPath + '.tmp.mp4';
  try { fs.unlinkSync(tmpPath); } catch {}
  const args = ['-y'];
  if (!o.zoom) args.push('-loop', '1', '-t', o.durationSec.toFixed(3));
  args.push('-i', o.imagePath, '-vf', vf, '-r', String(o.fps));
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', tmpPath);
  try {
    await run(FFMPEG, args, 'ffmpeg не смог отрендерить сцену');
    if (!(await isValidVideo(tmpPath))) {
      try { fs.unlinkSync(tmpPath); } catch {}
      throw new Error('Сцена отрендерилась, но файл невалидный (нет moov-атома)');
    }
    fs.renameSync(tmpPath, o.outPath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw e;
  }
}

export interface StitchOpts {
  clips: { path: string; durationSec: number }[];
  audioPath: string;
  outPath: string;
  fps: number;
  quality: QualitySettings;
  /** Имена xfade-переходов между клипами (длина = clips-1) или null. */
  transitions: string[] | null;
  transitionDur: number;
  workDir: string;
}

/** Сшить клипы в финальный ролик (с переходами или встык) + добавить звук. */
export async function stitchClips(o: StitchOpts): Promise<void> {
  const n = o.clips.length;

  // Без переходов или одна сцена — быстрый concat со stream-copy
  if (!o.transitions || o.transitions.length === 0 || n === 1) {
    const listPath = path.join(o.workDir, 'clips.txt');
    fs.writeFileSync(listPath, o.clips.map((c) => `file '${posix(c.path)}'`).join('\n') + '\n');
    await run(
      FFMPEG,
      ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-i', o.audioPath,
        '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', o.outPath],
      'ffmpeg не смог склеить клипы',
    );
    return;
  }

  // Цепочка xfade. При >30 сценах — разбиваем на чанки для скорости.
  const t = o.transitionDur;
  const CHUNK = 30;

  if (n <= CHUNK) {
    await stitchChunk(o.clips, o.transitions!, t, o.audioPath, o.outPath, o.quality, o.workDir);
  } else {
    // Разбиваем на чанки, склеиваем каждый с xfade, потом concat
    const chunkDir = path.join(o.workDir, '_chunks');
    fs.mkdirSync(chunkDir, { recursive: true });
    const chunkPaths: string[] = [];
    for (let start = 0; start < n; start += CHUNK) {
      const end = Math.min(start + CHUNK, n);
      const chunkClips = o.clips.slice(start, end);
      const chunkTrans = o.transitions!.slice(start, end - 1);
      const chunkOut = path.join(chunkDir, `chunk_${chunkPaths.length}.mp4`);
      await stitchChunk(chunkClips, chunkTrans, t, null, chunkOut, o.quality, chunkDir);
      chunkPaths.push(chunkOut);
    }
    // Concat чанки + аудио
    const listPath = path.join(o.workDir, 'chunks.txt');
    fs.writeFileSync(listPath, chunkPaths.map((c) => `file '${posix(c)}'`).join('\n') + '\n');
    await run(
      FFMPEG,
      ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-i', o.audioPath,
        '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', o.outPath],
      'ffmpeg не смог склеить чанки',
    );
    fs.rmSync(chunkDir, { recursive: true, force: true });
  }
}

async function stitchChunk(
  clips: { path: string; durationSec: number }[],
  transitions: string[],
  t: number,
  audioPath: string | null,
  outPath: string,
  quality: QualitySettings,
  workDir: string,
): Promise<void> {
  const n = clips.length;
  if (n === 1) {
    fs.copyFileSync(clips[0].path, outPath);
    return;
  }

  const linksDir = path.join(workDir, '_in');
  fs.mkdirSync(linksDir, { recursive: true });
  const inputs: string[] = [];
  for (let i = 0; i < n; i++) {
    const ext = path.extname(clips[i].path);
    const short = path.join(linksDir, `${i}${ext}`);
    try { fs.unlinkSync(short); } catch {}
    try { fs.linkSync(clips[i].path, short); } catch { fs.copyFileSync(clips[i].path, short); }
    inputs.push('-i', short);
  }
  if (audioPath) {
    const shortAudio = path.join(linksDir, `a${path.extname(audioPath)}`);
    try { fs.unlinkSync(shortAudio); } catch {}
    try { fs.linkSync(audioPath, shortAudio); } catch { fs.copyFileSync(audioPath, shortAudio); }
    inputs.push('-i', shortAudio);
  }

  let chain = '';
  let prev = '0:v';
  let acc = clips[0].durationSec;
  for (let i = 1; i < n; i++) {
    const off = Math.max(0, acc - t).toFixed(3);
    const outLabel = i === n - 1 ? 'vout' : `v${i}`;
    const trans = transitions[i - 1] ?? 'fade';
    chain += `[${prev}][${i}:v]xfade=transition=${trans}:duration=${t.toFixed(3)}:offset=${off}[${outLabel}];`;
    acc = acc + clips[i].durationSec - t;
    prev = outLabel;
  }
  chain = chain.replace(/;$/, '');

  const fcPath = path.join(workDir, 'fc.txt');
  fs.writeFileSync(fcPath, chain, 'utf-8');

  const mapArgs = audioPath
    ? ['-map', '[vout]', '-map', `${n}:a`, '-c:a', 'aac', '-b:a', '192k', '-shortest']
    : ['-map', '[vout]'];

  await run(
    FFMPEG,
    ['-y', ...inputs, '-filter_complex_script', fcPath, ...mapArgs,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(quality.crf), '-pix_fmt', 'yuv420p', outPath],
    'ffmpeg не смог собрать чанк с переходами',
  );
  fs.rmSync(linksDir, { recursive: true, force: true });
}

// ───────────────────────── Grading (post-process) ─────────────────────────

export interface GradingOpts {
  grainEnabled?: boolean;
  grainIntensity?: number;
  vignetteEnabled?: boolean;
  vignetteIntensity?: number;
  lutFile?: string | null;
  subtitlesFile?: string | null;
  ccBrightness?: number;
  ccContrast?: number;
  ccSaturation?: number;
  ccTemperature?: number;
  quality: QualitySettings;
}

export async function applyGrading(inputPath: string, outputPath: string, opts: GradingOpts): Promise<void> {
  const filters: string[] = [];

  if (opts.lutFile && fs.existsSync(opts.lutFile)) {
    const relLut = path.relative(process.cwd(), opts.lutFile).split(path.sep).join('/');
    filters.push(`lut3d=${relLut}:interp=tetrahedral`);
  }

  // Цветокоррекция (eq фильтр)
  const bright = opts.ccBrightness ?? 0;
  const contr = opts.ccContrast ?? 0;
  const sat = opts.ccSaturation ?? 0;
  if (bright !== 0 || contr !== 0 || sat !== 0) {
    // eq: brightness [-1..1], contrast [0..2], saturation [0..3]
    const eqBright = (bright / 100).toFixed(3);
    const eqContrast = (1 + contr / 100).toFixed(3);
    const eqSat = (1 + sat / 100).toFixed(3);
    filters.push(`eq=brightness=${eqBright}:contrast=${eqContrast}:saturation=${eqSat}`);
  }

  // Температура через colorbalance
  const temp = opts.ccTemperature ?? 0;
  if (temp !== 0) {
    const shift = (temp / 100 * 0.3).toFixed(3);
    const negShift = (-temp / 100 * 0.3).toFixed(3);
    filters.push(`colorbalance=rs=${shift}:gs=0:bs=${negShift}:rm=${shift}:gm=0:bm=${negShift}:rh=${shift}:gh=0:bh=${negShift}`);
  }
  if (opts.grainEnabled) {
    const s = Math.min(25, Math.max(1, opts.grainIntensity ?? 8));
    filters.push(`noise=c0s=${s}:c0f=t+u:c1s=${Math.round(s * 0.3)}:c1f=t+u`);
  }
  if (opts.vignetteEnabled) {
    const v = Math.min(1.0, Math.max(0.1, opts.vignetteIntensity ?? 0.5));
    const angle = (Math.PI / 3) * (1 - v) + (Math.PI / 10) * v;
    filters.push(`vignette=angle=${angle.toFixed(4)}`);
  }
  if (opts.subtitlesFile && fs.existsSync(opts.subtitlesFile)) {
    const relSubs = path.relative(process.cwd(), opts.subtitlesFile).split(path.sep).join('/');
    filters.push(`ass=${relSubs}`);
  }

  if (filters.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  const vf = filters.join(',');
  await run(
    FFMPEG,
    ['-y', '-i', inputPath, '-vf', vf, ...videoCodecArgs(opts.quality), '-c:a', 'copy', outputPath],
    'ffmpeg не смог применить грейдинг',
  );
}

// ───────────────────────── Audio ducking ─────────────────────────

export interface DuckingOpts {
  voicePath: string;
  musicPath: string;
  outputPath: string;
  musicVolume?: number;
  ducking?: boolean;
  totalDuration?: number;
}

export async function mixAudioWithDucking(opts: DuckingOpts): Promise<void> {
  const vol = Math.min(1.0, Math.max(0.0, opts.musicVolume ?? 0.15));
  const dur = opts.totalDuration ? ['-t', opts.totalDuration.toFixed(3)] : [];

  if (!opts.ducking) {
    await run(
      FFMPEG,
      ['-y', '-i', opts.voicePath, '-stream_loop', '-1', '-i', opts.musicPath,
        ...dur,
        '-filter_complex',
        `[1:a]volume=${vol.toFixed(2)}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=3[out]`,
        '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '2', opts.outputPath],
      'ffmpeg не смог смикшировать аудио',
    );
    return;
  }

  await run(
    FFMPEG,
    ['-y', '-i', opts.voicePath, '-stream_loop', '-1', '-i', opts.musicPath,
      ...dur,
      '-filter_complex',
      `[0:a]asplit=2[sc][voice];` +
      `[1:a]volume=${vol.toFixed(2)}[mv];` +
      `[mv][sc]sidechaincompress=threshold=0.015:ratio=8:attack=10:release=600:level_sc=0.8[ducked];` +
      `[voice][ducked]amix=inputs=2:duration=first:dropout_transition=3[out]`,
      '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '2', opts.outputPath],
    'ffmpeg не смог смикшировать аудио с ducking',
  );
}

export interface SfxOverlay {
  filePath: string;
  timeSec: number;
  volume: number;
}

/** Overlay SFX sounds at specific timestamps onto a base audio track. */
export async function overlaySfx(basePath: string, sfx: SfxOverlay[], outputPath: string): Promise<void> {
  if (sfx.length === 0) return;
  const inputs = ['-y', '-i', basePath];
  for (const s of sfx) inputs.push('-i', s.filePath);
  const filters: string[] = [];
  const mixInputs: string[] = ['[0:a]'];
  for (let i = 0; i < sfx.length; i++) {
    const delayMs = Math.round(sfx[i].timeSec * 1000);
    const vol = sfx[i].volume.toFixed(2);
    filters.push(`[${i + 1}:a]volume=${vol},adelay=${delayMs}|${delayMs}[sfx${i}]`);
    mixInputs.push(`[sfx${i}]`);
  }
  filters.push(`${mixInputs.join('')}amix=inputs=${sfx.length + 1}:duration=first:dropout_transition=2[out]`);
  await run(FFMPEG, [...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '2', outputPath], 'ffmpeg не смог наложить SFX');
}

export interface VideoOverlay {
  filePath: string;
  timeSec: number;
  durationSec: number;
  x: number; // 0-100 %
  y: number;
  scale: number;
  resX: number;
  resY: number;
}

/** Overlay video files (with alpha) on top of base video at specific times/positions. */
export async function overlayVideos(basePath: string, overlays: VideoOverlay[], outputPath: string): Promise<void> {
  if (overlays.length === 0) return;
  const inputs = ['-y', '-i', basePath];
  for (const o of overlays) {
    const isImage = /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(o.filePath);
    if (isImage) inputs.push('-loop', '1', '-i', o.filePath);
    else inputs.push('-i', o.filePath);
  }

  const filters: string[] = [];
  let prev = '[0:v]';
  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i];
    const w = Math.round(o.resX * 0.3 * o.scale);
    const px = Math.round((o.x / 100) * o.resX - w / 2);
    const py = Math.round((o.y / 100) * o.resY - (w * 0.75) / 2);
    const enable = `between(t,${o.timeSec.toFixed(2)},${(o.timeSec + o.durationSec).toFixed(2)})`;
    filters.push(`[${i + 1}:v]scale=${w}:-1[ov${i}]`);
    const next = i < overlays.length - 1 ? `[tmp${i}]` : '[vout]';
    filters.push(`${prev}[ov${i}]overlay=x=${px}:y=${py}:enable='${enable}'${next}`);
    prev = next;
  }

  await run(FFMPEG, [...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '0:a?', '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-shortest', outputPath], 'ffmpeg не смог наложить видео-оверлеи');
}

