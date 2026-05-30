const BASE_URL = "http://192.168.1.9:8080/api/v1";

const TIMEOUT_MS = 15_000; // 15 s — normal requests
const UPLOAD_TIMEOUT_MS = 120_000; // 2 min — multipart uploads

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseJson(res: Response): Promise<any> {
  // Wrap JSON parsing in its own timeout so a stalled response body doesn't hang forever
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Response parse timeout")),
      10_000,
    );
    res
      .text()
      .then((text) => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(text));
        } catch {
          resolve({ message: text });
        }
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(!isFormData ? { "Content-Type": "application/json" } : {}),
    Accept: "application/json",
    "ngrok-skip-browser-warning": "true",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string>),
  };

  const timeout = isFormData ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS;
  const res = await fetchWithTimeout(
    `${BASE_URL}${path}`,
    { ...options, headers },
    timeout,
  );
  const data = await parseJson(res);

  if (!res.ok) {
    const fieldMessages = data.errors
      ? Object.values(data.errors as Record<string, string[]>)
          .flat()
          .join(" ")
      : null;
    const err: any = new Error(
      fieldMessages || data.message || `HTTP ${res.status}`,
    );
    err.response = { status: res.status, data };
    throw err;
  }

  return data as T;
}

export default { request };
