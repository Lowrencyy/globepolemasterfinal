import { getUnreadNotificationCount } from "@/services/skycable";
import { getBridgeToken } from "@/lib/token-bridge";

let _count = 0;
const _listeners = new Set<(count: number) => void>();

export function getUnreadCount(): number { return _count; }

export function setUnreadCount(count: number): void {
  if (_count === count) return;
  _count = count;
  _listeners.forEach(fn => fn(count));
}

export function subscribeUnreadCount(fn: (count: number) => void): () => void {
  _listeners.add(fn);
  fn(_count);
  return () => _listeners.delete(fn);
}

export async function refreshUnreadCount(): Promise<number> {
  const token = getBridgeToken() ?? "";
  if (!token) return 0;
  const count = await getUnreadNotificationCount(token);
  setUnreadCount(count);
  return count;
}
