// Сборка ролика (ФАЗА 2): берёт уже готовые картинки сцен + озвучивает текст
// одним куском + склеивает в MP4. Картинки тут НЕ генерируются — они делаются
// заранее, поштучно (services/images.ts). Сборка доступна только когда у всех
// сцен есть готовая картинка.

import path from 'node:path';
import { prisma } from '../db.js';
import { JOBS_DIR } from '../env.js';
import * as voicer from '../lib/voicer.js';
import { audioDuration, saveAudio, renderVideo } from '../lib/ffmpeg.js';
import { rel, abs } from '../lib/paths.js';
import fs from 'node:fs';

async function appendLog(jobId: string, msg: string) {
  const stamp = new Date().toLocaleTimeString('ru-RU', { hour12: false });
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { log: true } });
  const log = Array.isArray(job?.log) ? (job!.log as string[]) : [];
  log.push(`[${stamp}] ${msg}`);
  await prisma.job.update({ where: { id: jobId }, data: { log } });
}

const setStep = (jobId: string, step: string) =>
  prisma.job.update({ where: { id: jobId }, data: { step } });

/** Можно ли собирать: у всех сцен картинка готова. Возвращает причину, если нельзя. */
export async function assemblyBlockReason(projectId: string): Promise<string | null> {
  const scenes = await prisma.scene.findMany({ where: { projectId }, select: { imageStatus: true } });
  if (scenes.length === 0) return 'В проекте нет сцен';
  const notDone = scenes.filter((s) => s.imageStatus !== 'done').length;
  if (notDone > 0) return `Не у всех сцен готова картинка: осталось ${notDone} из ${scenes.length}`;
  return null;
}

/** Создать Job (снимок сцен и настроек). Гейт: все картинки должны быть готовы. */
export async function createJob(projectId: string): Promise<string> {
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
      aspectRatio: project.aspectRatio,
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

    // 1) Озвучка целиком
    await setStep(jobId, 'Озвучка: отправка задачи в Voicer');
    await appendLog(jobId, `Сцен: ${scenes.length}, символов текста: ${fullText.length}`);
    const voice = job.project.voiceTemplateId ? { template_uuid: job.project.voiceTemplateId } : undefined;
    const taskId = await voicer.createTask(fullText, voice);
    await prisma.job.update({ where: { id: jobId }, data: { voicerTaskId: String(taskId) } });

    await setStep(jobId, 'Озвучка: ожидание синтеза');
    await voicer.waitUntilReady(taskId);
    const raw = await voicer.downloadResult(taskId);
    const audioPath = await saveAudio(raw, jobDir);
    const total = await audioDuration(audioPath);
    await prisma.job.update({ where: { id: jobId }, data: { audioPath: rel(audioPath) } });
    await appendLog(jobId, `Озвучка готова: ${total.toFixed(1)} с`);

    // 2) Длительности картинок пропорционально длине текста сцены
    const charCounts = scenes.map((s) => Math.max(s.voiceText.length, 1));
    const totalChars = charCounts.reduce((a, b) => a + b, 0);
    const durations = charCounts.map((c) => (total * c) / totalChars);
    await Promise.all(
      scenes.map((s, i) =>
        prisma.sceneResult.update({ where: { id: s.id }, data: { durationSec: durations[i] } }),
      ),
    );
    await prisma.job.update({ where: { id: jobId }, data: { imagesDone: scenes.length } });

    // 3) Сборка видео из готовых картинок сцен
    await setStep(jobId, 'Сборка видео (ffmpeg)');
    const out = await renderVideo({
      jobDir,
      aspectRatio: job.aspectRatio,
      audioPath,
      images: scenes.map((s, i) => ({ path: abs(s.imagePath!), durationSec: durations[i] })),
    });

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'done', step: 'Готово', outputPath: rel(out), finishedAt: new Date() },
    });
    await appendLog(jobId, `Видео собрано: ${path.basename(out)}`);
  } catch (e: any) {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'error', error: String(e?.message ?? e), finishedAt: new Date() },
    });
    await appendLog(jobId, `ОШИБКА: ${e?.message ?? e}`);
  }
}
