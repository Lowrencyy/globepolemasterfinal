/**
 * Background network-aware sync manager.
 *
 * Auto-sync triggers:
 *  1. App start              — immediate flush
 *  2. App foreground         — immediate flush
 *  3. Every 30 seconds       — fast catch-up when online
 *  4. Network ping success   — flush as soon as a ping comes back alive
 *     (handles: flight mode off, WiFi reconnect, pocket-unlock)
 *
 * All four queues are flushed on every trigger:
 *  • sync-queue   (teardown reports + photos)
 *  • simple-queue (JSON PUT/POST — pole edits, pickup requests, delivery moves, GPS)
 *  • gps-queue    (pole GPS coordinates)
 *  • image-queue  (orphaned teardown photos)
 */
import { AppState, AppStateStatus } from "react-native";
import { BASE_URL } from "./api";
import { gpsQueueFlush } from "./gps-queue";
import { processSyncQueue, processImageQueue } from "./sync-queue";
import { processSimpleQueue } from "./simple-queue";
import { prefetchSitemap } from "./sitemap-cache";
import { refreshPendingCount } from "./pending-store";

const PING_URL       = `${BASE_URL}/ping`;
const AUTO_INTERVAL  = 30_000;   // 30 s — fast catch-up
const PING_TIMEOUT   = 8_000;    // 8 s ping timeout

let _timer:       ReturnType<typeof setInterval> | null = null;
let _appStateSub: { remove(): void } | null             = null;
let _flushing     = false;
let _wasOnline    = false;        // track last known online state
let _token: string | null         = null;

export type NetSyncState = {
  online: boolean;
  flushing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
};

let _state: NetSyncState = {
  online: false,
  flushing: false,
  lastSyncAt: null,
  lastError: null,
};

const _listeners = new Set<(state: NetSyncState) => void>();

function emitState() {
  const snapshot = { ..._state };
  _listeners.forEach((fn) => fn(snapshot));
}

function updateState(patch: Partial<NetSyncState>) {
  _state = { ..._state, ...patch };
  emitState();
}

export function getNetSyncState(): NetSyncState {
  return { ..._state };
}

export function subscribeNetSyncState(fn: (state: NetSyncState) => void): () => void {
  _listeners.add(fn);
  fn({ ..._state });
  return () => _listeners.delete(fn);
}

export function setNetSyncToken(token: string | null): void {
  _token = token;
}

// ── Network check ─────────────────────────────────────────────────────────────

export async function isOnline(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT);
  try {
    const res = await fetch(PING_URL, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });
    return res.status < 600;
  } catch (e: any) {
    // AbortError = timed out — treat as online (slow connection, not truly offline)
    if (e?.name === "AbortError") return true;
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ── Flush all queues ──────────────────────────────────────────────────────────

export async function flushAllQueues(): Promise<void> {
  if (_flushing) return;
  _flushing = true;
  updateState({ flushing: true, lastError: null });
  try {
    const online = await isOnline();

    // Network restored → log once
    if (online && !_wasOnline) {
      console.log("[NET_SYNC] Network restored — flushing queues");
    }
    _wasOnline = online;
    updateState({ online });

    if (!online) return;

    let simpleResult:
      | Awaited<ReturnType<typeof processSimpleQueue>>
      | null = null;

    try {
      simpleResult = await processSimpleQueue();
    } catch (error: any) {
      console.error(`[NET_SYNC_ERROR] simple-queue:`, error?.message ?? error);
      updateState({ lastError: `simple-queue: ${error?.message ?? "Sync failed"}` });
    }

    try {
      await gpsQueueFlush();
    } catch (error: any) {
      console.error(`[NET_SYNC_ERROR] gps-queue:`, error?.message ?? error);
      updateState({ lastError: `gps-queue: ${error?.message ?? "Sync failed"}` });
    }

    // Do not continue with teardown report/image uploads while there are still
    // pending simple updates. Pole-code edits must land first to keep naming
    // consistent for uploaded teardown images and reports.
    if ((simpleResult?.remaining ?? 0) > 0) {
      await refreshPendingCount();
      updateState({
        lastError: "Waiting for pending field updates before teardown upload",
      });
      return;
    }

    const remainingTasks: Array<[string, () => Promise<unknown>]> = [
      ["sync-queue", () => processSyncQueue()],
      ["image-queue", () => processImageQueue()],
      ["sitemap", () => (_token ? prefetchSitemap(_token) : Promise.resolve())],
    ];

    for (const [label, task] of remainingTasks) {
      try {
        await task();
      } catch (error: any) {
        console.error(`[NET_SYNC_ERROR] ${label}:`, error?.message ?? error);
        updateState({ lastError: `${label}: ${error?.message ?? "Sync failed"}` });
      }
    }

    await refreshPendingCount();
    updateState({ lastSyncAt: new Date().toISOString() });
  } finally {
    _flushing = false;
    updateState({ flushing: false });
  }
}

// Keep the old name for backward compat
export const tryFlush = flushAllQueues;

// ── Start / Stop ──────────────────────────────────────────────────────────────

export function startNetSync(): void {
  // 1. Immediate flush on start
  flushAllQueues();

  // 2. Fast repeating timer (30 s)
  if (_timer) clearInterval(_timer);
  _timer = setInterval(flushAllQueues, AUTO_INTERVAL);

  // 3. Flush on every foreground event
  if (_appStateSub) _appStateSub.remove();
  _appStateSub = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state === "active") flushAllQueues();
  });
}

export function stopNetSync(): void {
  if (_timer)       { clearInterval(_timer); _timer = null; }
  if (_appStateSub) { _appStateSub.remove(); _appStateSub = null; }
}
