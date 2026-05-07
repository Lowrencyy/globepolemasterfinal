/**
 * Offline submission queue.
 * When the network is unavailable, teardown submissions are saved here
 * and automatically retried the next time the app comes online.
 */
import * as FileSystem from "expo-file-system/legacy";

import api from "./api";
import { cacheSet } from "./cache";
import { getDisplayTime } from "./display-time";

const QUEUE_FILE = `${FileSystem.documentDirectory}sync_queue.json`;

export type QueueEntry = {
  id: string;
  fields: Record<string, string>;
  photoPaths: Record<string, string>;
  draftDir: string;
  poleDraftDir: string;
  fromPoleId?: string;
  nodeId?: string;
  poleAfterPath?: string; // path to delete from pole_drafts after success
  queuedAt: string;
};

async function readQueue(): Promise<QueueEntry[]> {
  try {
    const info = await FileSystem.getInfoAsync(QUEUE_FILE);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(QUEUE_FILE);
    return JSON.parse(raw) ?? [];
  } catch {
    return [];
  }
}

async function writeQueue(entries: QueueEntry[]): Promise<void> {
  await FileSystem.writeAsStringAsync(QUEUE_FILE, JSON.stringify(entries));
}

export async function queuePush(
  entry: Omit<QueueEntry, "id" | "queuedAt">,
): Promise<void> {
  const entries = await readQueue();
  entries.push({
    ...entry,
    id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    queuedAt: await getDisplayTime(),
  });
  await writeQueue(entries);
}

export async function queueCount(): Promise<number> {
  const entries = await readQueue();
  return entries.length;
}

export async function queueReadAll(): Promise<QueueEntry[]> {
  return readQueue();
}

export async function queueRemove(id: string): Promise<void> {
  const entries = await readQueue();
  await writeQueue(entries.filter((e) => e.id !== id));
}

async function buildForm(entry: QueueEntry): Promise<FormData> {
  const form = new FormData();
  for (const [key, value] of Object.entries(entry.fields)) {
    form.append(key, value);
  }
  for (const [fieldName, uri] of Object.entries(entry.photoPaths)) {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      form.append(fieldName, { uri, name: `${fieldName}.jpg`, type: "image/jpeg" } as any);
    }
  }
  return form;
}

async function submitEntry(entry: QueueEntry): Promise<void> {
  const form = await buildForm(entry);
  await api.post("/teardown-logs", form);

  await cacheSet("teardown_logs", null);
  if (entry.fromPoleId) {
    await cacheSet(`spans_pole_${entry.fromPoleId}`, null);
    await cacheSet(`pole_submitted_${entry.fromPoleId}`, true);
  }
  if (entry.nodeId) {
    await cacheSet(`node_logs_${entry.nodeId}`, null);
  }
  await FileSystem.deleteAsync(entry.draftDir, { idempotent: true }).catch(() => {});
  if (entry.poleAfterPath) {
    await FileSystem.deleteAsync(entry.poleAfterPath, { idempotent: true }).catch(() => {});
  }
}

export type SyncResult = {
  submitted: number;
  failed: number;
  firstError: string | null;
};

export async function processSyncQueue(): Promise<SyncResult> {
  const entries = await readQueue();
  if (entries.length === 0) return { submitted: 0, failed: 0, firstError: null };

  const results = await Promise.allSettled(entries.map((entry) => submitEntry(entry)));

  const remaining: QueueEntry[] = [];
  let submitted = 0;
  let firstError: string | null = null;

  for (let i = 0; i < entries.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      submitted++;
    } else {
      const status = (result.reason as any)?.response?.status;
      const msg: string =
        (result.reason as any)?.message ?? "Unknown error";
      if (status === 409) {
        // Already on server — clean up draft
        await FileSystem.deleteAsync(entries[i].draftDir, { idempotent: true }).catch(() => {});
        submitted++;
      } else {
        if (!firstError) firstError = `(${status ?? "network"}) ${msg}`;
        remaining.push(entries[i]);
      }
    }
  }

  await writeQueue(remaining);
  return { submitted, failed: remaining.length, firstError };
}
