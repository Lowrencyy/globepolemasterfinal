/**
 * Lightweight observable for the total pending-upload count.
 * Updated by net-sync after every flush and after every queue push.
 * Consumed by the tab layout to show a badge.
 */
import { queueReadAll, imageQueueReadAll } from "./sync-queue";
import { gpsQueueReadAll } from "./gps-queue";
import { simpleQueueReadAll } from "./simple-queue";

let _count = 0;
const _listeners = new Set<(count: number) => void>();

export function getPendingCount(): number { return _count; }

export function setPendingCount(count: number): void {
  if (_count === count) return;
  _count = count;
  _listeners.forEach(fn => fn(count));
}

export function subscribePendingCount(fn: (count: number) => void): () => void {
  _listeners.add(fn);
  fn(_count);
  return () => _listeners.delete(fn);
}

export async function refreshPendingCount(): Promise<number> {
  const [td, imgs, gps, simple] = await Promise.all([
    queueReadAll().catch(() => []),
    imageQueueReadAll().catch(() => []),
    gpsQueueReadAll().catch(() => []),
    simpleQueueReadAll().catch(() => []),
  ]);
  const count =
    (td as any[]).filter(i => i.status !== "synced" && i.status !== "permanently_failed").length +
    (imgs as any[]).filter(i => i.status !== "synced" && i.status !== "permanently_failed").length +
    gps.length +
    simple.length;
  setPendingCount(count);
  return count;
}
