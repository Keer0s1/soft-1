import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { rel, projectDir } from '../lib/paths.js';

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
  const { type, timeSec } = req.body;
  if (!type || timeSec == null) return res.status(400).json({ error: 'type и timeSec обязательны' });
  const data: any = { projectId: req.params.id, type, timeSec: Number(timeSec) };
  const fields = ['text','fontFamily','fontSize','fontColor','fontWeight','outlineWidth','outlineColor',
    'shadowSize','bgEnabled','bgColor','bgOpacity','bgRadius','textPreset','filePath',
    'x','y','scale','rotation','durationSec','animIn','animOut','animIdle','animInDur','animOutDur',
    'soundFile','soundVolume'];
  const numFields = new Set(['fontSize','outlineWidth','shadowSize','bgRadius','x','y','scale','rotation',
    'timeSec','durationSec','animInDur','animOutDur','soundVolume','bgOpacity']);
  for (const k of fields) {
    if (req.body[k] !== undefined) data[k] = numFields.has(k) ? Number(req.body[k]) : req.body[k];
  }
  if (type === 'text' && !data.text) data.text = 'Текст';
  const item = await prisma.overlay.create({ data });
  res.status(201).json(item);
});

// Обновить оверлей
overlaysRouter.patch('/projects/:id/overlays/:oid', async (req, res) => {
  const data: any = {};
  const fields = ['type','text','fontFamily','fontSize','fontColor','fontWeight','outlineWidth','outlineColor',
    'shadowSize','bgEnabled','bgColor','bgOpacity','bgRadius','textPreset','filePath',
    'x','y','scale','rotation','timeSec','durationSec','animIn','animOut','animIdle','animInDur','animOutDur',
    'soundFile','soundVolume'];
  const numFields = new Set(['fontSize','outlineWidth','shadowSize','bgRadius','x','y','scale','rotation',
    'timeSec','durationSec','animInDur','animOutDur','soundVolume','bgOpacity']);
  const boolFields = new Set(['bgEnabled']);
  for (const k of fields) {
    if (req.body[k] !== undefined) {
      if (boolFields.has(k)) data[k] = Boolean(req.body[k]);
      else if (numFields.has(k)) data[k] = Number(req.body[k]);
      else data[k] = req.body[k];
    }
  }
  const item = await prisma.overlay.update({ where: { id: req.params.oid }, data });
  res.json(item);
});

// Удалить оверлей
overlaysRouter.delete('/projects/:id/overlays/:oid', async (req, res) => {
  await prisma.overlay.delete({ where: { id: req.params.oid } });
  res.json({ ok: true });
});

// Загрузить файл (image/video/audio) для оверлея
overlaysRouter.post('/projects/:id/overlays/upload', async (req, res) => {
  try {
    const { dataUri, name } = req.body;
    const m = /^data:(image|video|audio)\/[\w+]+;base64,(.+)$/s.exec(dataUri);
    if (!m) return res.status(400).json({ error: 'Ожидается image/video/audio data URI' });
    const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { folderName: true, id: true } });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const dir = path.join(projectDir(project.id, project.folderName), 'overlays');
    fs.mkdirSync(dir, { recursive: true });
    const safeName = (name || `overlay_${Date.now()}`).replace(/[^a-zA-Z0-9а-яА-Я_.-]/g, '_');
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