/**
 * Offline-first API wrapper.
 *
 * Behaviour:
 *  • ONLINE  → calls the API directly. On network-level failure (no response)
 *              it queues the request automatically and returns an OfflineQueued result.
 *  • OFFLINE → queues immediately, returns an OfflineQueued result.
 *  • 4xx/5xx server errors are NOT queued — they are thrown as-is so the
 *              caller can handle validation errors normally.
 *
 * All queued items are processed by net-sync (auto) or the profile "Sync All" (manual).
 */
import api from "./api";
import { isOnline } from "./net-sync";
import { simpleQueuePush } from "./simple-queue";

export class OfflineQueued {
  constructor(public readonly queuedUrl: string) {}
  toString() { return `[queued offline: ${this.queuedUrl}]`; }
}

type Method = "post" | "put" | "patch" | "delete";
type Body   = Record<string, any>;

/** Returns the API response data, or OfflineQueued if the request was deferred. */
export async function offlineRequest<T = any>(
  method: Method,
  url: string,
  body: Body = {},
): Promise<T | OfflineQueued> {
  const online = await isOnline();

  if (online) {
    try {
      let res: any;
      if      (method === "post")   res = await api.post(url, body);
      else if (method === "put")    res = await api.put(url, body);
      else if (method === "patch")  res = await api.patch(url, body);
      else if (method === "delete") res = await (api as any).delete(url);
      return res?.data ?? res;
    } catch (err: any) {
      // Server returned a proper HTTP error (4xx/5xx) → rethrow, don't queue
      if (err?.response?.status) throw err;
      // Network-level failure → fall through to queue
    }
  }

  // Queue it for later
  await simpleQueuePush({ method: method === "delete" ? "post" : method, url, body });
  return new OfflineQueued(url);
}

// Convenience wrappers
export const offlinePost   = <T = any>(url: string, body?: Body) => offlineRequest<T>("post",   url, body);
export const offlinePut    = <T = any>(url: string, body?: Body) => offlineRequest<T>("put",    url, body);
export const offlinePatch  = <T = any>(url: string, body?: Body) => offlineRequest<T>("patch",  url, body);
export const offlineDelete = <T = any>(url: string, body?: Body) => offlineRequest<T>("delete", url, body);

/**
 * Helper to check if a result was queued offline.
 *
 * Usage:
 *   const result = await offlinePost("/skycable/pickup-requests", payload);
 *   if (wasQueued(result)) {
 *     Alert.alert("Saved offline", "Will sync when back online.");
 *   } else {
 *     // use result as T
 *   }
 */
export function wasQueued(result: any): result is OfflineQueued {
  return result instanceof OfflineQueued;
}
