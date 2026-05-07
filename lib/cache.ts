/**
 * Simple JSON disk cache using expo-file-system.
 * Shows stale data instantly while fresh data loads in the background.
 */
import * as FileSystem from "expo-file-system/legacy";

const CACHE_DIR = FileSystem.cacheDirectory + "app-cache/";

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
}

function filePath(key: string) {
  return CACHE_DIR + key.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const path = filePath(key);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const text = await FileSystem.readAsStringAsync(path);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  try {
    await ensureDir();
    await FileSystem.writeAsStringAsync(filePath(key), JSON.stringify(value));
  } catch {
    // ignore write errors
  }
}
