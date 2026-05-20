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
        "ngrok-skip-browser-warning": "true",
        Accept: "application/json",
      },
    });
    return res.status < 600;
  } catch (e: any) {
    // AbortError = timed out — treat as online (slow ngrok, not truly offline)
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
  try {
    const online = await isOnline();

    // Network restored → log once
    if (online && !_wasOnline) {
      console.log("[NET_SYNC] Network restored — flushing queues");
    }
    _wasOnline = online;

    if (!online) return;

    const results = await Promise.allSettled([
      processSyncQueue(),                              // teardown reports + photos
      processSimpleQueue(),                            // JSON PUT/POST actions
      gpsQueueFlush(),                                 // GPS coordinates
      processImageQueue(),                             // orphaned photos
      _token ? prefetchSitemap(_token) : Promise.resolve(),
    ]);

    const labels = ["sync-queue", "simple-queue", "gps-queue", "image-queue", "sitemap"];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`[NET_SYNC_ERROR] ${labels[i]}:`, r.reason?.message ?? r.reason);
      }
    });

    await refreshPendingCount();
  } finally {
    _flushing = false;
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
