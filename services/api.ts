const BASE_URL = "https://disguisedly-enarthrodial-kristi.ngrok-free.dev/api/v1";

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "ngrok-skip-browser-warning": "1",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    if (data.errors) {
      const fieldMessages = Object.values(data.errors as Record<string, string[]>)
        .flat()
        .join(" ");
      throw new Error(fieldMessages || data.message || "Request failed");
    }
    throw new Error(data.message || "Request failed");
  }

  return data as T;
}

export default { request };
