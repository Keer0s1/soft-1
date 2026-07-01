import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { uploadCtaImageSchema } from '../schemas.js';

const ctaCreateSchema = z.object({
  text: z.string().max(500).optional(),
  emoji: z.string().max(20).optional(),
  imagePath: z.string().max(500).nullable().optional(),
  timeSec: z.number().min(0).max(86400),
  durationSec: z.number().min(0.1).max(60).optional(),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
  scale: z.number().min(0.1).max(5).optional(),
  animation: z.string().max(40).optional(),
  style: z.string().max(40).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
}).refine((d) => Boolean(d.text || d.imagePath), { message: 'text или imagePath обязателен' });

const ctaUpdateSchema = z.object({
  text: z.string().max(500).optional(),
  emoji: z.string().max(20).optional(),
  imagePath: z.string().max(500).nullable().optional(),
  timeSec: z.number().min(0).max(86400).optional(),
  durationSec: z.number().min(0.1).max(60).optional(),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
  scale: z.number().min(0.1).max(5).optional(),
  animation: z.string().max(40).optional(),
  style: z.string().max(40).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export const ctaRouter = Router();

// Список CTA-оверлеев проекта
ctaRouter.get('/projects/:id/cta', async (req, res) => {
  const items = await prisma.ctaOverlay.findMany({
    where: { projectId: req.params.id },
    orderBy: { timeSec: 'asc' },
  });
  res.json(items);
});

// Создать CTA
ctaRouter.post('/projects/:id/cta', async (req, res) => {
  const parsed = ctaCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;
  const item = await prisma.ctaOverlay.create({
    data: {
      projectId: req.params.id,
      text: d.text ?? '',
      emoji: d.emoji ?? '',
      imagePath: d.imagePath ?? null,
      timeSec: d.timeSec,
      durationSec: d.durationSec ?? 3.0,
      x: d.x ?? 80,
      y: d.y ?? 85,
      scale: d.scale ?? 1.0,
      animation: d.animation ?? 'slideIn',
      style: d.style ?? 'pill',
      color: d.color ?? '#FF0000',
    },
  });
  res.json(item);
});

// Обновить CTA
ctaRouter.patch('/projects/:id/cta/:cid', async (req, res) => {
  const parsed = ctaUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const item = await prisma.ctaOverlay.update({ where: { id: req.params.cid }, data: parsed.data });
  res.json(item);
});

// Удалить CTA
ctaRouter.delete('/projects/:id/cta/:cid', async (req, res) => {
  await prisma.ctaOverlay.delete({ where: { id: req.params.cid } });
  res.json({ ok: true });
});

// Загрузить картинку или видео-оверлей
ctaRouter.post('/projects/:id/cta/upload-image', async (req, res) => {
  // Принимаем image/video для CTA-оверлеев (валидируем чуть мягче чем uploadCtaImageSchema)
  const schema = z.object({
    dataUri: z.string().regex(/^data:(image|video)\//).max(40_000_000),
    name: z.string().min(1).max(200).regex(/^[^\\/\x00\r\n]+$/),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const m = /^data:(image|video)\/[\w+]+;base64,(.+)$/s.exec(parsed.data.dataUri);
    if (!m) return res.status(400).json({ error: 'Ожидается image/video data URI' });
    const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { folderName: true } });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const dir = path.join(env.DATA_DIR, 'projects', project.folderName, 'overlays');
    fs.mkdirSync(dir, { recursive: true });
    const safeName = parsed.data.name.replace(/[^a-zA-Z0-9а-яА-Я_.-]/g, '_');
    const hasExt = /\.(png|gif|jpg|jpeg|webp|mp4|webm|mov)$/i.test(safeName);
    const ext = hasExt ? '' : (m[1] === 'video' ? '.webm' : '.png');
    const file = path.join(dir, safeName + ext);
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
    const relPath = `projects/${project.folderName}/overlays/${safeName}${ext}`;
    res.json({ path: relPath });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});
