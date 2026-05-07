/**
 * Live location sync — pings the backend every 15 minutes with the lineman's
 * current GPS coordinates so the web dashboard can show them on the live map.
 *
 * Only runs when:
 *  - The user is logged in (token present)
 *  - The user has granted foreground location permission
 */
import * as Location from "expo-location";
import { BASE_URL } from "./api";
import { tokenStore } from "./token";

const PING_URL    = `${BASE_URL}/lineman-location`;
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/** Post current GPS to the server. Silently ignores errors. */
async function sendLocation(): Promise<void> {
  try {
    const token = await tokenStore.get();
    if (!token) return;

    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return;

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    await fetch(PING_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        latitude:  pos.coords.latitude,
        longitude: pos.coords.longitude,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // silent — location sync is best-effort
  }
}

/** Request foreground location permission (if not already granted), then start pinging every 15 min. */
export async function startLocationSync(): Promise<void> {
  if (_running) stopLocationSync();
  _running = true;

  const existing = await Location.getForegroundPermissionsAsync();
  if (existing.status !== "granted") {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") { _running = false; return; }
  }

  // Immediate first ping on login
  sendLocation();

  if (_timer) clearInterval(_timer);
  _timer = setInterval(sendLocation, INTERVAL_MS);
}

/** Fire a single immediate ping — call this right after login. */
export function pingLocationNow(): void {
  sendLocation();
}

/** Stop pinging (call on logout). */
export function stopLocationSync(): void {
  _running = false;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
