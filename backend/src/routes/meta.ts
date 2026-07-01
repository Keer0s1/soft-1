import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_PROVIDERS } from '../lib/fastgen.js';
import * as fastgen from '../lib/fastgen.js';
import * as voicer from '../lib/voicer.js';
import * as proxy from '../lib/proxy.js';
import { ASPECT_SIZES, env } from '../env.js';
import { cached, invalidate } from '../lib/cache.js';
import { ZOOM_PRESETS, TRANSITION_PRESETS } from '../lib/effects.js';

export const metaRouter = Router();

metaRouter.get('/health', (_req, res) => res.json({ ok: true }));

// Пресеты эффектов для UI (id + название + ссылка на пример-видео)
metaRouter.get('/effects', (_req, res) => {
  res.json({
    zoom: ZOOM_PRESETS,
    transitions: TRANSITION_PRESETS,
    qualities: [
      { id: 'fast', label: 'Быстро' },
      { id: 'balance', label: 'Баланс' },
      { id: 'quality', label: 'Качество' },
    ],
  });
});

// Запасные красивые названия моделей, если API недоступен (rate limit / сеть)
const FALLBACK_MODEL_LABELS: Record<string, string> = {
  'nano-banana-pro': 'Nano Banana Pro',
  'nano-banana-2': 'Nano Banana 2',
  'flower-image': 'Flower Image',
  'grok-image': 'Grok Image',
  'openai-image': 'OpenAI Image',
};
const FALLBACK_PROVIDER_LABELS: Record<string, string> = {
  flow: 'Flow (Google)',
  flower: 'Flower (Nano Banana)',
  grok: 'Grok',
  openai: 'OpenAI',
};

// Какие операции считаем «image generation» (из /api/v6/models -> operations[])
function isImageGen(op: string): boolean {
  return /image_generate$/.test(op);
}

// Провайдеры/модели картинок с человекочитаемыми именами (из /api/v6/models),
// кешируем на 60с. Поддерживаем все image-провайдеры из IMAGE_PROVIDERS.
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

      const modelsByProvider: Record<string, any[]> = {};
      for (const m of modelList) {
        const ops: string[] = Array.isArray(m.operations) ? m.operations : [];
        if (!ops.some(isImageGen)) continue;
        const prov = String(m.provider ?? '');
        if (!IMAGE_PROVIDERS[prov]) continue;
        (modelsByProvider[prov] ||= []).push({
          code: m.id,
          label: m.display_name || FALLBACK_MODEL_LABELS[m.id] || m.id,
          default: !!m.default,
          deprecated: !!m.deprecated,
          experimental: !!m.experimental,
        });
      }

      const providersOut = Object.keys(IMAGE_PROVIDERS).map((id) => {
        const apiModels = modelsByProvider[id] ?? [];
        const fallbackModels = IMAGE_PROVIDERS[id].models.map((c) => ({
          code: c,
          label: FALLBACK_MODEL_LABELS[c] || c,
        }));
        return {
          id,
          label: provLabel(id),
          models: apiModels.length ? apiModels : fallbackModels,
        };
      });

      return { source: 'api', providers: providersOut, aspectRatios };
    });
    res.json(result);
  } catch {
    // Фолбэк: красивые имена из нашей таблицы
    res.json({
      source: 'fallback',
      providers: Object.keys(IMAGE_PROVIDERS).map((id) => ({
        id,
        label: FALLBACK_PROVIDER_LABELS[id] || IMAGE_PROVIDERS[id].label,
        models: IMAGE_PROVIDERS[id].models.map((c) => ({ code: c, label: FALLBACK_MODEL_LABELS[c] || c })),
      })),
      aspectRatios,
    });
  }
});

// Лимиты на час и текущее использование (fast-gen). Кеш 20с.
metaRouter.get('/usage', async (_req, res) => {
  try {
    // 5 секунд кеш — после генерации usage надо видеть свежим, не ждать
    // полминуты. Само поле в pipeline.ts инвалидируется invalidate('usage').
    const data = await cached('usage', 5_000, () => fastgen.getUsage());
    const limits = data.account_limits ?? {};
    const hourly = data.current_usage?.hourly_usage ?? {};
    const threads = data.current_usage?.active_threads ?? {};

    // expiration_date приходит как Unix-timestamp в СЕКУНДАХ → умножаем на 1000
    const expRaw = data.expiration_date;
    const exp = expRaw ? new Date(expRaw < 1e12 ? expRaw * 1000 : expRaw) : null;
    const daysLeft = exp ? Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86_400_000)) : null;

    // Окно лимита: API даёт window_start (sec) у каждого блока. Сброс через
    // 3600с от него. Если данных нет — считаем «через час от сейчас» как
    // подсказку (UI скроет точное время).
    function resetAtFor(stats: any): number | null {
      const ws = stats?.window_start;
      if (typeof ws !== 'number' || !isFinite(ws) || ws <= 0) return null;
      // Раньше API возвращал секунды; страхуемся от мс.
      const seconds = ws < 1e12 ? ws : ws / 1000;
      return Math.round((seconds + 3600) * 1000); // мс epoch
    }
    const imageResetAt = resetAtFor(hourly.image_generation);
    const videoResetAt = resetAtFor(hourly.video_generation);
    const promptResetAt = resetAtFor(hourly.prompt_generation);

    res.json({
      images: {
        used: hourly.image_generation?.current_usage ?? 0,
        limit: limits.img_gen_per_hour_limit ?? null,
        threads: threads.image_threads ?? 0,
        threadsAllowed: limits.img_generation_threads_allowed ?? null,
        resetAt: imageResetAt,
      },
      video: {
        used: hourly.video_generation?.current_usage ?? 0,
        limit: limits.video_gen_per_hour_limit ?? null,
        resetAt: videoResetAt,
      },
      prompts: {
        used: hourly.prompt_generation?.current_usage ?? 0,
        limit: limits.prompt_tokens_per_hour_limit ?? null,
        resetAt: promptResetAt,
      },
      // Старые поля (плоские) — для обратной совместимости со StatusBar
      credits: limits.img_gen_per_hour_limit ?? null,
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
  const c = proxy.getConfig();
  res.json({
    ...data,
    proxy: {
      enabled: c.enabled && proxy.isActive(),
      protocol: c.protocol,
      host: c.host,
      port: c.port,
    },
  });
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

// Доступные LUT-файлы для цветокоррекции
metaRouter.get('/luts', (_req, res) => {
  const lutsDir = path.join(env.DATA_DIR, 'luts');
  if (!fs.existsSync(lutsDir)) { res.json([]); return; }
  const files = fs.readdirSync(lutsDir).filter((f) => f.endsWith('.cube'));
  const luts = files.map((f) => ({
    file: f,
    name: f.replace('.cube', '').replace(/[-_]/g, ' '),
  }));
  res.json(luts);
});

// Содержимое конкретного LUT-файла (.cube) для live-превью на фронте
metaRouter.get('/luts/:file', (req, res) => {
  const file = req.params.file;
  if (!file.endsWith('.cube') || file.includes('..') || file.includes('/') || file.includes('\\')) {
    res.status(400).json({ error: 'invalid file' });
    return;
  }
  const filePath = path.join(env.DATA_DIR, 'luts', file);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'not found' }); return; }
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  const stream = fs.createReadStream(filePath);
  stream.on('error', (err) => {
    console.warn('LUT stream error:', err.message);
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});

// Доступная фоновая музыка
metaRouter.get('/music', (_req, res) => {
  const musicDir = path.join(env.DATA_DIR, 'music');
  if (!fs.existsSync(musicDir)) { res.json([]); return; }
  const files = fs.readdirSync(musicDir).filter((f) => /\.(mp3|wav|ogg|m4a)$/i.test(f));
  const tracks = files.map((f) => ({
    file: f,
    name: f.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
    path: `music/${f}`,
  }));
  res.json(tracks);
});

// ─── Прокси ─────────────────────────────────────────────────────────
// Текущая конфигурация (пароль не отдаём — только флаг "задан" в hasPassword).
metaRouter.get('/proxy', (_req, res) => {
  const c = proxy.getConfig();
  res.json({
    enabled: c.enabled,
    protocol: c.protocol,
    host: c.host,
    port: c.port,
    username: c.username ?? '',
    hasPassword: Boolean(c.password),
  });
});

// Сохранить новую конфигурацию.
// Поле password не передавать, если хочешь оставить старый (UI: оставь пустым).
metaRouter.put('/proxy', async (req, res) => {
  try {
    const body = req.body ?? {};
    const patch: any = {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      protocol: body.protocol,
      host: body.host,
      port: body.port != null ? Number(body.port) : undefined,
      username: body.username,
    };
    // Если password не пришёл или пустая строка — оставляем старый
    if (typeof body.password === 'string' && body.password.length > 0) {
      patch.password = body.password;
    }
    const next = await proxy.saveConfig(patch);
    // Сбрасываем кеш статусов/балансов, чтобы фронт сразу увидел свежий пинг
    invalidate('status');
    invalidate('balance');
    invalidate('usage');
    res.json({
      enabled: next.enabled,
      protocol: next.protocol,
      host: next.host,
      port: next.port,
      username: next.username ?? '',
      hasPassword: Boolean(next.password),
    });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// Проверить прокси: пингуем Voicer и fast-gen через текущий ИЛИ
// переданный во временном виде (для теста перед сохранением).
metaRouter.post('/proxy/test', async (req, res) => {
  const body = req.body ?? {};
  const override = body.host
    ? {
        protocol: body.protocol,
        host: body.host,
        port: Number(body.port),
        username: body.username,
        password: body.password,
      }
    : undefined;
  const [vc, fg] = await Promise.all([
    proxy.testProxy(`${env.VOICER_API_URL}/balance`, override),
    proxy.testProxy(`${env.FASTGEN_API_URL}/api/v6/usage`, override),
  ]);
  res.json({ voicer: vc, fastgen: fg });
});

// Реальная проверка картинкой: генерит картинку через выбранного провайдера
// и качает её со storage. Это ЕДИНСТВЕННЫЙ способ убедиться, что прокси
// тянет CDN — потому что fast-gen API может быть доступен и без прокси,
// а storage режется провайдером отдельно.
// ВНИМАНИЕ: fast-gen списывает кредиты по своему тарифу, мы это не контролируем.
// Использует ТОЛЬКО сохранённую конфигурацию прокси — чтобы не мутировать
// глобальный dispatcher во время реальной работы (старый applyTemporary
// уводил все живые генерации на тестовый прокси). Перед тестом сохрани
// конфиг через PUT /proxy.
metaRouter.post('/proxy/test-image', async (req, res) => {
  const body = req.body ?? {};
  const t0 = Date.now();

  const provider = typeof body.provider === 'string' ? body.provider : 'flow';
  const prompt = (typeof body.prompt === 'string' && body.prompt.trim())
    ? body.prompt.trim()
    : 'cute fluffy kitten sitting on a windowsill, soft light';

  let opId: string | null = null;
  try {
    const submitT0 = Date.now();
    opId = await fastgen.submitImage(prompt, { provider, aspectRatio: '1:1' });
    const submitMs = Date.now() - submitT0;

    const downloadT0 = Date.now();
    const bytes = await fastgen.waitForImage(opId, { timeoutMs: 300_000, pollMs: 3000 });
    const downloadMs = Date.now() - downloadT0;

    const dataUri = `data:image/png;base64,${bytes.toString('base64')}`;
    res.json({
      ok: true,
      via: proxy.isActive() ? 'proxy' : 'direct',
      provider,
      prompt,
      submitMs,
      downloadMs,
      totalMs: Date.now() - t0,
      imageBytes: bytes.length,
      imageDataUri: dataUri,
    });
  } catch (e: any) {
    if (opId) fastgen.cancelGeneration(opId).catch(() => {});
    res.json({
      ok: false,
      via: proxy.isActive() ? 'proxy' : 'direct',
      provider,
      totalMs: Date.now() - t0,
      error: String(e?.message ?? e),
    });
  }
});
