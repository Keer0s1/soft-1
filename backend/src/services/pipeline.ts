// Оркестрация сборки ролика: сценарий -> озвучка (одним куском) + картинки -> MP4.
// Тайминг: длительность каждой картинки пропорциональна числу символов её текста,
// чтобы смена кадров попадала под слова. Прогресс и история пишутся в БД.

import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';
import { env, JOBS_DIR } from '../env.js';
import * as voicer from '../lib/voicer.js';
import * as fastgen from '../lib/fastgen.js';
import { audioDuration, saveAudio, renderVideo } from '../lib/ffmpeg.js';

/** Путь относительно DATA_DIR — его отдаёт статика по /files/... */
function rel(absPath: string): string {
  return path.relative(env.DATA_DIR, absPath).split(path.sep).join('/');
}

async function appendLog(jobId: string, msg: string) {
  const stamp = new Date().toLocaleTimeString('ru-RU', { hour12: false });
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { log: true } });
  const log = Array.isArray(job?.log) ? (job!.log as string[]) : [];
  log.push(`[${stamp}] ${msg}`);
  await prisma.job.update({ where: { id: jobId }, data: { log } });
}

const setStep = (jobId: string, step: string) =>
  prisma.job.update({ where: { id: jobId }, data: { step } });

/** Запустить картинки с ограничением параллелизма (лимит fast-gen — 5). */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function runner() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

/** Создать Job для проекта (снимок текущих сцен и настроек) и вернуть его id. */
export async function createJob(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { scenes: { orderBy: { order: 'asc' } } },
  });
  if (!project) throw new Error('Проект не найден');
  if (project.scenes.length === 0) throw new Error('В проекте нет сцен');

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
        })),
      },
    },
  });
  return job.id;
}

/** Полный прогон. Вызывать НЕ дожидаясь (фоном) — клиент опрашивает статус. */
export async function runJob(jobId: string): Promise<void> {
  const jobDir = path.join(JOBS_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        results: { orderBy: { order: 'asc' } },
        project: true,
      },
    });
    if (!job) throw new Error('Job не найден');

    await prisma.job.update({ where: { id: jobId }, data: { status: 'running' } });

    const scenes = job.results; // снимок сцен в порядке
    const fullText = scenes.map((s) => s.voiceText).join('\n\n');

    // 1) Озвучка целиком (обходит минималку 500 символов на задачу)
    await setStep(jobId, 'Озвучка: отправка задачи в Voicer');
    await appendLog(jobId, `Сцен: ${scenes.length}, символов текста: ${fullText.length}`);
    const voice = job.project.voiceTemplateId
      ? { template_uuid: job.project.voiceTemplateId }
      : undefined;
    const taskId = await voicer.createTask(fullText, voice);
    await prisma.job.update({ where: { id: jobId }, data: { voicerTaskId: String(taskId) } });
    await appendLog(jobId, `Voicer-задача создана: ${taskId}`);

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

    // 3) Генерация картинок (с ограничением параллелизма)
    await setStep(jobId, `Генерация картинок (0/${scenes.length})`);
    const imagesDir = path.join(jobDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    let done = 0;

    const imagePaths = await mapWithConcurrency(scenes, env.IMAGE_CONCURRENCY, async (scene, i) => {
      try {
        const opId = await fastgen.submitImage(scene.imagePrompt, {
          provider: job.provider,
          model: job.model,
          aspectRatio: job.aspectRatio,
        });
        const bytes = await fastgen.waitForImage(opId);
        const p = path.join(imagesDir, `scene_${String(i).padStart(3, '0')}.png`);
        fs.writeFileSync(p, bytes);
        await prisma.sceneResult.update({
          where: { id: scene.id },
          data: { imagePath: rel(p), operationId: opId, durationSec: durations[i], status: 'done' },
        });
        done += 1;
        await setStep(jobId, `Генерация картинок (${done}/${scenes.length})`);
        await prisma.job.update({ where: { id: jobId }, data: { imagesDone: done } });
        await appendLog(jobId, `Картинка ${i + 1}/${scenes.length} готова`);
        return p;
      } catch (e: any) {
        await prisma.sceneResult.update({
          where: { id: scene.id },
          data: { status: 'error', error: String(e?.message ?? e) },
        });
        throw e;
      }
    });

    // 4) Сборка видео
    await setStep(jobId, 'Сборка видео (ffmpeg)');
    const out = await renderVideo({
      jobDir,
      aspectRatio: job.aspectRatio,
      audioPath,
      images: imagePaths.map((p, i) => ({ path: p, durationSec: durations[i] })),
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
