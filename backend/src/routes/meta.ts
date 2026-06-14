import { Router } from 'express';
import { IMAGE_PROVIDERS } from '../lib/fastgen.js';
import * as voicer from '../lib/voicer.js';
import { ASPECT_SIZES } from '../env.js';

export const metaRouter = Router();

metaRouter.get('/health', (_req, res) => res.json({ ok: true }));

// Провайдеры/модели картинок и доступные соотношения сторон — для выпадашек в UI
metaRouter.get('/providers', (_req, res) => {
  res.json({
    providers: Object.entries(IMAGE_PROVIDERS).map(([id, info]) => ({
      id,
      label: info.label,
      models: info.models,
    })),
    aspectRatios: Object.keys(ASPECT_SIZES),
  });
});

// Баланс озвучки Voicer
metaRouter.get('/voicer/balance', async (_req, res) => {
  try {
    res.json(await voicer.getBalance());
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) });
  }
});

// Шаблоны голоса Voicer (создаются в Telegram-боте)
metaRouter.get('/voicer/templates', async (_req, res) => {
  try {
    res.json(await voicer.getTemplates());
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) });
  }
});
