import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';
import { rel, abs } from '../lib/paths.js';
import { env } from '../env.js';

export const sfxRouter = Router();

// Встроенная библиотека звуков (файлы в data/sfx/)
sfxRouter.get('/sfx/library', (_req, res) => {
  const dir = path.join(env.DATA_DIR, 'sfx');
  if (!fs.existsSync(dir)) { res.json([]); return; }
  const files = fs.readdirSync(dir).filter(f => /\.(mp3|wav|ogg|m4a)$/i.test(f));
  const items = files.map(f => ({
    id: f,
    file: `sfx/${f}`,
    label: f.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
    category: 'library',
  }));
  res.json(items);
});

// Свои звуки пользователя (per-project, в папке проекта)
sfxRouter.get('/projects/:id/sfx/custom', async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { folderName: true } });
  if (!project) return res.status(404).json({ error: 'Проект не найден' });
  const dir = path.join(env.DATA_DIR, 'projects', project.folderName, 'sfx');
  if (!fs.existsSync(dir)) { res.json([]); return; }
  const files = fs.readdirSync(dir).filter(f => /\.(mp3|wav|ogg|m4a)$/i.test(f));
  const items = files.map(f => ({
    id: f,
    file: `projects/${project.folderName}/sfx/${f}`,
    label: f.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
    category: 'custom',
  }));
  res.json(items);
});

// Загрузить свой звук
sfxRouter.post('/projects/:id/sfx/upload', async (req, res) => {
  try {
    const { dataUri, name } = req.body;
    const m = /^data:audio\/[\w+]+;base64,(.+)$/s.exec(dataUri);
    if (!m) return res.status(400).json({ error: 'Ожидается audio data URI' });
    const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { folderName: true } });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const dir = path.join(env.DATA_DIR, 'projects', project.folderName, 'sfx');
    fs.mkdirSync(dir, { recursive: true });
    const safeName = (name || `sound_${Date.now()}`).replace(/[^a-zA-Z0-9а-яА-Я_.-]/g, '_');
    const file = path.join(dir, safeName.endsWith('.mp3') ? safeName : `${safeName}.mp3`);
    fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
    res.json({ file: rel(file), label: safeName.replace(/\.[^.]+$/, '') });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// CRUD для размещений SFX на таймлайне
sfxRouter.get('/projects/:id/sfx/placements', async (req, res) => {
  const placements = await prisma.sfxPlacement.findMany({
    where: { projectId: req.params.id },
    orderBy: { timeSec: 'asc' },
  });
  res.json(placements);
});

sfxRouter.post('/projects/:id/sfx/placements', async (req, res) => {
  const { soundFile, label, timeSec, volume, category } = req.body;
  if (!soundFile || timeSec == null) return res.status(400).json({ error: 'soundFile и timeSec обязательны' });
  const p = await prisma.sfxPlacement.create({
    data: { projectId: req.params.id, soundFile, label: label || '', timeSec: Number(timeSec), volume: volume ?? 1.0, category: category || 'library' },
  });
  res.json(p);
});

sfxRouter.patch('/projects/:id/sfx/placements/:pid', async (req, res) => {
  const { timeSec, volume } = req.body;
  const data: any = {};
  if (timeSec != null) data.timeSec = Number(timeSec);
  if (volume != null) data.volume = Number(volume);
  const p = await prisma.sfxPlacement.update({ where: { id: req.params.pid }, data });
  res.json(p);
});

sfxRouter.delete('/projects/:id/sfx/placements/:pid', async (req, res) => {
  await prisma.sfxPlacement.delete({ where: { id: req.params.pid } });
  res.json({ ok: true });
});
