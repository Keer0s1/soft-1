// Превью озвучки всего сценария — чтобы прослушать голос ДО сборки ролика.
// Не бросает наружу: статус/ошибка пишутся в проект.

import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';
import * as voicer from '../lib/voicer.js';
import { saveAudio } from '../lib/ffmpeg.js';
import { rel, projectDir } from '../lib/paths.js';

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

    const voice = project.voiceTemplateId ? { template_uuid: project.voiceTemplateId } : undefined;
    const taskId = await voicer.createTask(fullText, voice);
    await voicer.waitUntilReady(taskId);
    const raw = await voicer.downloadResult(taskId);

    const dir = path.join(projectDir(projectId, project.folderName), 'preview');
    fs.mkdirSync(dir, { recursive: true });
    const audioPath = await saveAudio(raw, dir);

    await prisma.project.update({
      where: { id: projectId },
      data: { voicePreviewStatus: 'done', voicePreviewPath: rel(audioPath) },
    });
  } catch (e: any) {
    await prisma.project.update({
      where: { id: projectId },
      data: { voicePreviewStatus: 'error', voicePreviewError: String(e?.message ?? e) },
    });
  }
}
