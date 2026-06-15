import path from 'node:path';
import fs from 'node:fs';
import { env } from '../env.js';

/** Путь относительно DATA_DIR — его отдаёт статика по /files/... */
export const rel = (abs: string): string =>
  path.relative(env.DATA_DIR, abs).split(path.sep).join('/');

/** Абсолютный путь из относительного (как лежит в БД). */
export const abs = (relPath: string): string => path.join(env.DATA_DIR, relPath);

/** Папка проекта внутри DATA_DIR/projects/<id> (создаётся при обращении). */
export function projectDir(projectId: string): string {
  const d = path.join(env.DATA_DIR, 'projects', projectId);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
