/**
 * Live location tracker.
 * Pings the backend with the lineman's GPS every 10 minutes while the app
 * is in the foreground.  Also fires once on login and once on every foreground
 * resume (throttled to once per 5 minutes so rapid app-switches don't spam).
 *
 * Backend consumes POST /skycable/lineman/location → displayed at /field/live.
 */
import * as Location from "expo-location";
import { AppState, AppStateStatus } from "react-native";
import api from "./api";
import { getPHTNow } from "./display-time";

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const THROTTLE_MS =  5 * 60 * 1000; // AppState pings: min 5 min apart

let _timer: ReturnType<typeof setInterval> | null = null;
let _appStateSub: { remove(): void } | null = null;
let _lastPingAt = 0;
let _running = false;

async function ping(): Promise<void> {
  try {
    _lastPingAt = Date.now();
    // Request permission on first ping — shows the system dialog if not yet granted
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") return;

    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const { latitude, longitude, accuracy } = loc.coords;

    // Reverse geocode to get address — best-effort, won't block the ping
    let barangay: string | null = null;
    let city: string | null = null;
    let province: string | null = null;
    let region_name: string | null = null;

    try {
      const [geo] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (geo) {
        // Android Philippines: district=barangay, city=city, subregion=province, region=region
        barangay    = geo.district ?? null;
        city        = geo.city ?? geo.subregion ?? null;
        province    = geo.subregion ?? geo.region ?? null;
        region_name = geo.region ?? null;
      }
    } catch (geoErr: any) {}

    await api.post("/skycable/lineman/location", {
      latitude,
      longitude,
      accuracy:    accuracy ?? null,
      timestamp:   getPHTNow(),
      barangay,
      city,
      province,
      region_name,
    });

    console.log(`[LOCATION_TRACKER] Pinged ${latitude.toFixed(6)}, ${longitude.toFixed(6)} · ${city ?? "?"}, ${province ?? "?"}`);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (!msg.includes("could not be found") && !msg.includes("404")) {
      console.log("[LOCATION_TRACKER] Ping failed:", msg);
    }
  }
}

function pingThrottled(): void {
  if (Date.now() - _lastPingAt < THROTTLE_MS) return;
  ping();
}

export function startLocationTracking(): void {
  if (_running) return;
  _running = true;

  ping(); // immediate first ping on login / app start

  if (_timer) clearInterval(_timer);
  _timer = setInterval(ping, INTERVAL_MS);

  if (_appStateSub) _appStateSub.remove();
  _appStateSub = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state === "active") pingThrottled();
  });
}

/** Fire an immediate location ping — call when a lineman starts work at a pole. */
export function pingNow(): void {
  ping();
}

export function stopLocationTracking(): void {
  _running = false;
  _lastPingAt = 0;
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_appStateSub) { _appStateSub.remove(); _appStateSub = null; }
}
