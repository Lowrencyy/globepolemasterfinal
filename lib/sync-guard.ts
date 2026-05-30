/**
 * Sync Guard — prevents redundant background network refreshes.
 *
 * Problem being solved:
 *   Every time a screen mounts or focuses it fires a background GET even when
 *   the cached data is only seconds old. This causes 10-20x more API calls than
 *   necessary: navigating Areas → Nodes → Poles → back to Poles fires
 *   getNodePoles() again even though nothing could have changed in <1s.
 *
 * Solution:
 *   Two lightweight guards:
 *     1. shouldRefresh(key, ttlMs) — returns true only if more than ttlMs ms
 *        have passed since the last successful network fetch for that key.
 *        In-memory first (instant), AsyncStorage as fallback (survives restarts).
 *
 *     2. lockSync(key) / unlockSync(key) — ensures only one concurrent fetch
 *        per key runs at a time. Returns false if a fetch is already in-flight.
 *
 * TTL recommendations:
 *   - Areas list:   5 min  (rarely changes mid-session)
 *   - Nodes list:   5 min  (rarely changes mid-session per area)
 *   - Poles list:  30 sec  (user may return from pole-detail after marking done)
 *   - Spans list:   2 min  (prefetched; only changes when admin edits spans)
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "syncguard:";

// In-memory mirror of last-synced timestamps.
// Avoids AsyncStorage round-trip on every call after the first.
const mem: Record<string, number> = {};

// Keys that are currently being fetched — prevents parallel duplicates.
const locks = new Set<string>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true if the data for `key` is stale and should be re-fetched.
 *
 * Checks in-memory first (synchronous-ish), falls back to AsyncStorage.
 * Never throws — a read error is treated as "stale, please refresh".
 */
export async function shouldRefresh(key: string, ttlMs: number): Promise<boolean> {
  const cached = mem[key];
  if (cached !== undefined) {
    return Date.now() - cached >= ttlMs;
  }

  try {
    const stored = await AsyncStorage.getItem(PREFIX + key);
    if (stored) {
      const ts = Number(stored);
      mem[key] = ts;
      return Date.now() - ts >= ttlMs;
    }
  } catch {}

  return true; // no record → treat as stale
}

/**
 * Call after a successful network fetch to record the sync time.
 * Updates both in-memory mirror and AsyncStorage.
 */
export async function markSynced(key: string): Promise<void> {
  const now = Date.now();
  mem[key] = now;
  try {
    await AsyncStorage.setItem(PREFIX + key, String(now));
  } catch {}
}

/**
 * Forcibly reset a key so the next shouldRefresh() call returns true.
 * Call this after a mutation (e.g. adding a pole) to force a refresh.
 */
export function invalidate(key: string): void {
  delete mem[key];
  AsyncStorage.removeItem(PREFIX + key).catch(() => {});
}

/**
 * Acquire an exclusive lock for a fetch operation.
 * Returns true if the lock was acquired (caller should proceed).
 * Returns false if another fetch is already running (caller should skip).
 */
export function lockSync(key: string): boolean {
  if (locks.has(key)) return false;
  locks.add(key);
  return true;
}

/**
 * Release a previously acquired lock.
 * Must be called in a finally block to prevent lock leaks.
 */
export function unlockSync(key: string): void {
  locks.delete(key);
}
