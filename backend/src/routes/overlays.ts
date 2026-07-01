import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { rel, projectDir } from '../lib/paths.js';
import { uploadOverlaySchema } from '../schemas.js';

// Базовая валидация полей оверлея (числа в разумных пределах, цвета, текст
// до 1000 символов). Используется и при create, и при patch — на patch все
// поля optional.
const overlayFieldsSchema = z.object({
  type: z.enum(['text', 'image', 'video', 'audio']).optional(),
  text: z.string().max(1000).optional(),
  fontFamily: z.string().max(80).optional(),
  fontSize: z.number().min(8).max(400).optional(),
  fontColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  fontWeight: z.union([z.number(), z.string().max(20)]).transform((v) => String(v)).optional(),
  outlineWidth: z.number().min(0).max(20).optional(),
  outlineColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  shadowSize: z.number().min(0).max(20).optional(),
  bgEnabled: z.boolean().optional(),
  bgColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  bgOpacity: z.number().min(0).max(1).optional(),
  bgRadius: z.number().min(0).max(100).optional(),
  textPreset: z.string().max(40).optional(),
  filePath: z.string().max(500).nullable().optional(),
  x: z.number().min(-50).max(150).optional(),
  y: z.number().min(-50).max(150).optional(),
  scale: z.number().min(0.05).max(10).optional(),
  rotation: z.number().min(-360).max(360).optional(),
  timeSec: z.number().min(0).max(86400).optional(),
  durationSec: z.number().min(0.1).max(120).optional(),
  animIn: z.string().max(40).optional(),
  animOut: z.string().max(40).optional(),
  animIdle: z.string().max(40).optional(),
  animInDur: z.number().min(0).max(10).optional(),
  animOutDur: z.number().min(0).max(10).optional(),
  soundFile: z.string().max(500).nullable().optional(),
  soundVolume: z.number().min(0).max(2).optional(),
});

const overlayCreateSchema = overlayFieldsSchema.extend({
  type: z.enum(['text', 'image', 'video', 'audio']),
  timeSec: z.number().min(0).max(86400),
});

export const overlaysRouter = Router();

// Встроенные звуки для оверлеев
const BUILTIN_SOUNDS_DIR = path.join(env.DATA_DIR, 'overlay-sfx');

overlaysRouter.get('/overlays/sounds', (_req, res) => {
  if (!fs.existsSync(BUILTIN_SOUNDS_DIR)) return res.json([]);
  const files = fs.readdirSync(BUILTIN_SOUNDS_DIR).filter(f => /\.(mp3|wav|ogg)$/i.test(f));
  res.json(files.map(f => ({
    id: f,
    label: f.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
    path: `overlay-sfx/${f}`,
  })));
});

// Список оверлеев проекта
overlaysRouter.get('/projects/:id/overlays', async (req, res) => {
  const items = await prisma.overlay.findMany({
    where: { projectId: req.params.id },
    orderBy: { timeSec: 'asc' },
  });
  res.json(items);
});

// Создать оверлей
overlaysRouter.post('/projects/:id/overlays', async (req, res) => {
  const parsed = overlayCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data: any = { projectId: req.params.id, ...parsed.data };
  if (data.type === 'text' && !data.text) data.text = 'Текст';
  const item = await prisma.overlay.create({ data });
  res.status(201).json(item);
});

// Обновить оверлей
overlaysRouter.patch('/projects/:id/overlays/:oid', async (req, res) => {
  const parsed = overlayFieldsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const item = await prisma.overlay.update({ where: { id: req.params.oid }, data: parsed.data });
  res.json(item);
});

// Удалить оверлей
overlaysRouter.delete('/projects/:id/overlays/:oid', async (req, res) => {
  await prisma.overlay.delete({ where: { id: req.params.oid } });
  res.json({ ok: true });
});

// Загрузить файл (image/video/audio) для оверлея
overlaysRouter.post('/projects/:id/overlays/upload', async (req, res) => {
  const parsed = uploadOverlaySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const m = /^data:(image|video|audio)\/[\w+]+;base64,(.+)$/s.exec(parsed.data.dataUri);
    if (!m) return res.status(400).json({ error: 'Ожидается image/video/audio data URI' });
    const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { folderName: true, id: true } });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const dir = path.join(projectDir(project.id, project.folderName), 'overlays');
    fs.mkdirSync(dir, { recursive: true });
    const safeName = parsed.data.name.replace(/[^a-zA-Z0-9а-яА-Я_.-]/g, '_');
    const hasExt = /\.(png|gif|jpg|jpeg|webp|mp4|webm|mov|mp3|wav|ogg)$/i.test(safeName);
    const extMap: Record<string, string> = { image: '.png', video: '.webm', audio: '.mp3' };
    const ext = hasExt ? '' : (extMap[m[1]] || '.bin');
    const file = path.join(dir, safeName + ext);
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
    res.json({ path: rel(file) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});