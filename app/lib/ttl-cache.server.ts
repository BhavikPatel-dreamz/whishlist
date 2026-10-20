/**
 * Tiny per-process TTL cache for essentially static rows (Shop, UIConfig).
 * Storefront proxy routes hit these on every request; a 30s window collapses
 * that into one query per shop per TTL. Writes invalidate the relevant keys
 * immediately, so a settings save is visible on the next request.
 */
type Entry = { value: unknown; expires: number };

const MAX_ENTRIES = 500;
const store = new Map<string, Entry>();

export const DEFAULT_TTL_MS = 30_000;

export function ttlGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function ttlSet(key: string, value: unknown, ttlMs: number = DEFAULT_TTL_MS): void {
  if (store.has(key)) store.delete(key);
  else if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expires: Date.now() + ttlMs });
}

export function ttlDelete(key: string): void {
  store.delete(key);
}

export async function ttlRemember<T>(
  key: string,
  load: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const hit = ttlGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  ttlSet(key, value, ttlMs);
  return value;
}
