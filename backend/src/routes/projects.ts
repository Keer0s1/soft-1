import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '../db.js';
import { parseTwoFiles } from '../lib/parse.js';
import { makeFolderName } from '../lib/paths.js';
import { env } from '../env.js';
import { createProjectSchema, updateProjectSchema, replaceScenesSchema, replaceScenesWithImagesSchema, parseFilesSchema } from '../schemas.js';
import { saveUploadedImage } from '../services/images.js';

export const projectsRouter = Router();

// Абсолютный путь к папке проекта на диске (чтобы показать в UI)
const folderPathOf = (p: { id: string; folderName: string }) =>
  path.join(env.DATA_DIR, 'projects', p.folderName || p.id);

// Список проектов (с числом сцен и последним запуском)
projectsRouter.get('/', async (req, res) => {
  const showArchived = req.query.archived === 'true';
  const projects = await prisma.project.findMany({
    where: { archived: showArchived },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { scenes: true, jobs: true } },
      jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
      scenes: {
        where: { imageStatus: 'done' },
        orderBy: { order: 'asc' },
        take: 1,
        select: { imagePath: true },
      },
    },
  });
  res.json(projects);
});

// Создать проект (+ задать человекочитаемое имя папки на диске)
projectsRouter.post('/', async (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const clean = parsed.data.title?.trim() || 'Без названия';
  const created = await prisma.project.create({ data: { title: clean } });
  const project = await prisma.project.update({
    where: { id: created.id },
    data: { folderName: makeFolderName(clean, created.id) },
  });
  res.status(201).json(project);
});

// Получить проект со сценами и историей
projectsRouter.get('/:id', async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      scenes: {
        orderBy: { order: 'asc' },
        include: { images: { orderBy: { createdAt: 'desc' }, select: { id: true, path: true, source: true, createdAt: true } } },
      },
      jobs: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!project) return res.status(404).json({ error: 'Проект не найден' });
  res.json({ ...project, folderPath: folderPathOf(project) });
});

// Обновить настройки проекта
projectsRouter.patch('/:id', async (req, res) => {
  const parsed = updateProjectSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data: Record<string, unknown> = {};
  const b = parsed.data;
  if (b.title !== undefined) data.title = b.title;
  if (b.provider !== undefined) data.provider = b.provider;
  if (b.model !== undefined) data.model = b.model;
  if (b.aspectRatio !== undefined) data.aspectRatio = b.aspectRatio;
  if (b.voiceTemplateId !== undefined) data.voiceTemplateId = b.voiceTemplateId;
  if (b.zoomEnabled !== undefined) data.zoomEnabled = b.zoomEnabled;
  if (b.zoomIntensity !== undefined) data.zoomIntensity = b.zoomIntensity;
  if (b.zoomPresets !== undefined) data.zoomPresets = b.zoomPresets;
  if (b.transitionEnabled !== undefined) data.transitionEnabled = b.transitionEnabled;
  if (b.transitionDuration !== undefined) data.transitionDuration = b.transitionDuration;
  if (b.transitionPresets !== undefined) data.transitionPresets = b.transitionPresets;
  if (b.renderQuality !== undefined) data.renderQuality = b.renderQuality;
  // Grading
  if (b.grainEnabled !== undefined) data.grainEnabled = b.grainEnabled;
  if (b.grainIntensity !== undefined) data.grainIntensity = b.grainIntensity;
  if (b.vignetteEnabled !== undefined) data.vignetteEnabled = b.vignetteEnabled;
  if (b.vignetteIntensity !== undefined) data.vignetteIntensity = b.vignetteIntensity;
  if (b.lutFile !== undefined) data.lutFile = b.lutFile;
  // Color correction
  if (b.ccBrightness !== undefined) data.ccBrightness = b.ccBrightness;
  if (b.ccContrast !== undefined) data.ccContrast = b.ccContrast;
  if (b.ccSaturation !== undefined) data.ccSaturation = b.ccSaturation;
  if (b.ccTemperature !== undefined) data.ccTemperature = b.ccTemperature;
  // Music
  if (b.bgMusicPath !== undefined) data.bgMusicPath = b.bgMusicPath;
  if (b.bgMusicVolume !== undefined) data.bgMusicVolume = b.bgMusicVolume;
  if (b.bgMusicDucking !== undefined) data.bgMusicDucking = b.bgMusicDucking;
  // Subtitles
  if (b.subtitlesEnabled !== undefined) data.subtitlesEnabled = b.subtitlesEnabled;
  if (b.subtitlesStyle !== undefined) data.subtitlesStyle = b.subtitlesStyle;
  if (b.subtitlesFontSize !== undefined) data.subtitlesFontSize = b.subtitlesFontSize;
  if (b.subtitlesPosition !== undefined) data.subtitlesPosition = b.subtitlesPosition;
  if (b.subtitlesX !== undefined) data.subtitlesX = b.subtitlesX;
  if (b.subtitlesY !== undefined) data.subtitlesY = b.subtitlesY;
  if (b.subtitlesColor !== undefined) data.subtitlesColor = b.subtitlesColor;
  if (b.subtitlesOutline !== undefined) data.subtitlesOutline = b.subtitlesOutline;
  if (b.subtitlesOutlineColor !== undefined) data.subtitlesOutlineColor = b.subtitlesOutlineColor;
  if (b.subtitlesShadow !== undefined) data.subtitlesShadow = b.subtitlesShadow;
  if (b.subtitlesAnimation !== undefined) data.subtitlesAnimation = b.subtitlesAnimation;
  if (b.subtitlesBgEnabled !== undefined) data.subtitlesBgEnabled = b.subtitlesBgEnabled;
  if (b.subtitlesBgColor !== undefined) data.subtitlesBgColor = b.subtitlesBgColor;
  if (b.subtitlesBgOpacity !== undefined) data.subtitlesBgOpacity = b.subtitlesBgOpacity;

  const project = await prisma.project.update({ where: { id: req.params.id }, data });
  res.json(project);
});

// Удалить проект (soft: архив, permanent: полное удаление с файлами)
projectsRouter.delete('/:id', async (req, res) => {
  const permanent = req.query.permanent === 'true';
  if (permanent) {
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (project) {
      const dir = path.join(env.DATA_DIR, 'projects', project.folderName || project.id);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
    await prisma.project.delete({ where: { id: req.params.id } });
  } else {
    await prisma.project.update({ where: { id: req.params.id }, data: { archived: true } });
  }
  res.status(204).end();
});

// Восстановить архивный проект
projectsRouter.post('/:id/restore', async (req, res) => {
  const project = await prisma.project.update({ where: { id: req.params.id }, data: { archived: false } });
  res.json(project);
});

// Полностью заменить сцены проекта массивом [{voiceText, imagePrompt}]
projectsRouter.put('/:id/scenes', async (req, res) => {
  const parsed = replaceScenesSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const scenes = parsed.data.scenes;
  await prisma.$transaction([
    prisma.scene.deleteMany({ where: { projectId: req.params.id } }),
    prisma.scene.createMany({
      data: scenes.map((s, i) => ({
        projectId: req.params.id,
        order: i,
        voiceText: s.voiceText,
        imagePrompt: s.imagePrompt,
      })),
    }),
    prisma.project.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } }),
  ]);
  const updated = await prisma.scene.findMany({
    where: { projectId: req.params.id },
    orderBy: { order: 'asc' },
  });
  res.json(updated);
});

// Разобрать два файла (речь + промты) в сцены по строкам (без сохранения)
projectsRouter.post('/:id/parse', async (req, res) => {
  const parsed = parseFilesSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const scenes = parseTwoFiles(parsed.data.speechText, parsed.data.promptsText);
    res.json({ scenes });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// Импорт сцен сразу с прикреплёнными картинками. Каждая сцена может содержать
// imageDataUri — тогда после создания сцены сохраняем картинку как активный вариант,
// и сцена сразу будет имитировать статус "done" (как если бы пользователь загрузил вручную).
projectsRouter.post('/:id/scenes/with-images', async (req, res) => {
  const parsed = replaceScenesWithImagesSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const items = parsed.data.scenes;
  try {
    // 1. Полностью заменяем сцены проекта (как делает PUT /scenes)
    await prisma.$transaction([
      prisma.scene.deleteMany({ where: { projectId: req.params.id } }),
      prisma.scene.createMany({
        data: items.map((s, i) => ({
          projectId: req.params.id,
          order: i,
          voiceText: s.voiceText,
          imagePrompt: s.imagePrompt,
        })),
      }),
      prisma.project.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } }),
    ]);
    const created = await prisma.scene.findMany({
      where: { projectId: req.params.id },
      orderBy: { order: 'asc' },
    });

    // 2. Цепляем загруженные картинки на соответствующие сцены
    for (let i = 0; i < created.length; i++) {
      const dataUri = items[i]?.imageDataUri;
      if (!dataUri) continue;
      try {
        await saveUploadedImage(created[i].id, dataUri);
      } catch (e: any) {
        console.warn(`upload scene ${i}: ${e?.message ?? e}`);
      }
    }

    const final = await prisma.scene.findMany({
      where: { projectId: req.params.id },
      orderBy: { order: 'asc' },
      include: { images: { orderBy: { createdAt: 'desc' }, select: { id: true, path: true, source: true, createdAt: true } } },
    });
    res.json(final);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});
