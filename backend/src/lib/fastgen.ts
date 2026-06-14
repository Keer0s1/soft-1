// Клиент fast-gen API — генерация картинок.
// POST /api/v4/<provider>/image/generate -> operation_id,
// поллинг GET /api/v4/operations/{id}, на success result — массив base64 (data-URI).

import { env } from '../env.js';

export class FastGenError extends Error {}

export const IMAGE_PROVIDERS: Record<string, { endpoint: string; models: string[]; label: string }> = {
  flow: {
    endpoint: '/api/v4/flow/image/generate',
    models: ['GEM_PIX_2', 'IMAGEN_3_5', 'NARWHAL'],
    label: 'Flow (Google)',
  },
  flower: {
    endpoint: '/api/v4/flower/image/generate',
    models: [],
    label: 'Flower (Nano Banana 2)',
  },
};

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

/** Отправить генерацию картинки, вернуть operation_id. */
export async function submitImage(prompt: string, opts: SubmitImageOpts = {}): Promise<string> {
  ensureConfigured();
  const provider = opts.provider ?? 'flow';
  const info = IMAGE_PROVIDERS[provider];
  if (!info) throw new FastGenError(`Неизвестный провайдер картинок: ${provider}`);

  const body: Record<string, unknown> = {
    prompt,
    aspect_ratio: opts.aspectRatio ?? '16:9',
  };
  if (provider === 'flow') {
    body.model = opts.model ?? 'GEM_PIX_2';
    if (opts.seed != null) body.seed = opts.seed;
  }

  const r = await fetch(`${env.FASTGEN_API_URL}${info.endpoint}`, {
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
  if (!data.operation_id) {
    throw new FastGenError(`fast-gen: нет operation_id в ответе: ${JSON.stringify(data)}`);
  }
  return String(data.operation_id);
}

async function getJson(path: string): Promise<any> {
  ensureConfigured();
  const r = await fetch(`${env.FASTGEN_API_URL}${path}`, { headers: headers() });
  if (!r.ok) throw new FastGenError(`fast-gen ${path}: ${r.status}`);
  return r.json();
}

/** Список моделей с человекочитаемыми именами (v5). */
export const getModels = () => getJson('/api/v5/models');
/** Провайдеры (display_name, media_types). */
export const getProviders = () => getJson('/api/v5/providers');
/** Лимиты и текущее использование за час. */
export const getUsage = () => getJson('/api/v5/usage');

/** Пинг здоровья сервиса с замером задержки. */
export async function ping(): Promise<{ ok: boolean; latencyMs: number; status?: number }> {
  const t0 = Date.now();
  try {
    const r = await fetch(`${env.FASTGEN_API_URL}/api/health?deep=true`, { headers: headers() });
    return { ok: r.ok, latencyMs: Date.now() - t0, status: r.status };
  } catch {
    return { ok: false, latencyMs: Date.now() - t0 };
  }
}

export async function getOperation(operationId: string): Promise<any> {
  ensureConfigured();
  const r = await fetch(`${env.FASTGEN_API_URL}/api/v4/operations/${operationId}`, {
    headers: headers(),
  });
  if (!r.ok) throw new FastGenError(`fast-gen /operations: ${r.status}`);
  return r.json();
}

/** Достать байты первой картинки из result операции (base64 / data-URI, разные обёртки). */
export function extractImageBytes(result: unknown): Buffer {
  let items: unknown[] = [];
  if (Array.isArray(result)) items = result;
  else if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const arr = ['images', 'results', 'files', 'data'].map((k) => obj[k]).find(Array.isArray);
    items = (arr as unknown[]) ?? [result];
  } else if (typeof result === 'string') items = [result];

  for (const item of items) {
    let raw: string | undefined;
    if (typeof item === 'string') raw = item;
    else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      for (const k of ['base64', 'image', 'data', 'content', 'b64_json']) {
        if (typeof obj[k] === 'string') {
          raw = obj[k] as string;
          break;
        }
      }
    }
    if (!raw) continue;
    const m = /^data:[^;]+;base64,(.*)$/s.exec(raw);
    if (m) raw = m[1];
    try {
      return Buffer.from(raw, 'base64');
    } catch {
      /* пробуем следующий */
    }
  }
  throw new FastGenError(
    `fast-gen: не смог достать картинку из результата: ${JSON.stringify(result).slice(0, 300)}`,
  );
}

/** Поллить операцию до готовности, вернуть байты картинки. */
export async function waitForImage(
  operationId: string,
  opts: { pollMs?: number; timeoutMs?: number } = {},
): Promise<Buffer> {
  const pollMs = opts.pollMs ?? 4000;
  const timeoutMs = opts.timeoutMs ?? 600_000;
  let waited = 0;
  for (;;) {
    const data: any = await getOperation(operationId);
    const status = String(data.status ?? '').toLowerCase();
    if (['success', 'succeeded', 'completed', 'done'].includes(status)) {
      return extractImageBytes(data.result);
    }
    if (['error', 'failed', 'cancelled', 'canceled'].includes(status)) {
      throw new FastGenError(
        `fast-gen: операция ${operationId} с ошибкой: ${JSON.stringify(data).slice(0, 300)}`,
      );
    }
    if (waited >= timeoutMs) {
      throw new FastGenError(`fast-gen: операция ${operationId} не завершилась за ${timeoutMs / 1000} с`);
    }
    await sleep(pollMs);
    waited += pollMs;
  }
}
