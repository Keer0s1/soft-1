import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';

function clean(url: string): string {
  return url.replace(/\/+$/, '');
}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? '',

  VOICER_API_URL: clean(process.env.VOICER_API_URL ?? 'https://voiceapiru.csv666.ru'),
  VOICER_API_KEY: process.env.VOICER_API_KEY ?? '',

  FASTGEN_API_URL: clean(process.env.FASTGEN_API_URL ?? 'https://googler.fast-gen.ai'),
  FASTGEN_API_KEY: process.env.FASTGEN_API_KEY ?? '',

  DATA_DIR: path.resolve(process.env.DATA_DIR ?? './data'),
  PORT: Number(process.env.PORT ?? 8000),

  IMAGE_CONCURRENCY: Number(process.env.IMAGE_CONCURRENCY ?? 5),

  VIDEO_CODEC: process.env.VIDEO_CODEC ?? 'libx264',
  VIDEO_PRESET: process.env.VIDEO_PRESET ?? 'veryfast',
  VIDEO_FPS: Number(process.env.VIDEO_FPS ?? 24),
};

// Размеры кадра по соотношению сторон
export const ASPECT_SIZES: Record<string, [number, number]> = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:3': [1440, 1080],
  '3:4': [1080, 1440],
};

// Папка с задачами (озвучка, картинки, видео) внутри DATA_DIR
export const JOBS_DIR = path.join(env.DATA_DIR, 'jobs');
fs.mkdirSync(JOBS_DIR, { recursive: true });
