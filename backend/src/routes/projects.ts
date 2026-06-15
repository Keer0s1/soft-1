import { Router } from 'express';
import path from 'node:path';
import { prisma } from '../db.js';
import { parseScript } from '../lib/parse.js';
import { makeFolderName } from '../lib/paths.js';
import { env } from '../env.js';

export const projectsRouter = Router();

// Абсолютный путь к папке проекта на диске (чтобы показать в UI)
const folderPathOf = (p: { id: string; folderName: string }) =>
  path.join(env.DATA_DIR, 'projects', p.folderName || p.id);

// Список проектов (с числом сцен и последним запуском)
projectsRouter.get('/', async (_req, res) => {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { scenes: true, jobs: true } },
      jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  res.json(projects);
});

// Создать проект (+ задать человекочитаемое имя папки на диске)
projectsRouter.post('/', async (req, res) => {
  const { title } = req.body ?? {};
  const clean = title?.trim() || 'Без названия';
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
  const { title, provider, model, aspectRatio, voiceTemplateId } = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (title !== undefined) data.title = String(title);
  if (provider !== undefined) data.provider = String(provider);
  if (model !== undefined) data.model = model === null ? null : String(model);
  if (aspectRatio !== undefined) data.aspectRatio = String(aspectRatio);
  if (voiceTemplateId !== undefined)
    data.voiceTemplateId = voiceTemplateId === null ? null : String(voiceTemplateId);
  const project = await prisma.project.update({ where: { id: req.params.id }, data });
  res.json(project);
});

// Удалить проект
projectsRouter.delete('/:id', async (req, res) => {
  await prisma.project.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// Полностью заменить сцены проекта массивом [{voiceText, imagePrompt}]
projectsRouter.put('/:id/scenes', async (req, res) => {
  const scenes = req.body?.scenes;
  if (!Array.isArray(scenes)) return res.status(400).json({ error: 'Ожидается массив scenes' });
  await prisma.$transaction([
    prisma.scene.deleteMany({ where: { projectId: req.params.id } }),
    prisma.scene.createMany({
      data: scenes.map((s: any, i: number) => ({
        projectId: req.params.id,
        order: i,
        voiceText: String(s.voiceText ?? ''),
        imagePrompt: String(s.imagePrompt ?? ''),
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

// Разобрать вставленный текст сценария в сцены (без сохранения)
projectsRouter.post('/:id/parse', async (req, res) => {
  const { scriptText, promptsText } = req.body ?? {};
  try {
    const scenes = parseScript(String(scriptText ?? ''), promptsText ? String(promptsText) : undefined);
    res.json({ scenes });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});
