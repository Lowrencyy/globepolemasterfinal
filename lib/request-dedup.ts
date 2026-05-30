/**
 * In-flight GET request deduplication.
 *
 * Problem: tab switches, screen focus events, and child component mounts all
 * trigger independent `api.get()` calls for the same URL at the same time.
 * Without dedup, those 4-8 concurrent calls all hit the server, saturate
 * the connection pool, and burn through battery.
 *
 * Solution: the first caller fires the real fetch and stores its Promise.
 * Subsequent callers for the same key receive the same Promise — they all
 * resolve together when the single network request completes.
 *
 * Keys are cleared as soon as the request settles (success OR error),
 * so the next independent navigation always gets a fresh fetch.
 */

type AnyPromise = Promise<any>;

const inFlight = new Map<string, AnyPromise>();

/**
 * Wrap a factory function so that concurrent calls with the same key
 * share one in-flight Promise instead of firing multiple requests.
 *
 * @param key     Unique string (e.g. full URL including query params)
 * @param factory Function that actually performs the network call
 */
export function deduplicate<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = factory().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

/** Number of currently in-flight requests (useful for debugging). */
export function inFlightCount(): number {
  return inFlight.size;
}

/** Clear all in-flight entries — use only in tests or after a hard reset. */
export function clearInFlight(): void {
  inFlight.clear();
}

// ── Debounce helper ────────────────────────────────────────────────────────────

/**
 * Returns a debounced version of `fn` that delays execution by `waitMs`.
 * Subsequent calls within the wait window reset the timer.
 * Use for: search input, filter changes, autocomplete, address lookup.
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  waitMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
}

// ── Throttle helper ────────────────────────────────────────────────────────────

/**
 * Returns a throttled version of `fn` that executes at most once per `limitMs`.
 * The first call fires immediately; subsequent calls within the window are
 * silently dropped (not queued).
 * Use for: refresh, app resume, screen focus, pagination, notification count.
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limitMs: number,
): (...args: Parameters<T>) => void {
  let lastCall = 0;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall < limitMs) return;
    lastCall = now;
    fn(...args);
  };
}
