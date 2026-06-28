// Простой кеш с TTL: чтобы не дёргать внешние API на каждый запрос фронта
// (модели/лимиты меняются редко) и сайт не тормозил.

interface Entry {
  value: unknown;
  expires: number;
}
const store = new Map<string, Entry>();

/** Вернуть из кеша или вычислить через fn и закешировать на ttlMs. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

/** Сбросить запись кеша по ключу (или все, если ключ не указан). */
export function invalidate(key?: string): void {
  if (key) store.delete(key);
  else store.clear();
}
