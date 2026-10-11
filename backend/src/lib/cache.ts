// Простой кеш с TTL: чтобы не дёргать внешние API на каждый запрос фронта
// (модели/лимиты меняются редко) и сайт не тормозил.
//
// Stale-while-revalidate: если данные устарели, но есть старая копия — сразу
// отдаём её, а обновление запускаем в фоне. Если внешний API упадёт — сайт
// продолжит работать со старыми данными вместо 502.

interface Entry {
  value: unknown;
  expires: number;
  refreshing: boolean;
  isError?: boolean;
}
const store = new Map<string, Entry>();

// Троттл одинаковых ошибок: не логируем одну и ту же ошибку чаще раза в 60с.
const errorLogTimestamps = new Map<string, number>();
const ERROR_LOG_INTERVAL = 60_000;

function shouldLogError(key: string): boolean {
  const now = Date.now();
  const last = errorLogTimestamps.get(key) ?? 0;
  if (now - last < ERROR_LOG_INTERVAL) return false;
  errorLogTimestamps.set(key, now);
  return true;
}

/** Вернуть из кеша или вычислить через fn и закешировать на ttlMs. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.expires > now && !hit.isError) return hit.value as T;

  // Есть протухшая копия (не ошибка) — отдаём её сразу, обновляем в фоне
  if (hit && !hit.isError) {
    if (!hit.refreshing) {
      hit.refreshing = true;
      fn().then(
        (value) => store.set(key, { value, expires: Date.now() + ttlMs, refreshing: false }),
        (err) => {
          const cause = err?.cause?.code || err?.cause?.message || err?.code;
          const detail = cause ? `${err?.message} (${cause})` : (err?.message ?? String(err));
          if (shouldLogError(key)) {
            console.error(`[cache/${key}] обновление в фоне не удалось:`, detail);
          }
          hit.refreshing = false;
        },
      );
    }
    return hit.value as T;
  }

  // Есть закешированная ошибка (negative cache) и TTL не истёк — бросаем снова
  if (hit && hit.isError && hit.expires > now) {
    throw hit.value;
  }

  // Первый запрос (или negative cache протух) — придётся подождать реальный ответ
  try {
    const value = await fn();
    store.set(key, { value, expires: now + ttlMs, refreshing: false });
    return value;
  } catch (err) {
    // Кешируем ошибку на 30с чтобы не долбить нерабочий API каждые 10с
    store.set(key, { value: err, expires: now + 30_000, refreshing: false, isError: true });
    throw err;
  }
}

/** Сбросить запись кеша по ключу (или все, если ключ не указан). */
export function invalidate(key?: string): void {
  if (key) store.delete(key);
  else store.clear();
}
