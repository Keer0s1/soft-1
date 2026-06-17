// Озвучка всего сценария — одна на проект, используется и для превью, и для сборки.
// Не бросает наружу: статус/ошибка пишутся в проект.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import * as voicer from '../lib/voicer.js';
import { saveAudio } from '../lib/ffmpeg.js';
import { rel, abs, projectDir } from '../lib/paths.js';
import { emitToProject } from '../lib/socket.js';

function textHash(text: string, templateId?: string | null): string {
  return crypto.createHash('sha256').update(`${templateId ?? ''}:${text}`).digest('hex').slice(0, 16);
}

export function computeVoiceHash(scenes: { voiceText: string }[], templateId?: string | null): string {
  const fullText = scenes.map((s) => s.voiceText).join('\n\n').trim();
  return textHash(fullText, templateId);
}

export async function generateVoicePreview(projectId: string): Promise<void> {
  await prisma.project.update({
    where: { id: projectId },
    data: { voicePreviewStatus: 'pending', voicePreviewError: '' },
  });
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { scenes: { orderBy: { order: 'asc' } } },
    });
    if (!project) return;
    const fullText = project.scenes.map((s) => s.voiceText).join('\n\n').trim();
    if (!fullText) throw new Error('Нет текста для озвучки');

    const hash = textHash(fullText, project.voiceTemplateId);

    const voice = project.voiceTemplateId ? { template_uuid: project.voiceTemplateId } : undefined;
    const taskId = await voicer.createTask(fullText, voice);
    await voicer.waitUntilReady(taskId);
    const raw = await voicer.downloadResult(taskId);

    const dir = path.join(projectDir(projectId, project.folderName), 'voice');
    fs.mkdirSync(dir, { recursive: true });
    const audioPath = await saveAudio(raw, dir);

    // Try to get word-level timestamps
    const timestamps = await voicer.downloadTimestamps(taskId);
    if (timestamps && timestamps.length > 0) {
      fs.writeFileSync(path.join(dir, 'timestamps.json'), JSON.stringify(timestamps), 'utf-8');
    }

    await prisma.project.update({
      where: { id: projectId },
      data: { voicePreviewStatus: 'done', voicePreviewPath: rel(audioPath), voiceTextHash: hash },
    });
    emitToProject(projectId, 'voice:preview:done', {});
  } catch (e: any) {
    await prisma.project.update({
      where: { id: projectId },
      data: { voicePreviewStatus: 'error', voicePreviewError: String(e?.message ?? e) },
    });
    emitToProject(projectId, 'voice:preview:error', { error: String(e?.message ?? e) });
  }
}

/** Получить актуальный путь к озвучке. Null если нет или устарела. */
export async function getValidVoicePath(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { scenes: { orderBy: { order: 'asc' } } },
  });
  if (!project) return null;

  // Своя озвучка — всегда приоритет
  if (project.customVoicePath) {
    const p = abs(project.customVoicePath);
    if (fs.existsSync(p)) return p;
  }

  // AI-озвучка: проверяем что хеш совпадает (текст не менялся)
  if (project.voicePreviewPath && project.voicePreviewStatus === 'done' && project.voiceTextHash) {
    const currentHash = computeVoiceHash(project.scenes, project.voiceTemplateId);
    if (currentHash === project.voiceTextHash) {
      const p = abs(project.voicePreviewPath);
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

/** Любая существующая озвучка (даже если хеш не совпадает — текст менялся). */
export async function getAnyVoicePath(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return null;
  if (project.customVoicePath) {
    const p = abs(project.customVoicePath);
    if (fs.existsSync(p)) return p;
  }
  if (project.voicePreviewPath && project.voicePreviewStatus === 'done') {
    const p = abs(project.voicePreviewPath);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Получить пословные тайминги если они есть. */
export function getWordTimestamps(projectId: string, folderName: string): any[] | null {
  const tsPath = path.join(projectDir(projectId, folderName), 'voice', 'timestamps.json');
  if (!fs.existsSync(tsPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(tsPath, 'utf-8'));
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}
