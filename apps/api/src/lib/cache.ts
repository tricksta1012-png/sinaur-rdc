/**
 * In-memory TTL cache — no dependencies, single-process safe.
 * Used for expensive DB aggregations that are safe to serve slightly stale.
 */
const store = new Map<string, { v: unknown; exp: number }>();

export function cGet<T>(key: string): T | null {
  const e = store.get(key);
  if (!e || Date.now() > e.exp) {
    store.delete(key);
    return null;
  }
  return e.v as T;
}

export function cSet(key: string, v: unknown, ttlMs: number): void {
  store.set(key, { v, exp: Date.now() + ttlMs });
}

export function cDel(key: string): void {
  store.delete(key);
}

/** Invalidate all keys with the given prefix (e.g. 'dashboard:stats:') */
export function cDelPrefix(prefix: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
