import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CacheEntry {
  /** Parsed response data */
  data: any;
  /** ETag from the server (e.g. '"abc123"') */
  etag: string | null;
  /** Unix epoch ms when this entry was stored */
  storedAt: number;
  /** TTL in milliseconds */
  ttlMs: number;
  /** URL path + params used to generate the key */
  endpoint: string;
  /** userId scoping — null for public/global data */
  userId: string | null;
}

// ── TTL presets (milliseconds) ─────────────────────────────────────────────────

export const TTL = {
  PSGC: 24 * 60 * 60 * 1000,   // 24 h — static government geography
  ME: 5 * 60 * 1000,            // 5 min — user profile (/me)
  MAP_PINS: 60 * 1000,          // 1 min — live map data
  LIST: 2 * 60 * 1000,          // 2 min — paginated lists
  DETAIL: 2 * 60 * 1000,        // 2 min — single-resource detail
  POLES: 2 * 60 * 1000,         // 2 min — pole queries
  DEFAULT: 2 * 60 * 1000,       // 2 min — fallback
} as const;

// ── Key builder ────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "apicache:";

/**
 * Build a deterministic cache key.
 * User-scoped keys include the userId so one user's data never leaks to another.
 */
export function buildCacheKey(endpoint: string, userId?: string | null): string {
  const scope = userId ? `u:${userId}:` : "pub:";
  // Normalize the endpoint so "/globe/poles?page=1&per_page=50" and
  // "/globe/poles?per_page=50&page=1" map to the same key.
  const normalized = normalizeUrl(endpoint);
  return `${STORAGE_PREFIX}${scope}${normalized}`;
}

function normalizeUrl(url: string): string {
  const [path, qs] = url.split("?");
  if (!qs) return path;
  const sorted = qs.split("&").sort().join("&");
  return `${path}?${sorted}`;
}

// ── Core operations ────────────────────────────────────────────────────────────

/**
 * Read a cache entry. Returns null if missing or expired.
 * Callers should show stale data on network errors — only this function
 * enforces TTL for "show immediately" logic.
 */
export async function getCache(key: string): Promise<CacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    const isExpired = Date.now() - entry.storedAt > entry.ttlMs;
    if (isExpired) return null;
    return entry;
  } catch {
    return null;
  }
}

/**
 * Read a cache entry even if expired (used for stale-while-revalidate
 * and offline fallback).
 */
export async function getCacheStale(key: string): Promise<CacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

/** Store a fresh response in the cache. */
export async function setCache(
  key: string,
  data: any,
  etag: string | null,
  endpoint: string,
  ttlMs: number,
  userId?: string | null,
): Promise<void> {
  const entry: CacheEntry = {
    data,
    etag,
    storedAt: Date.now(),
    ttlMs,
    endpoint,
    userId: userId ?? null,
  };
  try {
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Storage full or unavailable — silently skip, don't crash
  }
}

/** Remove a specific cache entry (e.g. after a mutation). */
export async function evictCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {}
}

/**
 * Evict all entries whose keys start with a given prefix.
 * Use after mutations that affect a group of resources.
 */
export async function evictCacheByPrefix(prefix: string): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const matching = allKeys.filter((k) => k.startsWith(prefix));
    if (matching.length > 0) {
      await AsyncStorage.multiRemove(matching);
    }
  } catch {}
}

/** Evict all api cache entries (e.g. on logout). */
export async function clearAllCache(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter((k) => k.startsWith(STORAGE_PREFIX));
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
  } catch {}
}
