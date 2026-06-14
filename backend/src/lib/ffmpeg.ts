// Обёртки над ffmpeg/ffprobe. Бинарники берём из npm-пакетов ffmpeg-static и
// ffprobe-static, чтобы не требовать установки ffmpeg в систему.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { env, ASPECT_SIZES } from '../env.js';

const FFMPEG = (ffmpegPath as unknown as string) || 'ffmpeg';
const FFPROBE = ffprobeStatic.path || 'ffprobe';

function run(bin: string, args: string[], errPrefix: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
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
  fs.writeFileSync(listPath, paths.map((p) => `file '${p}'\n`).join(''));
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

export interface RenderOpts {
  jobDir: string;
  aspectRatio: string;
  audioPath: string;
  /** Картинки по порядку сцен и их длительности (сек). */
  images: { path: string; durationSec: number }[];
}

/** Собрать слайдшоу из картинок + озвучку в один mp4. Возвращает путь к видео. */
export async function renderVideo(opts: RenderOpts): Promise<string> {
  const [w, h] = ASPECT_SIZES[opts.aspectRatio] ?? [1920, 1080];

  const scaledDir = path.join(opts.jobDir, 'images_scaled');
  fs.mkdirSync(scaledDir, { recursive: true });

  const scaled: { path: string; durationSec: number }[] = [];
  for (const img of opts.images) {
    const sp = path.join(scaledDir, path.basename(img.path));
    await scaleImage(img.path, sp, w, h);
    scaled.push({ path: sp, durationSec: img.durationSec });
  }

  // concat demuxer: каждая картинка с указанной длительностью
  const concatPath = path.join(opts.jobDir, 'video_concat.txt');
  const lines: string[] = [];
  for (const s of scaled) {
    lines.push(`file '${s.path}'`);
    lines.push(`duration ${s.durationSec.toFixed(3)}`);
  }
  // требование concat demuxer — повторить последний файл
  lines.push(`file '${scaled[scaled.length - 1].path}'`);
  fs.writeFileSync(concatPath, lines.join('\n') + '\n');

  const out = path.join(opts.jobDir, 'video.mp4');
  const cmd = [
    '-y',
    '-f', 'concat', '-safe', '0', '-i', concatPath,
    '-i', opts.audioPath,
    '-vf', 'format=yuv420p',
    '-r', String(env.VIDEO_FPS),
    '-c:v', env.VIDEO_CODEC,
  ];
  if (env.VIDEO_CODEC === 'libx264') cmd.push('-preset', env.VIDEO_PRESET, '-tune', 'stillimage');
  cmd.push('-c:a', 'aac', '-b:a', '192k', '-shortest', out);

  await run(FFMPEG, cmd, 'ffmpeg не смог собрать видео');
  return out;
}
