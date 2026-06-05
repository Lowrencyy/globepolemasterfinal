import {
  buildCacheKey,
  getCacheStale,
  setCache,
  TTL,
  type CacheEntry,
} from "@/lib/api-cache";
import { cacheWebTime } from "@/lib/display-time";
import { deduplicate } from "@/lib/request-dedup";
import { tokenStore } from "@/lib/token";
import { getBridgeToken } from "@/lib/token-bridge";

export const BASE_URL = "https://telcovantage.com/api/v1";

export const ASSET_BASE = "https://telcovantage.com/";

/** Converts a stored path like "project-logos/abc.png" to a full URL */
export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = ASSET_BASE.replace(/\/$/, "");
  return `${base}/storage/${path}`;
}

// no-op kept for backward compat — token is managed via token-bridge
export function setAuthToken(_token: string) {}

// ── TTL routing ───────────────────────────────────────────────────────────────
// Map URL patterns to appropriate local cache TTLs.
// More specific patterns must come before catch-alls.

function ttlForUrl(url: string): number {
  if (/\/locations\/(regions|provinces|cities|barangays)/.test(url))
    return TTL.PSGC;
  if (/\/auth\/me/.test(url)) return TTL.ME;
  if (/\/map-pins|\/map$|\/poles\/map/.test(url)) return TTL.MAP_PINS;
  if (/\/poles/.test(url)) return TTL.POLES;
  return TTL.DEFAULT;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function getToken(): Promise<string | null> {
  return getBridgeToken() ?? (await tokenStore.get());
}

async function buildHeaders(
  isFormData = false,
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const token = await getToken();
  return {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    Accept: "application/json",
    "X-App-Version": "1.0.0",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

// ── Response helpers ──────────────────────────────────────────────────────────

async function handleResponse(response: Response) {
  const dateHeader = response.headers.get("date");
  if (dateHeader) {
    cacheWebTime(dateHeader).catch(() => {});
  }

  const text = await response.text();
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    const err: any = new Error(data?.message ?? "Request failed");
    err.response = { status: response.status, data };
    throw err;
  }

  return { data };
}

const TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── GET with full cache + ETag + dedup pipeline ───────────────────────────────
//
// Request lifecycle for GET:
//   1. Build cache key from URL + userId.
//   2. Load stale cache (even expired) — used for immediate display.
//   3. Deduplicate: if another call for the same key is already in-flight,
//      reuse its Promise. All callers resolve together.
//   4. If cache has a valid ETag, attach If-None-Match header.
//   5a. 304 Not Modified → return existing cached data, no update needed.
//   5b. 200 OK           → update local cache (data + new ETag).
//   5c. Network error    → return stale cache if available, else rethrow.

async function cachedGet(url: string): Promise<{ data: any }> {
  const fullUrl = `${BASE_URL}${url}`;
  const userId = (await getToken()) ? "me" : null; // lightweight scope
  const cacheKey = buildCacheKey(url, userId);
  const ttlMs = ttlForUrl(url);

  // Step 2: Load stale cache for immediate UI rendering
  const stale: CacheEntry | null = await getCacheStale(cacheKey);

  // Step 3: Deduplicate concurrent calls for the same endpoint
  const networkFetch = (): Promise<{ data: any }> =>
    deduplicate(fullUrl, async () => {
      const extraHeaders: Record<string, string> = {};

      // Step 4: Attach ETag if we have one cached
      if (stale?.etag) {
        extraHeaders["If-None-Match"] = stale.etag;
      }

      const headers = await buildHeaders(false, extraHeaders);

      let response: Response;
      try {
        response = await fetchWithTimeout(fullUrl, { method: "GET", headers });
      } catch (networkErr) {
        // Step 5c: Offline / timeout → serve stale cache if available
        if (stale) {
          return { data: stale.data };
        }
        throw networkErr;
      }

      const dateHeader = response.headers.get("date");
      if (dateHeader) cacheWebTime(dateHeader).catch(() => {});

      // Step 5a: 304 Not Modified → nothing changed, keep stale data
      if (response.status === 304) {
        return { data: stale!.data };
      }

      if (!response.ok) {
        // On server error, serve stale cache if available rather than crashing
        if (stale) {
          return { data: stale.data };
        }
        const text = await response.text();
        let errData: any = {};
        try {
          errData = JSON.parse(text);
        } catch {
          errData = { message: text };
        }
        const err: any = new Error(errData?.message ?? "Request failed");
        err.response = { status: response.status, data: errData };
        throw err;
      }

      // Step 5b: 200 OK → parse, cache, return fresh data
      const text = await response.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }

      const newEtag = response.headers.get("ETag");
      await setCache(cacheKey, data, newEtag, url, ttlMs, userId);

      return { data };
    });

  return networkFetch();
}

// ── Exported API client ───────────────────────────────────────────────────────

const api = {
  /**
   * GET with cache-first + ETag + in-flight deduplication.
   * All screens use this — never call fetch() directly for GET requests.
   */
  get: cachedGet,

  post: async (url: string, body: any) => {
    const isFormData = body instanceof FormData;
    const headers = await buildHeaders(isFormData);
    const finalUrl = `${BASE_URL}${url}`;
    const timeout = isFormData ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS;

    const response = await fetchWithTimeout(
      finalUrl,
      {
        method: "POST",
        headers,
        body: isFormData ? body : JSON.stringify(body),
      },
      timeout,
    );
    return handleResponse(response);
  },

  put: async (url: string, body: any) => {
    const headers = await buildHeaders();
    const finalUrl = `${BASE_URL}${url}`;
    const response = await fetchWithTimeout(finalUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    return handleResponse(response);
  },

  patch: async (url: string, body: any) => {
    const headers = await buildHeaders();
    const finalUrl = `${BASE_URL}${url}`;
    const response = await fetchWithTimeout(finalUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    return handleResponse(response);
  },

  delete: async (url: string) => {
    const headers = await buildHeaders();
    const finalUrl = `${BASE_URL}${url}`;
    const response = await fetchWithTimeout(finalUrl, {
      method: "DELETE",
      headers,
    });
    return handleResponse(response);
  },
};

export default api;
