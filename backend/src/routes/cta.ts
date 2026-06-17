import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';
import { env } from '../env.js';

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
  const { text, emoji, imagePath, timeSec, durationSec, x, y, scale, animation, style, color } = req.body;
  if ((!text && !imagePath) || timeSec == null) return res.status(400).json({ error: 'text (или imagePath) и timeSec обязательны' });
  const item = await prisma.ctaOverlay.create({
    data: {
      projectId: req.params.id,
      text: text || '',
      emoji: emoji || '',
      imagePath: imagePath || null,
      timeSec: Number(timeSec),
      durationSec: durationSec ?? 3.0,
      x: x ?? 80,
      y: y ?? 85,
      scale: scale ?? 1.0,
      animation: animation || 'slideIn',
      style: style || 'pill',
      color: color || '#FF0000',
    },
  });
  res.json(item);
});

// Обновить CTA
ctaRouter.patch('/projects/:id/cta/:cid', async (req, res) => {
  const data: any = {};
  for (const k of ['text','emoji','imagePath','timeSec','durationSec','x','y','scale','animation','style','color']) {
    if (req.body[k] !== undefined) data[k] = ['timeSec','durationSec','x','y','scale'].includes(k) ? Number(req.body[k]) : req.body[k];
  }
  const item = await prisma.ctaOverlay.update({ where: { id: req.params.cid }, data });
  res.json(item);
});

// Удалить CTA
ctaRouter.delete('/projects/:id/cta/:cid', async (req, res) => {
  await prisma.ctaOverlay.delete({ where: { id: req.params.cid } });
  res.json({ ok: true });
});

// Загрузить картинку или видео-оверлей
ctaRouter.post('/projects/:id/cta/upload-image', async (req, res) => {
  try {
    const { dataUri, name } = req.body;
    const m = /^data:(image|video)\/[\w+]+;base64,(.+)$/s.exec(dataUri);
    if (!m) return res.status(400).json({ error: 'Ожидается image/video data URI' });
    const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { folderName: true } });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const dir = path.join(env.DATA_DIR, 'projects', project.folderName, 'overlays');
    fs.mkdirSync(dir, { recursive: true });
    const safeName = (name || `overlay_${Date.now()}`).replace(/[^a-zA-Z0-9а-яА-Я_.-]/g, '_');
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
