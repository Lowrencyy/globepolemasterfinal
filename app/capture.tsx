import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getPHTNow } from "@/lib/display-time";
import { captureEvents } from "@/lib/capture-events";
import { LiveMapTile } from "@/lib/live-map-tile";

function parseGpsAddress(raw: any): { road: string | undefined; city: string | undefined; province: string | undefined } {
  const city     = String(raw?.city ?? raw?.district ?? raw?.subregion ?? raw?.region ?? "").trim();
  const province = String(raw?.region ?? raw?.country ?? "").trim();
  const core     = String(raw?.street ?? raw?.road ?? raw?.pedestrian ?? "").trim();
  const num      = String(raw?.streetNumber ?? "").trim();
  const combined = [num, core].filter(Boolean).join(" ").trim();
  const blocked  = new Set([city, province].map(v => v.toLowerCase()).filter(Boolean));
  const road     = [combined, core, String(raw?.name ?? "").trim()].filter(Boolean).find(v => !blocked.has(v.toLowerCase()));
  return { road: road || undefined, city: city || undefined, province: province || undefined };
}

function computeDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000, r = (v: number) => (v * Math.PI) / 180;
  const a = Math.sin(r(lat2-lat1)/2)**2 + Math.cos(r(lat1))*Math.cos(r(lat2))*Math.sin(r(lng2-lng1)/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

export default function CaptureScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const params  = useLocalSearchParams<{
    label?: string; poleCode?: string; nodeName?: string;
    lat?: string; lng?: string; road?: string; city?: string; province?: string;
    tab?: "before" | "after" | "tag"; ownerType?: string; ownerPoleId?: string;
    returnKey: string;
  }>();

  const [permission, requestPermission] = useCameraPermissions();
  const [deviceCoords, setDeviceCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [address, setAddress] = useState<{ road: string | undefined; city: string | undefined; province: string | undefined }>({
    road: params.road || undefined, city: params.city || undefined, province: params.province || undefined,
  });
  const [now, setNow]           = useState(() => getPHTNow());
  const [capturing, setCapturing] = useState(false);

  // Flash animation on capture
  const flashOpacity  = useRef(new Animated.Value(0)).current;
  const cameraRef     = useRef<CameraView>(null);

  const targetLat = parseFloat(params.lat ?? "0") || null;
  const targetLng = parseFloat(params.lng ?? "0") || null;

  useEffect(() => {
    const id = setInterval(() => setNow(getPHTNow()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let mounted = true;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
      if (last && mounted) setDeviceCoords(last.coords);
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 2, timeInterval: 2000 },
        pos => { if (mounted) setDeviceCoords(pos.coords); },
      );
      const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (mounted) setDeviceCoords(fresh.coords);
      if (address.road || address.city || address.province) return;
      const lookup = targetLat != null && targetLng != null
        ? { latitude: targetLat, longitude: targetLng } : fresh.coords;
      try {
        const geo = await Location.reverseGeocodeAsync(lookup);
        if (geo[0] && mounted) { const r = parseGpsAddress(geo[0]); setAddress({ road: r.road, city: r.city, province: r.province }); }
      } catch {}
    })();
    return () => { mounted = false; sub?.remove(); };
  }, []);

  const cityProvince = useMemo(() => [address.city, address.province].filter(Boolean).join(", "), [address.city, address.province]);

  const rangeMeters = targetLat != null && targetLng != null && deviceCoords
    ? computeDistanceMeters(deviceCoords.latitude, deviceCoords.longitude, targetLat, targetLng) : null;

  const displayTime = useMemo(() => {
    try {
      const [d, t] = now.substring(0, 19).split("T");
      const [yr, mo, dy] = d.split("-").map(Number);
      const [hh, mm, ss] = t.split(":").map(Number);
      const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      // 24-hour time to match the stamped photo metadata
      return `${MON[mo-1]} ${dy}, ${yr}  ${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
    } catch { return now.substring(0, 19).replace("T", "  "); }
  }, [now]);

  async function takePhoto() {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      // Use onPictureSaved so the shutter action is instant; we handle the saved URI in the callback.
      cameraRef.current.takePictureAsync({
        quality: 0.92,
        skipProcessing: true,
        exif: false,
        onPictureSaved: async (picture) => {
          try {
            if (!picture?.uri) throw new Error("No photo");

            const result = {
              uri: picture.uri,
              tab: (params.tab ?? "before") as "before" | "after" | "tag",
              ownerType: params.ownerType ?? "",
              ownerPoleId: params.ownerPoleId ?? "",
            };

            captureEvents.emit(result);
            (global as any)[params.returnKey] = result;
          } catch {
            // If anything fails, allow user to try again
            setCapturing(false);
            return;
          }

          // Brief white flash then navigate back
          Animated.sequence([
            Animated.timing(flashOpacity, { toValue: 1, duration: 60, useNativeDriver: true }),
            Animated.timing(flashOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start(() => router.back());
        },
      });

    } catch {
      setCapturing(false);
    }
  }

  if (!permission) return <View style={s.bg} />;
  if (!permission.granted) {
    return (
      <View style={[s.bg, { justifyContent: "center", alignItems: "center", gap: 16 }]}>
        <Text style={{ color: "#fff", fontSize: 16 }}>Camera permission needed</Text>
        <TouchableOpacity onPress={requestPermission}
          style={{ backgroundColor: "#10b981", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}>
          <Text style={{ color: "#fff", fontWeight: "900" }}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.bg}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar hidden />

      {/* Camera — sized to fill full screen height (no letterbox) */}
      <View style={StyleSheet.absoluteFill} collapsable={false}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFillObject}
          facing="back"
        />
      </View>

      {/* Target coordinates — safe area top */}
      {targetLat != null && targetLng != null && (
        <View style={[s.targetCard, { top: insets.top + 8 }]} pointerEvents="none">
          <View style={s.targetLeft}>
            <Text style={{ fontSize: 14, marginRight: 8 }}>📍</Text>
            <View>
              <Text style={s.targetTitle}>Target Coordinates</Text>
              <Text style={s.targetCoords}>{targetLat.toFixed(6)},  {targetLng.toFixed(6)}</Text>
            </View>
          </View>
          {rangeMeters != null ? (
            <View style={{ alignItems: "flex-end" }}>
              <Text style={s.targetRange}>{rangeMeters}m Range</Text>
              <Text style={s.targetVerified}>Verified</Text>
            </View>
          ) : <Text style={s.targetActive}>Active</Text>}
        </View>
      )}

      {/* Metadata + map — bottom */}
      <View style={s.overlay} pointerEvents="none">
        <View style={s.metaBox}>
          <Text style={s.metaTime}>{displayTime}</Text>
          {address.road    && <Text style={s.metaLine}>{address.road}</Text>}
          {!!cityProvince  && <Text style={s.metaLine}>{cityProvince}</Text>}
          {targetLat != null && targetLng != null && (
            <Text style={s.metaCoords}>
              {Math.abs(targetLat).toFixed(6)}° {targetLat >= 0 ? "N" : "S"}{"  "}
              {Math.abs(targetLng).toFixed(6)}° {targetLng >= 0 ? "E" : "W"}
            </Text>
          )}
          <Text style={s.metaLabel}>{params.poleCode || "Pole"}  ({params.label || "BEFORE"})</Text>
          <Text style={s.metaNode}>Node: {params.nodeName || "-"}</Text>
        </View>
        <View style={s.mapWrap}>
          <LiveMapTile fallbackLat={targetLat} fallbackLng={targetLng} size={96} borderRadius={10} />
        </View>
      </View>

      {/* Shutter row */}
      <View style={s.shutterRow}>
        <TouchableOpacity style={s.sideBtn} onPress={() => router.back()}>
          <Text style={s.sideBtnTxt}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.shutter, capturing && { opacity: 0.5 }]}
          onPress={takePhoto}
          disabled={capturing}
          activeOpacity={0.8}
        >
          <View style={s.shutterInner} />
        </TouchableOpacity>
        <View style={s.sideBtn} />
      </View>

      {/* Capture flash */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: "#fff", opacity: flashOpacity }]}
        pointerEvents="none"
      />
    </View>
  );
}

const s = StyleSheet.create({
  bg:            { flex: 1, backgroundColor: "#000" },
  targetCard:    { position: "absolute", left: 12, right: 12, backgroundColor: "rgba(13,17,23,0.88)", borderRadius: 14, paddingVertical: 11, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  targetLeft:    { flexDirection: "row", alignItems: "center", flex: 1 },
  targetTitle:   { color: "#fff", fontSize: 11, fontWeight: "700" },
  targetCoords:  { color: "#9CA3AF", fontSize: 10, marginTop: 1 },
  targetRange:   { color: "#10b981", fontSize: 13, fontWeight: "800" },
  targetVerified:{ color: "#A7F3D0", fontSize: 9, marginTop: 2 },
  targetActive:  { color: "#10b981", fontSize: 11, fontWeight: "700" },
  overlay:       { position: "absolute", left: 0, right: 0, bottom: 104, flexDirection: "row", alignItems: "stretch", backgroundColor: "rgba(0,0,0,0.78)" },
  metaBox:       { flex: 1, paddingLeft: 14, paddingRight: 6, paddingVertical: 10, justifyContent: "center", gap: 2 },
  metaTime:      { color: "#fff", fontWeight: "800", fontSize: 13 },
  metaLine:      { color: "#fff", fontWeight: "400", fontSize: 12 },
  metaCoords:    { color: "#fff", fontWeight: "400", fontSize: 11 },
  metaLabel:     { color: "#fff", fontWeight: "800", fontSize: 12, marginTop: 2 },
  metaNode:      { color: "#aaa", fontWeight: "400", fontSize: 11 },
  mapWrap:       { justifyContent: "center", paddingRight: 10, paddingVertical: 10 },
  shutterRow:    { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 36, paddingVertical: 16, backgroundColor: "rgba(0,0,0,0.78)" },
  shutter:       { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(255,255,255,0.22)", borderWidth: 4, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  shutterInner:  { width: 54, height: 54, borderRadius: 27, backgroundColor: "#fff" },
  sideBtn:       { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  sideBtnTxt:    { color: "#fff", fontSize: 22 },
});
