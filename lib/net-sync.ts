/**
 * Background network-aware sync manager.
 *
 * - On app start: immediately attempt to flush queues if online
 * - Every 5 minutes: if online, flush queues
 * - Also flushes whenever the app comes back to the foreground
 */
import { AppState, AppStateStatus } from "react-native";
import { BASE_URL } from "./api";
import { gpsQueueFlush } from "./gps-queue";
import { processSyncQueue } from "./sync-queue";
import { processSimpleQueue } from "./simple-queue";

const PING_URL    = `${BASE_URL}/ping`;
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let _timer: ReturnType<typeof setInterval> | null = null;
let _appStateSub: { remove(): void } | null = null;
let _flushing = false;

export async function isOnline(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
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
    // AbortError = request timed out — ngrok is just slow, device likely has network.
    // Only treat as offline for actual network-level failures (TypeError / "Network request failed").
    if (e?.name === "AbortError") return true;
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function tryFlush(): Promise<void> {
  if (_flushing) return;
  _flushing = true;
  try {
    const online = await isOnline();
    if (!online) return;
    await Promise.allSettled([processSyncQueue(), processSimpleQueue(), gpsQueueFlush()]);
  } finally {
    _flushing = false;
  }
}

export function startNetSync(): void {
  tryFlush();

  if (_timer) clearInterval(_timer);
  _timer = setInterval(tryFlush, INTERVAL_MS);

  if (_appStateSub) _appStateSub.remove();
  _appStateSub = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state === "active") tryFlush();
  });
}

export function stopNetSync(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_appStateSub) { _appStateSub.remove(); _appStateSub = null; }
}
