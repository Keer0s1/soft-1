import { Router } from 'express';
import fs from 'node:fs';
import { prisma } from '../db.js';
import { abs } from '../lib/paths.js';
import { generateSceneImage, generateMissing, saveUploadedImage } from '../services/images.js';
import { generateVoicePreview } from '../services/voice.js';
import { assemblyBlockReason } from '../services/pipeline.js';

export const scenesRouter = Router();

// Лёгкий эндпоинт для поллинга статусов картинок + можно ли собирать
scenesRouter.get('/projects/:id/scenes/status', async (req, res) => {
  const scenes = await prisma.scene.findMany({
    where: { projectId: req.params.id },
    orderBy: { order: 'asc' },
    select: { id: true, imageStatus: true, imagePath: true, imageError: true, imageSource: true, imageUpdatedAt: true },
  });
  const blockReason = await assemblyBlockReason(req.params.id);
  res.json({ scenes, blockReason, canAssemble: blockReason === null });
});

// Создать одну сцену в конце
scenesRouter.post('/projects/:id/scenes', async (req, res) => {
  const count = await prisma.scene.count({ where: { projectId: req.params.id } });
  const scene = await prisma.scene.create({
    data: {
      projectId: req.params.id,
      order: count,
      voiceText: String(req.body?.voiceText ?? ''),
      imagePrompt: String(req.body?.imagePrompt ?? ''),
    },
  });
  res.status(201).json(scene);
});

// Поменять порядок сцен
scenesRouter.post('/projects/:id/scenes/reorder', async (req, res) => {
  const ids: string[] = req.body?.orderedIds ?? [];
  await prisma.$transaction(
    ids.map((id, i) => prisma.scene.update({ where: { id }, data: { order: i } })),
  );
  res.json({ ok: true });
});

// Сгенерировать картинки всем недостающим/ошибочным сценам (фоном)
scenesRouter.post('/projects/:id/images/generate-missing', async (req, res) => {
  generateMissing(req.params.id).catch((e) => console.error('generateMissing:', e));
  res.status(202).json({ ok: true });
});

// Превью озвучки всего сценария (фоном)
scenesRouter.post('/projects/:id/voice-preview', async (req, res) => {
  generateVoicePreview(req.params.id).catch((e) => console.error('voicePreview:', e));
  res.status(202).json({ ok: true });
});

// Обновить текст/промт сцены (картинку НЕ трогаем)
scenesRouter.patch('/projects/:id/scenes/:sceneId', async (req, res) => {
  const data: Record<string, unknown> = {};
  if (req.body?.voiceText !== undefined) data.voiceText = String(req.body.voiceText);
  if (req.body?.imagePrompt !== undefined) data.imagePrompt = String(req.body.imagePrompt);
  const scene = await prisma.scene.update({ where: { id: req.params.sceneId }, data });
  res.json(scene);
});

// Удалить сцену (и файл её картинки)
scenesRouter.delete('/projects/:id/scenes/:sceneId', async (req, res) => {
  const scene = await prisma.scene.findUnique({ where: { id: req.params.sceneId } });
  if (scene?.imagePath) {
    try {
      fs.rmSync(abs(scene.imagePath), { force: true });
    } catch {
      /* не критично */
    }
  }
  await prisma.scene.delete({ where: { id: req.params.sceneId } });
  res.status(204).end();
});

// (Пере)генерировать картинку одной сцены. body: { newSeed?: boolean }
scenesRouter.post('/projects/:id/scenes/:sceneId/image', async (req, res) => {
  const newSeed = !!req.body?.newSeed;
  generateSceneImage(req.params.sceneId, { newSeed }).catch((e) =>
    console.error('generateSceneImage:', e),
  );
  res.status(202).json({ ok: true });
});

// Загрузить свою картинку на сцену. body: { dataUri }
scenesRouter.post('/projects/:id/scenes/:sceneId/upload', async (req, res) => {
  try {
    await saveUploadedImage(req.params.sceneId, String(req.body?.dataUri ?? ''));
    const scene = await prisma.scene.findUnique({ where: { id: req.params.sceneId } });
    res.json(scene);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});
