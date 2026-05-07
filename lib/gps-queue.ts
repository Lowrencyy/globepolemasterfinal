/**
 * Offline GPS queue.
 * When the network is unavailable, pole GPS saves are stored here
 * and flushed the next time the device is online.
 */
import * as FileSystem from "expo-file-system/legacy";
import api from "./api";

const GPS_QUEUE_FILE = `${FileSystem.documentDirectory}gps_queue.json`;

type GpsEntry = {
  pole_id: string;
  lat: number;
  lng: number;
  queuedAt: string;
};

async function readQueue(): Promise<GpsEntry[]> {
  try {
    const info = await FileSystem.getInfoAsync(GPS_QUEUE_FILE);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(GPS_QUEUE_FILE);
    return JSON.parse(raw) ?? [];
  } catch {
    return [];
  }
}

async function writeQueue(entries: GpsEntry[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(GPS_QUEUE_FILE, JSON.stringify(entries));
  } catch {}
}

export async function gpsQueuePush(
  pole_id: string,
  lat: number,
  lng: number,
): Promise<void> {
  const entries = await readQueue();
  // Replace existing entry for same pole if any
  const filtered = entries.filter((e) => e.pole_id !== pole_id);
  filtered.push({ pole_id, lat, lng, queuedAt: new Date().toISOString() });
  await writeQueue(filtered);
}

export async function gpsQueueCount(): Promise<number> {
  return (await readQueue()).length;
}

export async function gpsQueueFlush(): Promise<void> {
  const entries = await readQueue();
  if (entries.length === 0) return;

  const results = await Promise.allSettled(
    entries.map((entry) =>
      api.post(`/poles/${entry.pole_id}/gps`, {
        map_latitude: entry.lat,
        map_longitude: entry.lng,
      }),
    ),
  );

  const remaining = entries.filter((_, i) => {
    const result = results[i];
    if (result.status === "fulfilled") {
      console.log(`[GPS_QUEUE] Synced pole ${entries[i].pole_id}`);
      return false; // synced — remove from queue
    }
    const err = (result as PromiseRejectedResult).reason;
    const status: number | undefined = err?.response?.status;
    // Non-retryable: 4xx errors mean the request is invalid — drop it.
    // Retryable: network failure (no response) or 5xx server error — keep.
    if (status !== undefined && status >= 400 && status < 500) {
      console.warn(`[GPS_QUEUE] Dropping pole ${entries[i].pole_id} — server error ${status}:`, err?.message);
      return false; // drop — retrying a 404/422/400 will never succeed
    }
    console.log(`[GPS_QUEUE] Keeping pole ${entries[i].pole_id} for retry — network/server error:`, err?.message);
    return true; // network error or 5xx — keep for retry
  });

  await writeQueue(remaining);
}

export async function gpsQueueHasPole(pole_id: string): Promise<boolean> {
  const entries = await readQueue();
  return entries.some((e) => e.pole_id === pole_id);
}

export async function gpsQueueGet(pole_id: string): Promise<{ lat: number; lng: number } | null> {
  const entries = await readQueue();
  const entry = entries.find((e) => e.pole_id === pole_id);
  return entry ? { lat: entry.lat, lng: entry.lng } : null;
}

export async function gpsQueueReadAll(): Promise<GpsEntry[]> {
  return readQueue();
}

export async function gpsQueueRemove(pole_id: string): Promise<void> {
  const entries = await readQueue();
  await writeQueue(entries.filter((e) => e.pole_id !== pole_id));
}
