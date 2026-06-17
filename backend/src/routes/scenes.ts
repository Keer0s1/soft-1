import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';
import { abs, rel, projectDir } from '../lib/paths.js';
import { generateSceneImage, generateMissing, saveUploadedImage, setActiveImage, activeGenerations } from '../services/images.js';
import { generateVoicePreview, getWordTimestamps } from '../services/voice.js';
import { assemblyBlockReason } from '../services/pipeline.js';
import { runVideoPreview } from '../services/videoPreview.js';
import { taskQueue } from '../lib/taskQueue.js';
import { createSceneSchema, updateSceneSchema, reorderScenesSchema, genImageSchema, uploadImageSchema, setActiveImageSchema, batchUpdateScenesSchema } from '../schemas.js';

export const scenesRouter = Router();

// Лёгкий эндпоинт для поллинга статусов картинок + варианты + можно ли собирать
scenesRouter.get('/projects/:id/scenes/status', async (req, res) => {
  const scenes = await prisma.scene.findMany({
    where: { projectId: req.params.id },
    orderBy: { order: 'asc' },
    select: {
      id: true, imageStatus: true, imagePath: true, imageError: true, imageSource: true,
      imageUpdatedAt: true, activeImageId: true,
      images: { orderBy: { createdAt: 'desc' }, select: { id: true, path: true, source: true, createdAt: true } },
    },
  });
  const blockReason = await assemblyBlockReason(req.params.id);
  res.json({ scenes, blockReason, canAssemble: blockReason === null });
});

// Создать одну сцену в конце
scenesRouter.post('/projects/:id/scenes', async (req, res) => {
  const parsed = createSceneSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const count = await prisma.scene.count({ where: { projectId: req.params.id } });
  const scene = await prisma.scene.create({
    data: {
      projectId: req.params.id,
      order: count,
      voiceText: parsed.data.voiceText,
      imagePrompt: parsed.data.imagePrompt,
    },
  });
  res.status(201).json(scene);
});

// Поменять порядок сцен
scenesRouter.post('/projects/:id/scenes/reorder', async (req, res) => {
  const parsed = reorderScenesSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const ids = parsed.data.orderedIds;
  await prisma.$transaction(
    ids.map((id, i) => prisma.scene.update({ where: { id }, data: { order: i } })),
  );
  res.json({ ok: true });
});

// Сгенерировать картинки всем недостающим/ошибочным сценам (фоном)
scenesRouter.post('/projects/:id/images/generate-missing', async (req, res) => {
  const taskId = `gen-missing-${req.params.id}`;
  if (taskQueue.has(taskId)) return res.status(202).json({ ok: true });
  taskQueue.run(taskId, 'generate-missing', (signal) => generateMissing(req.params.id, signal));
  res.status(202).json({ ok: true });
});

// Отменить генерацию картинок (только те что ещё в очереди, не ушли на API)
scenesRouter.delete('/projects/:id/images/cancel', async (req, res) => {
  const taskId = `gen-missing-${req.params.id}`;
  const cancelled = taskQueue.cancel(taskId);
  const pending = await prisma.scene.findMany({
    where: { projectId: req.params.id, imageStatus: 'pending' },
    select: { id: true },
  });
  const toReset = pending.filter((s) => !activeGenerations.has(s.id)).map((s) => s.id);
  if (toReset.length > 0) {
    await prisma.scene.updateMany({
      where: { id: { in: toReset } },
      data: { imageStatus: 'none', imageError: 'Отменено' },
    });
  }
  res.json({ ok: true, cancelled, resetCount: toReset.length });
});

// Превью озвучки всего сценария (фоном)
scenesRouter.post('/projects/:id/voice-preview', async (req, res) => {
  const taskId = `voice-preview-${req.params.id}`;
  if (taskQueue.has(taskId)) return res.status(202).json({ ok: true });
  taskQueue.run(taskId, 'voice-preview', () => generateVoicePreview(req.params.id));
  res.status(202).json({ ok: true });
});

// Авто видео-превью (ffmpeg, низкое разрешение, вызывается фронтом по debounce)
scenesRouter.post('/projects/:id/video-preview', async (req, res) => {
  const taskId = `video-preview-${req.params.id}`;
  if (taskQueue.has(taskId)) {
    taskQueue.cancel(taskId);
  }
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { voicePreviewPath: true, voicePreviewStatus: true } });
  if (!project) return res.status(404).json({ error: 'Проект не найден' });
  if (!project.voicePreviewPath || project.voicePreviewStatus !== 'done') {
    return res.status(400).json({ error: 'Сначала сгенерируйте озвучку' });
  }
  taskQueue.run(taskId, 'video-preview', () => runVideoPreview(req.params.id));
  res.status(202).json({ ok: true });
});

// Пословные тайминги озвучки (для karaoke-субтитров на фронте)
scenesRouter.get('/projects/:id/voice-timestamps', async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { id: true, folderName: true, voicePreviewPath: true } });
  if (!project) return res.status(404).json({ error: 'Проект не найден' });
  const timestamps = getWordTimestamps(project.id, project.folderName);
  if (timestamps && timestamps.length > 0) return res.json(timestamps);

  // Fallback: generate proportional timestamps from scenes text + audio duration
  try {
    const scenes = await prisma.scene.findMany({ where: { projectId: project.id }, orderBy: { order: 'asc' }, select: { voiceText: true } });
    if (!scenes.length || !project.voicePreviewPath) return res.json([]);
    const { audioDuration } = await import('../lib/ffmpeg.js');
    const { abs } = await import('../lib/paths.js');
    const dur = await audioDuration(abs(project.voicePreviewPath));
    if (!dur || dur <= 0) return res.json([]);
    const fullText = scenes.map(s => s.voiceText).join(' ');
    const words = fullText.split(/\s+/).filter(w => w.trim());
    if (!words.length) return res.json([]);
    const perWord = dur / words.length;
    const result = words.map((word, i) => ({ word, startSec: +(i * perWord).toFixed(3), endSec: +((i + 1) * perWord).toFixed(3) }));
    res.json(result);
  } catch {
    res.json([]);
  }
});

// Обновить текст/промт/эффекты сцены
scenesRouter.patch('/projects/:id/scenes/:sceneId', async (req, res) => {
  const parsed = updateSceneSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data: Record<string, unknown> = {};
  if (parsed.data.voiceText !== undefined) data.voiceText = parsed.data.voiceText;
  if (parsed.data.imagePrompt !== undefined) data.imagePrompt = parsed.data.imagePrompt;
  if (parsed.data.effectOverrides !== undefined) data.effectOverrides = parsed.data.effectOverrides;
  if (parsed.data.durationOverride !== undefined) data.durationOverride = parsed.data.durationOverride;
  const scene = await prisma.scene.update({ where: { id: req.params.sceneId }, data });
  res.json(scene);
});

// Batch-update per-scene overrides (multi-select on timeline)
scenesRouter.post('/projects/:id/scenes/batch-update', async (req, res) => {
  const parsed = batchUpdateScenesSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { sceneIds, patch } = parsed.data;
  const data: Record<string, unknown> = {};
  if (patch.effectOverrides !== undefined) data.effectOverrides = patch.effectOverrides;
  if (patch.durationOverride !== undefined) data.durationOverride = patch.durationOverride;
  await prisma.scene.updateMany({ where: { id: { in: sceneIds }, projectId: req.params.id }, data });
  res.json({ ok: true, updated: sceneIds.length });
});

// Удалить сцену (и файлы всех её вариантов картинок)
scenesRouter.delete('/projects/:id/scenes/:sceneId', async (req, res) => {
  const variants = await prisma.sceneImage.findMany({ where: { sceneId: req.params.sceneId } });
  for (const v of variants) {
    try {
      fs.rmSync(abs(v.path), { force: true });
    } catch {
      /* не критично */
    }
  }
  await prisma.scene.delete({ where: { id: req.params.sceneId } });
  res.status(204).end();
});

// Выбрать прошлый вариант картинки активным
scenesRouter.post('/projects/:id/scenes/:sceneId/active', async (req, res) => {
  const parsed = setActiveImageSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    await setActiveImage(req.params.sceneId, parsed.data.imageId);
    const scene = await prisma.scene.findUnique({ where: { id: req.params.sceneId } });
    res.json(scene);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// (Пере)генерировать картинку одной сцены. body: { newSeed?: boolean }
scenesRouter.post('/projects/:id/scenes/:sceneId/image', async (req, res) => {
  const parsed = genImageSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  generateSceneImage(req.params.sceneId, { newSeed: parsed.data.newSeed }).catch((e) =>
    console.error('generateSceneImage:', e),
  );
  res.status(202).json({ ok: true });
});

// Загрузить свою картинку на сцену. body: { dataUri }
scenesRouter.post('/projects/:id/scenes/:sceneId/upload', async (req, res) => {
  const parsed = uploadImageSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    await saveUploadedImage(req.params.sceneId, parsed.data.dataUri);
    const scene = await prisma.scene.findUnique({ where: { id: req.params.sceneId } });
    res.json(scene);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// Загрузить свою озвучку (mp3/wav). Заменяет AI-озвучку — будет использоваться при сборке.
scenesRouter.post('/projects/:id/voice-upload', async (req, res) => {
  try {
    const dataUri = String(req.body?.dataUri ?? '');
    const m = /^data:audio\/[\w+]+;base64,(.+)$/s.exec(dataUri);
    if (!m) return res.status(400).json({ error: 'Ожидается audio в формате data:audio/...;base64,...' });
    const bytes = Buffer.from(m[1], 'base64');
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const dir = path.join(projectDir(project.id, project.folderName), 'voice');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `custom_${Date.now()}.mp3`);
    fs.writeFileSync(file, bytes);
    const relPath = rel(file);
    await prisma.project.update({
      where: { id: req.params.id },
      data: { customVoicePath: relPath, voicePreviewPath: relPath, voicePreviewStatus: 'done' },
    });
    res.json({ path: relPath });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// Убрать свою озвучку (вернуться к AI)
scenesRouter.delete('/projects/:id/voice-custom', async (req, res) => {
  await prisma.project.update({ where: { id: req.params.id }, data: { customVoicePath: null } });
  res.json({ ok: true });
});

// Загрузить фоновую музыку с компа. body: { dataUri: "data:audio/...;base64,..." }
scenesRouter.post('/projects/:id/music', async (req, res) => {
  try {
    const dataUri = String(req.body?.dataUri ?? '');
    const m = /^data:audio\/[\w+]+;base64,(.+)$/s.exec(dataUri);
    if (!m) return res.status(400).json({ error: 'Ожидается audio в формате data:audio/...;base64,...' });
    const bytes = Buffer.from(m[1], 'base64');
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const dir = path.join(projectDir(project.id, project.folderName), 'music');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `bgm_${Date.now()}.mp3`);
    fs.writeFileSync(file, bytes);
    const relPath = rel(file);
    await prisma.project.update({ where: { id: req.params.id }, data: { bgMusicPath: relPath } });
    res.json({ path: relPath });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});
