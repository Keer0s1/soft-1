// Клиент Voicer API — синтез речи (TTS).
// Workflow: POST /tasks -> GET /tasks/{id}/status -> GET /tasks/{id}/result.
// Статусы: waiting -> processing -> ending -> ending_processed; error / error_handled.

import { env } from '../env.js';

export class VoicerError extends Error {}

function headers(): Record<string, string> {
  return { 'X-API-Key': env.VOICER_API_KEY, 'Content-Type': 'application/json' };
}

function ensureConfigured() {
  if (!env.VOICER_API_URL || !env.VOICER_API_KEY) {
    throw new VoicerError('Voicer API не настроен: заполни VOICER_API_URL и VOICER_API_KEY в .env');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface VoiceTemplate {
  /** UUID сохранённого шаблона */
  template_uuid?: string;
  /** Инлайн-настройки голоса (взаимоисключающи с template_uuid) */
  template?: Record<string, unknown>;
}

export async function getBalance(): Promise<any> {
  ensureConfigured();
  const r = await fetch(`${env.VOICER_API_URL}/balance`, { headers: headers() });
  if (!r.ok) throw new VoicerError(`Voicer /balance: ${r.status}`);
  return r.json();
}

/** Пинг Voicer с замером задержки (через /balance — самый дешёвый запрос). */
export async function ping(): Promise<{ ok: boolean; latencyMs: number; status?: number }> {
  const t0 = Date.now();
  try {
    const r = await fetch(`${env.VOICER_API_URL}/balance`, { headers: headers() });
    return { ok: r.ok, latencyMs: Date.now() - t0, status: r.status };
  } catch {
    return { ok: false, latencyMs: Date.now() - t0 };
  }
}

export async function getTemplates(): Promise<any> {
  ensureConfigured();
  const r = await fetch(`${env.VOICER_API_URL}/templates`, { headers: headers() });
  if (!r.ok) throw new VoicerError(`Voicer /templates: ${r.status}`);
  return r.json();
}

/** Создать задачу синтеза, вернуть её id. */
export async function createTask(text: string, voice?: VoiceTemplate): Promise<number> {
  ensureConfigured();
  const body: Record<string, unknown> = { text };
  if (voice?.template_uuid) body.template_uuid = voice.template_uuid;
  else if (voice?.template) body.template = voice.template;

  const r = await fetch(`${env.VOICER_API_URL}/tasks`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new VoicerError(`Voicer: ошибка создания задачи (${r.status}): ${t.slice(0, 500)}`);
  }
  const data: any = await r.json();
  const taskId = data.task_id ?? data.id;
  if (taskId === undefined || taskId === null) {
    throw new VoicerError(`Voicer: не нашёл task_id в ответе: ${JSON.stringify(data)}`);
  }
  return Number(taskId);
}

export async function getStatus(taskId: number): Promise<string> {
  ensureConfigured();
  const r = await fetch(`${env.VOICER_API_URL}/tasks/${taskId}/status`, { headers: headers() });
  if (!r.ok) throw new VoicerError(`Voicer /status: ${r.status}`);
  const data: any = await r.json();
  if (!data.status) throw new VoicerError(`Voicer: нет статуса в ответе: ${JSON.stringify(data)}`);
  return String(data.status);
}

/** Поллить статус, пока озвучка не будет готова. */
export async function waitUntilReady(
  taskId: number,
  opts: { pollMs?: number; timeoutMs?: number; onStatus?: (s: string) => void } = {},
): Promise<string> {
  const pollMs = opts.pollMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 1800_000;
  let waited = 0;
  for (;;) {
    const status = await getStatus(taskId);
    opts.onStatus?.(status);
    if (status === 'ending' || status === 'ending_processed') return status;
    if (status === 'error' || status === 'error_handled') {
      throw new VoicerError(`Voicer: задача ${taskId} завершилась с ошибкой (статус ${status})`);
    }
    if (waited >= timeoutMs) {
      throw new VoicerError(`Voicer: задача ${taskId} не завершилась за ${timeoutMs / 1000} с`);
    }
    await sleep(pollMs);
    waited += pollMs;
  }
}

/** Скачать результат (MP3, либо ZIP с чанками). Возвращает сырые байты. */
export async function downloadResult(taskId: number): Promise<Buffer> {
  ensureConfigured();
  const r = await fetch(`${env.VOICER_API_URL}/tasks/${taskId}/result`, { headers: headers() });
  if (!r.ok) throw new VoicerError(`Voicer /result: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export interface WordTimestamp {
  word: string;
  startSec: number;
  endSec: number;
}

/** Попытаться получить пословные тайминги. Возвращает null если API не поддерживает. */
export async function downloadTimestamps(taskId: number): Promise<WordTimestamp[] | null> {
  ensureConfigured();
  try {
    const r = await fetch(`${env.VOICER_API_URL}/tasks/${taskId}/timestamps`, { headers: headers() });
    if (!r.ok) return null;
    const data: any = await r.json();
    // Поддерживаем формат: { words: [{ word, start, end }] } или [{ word, start, end }]
    const words = Array.isArray(data) ? data : data?.words;
    if (!Array.isArray(words) || words.length === 0) return null;
    return words.map((w: any) => ({
      word: String(w.word ?? w.text ?? ''),
      startSec: Number(w.start ?? w.startSec ?? w.start_sec ?? 0),
      endSec: Number(w.end ?? w.endSec ?? w.end_sec ?? 0),
    }));
  } catch {
    return null;
  }
}
