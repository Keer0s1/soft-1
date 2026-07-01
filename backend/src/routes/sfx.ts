import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../db.js';
import { rel, abs } from '../lib/paths.js';
import { env } from '../env.js';
import { uploadSfxSchema } from '../schemas.js';

const placementCreateSchema = z.object({
  soundFile: z.string().min(1).max(500),
  label: z.string().max(200).optional(),
  timeSec: z.number().min(0).max(86400),
  volume: z.number().min(0).max(2).optional(),
  category: z.string().max(40).optional(),
});

const placementUpdateSchema = z.object({
  timeSec: z.number().min(0).max(86400).optional(),
  volume: z.number().min(0).max(2).optional(),
});

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
  const parsed = uploadSfxSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const m = /^data:audio\/[\w+]+;base64,(.+)$/s.exec(parsed.data.dataUri);
    if (!m) return res.status(400).json({ error: 'Ожидается audio data URI' });
    const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { folderName: true } });
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const dir = path.join(env.DATA_DIR, 'projects', project.folderName, 'sfx');
    fs.mkdirSync(dir, { recursive: true });
    const safeName = parsed.data.name.replace(/[^a-zA-Z0-9а-яА-Я_.-]/g, '_');
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
  const parsed = placementCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { soundFile, label, timeSec, volume, category } = parsed.data;
  const p = await prisma.sfxPlacement.create({
    data: { projectId: req.params.id, soundFile, label: label ?? '', timeSec, volume: volume ?? 1.0, category: category ?? 'library' },
  });
  res.json(p);
});

sfxRouter.patch('/projects/:id/sfx/placements/:pid', async (req, res) => {
  const parsed = placementUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const p = await prisma.sfxPlacement.update({ where: { id: req.params.pid }, data: parsed.data });
  res.json(p);
});

sfxRouter.delete('/projects/:id/sfx/placements/:pid', async (req, res) => {
  await prisma.sfxPlacement.delete({ where: { id: req.params.pid } });
  res.json({ ok: true });
});
