/**
 * Display Time — records the Philippine Standard Time as shown on the home screen.
 *
 * Captured on every app open / foreground resume so that offline submissions
 * use the time that was actually visible to the lineman, not whatever the
 * device clock says at sync time (which could be manually edited).
 *
 * All timestamps are returned as PHT (UTC+8) ISO strings: "2026-04-12T14:30:00.000+08:00"
 */

import { cacheGet, cacheSet } from "./cache";

const KEY = "display_time_snapshot";
const OFFSET_KEY = "web_time_offset_ms";

let memoryOffset = 0;

// Load cached offset immediately on module import if available
cacheGet<number>(OFFSET_KEY)
  .then((off) => {
    if (typeof off === "number" && !isNaN(off)) {
      memoryOffset = off;
    }
  })
  .catch(() => {});

/** Get the currently cached web time offset in milliseconds. */
export async function getWebTimeOffset(): Promise<number> {
  const off = await cacheGet<number>(OFFSET_KEY).catch(() => null);
  if (typeof off === "number" && !isNaN(off)) {
    memoryOffset = off;
    return off;
  }
  return memoryOffset;
}

/** Save the offset between web server time and local device clock */
export async function cacheWebTime(serverDateStr?: string | null): Promise<void> {
  if (!serverDateStr) return;
  const serverMs = Date.parse(serverDateStr);
  if (isNaN(serverMs)) return;
  const offset = serverMs - Date.now();
  memoryOffset = offset;
  await cacheSet(OFFSET_KEY, offset).catch(() => {});
}

/** Convert a ms-since-epoch value to a PHT ISO string (UTC+8 offset). */
function toPHTIso(ms: number): string {
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  return d.toISOString().replace("Z", "+08:00");
}

/** Get the current PHT time synchronously as an ISO string. */
export function getPHTNow(): string {
  return toPHTIso(Date.now() + memoryOffset);
}

/** Get the current PHT date as YYYY-MM-DD (for API date queries). */
export function getPHTToday(): string {
  return toPHTIso(Date.now() + memoryOffset).split("T")[0];
}

/** Save the current device time. Called by the home screen on mount/focus. */
export async function saveDisplayTime(): Promise<void> {
  await cacheSet(KEY, Date.now() + memoryOffset).catch(() => {});
}

/**
 * Get the last saved display time as a PHT ISO string.
 * Falls back to the current device time if no snapshot exists.
 */
export async function getDisplayTime(): Promise<string> {
  const cached = await cacheGet<number>(KEY).catch(() => null);
  const currentOffset = await getWebTimeOffset();
  return toPHTIso(cached ?? (Date.now() + currentOffset));
}
