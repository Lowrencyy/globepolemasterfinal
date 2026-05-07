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

/** Convert a ms-since-epoch value to a PHT ISO string (UTC+8 offset). */
function toPHTIso(ms: number): string {
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  return d.toISOString().replace("Z", "+08:00");
}

/** Get the current PHT time synchronously as an ISO string. */
export function getPHTNow(): string {
  return toPHTIso(Date.now());
}

/** Get the current PHT date as YYYY-MM-DD (for API date queries). */
export function getPHTToday(): string {
  return toPHTIso(Date.now()).split("T")[0];
}

/** Save the current device time. Called by the home screen on mount/focus. */
export async function saveDisplayTime(): Promise<void> {
  await cacheSet(KEY, Date.now()).catch(() => {});
}

/**
 * Get the last saved display time as a PHT ISO string.
 * Falls back to the current device time if no snapshot exists.
 */
export async function getDisplayTime(): Promise<string> {
  const cached = await cacheGet<number>(KEY).catch(() => null);
  return toPHTIso(cached ?? Date.now());
}
