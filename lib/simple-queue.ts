/**
 * Queue for simple JSON PUT/POST requests (no photos).
 * Used for pole name edits, GPS updates, etc.
 */
import * as FileSystem from "expo-file-system/legacy";
import api from "./api";

const QUEUE_FILE  = `${FileSystem.documentDirectory}simple_queue.json`;
const MAX_RETRIES = 5;

export type SimpleQueueEntry = {
  id: string;
  method: "put" | "post";
  url: string;
  body: Record<string, any>;
  retryCount: number;
  lastError?: string;
  queuedAt: string;
};

async function readQueue(): Promise<SimpleQueueEntry[]> {
  try {
    const info = await FileSystem.getInfoAsync(QUEUE_FILE);
    if (!info.exists) return [];
    return JSON.parse(await FileSystem.readAsStringAsync(QUEUE_FILE)) ?? [];
  } catch { return []; }
}

async function writeQueue(entries: SimpleQueueEntry[]): Promise<void> {
  await FileSystem.writeAsStringAsync(QUEUE_FILE, JSON.stringify(entries));
}

export async function simpleQueuePush(
  entry: Omit<SimpleQueueEntry, "id" | "retryCount" | "queuedAt">,
): Promise<void> {
  const entries = await readQueue();
  // Replace existing entry for the same URL — no point stacking identical edits
  const filtered = entries.filter(e => e.url !== entry.url);
  filtered.push({
    ...entry,
    id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    retryCount: 0,
    queuedAt: new Date().toISOString(),
  });
  await writeQueue(filtered);
}

export async function simpleQueueCount(): Promise<number> {
  return (await readQueue()).filter(e => e.retryCount < MAX_RETRIES).length;
}

export async function simpleQueueReadAll(): Promise<SimpleQueueEntry[]> {
  return readQueue();
}

export async function simpleQueueRemove(id: string): Promise<void> {
  await writeQueue((await readQueue()).filter(e => e.id !== id));
}

export async function processSimpleQueue(): Promise<void> {
  const entries = await readQueue();
  if (entries.length === 0) return;

  const remaining: SimpleQueueEntry[] = [];

  for (const entry of entries) {
    try {
      if (entry.method === "put") {
        await api.put(entry.url, entry.body);
      } else {
        await api.post(entry.url, entry.body);
      }
      // Success — removed from remaining
    } catch (e: any) {
      const status = e?.response?.status;

      if (status === 422 || status === 404 || status === 400) {
        // Validation/not-found — retrying won't help; log and drop
        console.warn(`[SIMPLE_QUEUE_DROP] ${entry.method.toUpperCase()} ${entry.url} → ${status}:`, e?.response?.data ?? e?.message);
      } else if ((entry.retryCount ?? 0) + 1 >= MAX_RETRIES) {
        console.warn(`[MAX_RETRIES_EXCEEDED] ${entry.method.toUpperCase()} ${entry.url} after ${MAX_RETRIES} attempts`);
      } else {
        // Network / 5xx — keep for retry
        remaining.push({ ...entry, retryCount: (entry.retryCount ?? 0) + 1, lastError: e?.message });
      }
    }
  }

  await writeQueue(remaining);
}
