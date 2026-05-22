import { getBridgeToken } from "@/lib/token-bridge";
import { tokenStore } from "@/lib/token";
import { cacheWebTime } from "@/lib/display-time";

export const BASE_URL =
  "https://jam-meetings-centuries-sold.trycloudflare.com/api/v1";

export const ASSET_BASE =
  "https://jam-meetings-centuries-sold.trycloudflare.com/";

/** Converts a stored path like "project-logos/abc.png" to a full URL */
export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = ASSET_BASE.replace(/\/$/, "");
  return `${base}/storage/${path}`;
}

export function setAuthToken(_token: string) {}

async function buildHeaders(
  isFormData = false,
  extra?: Record<string, string>,
) {
  // Bridge token is set synchronously on login — always current for this session.
  // Fall back to tokenStore (file-persisted) for app restarts.
  const token = getBridgeToken() ?? await tokenStore.get();
  return {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    Accept: "application/json",
    "ngrok-skip-browser-warning": "true",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

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

const TIMEOUT_MS = 30_000;          // 30 s — extended timeout for reliable mobile loading
const UPLOAD_TIMEOUT_MS = 120_000;  // 120 s for photo/file uploads

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

const api = {
  post: async (url: string, body: any) => {
    const isFormData = body instanceof FormData;
    const headers = await buildHeaders(isFormData);
    const finalUrl = `${BASE_URL}${url}`;
    console.log("POST URL:", finalUrl);

    // Use extended timeout for multipart file uploads
    const timeout = isFormData ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS;

    const response = await fetchWithTimeout(finalUrl, {
      method: "POST",
      headers,
      body: isFormData ? body : JSON.stringify(body),
    }, timeout);
    return handleResponse(response);
  },
  get: async (url: string) => {
    const headers = await buildHeaders();
    const finalUrl = `${BASE_URL}${url}`;
    console.log("GET URL:", finalUrl);

    const response = await fetchWithTimeout(finalUrl, {
      method: "GET",
      headers,
    });
    return handleResponse(response);
  },
  put: async (url: string, body: any) => {
    const headers = await buildHeaders();
    const finalUrl = `${BASE_URL}${url}`;
    console.log("PUT URL:", finalUrl);

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
    console.log("PATCH URL:", finalUrl);

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
    console.log("DELETE URL:", finalUrl);

    const response = await fetchWithTimeout(finalUrl, {
      method: "DELETE",
      headers,
    });
    return handleResponse(response);
  },
};

export default api;
