import path from 'node:path';
import fs from 'node:fs';
import { env } from '../env.js';

/** Путь относительно DATA_DIR — его отдаёт статика по /files/... */
export const rel = (abs: string): string =>
  path.relative(env.DATA_DIR, abs).split(path.sep).join('/');

/** Абсолютный путь из относительного (как лежит в БД). */
export const abs = (relPath: string): string => path.join(env.DATA_DIR, relPath);

/** Человекочитаемое имя папки из названия + короткого id (уникальное и стабильное). */
export function makeFolderName(title: string, id: string): string {
  const slug = (title || 'rolik')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-') // буквы/цифры (в т.ч. кириллица) — остальное в дефис
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'rolik';
  return `${slug}-${id.slice(-6)}`;
}

/** Папка проекта DATA_DIR/projects/<folderName||id> (создаётся при обращении). */
export function projectDir(projectId: string, folderName?: string | null): string {
  const d = path.join(env.DATA_DIR, 'projects', folderName || projectId);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
