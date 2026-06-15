import { Router } from 'express';
import { IMAGE_PROVIDERS } from '../lib/fastgen.js';
import * as fastgen from '../lib/fastgen.js';
import * as voicer from '../lib/voicer.js';
import { ASPECT_SIZES } from '../env.js';
import { cached } from '../lib/cache.js';
import { ZOOM_PRESETS, TRANSITION_PRESETS } from '../lib/effects.js';

export const metaRouter = Router();

metaRouter.get('/health', (_req, res) => res.json({ ok: true }));

// Пресеты эффектов для UI (id + название + ссылка на пример-видео)
metaRouter.get('/effects', (_req, res) => {
  res.json({
    zoom: ZOOM_PRESETS.map((z) => ({ ...z, example: `/examples/zoom_${z.id}.mp4` })),
    transitions: TRANSITION_PRESETS.map((t) => ({ ...t, example: `/examples/trans_${t.id}.mp4` })),
    qualities: [
      { id: 'fast', label: 'Быстро' },
      { id: 'balance', label: 'Баланс' },
      { id: 'quality', label: 'Качество' },
    ],
  });
});

// Запасные красивые названия моделей, если API недоступен (rate limit / сеть)
const FALLBACK_MODEL_LABELS: Record<string, string> = {
  GEM_PIX_2: 'Nano Pro',
  IMAGEN_3_5: 'Imagen 4',
  NARWHAL: 'Nano Banana 2',
};
const FALLBACK_PROVIDER_LABELS: Record<string, string> = {
  flow: 'Flow (Google)',
  flower: 'Flower (Nano Banana 2)',
};

// Провайдеры/модели картинок с человекочитаемыми именами (из /api/v5/models),
// кешируем на 60с. Поддерживаем генерацию только flow + flower.
metaRouter.get('/providers', async (_req, res) => {
  const aspectRatios = Object.keys(ASPECT_SIZES);
  try {
    const result = await cached('providers', 60_000, async () => {
      const [models, providers] = await Promise.all([fastgen.getModels(), fastgen.getProviders()]);
      const provList: any[] = Array.isArray(providers) ? providers : providers?.data ?? [];
      const modelList: any[] = Array.isArray(models) ? models : models?.data ?? [];
      const provLabel = (id: string) =>
        provList.find((p) => p.id === id)?.display_name ||
        FALLBACK_PROVIDER_LABELS[id] ||
        IMAGE_PROVIDERS[id]?.label ||
        id;

      // flow: показываем модели с красивыми именами; flower: модель одна, селектор не нужен
      const flowModels = modelList
        .filter((m) => m.provider === 'flow' && m.media_type === 'image')
        .map((m) => ({
          code: m.provider_model || m.id,
          label: m.display_name || FALLBACK_MODEL_LABELS[m.provider_model] || m.id,
          default: !!m.default,
          deprecated: !!m.deprecated,
          experimental: !!m.experimental,
        }));

      return {
        source: 'api',
        providers: [
          {
            id: 'flow',
            label: provLabel('flow'),
            models: flowModels.length
              ? flowModels
              : IMAGE_PROVIDERS.flow.models.map((c) => ({ code: c, label: FALLBACK_MODEL_LABELS[c] || c })),
          },
          { id: 'flower', label: provLabel('flower'), models: [] },
        ],
        aspectRatios,
      };
    });
    res.json(result);
  } catch {
    // Фолбэк: красивые имена из нашей таблицы
    res.json({
      source: 'fallback',
      providers: [
        {
          id: 'flow',
          label: FALLBACK_PROVIDER_LABELS.flow,
          models: IMAGE_PROVIDERS.flow.models.map((c) => ({ code: c, label: FALLBACK_MODEL_LABELS[c] || c })),
        },
        { id: 'flower', label: FALLBACK_PROVIDER_LABELS.flower, models: [] },
      ],
      aspectRatios,
    });
  }
});

// Лимиты на час и текущее использование (fast-gen). Кеш 20с.
metaRouter.get('/usage', async (_req, res) => {
  try {
    const data = await cached('usage', 20_000, () => fastgen.getUsage());
    const limits = data.account_limits ?? {};
    const hourly = data.current_usage?.hourly_usage ?? {};
    const threads = data.current_usage?.active_threads ?? {};

    // expiration_date приходит как Unix-timestamp в СЕКУНДАХ → умножаем на 1000
    const expRaw = data.expiration_date;
    const exp = expRaw ? new Date(expRaw < 1e12 ? expRaw * 1000 : expRaw) : null;
    const daysLeft = exp ? Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86_400_000)) : null;

    res.json({
      images: {
        used: hourly.image_generation?.current_usage ?? 0,
        limit: limits.img_gen_per_hour_limit ?? null,
        threads: threads.image_threads ?? 0,
        threadsAllowed: limits.img_generation_threads_allowed ?? null,
      },
      video: {
        used: hourly.video_generation?.current_usage ?? 0,
        limit: limits.video_gen_per_hour_limit ?? null,
      },
      // Лимит картинок в час (показываем в плашке как "кредиты")
      credits: limits.img_gen_per_hour_limit ?? null,
      // Лимит токенов промтов в час
      tokens: limits.prompt_tokens_per_hour_limit ?? null,
      promptTokensLimit: limits.prompt_tokens_per_hour_limit ?? null,
      daysLeft,
      window: data.usage_window ?? null,
    });
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) });
  }
});

// Здоровье провайдеров: пинг fast-gen и Voicer с задержкой. Кеш 10с.
function classify(p: { ok: boolean; latencyMs: number }): 'green' | 'yellow' | 'red' {
  if (!p.ok) return 'red';
  if (p.latencyMs > 8000) return 'red';
  if (p.latencyMs > 3000) return 'yellow';
  return 'green';
}

metaRouter.get('/status', async (_req, res) => {
  const data = await cached('status', 10_000, async () => {
    const [fg, vc] = await Promise.all([fastgen.ping(), voicer.ping()]);
    return {
      checkedAt: new Date().toISOString(),
      fastgen: { ...fg, health: classify(fg) },
      voicer: { ...vc, health: classify(vc) },
    };
  });
  res.json(data);
});

// Баланс озвучки Voicer
metaRouter.get('/voicer/balance', async (_req, res) => {
  try {
    res.json(await cached('balance', 30_000, () => voicer.getBalance()));
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) });
  }
});

// Шаблоны голоса Voicer (создаются в Telegram-боте)
metaRouter.get('/voicer/templates', async (_req, res) => {
  try {
    res.json(await cached('templates', 30_000, () => voicer.getTemplates()));
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) });
  }
});
