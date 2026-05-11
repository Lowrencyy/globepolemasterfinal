/**
 * Offline teardown submission queue + image upload queue.
 *
 * Statuses:  pending | syncing | synced | failed | permanently_failed
 * Logs:
 *   OFFLINE_CACHE_SAVED
 *   ONLINE_UPLOAD_SUCCESS
 *   ONLINE_UPLOAD_BACKEND_ERROR
 *   OFFLINE_SYNC_STARTED
 *   OFFLINE_SYNC_EMPTY
 *   OFFLINE_SYNC_COMPLETED
 *   NETWORK_ERROR_KEEP_PENDING
 *   MAX_RETRIES_EXCEEDED
 */
import * as FileSystem from "expo-file-system/legacy";
import api from "./api";
import { cacheSet } from "./cache";
import { refreshPendingCount } from "./pending-store";

const QUEUE_FILE    = `${FileSystem.documentDirectory}sync_queue.json`;
const IMAGES_FILE   = `${FileSystem.documentDirectory}sync_images.json`;
// Persistent dir for images that failed their initial upload — survives draft cleanup
export const OFFLINE_IMAGES_DIR = `${FileSystem.documentDirectory}offline_images/`;

const MAX_RETRIES = 5;

export type SyncStatus = "pending" | "syncing" | "synced" | "failed" | "permanently_failed";

export type QueueEntry = {
  id: string;
  local_id: string;
  fields: Record<string, string>;
  photoPaths: Record<string, string>;
  draftDir: string;
  poleDraftDir: string;
  fromPoleId?: string;
  toPoleId?: string;
  nodeId?: string;
  poleAfterPath?: string;
  status: SyncStatus;
  retryCount: number;
  lastError?: string;
  queuedAt: string;
};

export type ImageQueueEntry = {
  id: string;
  reportLocalId: string;
  fieldName: string;
  uri: string;           // points to OFFLINE_IMAGES_DIR copy — survives draft cleanup
  meta: {
    report_id?: string;
    pole_id?: string;
    node_id?: string;
    pole_code?: string;
    image_type?: string;
  };
  status: SyncStatus;
  retryCount: number;
  lastError?: string;
  queuedAt: string;
};

// ── File helpers ──────────────────────────────────────────────────────────────

async function ensureOfflineImagesDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(OFFLINE_IMAGES_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(OFFLINE_IMAGES_DIR, { intermediates: true });
}

async function readQueue(): Promise<QueueEntry[]> {
  try {
    const info = await FileSystem.getInfoAsync(QUEUE_FILE);
    if (!info.exists) return [];
    return JSON.parse(await FileSystem.readAsStringAsync(QUEUE_FILE)) ?? [];
  } catch { return []; }
}

async function writeQueue(entries: QueueEntry[]): Promise<void> {
  await FileSystem.writeAsStringAsync(QUEUE_FILE, JSON.stringify(entries));
}

async function readImageQueue(): Promise<ImageQueueEntry[]> {
  try {
    const info = await FileSystem.getInfoAsync(IMAGES_FILE);
    if (!info.exists) return [];
    return JSON.parse(await FileSystem.readAsStringAsync(IMAGES_FILE)) ?? [];
  } catch { return []; }
}

async function writeImageQueue(entries: ImageQueueEntry[]): Promise<void> {
  await FileSystem.writeAsStringAsync(IMAGES_FILE, JSON.stringify(entries));
}

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ── Copy image to persistent storage ────────────────────────────────────────

/**
 * Copy an image from a draft/temp location to OFFLINE_IMAGES_DIR so it
 * survives draft directory cleanup. Returns the persistent URI.
 */
export async function persistImage(uri: string, fileName: string): Promise<string> {
  await ensureOfflineImagesDir();
  const dest = `${OFFLINE_IMAGES_DIR}${fileName}`;
  const destInfo = await FileSystem.getInfoAsync(dest);
  if (!destInfo.exists) {
    await FileSystem.copyAsync({ from: uri, to: dest });
  }
  return dest;
}

// ── Push ─────────────────────────────────────────────────────────────────────

export async function queuePush(
  entry: Omit<QueueEntry, "id" | "local_id" | "status" | "retryCount" | "queuedAt">,
): Promise<string> {
  const local_id = makeId();
  const entries = await readQueue();
  entries.push({
    ...entry,
    id: makeId(),
    local_id,
    status: "pending",
    retryCount: 0,
    queuedAt: new Date().toISOString(),
  });
  await writeQueue(entries);
  console.log("[OFFLINE_CACHE_SAVED]", local_id);
  refreshPendingCount().catch(() => {});
  return local_id;
}

export async function imageQueuePush(
  items: Omit<ImageQueueEntry, "id" | "status" | "retryCount" | "queuedAt">[],
): Promise<void> {
  const existing = await readImageQueue();
  const now = new Date().toISOString();
  for (const item of items) {
    // Deduplicate: skip if same reportLocalId + fieldName already queued
    const duplicate = existing.some(
      e => e.reportLocalId === item.reportLocalId && e.fieldName === item.fieldName && e.status !== "permanently_failed",
    );
    if (!duplicate) {
      existing.push({ ...item, id: makeId(), status: "pending", retryCount: 0, queuedAt: now });
    }
  }
  await writeImageQueue(existing);
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function queueReadAll(): Promise<QueueEntry[]> { return readQueue(); }
export async function imageQueueReadAll(): Promise<ImageQueueEntry[]> { return readImageQueue(); }

export async function queueCount(): Promise<number> {
  return (await readQueue()).filter(e => e.status !== "synced" && e.status !== "permanently_failed").length;
}

export async function queueRemove(id: string): Promise<void> {
  await writeQueue((await readQueue()).filter(e => e.id !== id));
}

export async function imageQueueRemove(id: string): Promise<void> {
  const images = await readImageQueue();
  const entry = images.find(e => e.id === id);
  // Delete persistent copy when explicitly removed
  if (entry?.uri?.includes(OFFLINE_IMAGES_DIR)) {
    await FileSystem.deleteAsync(entry.uri, { idempotent: true }).catch(() => {});
  }
  await writeImageQueue(images.filter(e => e.id !== id));
}

// ── Upload helpers ────────────────────────────────────────────────────────────

async function buildForm(entry: QueueEntry): Promise<FormData> {
  const form = new FormData();
  form.append("local_id", entry.local_id);
  for (const [k, v] of Object.entries(entry.fields)) form.append(k, v);
  for (const [fieldName, uri] of Object.entries(entry.photoPaths)) {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      form.append(fieldName, { uri, name: `${fieldName}.jpg`, type: "image/jpeg" } as any);
    }
  }
  return form;
}

async function cleanupAfterSuccess(entry: QueueEntry): Promise<void> {
  await cacheSet("teardown_logs", null);
  if (entry.fromPoleId) {
    await cacheSet(`spans_pole_${entry.fromPoleId}`, null);
    await cacheSet(`pole_submitted_${entry.fromPoleId}`, true);
  }
  // Also invalidate destination pole span cache — it may have new pending spans revealed
  if (entry.toPoleId) {
    await cacheSet(`spans_pole_${entry.toPoleId}`, null);
  }
  if (entry.nodeId) await cacheSet(`node_logs_${entry.nodeId}`, null);
  await FileSystem.deleteAsync(entry.draftDir, { idempotent: true }).catch(() => {});
  if (entry.poleAfterPath) {
    await FileSystem.deleteAsync(entry.poleAfterPath, { idempotent: true }).catch(() => {});
  }
}

// ── Process report queue ──────────────────────────────────────────────────────

export type SyncResult = {
  submitted: number;
  failed: number;
  permanentlyFailed: number;
  firstError: string | null;
};

export async function processSyncQueue(): Promise<SyncResult> {
  const all = await readQueue();
  const actionable = all.filter(
    e => (e.status === "pending" || e.status === "failed") && e.retryCount < MAX_RETRIES,
  );

  if (actionable.length === 0) {
    console.log("[OFFLINE_SYNC_EMPTY]");
    return { submitted: 0, failed: 0, permanentlyFailed: 0, firstError: null };
  }

  console.log(`[OFFLINE_SYNC_STARTED] ${actionable.length} items`);

  // Mark actionable as syncing atomically
  const marked = all.map(e =>
    actionable.some(a => a.id === e.id) ? { ...e, status: "syncing" as SyncStatus } : e,
  );
  await writeQueue(marked);

  const results = await Promise.allSettled(
    actionable.map(entry => buildForm(entry).then(form => api.post("/teardown-logs", form))),
  );

  let submitted = 0;
  let permanentlyFailed = 0;
  let firstError: string | null = null;

  const final = await readQueue();

  for (let i = 0; i < actionable.length; i++) {
    const entry = actionable[i];
    const result = results[i];
    const idx = final.findIndex(e => e.id === entry.id);
    if (idx === -1) continue;

    if (result.status === "fulfilled") {
      submitted++;
      final[idx].status = "synced";
      console.log(`[ONLINE_UPLOAD_SUCCESS] local_id=${entry.local_id}`);
      await cleanupAfterSuccess(entry);
    } else {
      const err = result.reason as any;
      const httpStatus = err?.response?.status;
      const newRetry = entry.retryCount + 1;

      if (httpStatus === 409) {
        // Already on server
        submitted++;
        final[idx].status = "synced";
        await cleanupAfterSuccess(entry);
      } else if (httpStatus === 400 || httpStatus === 422 || httpStatus === 404) {
        // Bad data — won't help to retry
        const msg = err?.response?.data?.message ?? JSON.stringify(err?.response?.data ?? {}).slice(0, 200);
        final[idx].status = "permanently_failed";
        final[idx].lastError = `HTTP ${httpStatus}: ${msg}`;
        permanentlyFailed++;
        console.log(`[ONLINE_UPLOAD_BACKEND_ERROR] local_id=${entry.local_id} status=${httpStatus}`);
      } else {
        // Network / 5xx — retry later
        const msg = err?.message ?? `HTTP ${httpStatus ?? "network"}`;
        final[idx].retryCount = newRetry;
        final[idx].lastError = msg;

        if (newRetry >= MAX_RETRIES) {
          final[idx].status = "permanently_failed";
          permanentlyFailed++;
          console.log(`[MAX_RETRIES_EXCEEDED] local_id=${entry.local_id} after ${newRetry} attempts`);
        } else {
          final[idx].status = "failed";
          if (!firstError) firstError = msg;
          console.log(`[NETWORK_ERROR_KEEP_PENDING] local_id=${entry.local_id} attempt=${newRetry}`);
        }
      }
    }
  }

  await writeQueue(final);
  refreshPendingCount().catch(() => {});

  const failedCount = final.filter(e => e.status === "failed").length;
  console.log(`[OFFLINE_SYNC_COMPLETED] submitted=${submitted} failed=${failedCount} permanent=${permanentlyFailed}`);
  return { submitted, failed: failedCount, permanentlyFailed, firstError };
}

// ── Process image queue ───────────────────────────────────────────────────────

export async function processImageQueue(): Promise<void> {
  const all = await readImageQueue();
  const actionable = all.filter(
    e => (e.status === "pending" || e.status === "failed") && e.retryCount < MAX_RETRIES,
  );
  if (actionable.length === 0) return;

  const marked = all.map(e =>
    actionable.some(a => a.id === e.id) ? { ...e, status: "syncing" as SyncStatus } : e,
  );
  await writeImageQueue(marked);

  const results = await Promise.allSettled(
    actionable.map(async (img) => {
      const info = await FileSystem.getInfoAsync(img.uri);
      if (!info.exists) throw new Error(`Image file missing: ${img.uri}`);

      const form = new FormData();
      if (img.meta.report_id) form.append("report_id",   img.meta.report_id);
      if (img.meta.pole_id)   form.append("pole_id",     img.meta.pole_id);
      if (img.meta.node_id)   form.append("node_id",     img.meta.node_id);
      if (img.meta.pole_code) form.append("pole_code",   img.meta.pole_code);
      if (img.meta.image_type) form.append("image_type", img.meta.image_type);
      form.append("inventory_type", "skycable");
      form.append("idempotency_key", `${img.reportLocalId}_${img.fieldName}`);
      form.append("image", { uri: img.uri, name: `${img.fieldName}.jpg`, type: "image/jpeg" } as any);
      return api.post("/teardown/upload-image", form);
    }),
  );

  const final = await readImageQueue();

  for (let i = 0; i < actionable.length; i++) {
    const img = actionable[i];
    const idx = final.findIndex(e => e.id === img.id);
    if (idx === -1) continue;

    const result = results[i];
    if (result.status === "fulfilled") {
      final[idx].status = "synced";
      // Clean up persistent image copy after confirmed upload
      if (img.uri.includes(OFFLINE_IMAGES_DIR)) {
        await FileSystem.deleteAsync(img.uri, { idempotent: true }).catch(() => {});
      }
    } else {
      const httpStatus = (result.reason as any)?.response?.status;
      const newRetry = img.retryCount + 1;
      final[idx].retryCount = newRetry;
      final[idx].lastError = (result.reason as any)?.message ?? "Upload failed";

      if (newRetry >= MAX_RETRIES || (httpStatus >= 400 && httpStatus < 500)) {
        final[idx].status = "permanently_failed";
        console.log(`[MAX_RETRIES_EXCEEDED] image ${img.fieldName} for ${img.reportLocalId}`);
      } else {
        final[idx].status = "failed";
      }
    }
  }

  await writeImageQueue(final);
}
