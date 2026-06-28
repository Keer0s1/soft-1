// Клиент fast-gen API (v6). Сервис ушёл с /api/v4 и /api/v5 на /api/v6.
// Workflow: POST /api/v6/generations -> поллинг GET /api/v6/generations/{id} ->
// при status="succeeded" забираем картинку из results[].download_url или results[].data.

import { env } from '../env.js';
import { proxyFetch, getHttpsAgent } from './proxy.js';
import * as nodeHttp from 'node:http';
import * as nodeHttps from 'node:https';

export class FastGenError extends Error {}

// Провайдеры v6: каждый имеет свою модель для image. Список синхронизирован
// с GET /api/v6/models (provider -> модели). Старые v4 имена моделей
// (GEM_PIX_2, IMAGEN_3_5, NARWHAL) больше не существуют.
export const IMAGE_PROVIDERS: Record<string, { models: string[]; label: string }> = {
  flow: {
    models: ['nano-banana-pro', 'nano-banana-2'],
    label: 'Flow (Google)',
  },
  flower: {
    models: ['flower-image'],
    label: 'Flower (Nano Banana)',
  },
  grok: {
    models: ['grok-image'],
    label: 'Grok',
  },
  openai: {
    models: ['openai-image'],
    label: 'OpenAI',
  },
};

// Маппинг старых имён моделей на новые. Нужен чтобы старые проекты,
// сохранённые в БД с model=GEM_PIX_2 и т.п., продолжали работать.
const MODEL_ALIASES: Record<string, string> = {
  GEM_PIX_2: 'nano-banana-pro',
  IMAGEN_3_5: 'nano-banana-pro',
  NARWHAL: 'nano-banana-2',
};

function normalizeModel(provider: string, model?: string | null): string {
  if (model && MODEL_ALIASES[model]) return MODEL_ALIASES[model];
  if (model) return model;
  // default по провайдеру
  return IMAGE_PROVIDERS[provider]?.models[0] ?? 'nano-banana-pro';
}

function headers(): Record<string, string> {
  return { 'X-API-Key': env.FASTGEN_API_KEY, 'Content-Type': 'application/json' };
}

function ensureConfigured() {
  if (!env.FASTGEN_API_KEY) {
    throw new FastGenError('fast-gen API не настроен: заполни FASTGEN_API_KEY в .env');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SubmitImageOpts {
  provider?: string;
  model?: string | null;
  aspectRatio?: string;
  seed?: number | null;
}

/** Отправить генерацию картинки, вернуть generation id. */
export async function submitImage(prompt: string, opts: SubmitImageOpts = {}): Promise<string> {
  ensureConfigured();
  const provider = opts.provider ?? 'flow';
  if (!IMAGE_PROVIDERS[provider]) {
    throw new FastGenError(`Неизвестный провайдер картинок: ${provider}`);
  }
  const model = normalizeModel(provider, opts.model);

  const body: Record<string, unknown> = {
    model,
    prompt,
    aspect_ratio: opts.aspectRatio ?? '16:9',
  };
  if (opts.seed != null) body.seed = opts.seed;

  const r = await proxyFetch(`${env.FASTGEN_API_URL}/api/v6/generations`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (r.status === 403) throw new FastGenError('fast-gen: 403 — нет активной подписки на изображения');
  if (r.status === 429) throw new FastGenError('fast-gen: 429 — превышен лимит одновременных генераций');
  if (!r.ok) {
    const t = await r.text();
    throw new FastGenError(`fast-gen: ошибка генерации (${r.status}): ${t.slice(0, 500)}`);
  }
  const data: any = await r.json();
  const id = data.id ?? data.generation_id ?? data.operation_id;
  if (!id) {
    throw new FastGenError(`fast-gen: нет id генерации в ответе: ${JSON.stringify(data)}`);
  }
  return String(id);
}

async function getJson(path: string): Promise<any> {
  ensureConfigured();
  const r = await proxyFetch(`${env.FASTGEN_API_URL}${path}`, { headers: headers() });
  if (!r.ok) throw new FastGenError(`fast-gen ${path}: ${r.status}`);
  return r.json();
}

/** Список моделей v6. */
export const getModels = () => getJson('/api/v6/models');
/** Провайдеры v6. */
export const getProviders = () => getJson('/api/v6/providers');
/** Лимиты и текущее использование за час (v6). */
export const getUsage = () => getJson('/api/v6/usage');

/** Пинг здоровья сервиса с замером задержки. */
export async function ping(): Promise<{ ok: boolean; latencyMs: number; status?: number }> {
  const t0 = Date.now();
  try {
    const r = await proxyFetch(`${env.FASTGEN_API_URL}/api/v6/usage`, { headers: headers() });
    return { ok: r.ok, latencyMs: Date.now() - t0, status: r.status };
  } catch {
    return { ok: false, latencyMs: Date.now() - t0 };
  }
}

/** Статус генерации (v6). Возвращает { status, results, error, ... }. */
export async function getGeneration(generationId: string): Promise<any> {
  ensureConfigured();
  const r = await proxyFetch(`${env.FASTGEN_API_URL}/api/v6/generations/${generationId}`, {
    headers: headers(),
  });
  if (!r.ok) throw new FastGenError(`fast-gen /generations: ${r.status}`);
  return r.json();
}

/** Отменить генерацию на стороне fast-gen (v6 DELETE /generations/{id}).
 *  Ошибки глотаем — отмена best-effort, на пользователе не отражается. */
export async function cancelGeneration(generationId: string): Promise<void> {
  if (!env.FASTGEN_API_KEY) return;
  try {
    await proxyFetch(`${env.FASTGEN_API_URL}/api/v6/generations/${generationId}`, {
      method: 'DELETE',
      headers: headers(),
    });
  } catch {
    /* ignore */
  }
}

/** Старое имя для обратной совместимости — теперь алиас getGeneration. */
export const getOperation = getGeneration;

/** Скачать байты из download_url (storage-backed media).
 *  download_url у fast-gen — presigned URL c новым storage-хостингом,
 *  TLS-поток у которого периодически рвётся посреди тела ответа
 *  (ECONNRESET / 'terminated'). Поэтому качаем через node:https с
 *  Connection: close, докачкой по Range и большим числом попыток.
 *  Лишние хедеры (X-API-Key и т.п.) ломают подпись → 403, поэтому хедеры
 *  на сам storage не льём.
 */
async function fetchUrlBytes(url: string): Promise<Buffer> {
  const attempts = 8;
  let lastErr: any = null;
  let collected = Buffer.alloc(0);
  let totalSize: number | null = null;

  for (let i = 0; i < attempts; i++) {
    try {
      const { chunk, total, complete } = await downloadRange(url, collected.length);
      if (chunk.length) collected = Buffer.concat([collected, chunk]);
      if (totalSize == null && total != null) totalSize = total;
      if (complete && (totalSize == null || collected.length >= totalSize)) {
        return collected;
      }
      lastErr = new FastGenError(
        `соединение закрыто до конца (${collected.length}/${totalSize ?? '?'} байт)`,
      );
    } catch (e: any) {
      lastErr = e;
    }
    if (i < attempts - 1) await sleep(700 * (i + 1));
  }
  const msg = lastErr?.cause?.code || lastErr?.code || lastErr?.message || String(lastErr);
  throw new FastGenError(`fast-gen: не удалось скачать картинку после ${attempts} попыток: ${msg}`);
}

/** Однопопыточное скачивание с поддержкой Range (докачка с offset). */
function downloadRange(url: string, offset: number): Promise<{ chunk: Buffer; total: number | null; complete: boolean }> {
  return new Promise((resolve, reject) => {
    let lib: typeof nodeHttps | typeof nodeHttp;
    let parsed: URL;
    try {
      parsed = new URL(url);
      lib = parsed.protocol === 'http:' ? nodeHttp : nodeHttps;
    } catch (e) { return reject(e); }

    const headers: Record<string, string> = { connection: 'close' };
    if (offset > 0) headers.range = `bytes=${offset}-`;

    const agent = getHttpsAgent();
    const req = lib.request(
      {
        method: 'GET',
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: parsed.pathname + parsed.search,
        headers,
        ...(agent ? { agent } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return downloadRange(new URL(res.headers.location, url).toString(), offset).then(resolve, reject);
        }
        if (status !== 200 && status !== 206) {
          res.resume();
          return reject(new FastGenError(`storage HTTP ${status}`));
        }
        let total: number | null = null;
        const cr = res.headers['content-range'];
        if (typeof cr === 'string') {
          const m = /\/(\d+)\s*$/.exec(cr);
          if (m) total = Number(m[1]);
        }
        if (total == null && res.headers['content-length']) {
          const cl = Number(res.headers['content-length']);
          total = offset + (Number.isFinite(cl) ? cl : 0);
        }
        const parts: Buffer[] = [];
        res.on('data', (c) => parts.push(c as Buffer));
        res.on('end', () => resolve({ chunk: Buffer.concat(parts), total, complete: true }));
        res.on('error', (err) => resolve({ chunk: Buffer.concat(parts), total, complete: false, ...{ _err: err } as any }));
        res.on('aborted', () => resolve({ chunk: Buffer.concat(parts), total, complete: false }));
      },
    );
    req.setTimeout(60_000, () => req.destroy(new Error('socket timeout')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Достать байты картинки из ответа v6.
 * results: [{ type, download_url, data, mime_type, ... }]
 * Сначала пробуем download_url, потом инлайн data URI.
 */
export async function extractImageBytes(statusResponse: any): Promise<Buffer> {
  const results = Array.isArray(statusResponse?.results) ? statusResponse.results : [];
  if (results.length === 0) {
    throw new FastGenError(
      `fast-gen: в ответе нет results. status=${statusResponse?.status}, error=${statusResponse?.error ?? 'нет'}`,
    );
  }
  const imageItems = results.filter((it: any) => it?.type === 'image' || !it?.type);
  const candidates = imageItems.length ? imageItems : results;

  let lastError: unknown = null;
  for (const item of candidates) {
    if (item?.download_url) {
      try { return await fetchUrlBytes(String(item.download_url)); }
      catch (e) { lastError = e; }
    }
    const inline = item?.data;
    if (typeof inline === 'string' && inline.length > 0) {
      const m = /^data:[^;]+;base64,(.*)$/s.exec(inline);
      const b64 = m ? m[1] : inline;
      try { return Buffer.from(b64, 'base64'); }
      catch (e) { lastError = e; }
    }
  }
  if (lastError) {
    throw new FastGenError(
      `fast-gen: ошибка извлечения картинки: ${(lastError as any)?.message ?? lastError}`,
    );
  }
  throw new FastGenError(
    `fast-gen: ни download_url ни data не пригодны (results[0]: ${JSON.stringify(candidates[0]).slice(0, 300)})`,
  );
}

/** Поллить генерацию до готовности, вернуть байты картинки. */
export async function waitForImage(
  generationId: string,
  opts: { pollMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Buffer> {
  const pollMs = opts.pollMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 600_000;
  let waited = 0;
  for (;;) {
    if (opts.signal?.aborted) throw new FastGenError('Отменено');
    const data: any = await getGeneration(generationId);
    const status = String(data.status ?? '').toLowerCase();
    if (status === 'succeeded') {
      return extractImageBytes(data);
    }
    if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
      const err = data.error || JSON.stringify(data).slice(0, 300);
      throw new FastGenError(`fast-gen: генерация ${generationId} с ошибкой: ${err}`);
    }
    if (waited >= timeoutMs) {
      throw new FastGenError(`fast-gen: генерация ${generationId} не завершилась за ${timeoutMs / 1000} с`);
    }
    await sleep(pollMs);
    waited += pollMs;
  }
}
