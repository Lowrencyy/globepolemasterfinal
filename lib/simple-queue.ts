/**
 * Lightweight queue for simple JSON PUT/POST requests (no photos).
 * Used for things like pole name edits that need to sync to the backend.
 */
import * as FileSystem from "expo-file-system/legacy";
import api from "./api";

const QUEUE_FILE = `${FileSystem.documentDirectory}simple_queue.json`;

export type SimpleQueueEntry = {
  id: string;
  method: "put" | "post";
  url: string;
  body: Record<string, any>;
  queuedAt: string;
};

async function readQueue(): Promise<SimpleQueueEntry[]> {
  try {
    const info = await FileSystem.getInfoAsync(QUEUE_FILE);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(QUEUE_FILE);
    return JSON.parse(raw) ?? [];
  } catch {
    return [];
  }
}

async function writeQueue(entries: SimpleQueueEntry[]): Promise<void> {
  await FileSystem.writeAsStringAsync(QUEUE_FILE, JSON.stringify(entries));
}

export async function simpleQueuePush(
  entry: Omit<SimpleQueueEntry, "id" | "queuedAt">,
): Promise<void> {
  const entries = await readQueue();
  // Replace existing entry for the same URL so we don't stack duplicates
  const filtered = entries.filter((e) => e.url !== entry.url);
  filtered.push({
    ...entry,
    id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    queuedAt: new Date().toISOString(),
  });
  await writeQueue(filtered);
}

export async function simpleQueueCount(): Promise<number> {
  return (await readQueue()).length;
}

export async function simpleQueueReadAll(): Promise<SimpleQueueEntry[]> {
  return readQueue();
}

export async function simpleQueueRemove(id: string): Promise<void> {
  const entries = await readQueue();
  await writeQueue(entries.filter((e) => e.id !== id));
}

/**
 * Process all queued simple requests.
 * Called from handleSync and net-reconnect.
 * Never throws.
 */
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
      // Success — entry removed (not pushed to remaining)
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 422 || status === 404) {
        // Validation or not-found — drop it, retrying won't help
      } else {
        // Network error — keep for next retry
        remaining.push(entry);
      }
    }
  }

  await writeQueue(remaining);
}
