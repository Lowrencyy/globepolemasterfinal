import api from "@/lib/api";
import { captureEvents } from "@/lib/capture-events";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getDisplayTime, getPHTNow } from "@/lib/display-time";
import { pingNow } from "@/lib/location-tracker";
import { startPoleTeardown } from "@/services/skycable";
import { useAuth } from "@/context/auth-context";
import { simpleQueuePush } from "@/lib/simple-queue";
import { gpsQueueGet } from "@/lib/gps-queue";
import * as FileSystem from "expo-file-system/legacy";
import { Image as ExpoImage } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import * as MediaLibrary from "expo-media-library";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Play, Timer } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { WebView } from "react-native-webview";
import { buildSpanMapHtml, buildPoleMapHtml, StaticTileMap, STAMP_HTML } from "./components";

const SLOTS = ["DA", "C1", "C2", "C3", "C4", "C5"] as const;
const REQUIRED_GPS_ACCURACY_METERS = 10;
// TEMP: GPS capture + 50m proximity requirements disabled for testing — re-enable before production
const DEV_SKIP_GPS_CHECKS = true;
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

type PhotoField = {
  uri: string;
  name: string;
  type: string;
  fileUri?: string;
  version?: number;
} | null;

type GpsData = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  captured_at: string;
};

function computeDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return Math.round(6371e3 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function sanitize(s?: string) {
  return (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "_");
}

function parseGpsAddress(raw: any): { road: string; city: string; province: string } {
  const city = String(raw?.city ?? raw?.district ?? raw?.subregion ?? raw?.region ?? "").trim();
  const province = String(raw?.region ?? raw?.country ?? "").trim();

  const streetCore = String(raw?.street ?? raw?.road ?? raw?.pedestrian ?? "").trim();
  const streetNumber = String(raw?.streetNumber ?? "").trim();
  const combinedStreet = [streetNumber, streetCore].filter(Boolean).join(" ").trim();

  const blocked = new Set(
    [city, province, `${city}, ${province}`]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  const roadCandidates = [
    combinedStreet,
    streetCore,
    String(raw?.name ?? "").trim(),
    String(raw?.neighborhood ?? "").trim(),
    String(raw?.subLocality ?? "").trim(),
    String(raw?.streetNumber ?? "").trim(),
  ].filter(Boolean);

  const road =
    roadCandidates.find((value) => !blocked.has(value.toLowerCase())) ?? "";

  return { road, city, province };
}

function applyParsedGpsAddress(
  raw: any,
  setters: {
    setGpsStreet: (value: string) => void;
    setGpsCity: (value: string) => void;
    setGpsProvince: (value: string) => void;
  },
) {
  const { road, city, province } = parseGpsAddress(raw);
  if (road) setters.setGpsStreet(road);
  if (city) setters.setGpsCity(city);
  if (province) setters.setGpsProvince(province);
}

function createPhotoField(
  fileUri: string,
  name: string,
): NonNullable<PhotoField> {
  const version = Date.now();
  return {
    uri: `${fileUri}?v=${version}`,
    fileUri,
    name,
    type: "image/jpeg",
    version,
  };
}

function staticMapUrl(lat: number, lng: number) {
  const w = Math.round(SCREEN_W * 0.35 * 2);
  const h = Math.round(SCREEN_H * 0.22 * 2);
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=16&size=${w}x${h}&markers=${lat},${lng},red`;
}

function getCompletionState({
  hasGps,
  photoBefore,
  photoAfter,
  photoTag,
  slot,
}: {
  hasGps: boolean;
  photoBefore: PhotoField;
  photoAfter: PhotoField;
  photoTag: PhotoField;
  slot: string;
}) {
  const completed = [
    hasGps,
    !!photoBefore,
    !!photoAfter,
    !!photoTag,
    !!slot,
  ].filter(Boolean).length;

  return {
    completed,
    total: 5,
    percent: Math.round((completed / 5) * 100),
  };
}

function fmtPHT(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pht = new Date(d.getTime() + 8 * 3600 * 1000);
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][pht.getUTCMonth()];
  const day = pht.getUTCDate();
  const h = pht.getUTCHours();
  const min = String(pht.getUTCMinutes()).padStart(2,"0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${mon} ${day} · ${h12}:${min} ${ampm}`;
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2,"0");
  const ss = String(s).padStart(2,"0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}


function TrackerMini({ done, label }: { done: boolean; label: string }) {
  return (
    <View style={styles.trackerMini}>
      <View style={[styles.trackerMiniDot, done && styles.trackerMiniDotDone]}>
        <Text
          style={[
            styles.trackerMiniDotText,
            done && styles.trackerMiniDotTextDone,
          ]}
        >
          {done ? "✓" : "•"}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={[styles.trackerMiniLabel, done && styles.trackerMiniLabelDone]}
      >
        {label}
      </Text>
    </View>
  );
}

function ProgressWaveBar({
  progress,
  accentColor,
}: {
  progress: number;
  accentColor: string;
}) {
  const waveAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(waveAnim, {
        toValue: 1,
        duration: 2200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [waveAnim]);

  const shimmerTranslate = waveAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-160, 260],
  });

  const bobTranslate = waveAnim.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0, -1.5, 0, 1.5, 0],
  });

  return (
    <View style={styles.progressBarTrack}>
      <View
        style={[
          styles.progressBarFill,
          { width: `${progress}%`, backgroundColor: accentColor },
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.progressWave,
            {
              transform: [
                { translateX: shimmerTranslate },
                { translateY: bobTranslate },
                { rotate: "12deg" },
              ],
            },
          ]}
        />
      </View>
    </View>
  );
}

function SectionHeading({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderTextWrap}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}


const BLUR_DETECT_HTML = `<!DOCTYPE html><html><body style="margin:0;padding:0"><canvas id="c" style="display:none"></canvas><script>
function run(b64){
  var img=new Image();
  img.onload=function(){
    var W=Math.min(img.width,200),H=Math.min(img.height,200);
    var c=document.getElementById('c');c.width=W;c.height=H;
    var ctx=c.getContext('2d');ctx.drawImage(img,0,0,W,H);
    var d=ctx.getImageData(0,0,W,H).data;
    var g=new Float32Array(W*H);
    for(var i=0;i<W*H;i++)g[i]=0.299*d[i*4]+0.587*d[i*4+1]+0.114*d[i*4+2];
    var s=0,n=0;
    for(var y=1;y<H-1;y++){for(var x=1;x<W-1;x++){
      var v=-4*g[y*W+x]+g[(y-1)*W+x]+g[(y+1)*W+x]+g[y*W+x-1]+g[y*W+x+1];
      s+=v*v;n++;
    }}
    window.ReactNativeWebView.postMessage(JSON.stringify({v:n>0?s/n:999}));
  };
  img.onerror=function(){window.ReactNativeWebView.postMessage(JSON.stringify({v:999}));};
  img.src='data:image/jpeg;base64,'+b64;
}
document.addEventListener('message',function(e){run(e.data);});
window.addEventListener('message',function(e){run(e.data);});
window.ReactNativeWebView.postMessage(JSON.stringify({ready:1}));
<\/script></body></html>`;

function PhotoTile({
  label, photo, accentColor, onCapture, onView, disabled,
}: {
  label: string; photo: PhotoField; accentColor: string;
  onCapture: () => void; onView: () => void; disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.photoTileCard, photo ? { borderColor: accentColor } : {}, disabled && { opacity: 0.45 }]}
      onPress={disabled ? undefined : photo ? onView : onCapture}
      disabled={disabled}
    >
      <View style={styles.photoTileImgWrap}>
        {photo ? (
          <>
            <ExpoImage key={photo.version} source={{ uri: photo.uri }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="none" transition={100} />
            <View style={styles.photoViewHint}>
              <Text style={styles.photoViewHintText}>VIEW</Text>
            </View>
          </>
        ) : (
          <View style={styles.photoTilePlaceholder}>
            <Text style={{ fontSize: 28, marginBottom: 4 }}>📷</Text>
            <Text style={{ fontSize: 9, fontWeight: "700", color: "#94A3B8", textAlign: "center" }}>Tap to capture</Text>
          </View>
        )}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 4 }}>
        <Text style={[styles.photoTileLabel, photo ? { color: accentColor } : {}]}>
          {label.toUpperCase()}
        </Text>
        {photo && (
          <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: accentColor, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#FFF", fontSize: 9, fontWeight: "900" }}>✓</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

type StreetTileInfo = {
  url: string;
  tileX: number;
  tileY: number;
  zoom: number;
  dotX: number;
  dotY: number;
};

type StampMapTile = { b64: string; dx: number; dy: number };
type StampMapResult = { b64: string; tiles: StampMapTile[]; dotX: number; dotY: number };

const STREET_TILE_OFFSETS = [-1, 0, 1] as const;
const CARTO_SUBDOMAINS = ["a", "b", "c", "d"] as const;

function streetTileUrlFor(tileX: number, tileY: number, zoom: number): string {
  // Spread requests across CARTO subdomains to reduce missing tiles under load.
  const idx = Math.abs(tileX + tileY) % CARTO_SUBDOMAINS.length;
  const sub = CARTO_SUBDOMAINS[idx];
  return `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${tileX}/${tileY}.png`;
}

function MapThumbnail({ info }: { info: StreetTileInfo }) {
  const [sz, setSz] = React.useState(0);
  return (
    <View
      style={{ aspectRatio: 1, alignSelf: "stretch", borderRadius: 10, overflow: "hidden", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.35)" }}
      onLayout={e => setSz(e.nativeEvent.layout.width)}
    >
      {sz > 0 && STREET_TILE_OFFSETS.map(dy =>
        STREET_TILE_OFFSETS.map(dx => (
          <Image
            key={`${dx}:${dy}`}
            source={{ uri: streetTileUrlFor(info.tileX + dx, info.tileY + dy, info.zoom) }}
            style={{
              position: "absolute",
              width: sz,
              height: sz,
              left: (dx + 0.5 - info.dotX) * sz,
              top: (dy + 0.5 - info.dotY) * sz,
            }}
            resizeMode="cover"
          />
        )),
      )}
      <View style={{ position: "absolute", top: "50%", left: "50%", width: 12, height: 12, borderRadius: 6, backgroundColor: "#EF4444", borderWidth: 2, borderColor: "#FFF", marginLeft: -6, marginTop: -6 }} />
      <View style={{ position: "absolute", bottom: 4, left: 0, right: 0, alignItems: "center" }}>
        <View style={{ backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
          <Text style={{ color: "#FFF", fontSize: 8, fontWeight: "900", letterSpacing: 0.7 }}>STREET</Text>
        </View>
      </View>
    </View>
  );
}

export default function DestinationPoleScreen() {
  const params = useLocalSearchParams<{
    pole_code: string;
    pole_name: string;
    node_id: string;
    project_id: string;
    project_name: string;
    accent: string;
    span_id: string;
    span_code: string;
    to_pole_id: string;
    to_pole_code: string;
    to_pole_name: string;
    expected_cable: string;
    length_meters: string;
    declared_runs: string;
    expected_node: string;
    expected_amplifier: string;
    expected_extender: string;
    expected_tsc: string;
    expected_powersupply: string;
    expected_powersupply_housing: string;
    from_pole_latitude: string;
    from_pole_longitude: string;
    from_pole_gps_captured_at: string;
    from_pole_id: string;
    node_name?: string;
    to_pole_sitemap_lat?: string;
    to_pole_sitemap_lng?: string;
  }>();

  const accentColor = params.accent || "#0B7A5A";
  const projFolder = sanitize(params.project_name);
  const toPoleCode = sanitize(params.to_pole_code);
  const fromCode = sanitize(params.pole_code);

  const draftDir = `${FileSystem.documentDirectory}teardown_drafts/${projFolder}/${params.node_id}/${params.from_pole_id}/`;

  const F = {
    before: `${toPoleCode}_before.jpg`,
    after: `${toPoleCode}_after.jpg`,
    tag: `${toPoleCode}_poletag.jpg`,
  };

  const [editedToPoleName, setEditedToPoleName] = useState(params.to_pole_name ?? "");
  const [editToNameModalOpen, setEditToNameModalOpen] = useState(false);
  const [editToNameDraft, setEditToNameDraft] = useState("");
  const [savingToName, setSavingToName] = useState(false);

  const [photoBefore, setPhotoBefore] = useState<PhotoField>(null);
  const [photoAfter, setPhotoAfter] = useState<PhotoField>(null);
  const [photoTag, setPhotoTag] = useState<PhotoField>(null);
  const [qualityBefore, setQualityBefore] = useState<number | null>(null);
  const [qualityAfter, setQualityAfter] = useState<number | null>(null);
  const [qualityTag, setQualityTag] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerLabel, setViewerLabel] = useState("");
  const [viewerTab, setViewerTab] = useState<"before" | "after" | "tag" | null>(null);
  const [viewerRetake, setViewerRetake] = useState<(() => void) | null>(null);
  const viewerPhoto =
    viewerTab === "before" ? photoBefore :
    viewerTab === "after"  ? photoAfter  :
    viewerTab === "tag"    ? photoTag    :
    null;
  const [slot, setSlot] = useState("");
  const [landmark, setLandmark] = useState("");

  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsCapturing, setGpsCapturing] = useState(false);
  const [capturedGps, setCapturedGps] = useState<GpsData | null>(null);
  const [gpsStreet,   setGpsStreet]   = useState("");
  const [gpsCity,     setGpsCity]     = useState("");
  const [gpsProvince, setGpsProvince] = useState("");
  const [gpsSuccessModal, setGpsSuccessModal] = useState(false);
  // true = GPS came from sitemap APK (pre-placed, no re-capture needed)
  // false = GPS was captured on this device (or absent)
  const [gpsFromSitemap, setGpsFromSitemap] = useState(false);
  const [mapSatellite, setMapSatellite] = useState(false);
  const [mapFullscreen, setMapFullscreen] = useState(false);

  const [showCameraModal, setShowCameraModal] = useState(false);
  const [activeCameraTab, setActiveCameraTab] = useState<"before" | "after" | "tag">("before");

  // Preload map tile whenever camera modal opens (backup if GPS preload hadn't finished)
  useEffect(() => {
    if (!showCameraModal || mapTileCache.current) return;
    const gps = capturedGps;
    if (!gps) return;
    fetchMapTileB64(gps.latitude, gps.longitude)
      .then(r => { if (r) mapTileCache.current = r; })
      .catch(() => {});
  }, [showCameraModal]);
  const cameraRef = useRef<React.ComponentRef<typeof CameraView>>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [photoCapturing, setPhotoCapturing] = useState(false);
  const [outOfAreaAlert, setOutOfAreaAlert] = useState<{ visible: boolean; distance: number } | null>(null);
  const [cameraZoom, setCameraZoom] = useState(0);
  const pinchBaseZoom = useRef(0);
  const pinchGesture = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => { pinchBaseZoom.current = cameraZoom; })
    .onUpdate((e) => {
      setCameraZoom(Math.min(1, Math.max(0, pinchBaseZoom.current + (e.scale - 1) * 0.5)));
    });
  const [blurWarning, setBlurWarning] = useState(false);
  const captureGenRef = useRef(0);


  const [elapsedSecs, setElapsedSecs] = useState(0);
  const captureReturnKey = `__dest_capture_${params.to_pole_id}`;
  const lastFreshCaptureRef = useRef(0);

  // Instant card update via event emitter
  useEffect(() => {
    return captureEvents.on((result) => {
      if (result.ownerType !== "destination" || String(result.ownerPoleId) !== String(params.to_pole_id ?? "")) return;
      const tab = result.tab;
      const setter = tab === "before" ? setPhotoBefore : tab === "after" ? setPhotoAfter : setPhotoTag;
      const file   = tab === "before" ? F.before       : tab === "after" ? F.after       : F.tag;
      lastFreshCaptureRef.current = Date.now();
      setter(createPhotoField(result.uri, file));
    });
  }, [params.to_pole_id, F.before, F.after, F.tag]);

  // ── Pole teardown session (date_start persisted to backend) ──────────────
  const { token } = useAuth();
  const [poleStartedAt, setPoleStartedAt] = useState<string | null>(null);
  const [poleStarting, setPoleStarting] = useState(false);
  const [poleDuration, setPoleDuration] = useState(0);
  const poleDurationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load date_start from the cached poles list for this node
  useEffect(() => {
    cacheGet<any[]>(`sitemap_poles_${params.node_id}`).then(cached => {
      if (!cached?.length) return;
      const entry = cached.find(p => String(p.pole_id) === String(params.to_pole_id));
      if (entry?.date_start) setPoleStartedAt(entry.date_start);
    }).catch(() => {});
  }, [params.node_id, params.to_pole_id]);

  // Run duration counter once poleStartedAt is known
  useEffect(() => {
    if (!poleStartedAt) return;
    const startMs = new Date(poleStartedAt).getTime();
    const tick = () => setPoleDuration(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    poleDurationRef.current = setInterval(tick, 1000);
    return () => { if (poleDurationRef.current) clearInterval(poleDurationRef.current); };
  }, [poleStartedAt]);

  async function handleStartPoleTeardown() {
    if (!token || poleStarting) return;
    setPoleStarting(true);
    const now = getPHTNow();

    // 1. Immediately update local state & cached list to unblock offline progression instantly
    setPoleStartedAt(now);
    const cached = await cacheGet<any[]>(`sitemap_poles_${params.node_id}`).catch(() => null);

    // Assign sequence based on start order: max existing sequence + 1
    const nextSequence = cached
      ? cached.reduce((max, p) => Math.max(max, Number(p.sequence) || 0), 0) + 1
      : 1;

    if (cached?.length) {
      const updated = cached.map(p =>
        String(p.pole_id) === String(params.to_pole_id)
          ? { ...p, sequence: nextSequence, date_start: now }
          : p
      );
      await cacheSet(`sitemap_poles_${params.node_id}`, updated).catch(() => {});
    }

    // 2. Start teardown on backend — resolve skycable_poles.id (pivot PK) from cache
    //    The route uses the pivot row ID, not poles.id (FK).
    const sitemapPoles = await cacheGet<any[]>(`sitemap_poles_${params.node_id}`).catch(() => null);
    const pivotEntry = sitemapPoles?.find(p => String(p.pole_id) === String(params.to_pole_id));
    const rowId = pivotEntry?.id ? String(pivotEntry.id) : params.to_pole_id;

    try {
      await api.put(`/skycable/nodes/${params.node_id}/poles/${rowId}`, { date_start: now });
    } catch (err: any) {
      if (!err?.response?.status) {
        await simpleQueuePush({
          method: "put",
          url: `/skycable/nodes/${params.node_id}/poles/${rowId}`,
          body: { date_start: now },
        }).catch(() => {});
      }
    }

    // Update poles.skycable_status directly (this is what the web admin + Navicat shows)
    api.put(`/skycable/poles/${params.to_pole_id}`, { skycable_status: "in_progress" }).catch(async (err: any) => {
      if (!err?.response?.status) {
        await simpleQueuePush({
          method: "put",
          url: `/skycable/poles/${params.to_pole_id}`,
          body: { skycable_status: "in_progress" },
        }).catch(() => {});
      } else {
        Alert.alert("Start Failed", err?.message ?? "Unable to start pole teardown.");
      }
    });

    // Sync skycable_poles.status via patch endpoint (fire-and-forget backup)
    api.patch(`/skycable/nodes/${params.node_id}/poles/sync`, {
      pole_id: Number(params.to_pole_id),
      date_start: now,
      status: "in_progress",
    }).catch(() => {});

    // Directly update this pole's status on the backend (fire-and-forget)
    api.put(`/skycable/nodes/${params.node_id}/poles/${params.to_pole_id}`, {
      status: "in_progress",
      date_start: now,
    }).catch(() => {});

    // Ping lineman location — records that the lineman is physically at this destination pole
    pingNow();

    setPoleStarting(false);
  }

  const timerStartRef = useRef(Date.now());
  // Record ISO start time when lineman enters this screen — sent to backend as started_at
  const startedAtRef    = useRef(new Date().toISOString());
  const toPoleGpsRef    = useRef<GpsData | null>(null);
  const isCapturingRef  = useRef(false);
  const prewarmedGps    = useRef<{ latitude: number; longitude: number } | null>(null);
  const locationWatcher = useRef<Location.LocationSubscription | null>(null);
  const blurCheckRef = useRef<WebView>(null);
  const blurResolverRef = useRef<((variance: number) => void) | null>(null);
  const stampRef = useRef<WebView>(null);
  const stampResolverRef = useRef<((b64: string | null) => void) | null>(null);
  const mapTileCache = useRef<StampMapResult | null>(null);
  const gpsWarmKeyRef = useRef<string>("");
  const gpsWarmPromiseRef = useRef<Promise<void> | null>(null);
  const captureMapPrefetchedRef = useRef(false);

  const hasGps = DEV_SKIP_GPS_CHECKS ? !!capturedGps : !!capturedGps && !gpsFromSitemap;
  const infoComplete = !!poleStartedAt && (DEV_SKIP_GPS_CHECKS || hasGps) && !!slot;

  // Always allow starting — don't block the user with "complete required fields first"

  const progress = useMemo(
    () =>
      getCompletionState({
        hasGps,
        photoBefore,
        photoAfter,
        photoTag,
        slot,
      }),
    [hasGps, photoBefore, photoAfter, photoTag, slot],
  );

  useEffect(() => {
    const id = setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - timerStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (slot) cacheSet(`draft_slot_${params.to_pole_id}`, slot).catch(() => {});
  }, [slot, params.to_pole_id]);

  useEffect(() => {
    cacheSet(`draft_landmark_${params.to_pole_id}`, landmark).catch(() => {});
  }, [landmark, params.to_pole_id]);

  useEffect(() => {
    cacheGet<{ lat: number; lng: number }>(`pole_gps_${params.to_pole_id}`)
      .then(async (g) => {
        if (g?.lat && g?.lng) {
          // Previously captured on this device
          setCapturedGps({
            latitude: g.lat,
            longitude: g.lng,
            accuracy: null,
            captured_at: new Date().toISOString(),
          });
          setGpsFromSitemap(false);
        } else {
          const q = await gpsQueueGet(params.to_pole_id);
          if (q?.lat && q?.lng) {
            // Queued GPS (captured offline on this device)
            setCapturedGps({
              latitude: q.lat,
              longitude: q.lng,
              accuracy: null,
              captured_at: await getDisplayTime(),
            });
            setGpsFromSitemap(false);
          } else {
            // Fall back to sitemap cache — coordinates pre-placed by the sitemap APK
            // These are the actual pole locations; no re-capture needed
            const sitemapPoles = await cacheGet<any[]>(`sitemap_poles_${params.node_id}`).catch(() => null);
            const sitemapMatch = sitemapPoles?.find(p => String(p.pole_id) === String(params.to_pole_id));
            if (sitemapMatch?.pole?.lat && sitemapMatch?.pole?.lng) {
              const lat = parseFloat(sitemapMatch.pole.lat);
              const lng = parseFloat(sitemapMatch.pole.lng);
              if (Number.isFinite(lat) && Number.isFinite(lng)) {
                setCapturedGps({ latitude: lat, longitude: lng, accuracy: null, captured_at: "" });
                setGpsFromSitemap(true);
                // Pre-load map tile immediately
                fetchMapTileB64(lat, lng)
                  .then(r => { if (r) mapTileCache.current = r; })
                  .catch(() => {});
                // Reverse geocode sitemap GPS silently
                Location.reverseGeocodeAsync({ latitude: lat, longitude: lng })
                  .then(res => {
                    const a = res[0];
                    if (!a) return;
                    applyParsedGpsAddress(a, { setGpsStreet, setGpsCity, setGpsProvince });
                  })
                  .catch(() => {});
              }
            }
          }
        }
      })
      .catch(() => {});

    api
      .get(`/poles/${params.to_pole_id}`)
      .then(({ data }) => {
        const d = data?.data ?? data;
        if (d?.map_latitude && d?.map_longitude) {
          const lat = Number(d.map_latitude);
          const lng = Number(d.map_longitude);
          if (lat && lng) {
            fetchMapTileB64(lat, lng)
              .then(r => { if (r) mapTileCache.current = r; })
              .catch(() => {});

            Location.reverseGeocodeAsync({ latitude: lat, longitude: lng })
              .then(res => {
                const a = res[0];
                if (!a) return;
                applyParsedGpsAddress(a, { setGpsStreet, setGpsCity, setGpsProvince });
              })
              .catch(() => {});

            setCapturedGps(prev => {
              if (prev) return prev; // keep existing (device capture or sitemap)
              setGpsFromSitemap(true); // came from backend sitemap data
              return { latitude: lat, longitude: lng, accuracy: null, captured_at: getPHTNow() };
            });
          }
        }
      })
      .catch(() => {});

    cacheGet<string>(`draft_slot_${params.to_pole_id}`)
      .then((v) => {
        if (v) setSlot(v);
      })
      .catch(() => {});

    cacheGet<string>(`draft_landmark_${params.to_pole_id}`)
      .then((v) => {
        if (v) setLandmark(v);
      })
      .catch(() => {});

    const srcDir = `${FileSystem.documentDirectory}pole_drafts/${projFolder}/${params.node_id}/${params.from_pole_id}/`;
    const copyDir = `${FileSystem.documentDirectory}teardown_drafts/${projFolder}/${params.node_id}/${params.from_pole_id}/`;

    FileSystem.makeDirectoryAsync(copyDir, { intermediates: true })
      .then(async () => {
        const files = [
          {
            src: `pole_${params.from_pole_id}_before.jpg`,
            dest: `${fromCode}_before.jpg`,
          },
          {
            src: `pole_${params.from_pole_id}_after.jpg`,
            dest: `${fromCode}_after.jpg`,
          },
          {
            src: `pole_${params.from_pole_id}_poletag.jpg`,
            dest: `${fromCode}_poletag.jpg`,
          },
        ];

        for (const f of files) {
          const srcPath = srcDir + f.src;
          const destPath = copyDir + f.dest;
          const [srcInfo, destInfo] = await Promise.all([
            FileSystem.getInfoAsync(srcPath),
            FileSystem.getInfoAsync(destPath),
          ]);
          if (srcInfo.exists && !destInfo.exists) {
            FileSystem.copyAsync({ from: srcPath, to: destPath }).catch(
              () => {},
            );
          }
        }
      })
      .catch(() => {});

    if (!poleStartedAt) {
      setPhotoBefore(null);
      setPhotoAfter(null);
      setPhotoTag(null);
      setQualityBefore(null);
      setQualityAfter(null);
      setQualityTag(null);
      return;
    }

    (async () => {
      await FileSystem.makeDirectoryAsync(draftDir, { intermediates: true });

      const poleDraftDir = `${FileSystem.documentDirectory}pole_drafts/${projFolder}/${params.node_id}/${params.to_pole_id}/`;

      // Load a photo for this teardown session.
      // Priority 1: teardown_drafts (captured on this screen — always fresh).
      // Priority 2: pole_drafts from a previous pole-detail visit for this same pole.
      //   → If Pole 1 was already a FROM pole (captured before/after/tag in pole-detail),
      //     all 3 are reused here when Pole 1 becomes a destination on a different span.
      //   → Copied into teardown_drafts so submission reads from one consistent place.
      const load = async (
        tdFile: string,
        pdFile: string | null, // null = never fall back to pole_drafts
      ): Promise<PhotoField | null> => {
        const tdPath = draftDir + tdFile;
        const tdInfo = await FileSystem.getInfoAsync(tdPath).catch(() => ({ exists: false }));
        if ((tdInfo as any).exists) {
          const viewPath = tdPath.replace(/\.jpg$/i, "_view.jpg");
          const viewInfo = await FileSystem.getInfoAsync(viewPath).catch(() => ({ exists: false }));
          const chosenPath = (viewInfo as any).exists ? viewPath : tdPath;
          const version = Date.now();
          return {
            uri: `${chosenPath}?v=${version}`,
            fileUri: chosenPath,
            name: tdFile,
            type: "image/jpeg",
            version,
          };
        }

        if (pdFile) {
          const pdPath = poleDraftDir + pdFile;
          const pdInfo = await FileSystem.getInfoAsync(pdPath).catch(() => ({ exists: false }));
          if ((pdInfo as any).exists) {
            await FileSystem.copyAsync({ from: (pdInfo as any).uri, to: tdPath }).catch(() => {});
            // Also copy _view.jpg from pole_drafts if available
            const pdViewPath = pdPath.replace(/\.jpg$/i, "_view.jpg");
            const tdViewPath = tdPath.replace(/\.jpg$/i, "_view.jpg");
            const pdViewInfo = await FileSystem.getInfoAsync(pdViewPath).catch(() => ({ exists: false }));
            if ((pdViewInfo as any).exists) {
              await FileSystem.copyAsync({ from: pdViewPath, to: tdViewPath }).catch(() => {});
            }
            const viewInfo = await FileSystem.getInfoAsync(tdViewPath).catch(() => ({ exists: false }));
            const chosenPath = (viewInfo as any).exists ? tdViewPath : tdPath;
            const version = Date.now();
            return {
              uri: `${chosenPath}?v=${version}`,
              fileUri: chosenPath,
              name: tdFile,
              type: "image/jpeg",
              version,
            };
          }
        }

        return null;
      };

      // Skip overwrite if a fresh capture just happened (race guard)
      if (Date.now() - lastFreshCaptureRef.current < 3000) return;

      const [b, a, t] = await Promise.all([
        load(F.before, `pole_${params.to_pole_id}_before.jpg`),
        load(F.after,  `pole_${params.to_pole_id}_after.jpg`),
        load(F.tag,    `pole_${params.to_pole_id}_poletag.jpg`),
      ]);

      if (b) setPhotoBefore(b);
      if (a) setPhotoAfter(a);
      if (t) setPhotoTag(t);

      const [qb, qa, qt] = await Promise.all([
        cacheGet<number>(`td_quality_before_${params.to_pole_id}`),
        cacheGet<number>(`td_quality_after_${params.to_pole_id}`),
        cacheGet<number>(`td_quality_tag_${params.to_pole_id}`),
      ]);
      if (b && qb != null) setQualityBefore(qb);
      if (a && qa != null) setQualityAfter(qa);
      if (t && qt != null) setQualityTag(qt);
    })();

    cacheGet<string>(`draft_to_pole_name_${params.to_pole_id}`)
      .then((v) => { if (v) setEditedToPoleName(v); })
      .catch(() => {});
  }, [
    draftDir,
    fromCode,
    projFolder,
    F.before,
    F.after,
    F.tag,
    params.node_id,
    params.from_pole_id,
    params.pole_code,
    params.to_pole_code,
    params.to_pole_id,
    poleStartedAt,
  ]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Highest,
          distanceInterval: 1,
          timeInterval: 2000,
        },
        (loc) => {
          if (!mounted) return;
          toPoleGpsRef.current = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: loc.coords.accuracy,
            captured_at: new Date(loc.timestamp).toISOString(),
          };
          prewarmedGps.current = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setGpsAccuracy(Math.round(loc.coords.accuracy ?? 999));
        },
      );

      if (mounted) locationWatcher.current = sub;
      else sub.remove();
    })();

    return () => {
      mounted = false;
      locationWatcher.current?.remove();
      locationWatcher.current = null;
    };
  }, []);

  function handleBlurMessage(event: { nativeEvent: { data: string } }) {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.ready || !blurResolverRef.current) return;
      const variance = typeof data.v === "number" ? data.v : 0;
      blurResolverRef.current(variance);
      blurResolverRef.current = null;
    } catch {}
  }

  function handleStampMessage(event: { nativeEvent: { data: string } }) {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.ready || !stampResolverRef.current) return;
      stampResolverRef.current(data.stamped ?? null);
      stampResolverRef.current = null;
    } catch {}
  }

  function streetTileInfo(lat: number, lng: number, zoom = 18): StreetTileInfo {
    const n = Math.pow(2, zoom);
    const xFrac = ((lng + 180) / 360) * n;
    const latRad = (lat * Math.PI) / 180;
    const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    const tileX = Math.floor(xFrac);
    const tileY = Math.floor(yFrac);
    return {
      url: streetTileUrlFor(tileX, tileY, zoom),
      tileX,
      tileY,
      zoom,
      dotX: xFrac - tileX,
      dotY: yFrac - tileY,
    };
  }

  async function fetchMapTileB64(lat: number, lng: number): Promise<StampMapResult | null> {
    try {
      const { tileX, tileY, zoom, dotX, dotY } = streetTileInfo(lat, lng, 18);
      const requests: { dx: number; dy: number }[] = [];

      STREET_TILE_OFFSETS.forEach(dy => {
        STREET_TILE_OFFSETS.forEach(dx => {
          requests.push({
            dx,
            dy,
          });
        });
      });

      const results = await Promise.all(
        requests.map(async ({ dx, dy }) => {
          const fullTileX = tileX + dx;
          const fullTileY = tileY + dy;

          const startIdx = Math.abs(fullTileX + fullTileY) % CARTO_SUBDOMAINS.length;
          const cartoCandidates = [
            ...CARTO_SUBDOMAINS.slice(startIdx),
            ...CARTO_SUBDOMAINS.slice(0, startIdx),
          ].map(sub => `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${fullTileX}/${fullTileY}.png`);

          const candidates = [
            ...cartoCandidates,
            `https://tile.openstreetmap.org/${zoom}/${fullTileX}/${fullTileY}.png`,
          ];

          for (let attempt = 0; attempt < candidates.length; attempt++) {
            const url = candidates[attempt];
            const tmp = `${FileSystem.cacheDirectory}maptile_dest_${Date.now()}_${dx}_${dy}_${attempt}.png`;
            try {
              const dl = await FileSystem.downloadAsync(url, tmp);
              const b64 = await FileSystem.readAsStringAsync(dl.uri, { encoding: "base64" as any });
              return { b64, dx, dy };
            } catch {
              // try next candidate
            } finally {
              FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
            }
          }

          return null;
        }),
      );
      const tiles = results.filter((tile): tile is StampMapTile => !!tile);
      const centerTile = tiles.find(tile => tile.dx === 0 && tile.dy === 0);
      if (!centerTile) return null;
      return { b64: centerTile.b64, tiles, dotX, dotY };
    } catch {
      return null;
    }
  }

  function buildStampLines(tab: "before" | "after" | "tag"): string[] {
    const name = editedToPoleName || params.to_pole_name || params.to_pole_code || "";
    const tabLabel = tab === "before" ? "BEFORE" : tab === "after" ? "AFTER" : "POLE TAG";
    const gps = capturedGps;
    // Use server-synced PHT time — cannot be spoofed by changing device clock
    const phtIso = getPHTNow(); // "2026-05-19T23:34:50+08:00"
    const [datePart, timeRaw] = phtIso.substring(0, 19).split("T");
    const [yr, mo, dy] = datePart.split("-").map(Number);
    const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const lines: string[] = [`${MON[mo - 1]} ${dy}, ${yr}  ${timeRaw}`];

    // Street + city/province from reverse geocoding (populated on GPS capture)
    if (gpsStreet) lines.push(gpsStreet);
    const cityProv = [gpsCity, gpsProvince].filter(Boolean).join(", ");
    if (cityProv) lines.push(cityProv);

    if (gps) {
      const latStr = `${Math.abs(gps.latitude).toFixed(6)}\u00b0 ${gps.latitude >= 0 ? "N" : "S"}`;
      const lngStr = `${Math.abs(gps.longitude).toFixed(6)}\u00b0 ${gps.longitude >= 0 ? "E" : "W"}`;
      lines.push(`${latStr}  ${lngStr}`);
    }
    lines.push(`${name}  (${tabLabel})`);
    const nodeLabel = params.node_name || params.node_id || "";
    if (nodeLabel) lines.push(`Node: ${nodeLabel}`);
    return lines;
  }

  async function stampPhoto(uri: string, lines: string[], lat?: number | null, lng?: number | null): Promise<string> {
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" as any });
      // Use pre-loaded tile cache — no network wait during photo stamping
      const mapResult = mapTileCache.current
        ?? (lat != null && lng != null ? await fetchMapTileB64(lat, lng).catch(() => null) : null);
      const payload = JSON.stringify({
        b64, lines,
        mapB64:  mapResult?.b64  ?? null,
        mapTiles: mapResult?.tiles ?? null,
        mapDotX: mapResult?.dotX ?? 0.5,
        mapDotY: mapResult?.dotY ?? 0.5,
      });
      return new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
          stampResolverRef.current = null;
          resolve(uri);
        }, 15000);
        stampResolverRef.current = (result: string | null) => {
          clearTimeout(timer);
          if (!result) { resolve(uri); return; }
          const tmp = `${FileSystem.cacheDirectory}stamp_${Date.now()}.jpg`;
          FileSystem.writeAsStringAsync(tmp, result, { encoding: "base64" as any })
            .then(() => resolve(tmp))
            .catch(() => resolve(uri));
        };
        stampRef.current?.injectJavaScript(
          `(function(){document.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(payload)}}));})();true;`
        );
      });
    } catch {
      return uri;
    }
  }

  function varianceToPercent(v: number): number {
    // Log scale: v=80 (blur threshold) ≈ 40%, v=500 ≈ 75%, v=2000 = 100%
    return Math.min(100, Math.max(0, Math.round(Math.log(v + 1) / Math.log(2001) * 100)));
  }

  async function checkPhotoQuality(fileUri: string): Promise<number> {
    try {
      const b64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: "base64" as any,
      });
      return new Promise<number>((resolve) => {
        blurResolverRef.current = resolve;
        blurCheckRef.current?.injectJavaScript(
          `(function(){document.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(b64)}}));})();true;`
        );
        setTimeout(() => {
          if (blurResolverRef.current) {
            blurResolverRef.current(400); // assume max on timeout
            blurResolverRef.current = null;
          }
        }, 8000);
      });
    } catch {
      return 0;
    }
  }

  async function captureGps() {
    const coords = toPoleGpsRef.current;
    if (!coords) {
      Alert.alert("GPS not ready", "Still acquiring signal. Please wait.");
      return;
    }

    // No distance check on GPS capture — the purpose of recapturing is to
    // replace the sitemap coordinates with the actual field coordinates.

    setGpsCapturing(true);
    try {
      setCapturedGps({ ...coords });
      setGpsFromSitemap(false);
      cacheSet(`pole_gps_${params.to_pole_id}`, {
        lat: coords.latitude,
        lng: coords.longitude,
      }).catch(() => {});

      // Pre-load street map tile now so stamp is instant when photo is taken
      fetchMapTileB64(coords.latitude, coords.longitude)
        .then(r => { if (r) mapTileCache.current = r; })
        .catch(() => {});

      // Reverse geocode in background — fills stamp lines with street/city/province
      Location.reverseGeocodeAsync({ latitude: coords.latitude, longitude: coords.longitude })
        .then(res => {
          const a = res[0];
          if (!a) return;
          applyParsedGpsAddress(a, { setGpsStreet, setGpsCity, setGpsProvince });
        })
        .catch(() => {});

      setGpsSuccessModal(true);
    } finally {
      setGpsCapturing(false);
    }
  }

  async function compressPhoto(uri: string): Promise<string> {
    try {
      const ctx = ImageManipulator.manipulate(uri);
      ctx.resize({ width: 1080 });
      const img = await ctx.renderAsync();
      const result = await img.saveAsync({
        compress: 0.88,
        format: SaveFormat.JPEG,
      });
      return result.uri;
    } catch {
      return uri;
    }
  }

  async function savePhotoDraft(
    fileName: string,
    uri: string,
    stampLines?: string[],
    gpsLat?: number | null,
    gpsLng?: number | null,
  ): Promise<NonNullable<PhotoField>> {
    await FileSystem.makeDirectoryAsync(draftDir, { intermediates: true });

    const compressed = await compressPhoto(uri);

    // ── Clean version → disk (uploaded to backend) ──
    const dest = draftDir + fileName;
    const existing = await FileSystem.getInfoAsync(dest);
    if (existing.exists) await FileSystem.deleteAsync(dest, { idempotent: true });
    await FileSystem.copyAsync({ from: compressed, to: dest });

    // ── Stamped version → _view file on disk + gallery (display + lineman backup) ──
    let displayUri = dest; // UI display (may be temp file to avoid Android stale file:// cache)
    let uploadUri = dest;  // stable on-disk URI for backend + draft restore
    if (stampLines?.length) {
      const stamped = await stampPhoto(compressed, stampLines, gpsLat, gpsLng);
      const viewDest = dest.replace(/\.jpg$/i, "_view.jpg");
      const viewExisting = await FileSystem.getInfoAsync(viewDest);
      if ((viewExisting as any).exists) await FileSystem.deleteAsync(viewDest, { idempotent: true });
      await FileSystem.copyAsync({ from: stamped, to: viewDest });
      uploadUri = viewDest;
      // See pole-detail.tsx: overwriting the same *_view.jpg can show stale bytes on Android.
      // Use the freshly generated stamped temp file for immediate UI display.
      displayUri = stamped;
      MediaLibrary.requestPermissionsAsync(true)
        .then(({ status }) => {
          if (status === "granted") MediaLibrary.saveToLibraryAsync(stamped).catch(() => {});
        })
        .catch(() => {});
    }

    // Cross-copy clean + stamped view to pole_drafts for before/after/tag so
    // components.tsx can always recover the destination set even if the pole
    // code/name changed mid-flow and the teardown_drafts filename no longer matches.
    if (fileName === F.before || fileName === F.after || fileName === F.tag) {
      const suffix =
        fileName === F.before
          ? "_before"
          : fileName === F.after
          ? "_after"
          : "_poletag";
      const poleDir = `${FileSystem.documentDirectory}pole_drafts/${projFolder}/${params.node_id}/${params.to_pole_id}/`;
      const poleCleanDest = `${poleDir}pole_${params.to_pole_id}${suffix}.jpg`;
      const poleViewDest = `${poleDir}pole_${params.to_pole_id}${suffix}_view.jpg`;

      FileSystem.makeDirectoryAsync(poleDir, { intermediates: true })
        .then(async () => {
          const existingClean = await FileSystem.getInfoAsync(poleCleanDest);
          if ((existingClean as any).exists) await FileSystem.deleteAsync(poleCleanDest, { idempotent: true });
          await FileSystem.copyAsync({ from: compressed, to: poleCleanDest });
          if (uploadUri !== dest) {
            const existingView = await FileSystem.getInfoAsync(poleViewDest);
            if ((existingView as any).exists) await FileSystem.deleteAsync(poleViewDest, { idempotent: true });
            return FileSystem.copyAsync({ from: uploadUri, to: poleViewDest });
          }
        })
        .catch(() => {});
    }

    const version = Date.now();
    return {
      uri: `${displayUri}?v=${version}`,
      fileUri: uploadUri,
      name: fileName,
      type: "image/jpeg",
      version,
    };
  }

  function openViewer(tab: "before" | "after" | "tag", retakeFn: () => void) {
    const photo = tab === "before" ? photoBefore : tab === "after" ? photoAfter : photoTag;
    if (!photo) return;
    setViewerLabel(tab === "before" ? "Before" : tab === "after" ? "After" : "Tag");
    setViewerTab(tab);
    setViewerRetake(() => retakeFn);
    setViewerOpen(true);
  }

  function computeDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371e3;
    const p1 = (lat1 * Math.PI) / 180;
    const p2 = (lat2 * Math.PI) / 180;
    const dp = ((lat2 - lat1) * Math.PI) / 180;
    const dl = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  }

  const warmDestinationGpsBundle = useCallback(async (
    lat: number,
    lng: number,
    opts?: { force?: boolean },
  ) => {
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (!opts?.force && gpsWarmKeyRef.current === key && gpsWarmPromiseRef.current) {
      return gpsWarmPromiseRef.current;
    }

    gpsWarmKeyRef.current = key;
    captureMapPrefetchedRef.current = false;

    const warmPromise = (async () => {
      await Promise.allSettled([
        fetchMapTileB64(lat, lng).then((r) => {
          if (r) mapTileCache.current = r;
        }),
        Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }).then((res) => {
          const a = res[0];
          if (!a) return;
          applyParsedGpsAddress(a, { setGpsStreet, setGpsCity, setGpsProvince });
        }),
        Image.prefetch(staticMapUrl(lat, lng)).then((ok) => {
          captureMapPrefetchedRef.current = !!ok;
        }),
      ]);
    })();

    gpsWarmPromiseRef.current = warmPromise;
    await warmPromise;
  }, []);

  useEffect(() => {
    if (!capturedGps?.latitude || !capturedGps?.longitude) return;
    warmDestinationGpsBundle(capturedGps.latitude, capturedGps.longitude).catch(() => {});
  }, [capturedGps?.latitude, capturedGps?.longitude, warmDestinationGpsBundle]);

  const openSharedCapture = useCallback((tab: "before" | "after" | "tag") => {
    const gps = capturedGps ?? toPoleGpsRef.current;
    if (!gps) return;
    const tabLabel = tab === "before" ? "BEFORE" : tab === "after" ? "AFTER" : "POLE TAG";
    router.push({
      pathname: "/capture" as any,
      params: {
        tab,
        returnKey: captureReturnKey,
        ownerType: "destination",
        ownerPoleId: String(params.to_pole_id ?? ""),
        label: tabLabel,
        poleCode: editedToPoleName || params.to_pole_name || params.to_pole_code || "Destination Pole",
        nodeName: params.node_name || params.node_id || "",
        lat: String(gps.latitude),
        lng: String(gps.longitude),
        road: gpsStreet,
        city: gpsCity,
        province: gpsProvince,
        prefetchedMap: captureMapPrefetchedRef.current ? "1" : "0",
      },
    });
  }, [
    capturedGps,
    captureReturnKey,
    editedToPoleName,
    gpsCity,
    gpsProvince,
    gpsStreet,
    params.node_id,
    params.node_name,
    params.to_pole_id,
    params.to_pole_code,
    params.to_pole_name,
  ]);

  // Stable refs so applyCaptureResult's useCallback doesn't restart mid-stamp
  // when setter(createPhotoField) triggers a re-render and recreates these functions.
  const buildStampLinesRef = useRef(buildStampLines);
  buildStampLinesRef.current = buildStampLines;
  const savePhotoDraftRef = useRef(savePhotoDraft);
  savePhotoDraftRef.current = savePhotoDraft;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const applyCaptureResult = async () => {
        const result = (global as any)[captureReturnKey] as
          | {
              uri?: string;
              tab?: "before" | "after" | "tag";
              ownerType?: string;
              ownerPoleId?: string;
              skipStamp?: boolean;
            }
          | undefined;
        if (!result?.uri || !result?.tab) return;

        const expectedPoleId = String(params.to_pole_id ?? "");
        if (result.ownerType !== "destination" || String(result.ownerPoleId ?? "") !== expectedPoleId) {
          delete (global as any)[captureReturnKey];
          return;
        }

        delete (global as any)[captureReturnKey];

        const tab = result.tab;
        const setter = tab === "before" ? setPhotoBefore : tab === "after" ? setPhotoAfter : setPhotoTag;
        const qualitySetter = tab === "before" ? setQualityBefore : tab === "after" ? setQualityAfter : setQualityTag;
        const file = tab === "before" ? F.before : tab === "after" ? F.after : F.tag;
        const qualityKey = tab === "before"
          ? `td_quality_before_${params.to_pole_id}`
          : tab === "after"
          ? `td_quality_after_${params.to_pole_id}`
          : `td_quality_tag_${params.to_pole_id}`;

        setActiveCameraTab(tab);
        setBlurWarning(false);

        const thisGen = ++captureGenRef.current;
        lastFreshCaptureRef.current = Date.now(); // block draft loader for 3s
        setter(createPhotoField(result.uri, file)); // show immediately

        try {
          const gpsLat = capturedGps?.latitude ?? toPoleGpsRef.current?.latitude ?? null;
          const gpsLng = capturedGps?.longitude ?? toPoleGpsRef.current?.longitude ?? null;
          // Skip re-stamp if capture.tsx already burned the metadata in
          const stampLines = result.skipStamp ? undefined : buildStampLinesRef.current(tab);
          const saved = await savePhotoDraftRef.current(file, result.uri, stampLines, gpsLat, gpsLng);
          if (cancelled || captureGenRef.current !== thisGen) return;

          setter(saved);
          cacheSet(`photo_captured_at_${params.to_pole_id}_${tab}`, getPHTNow()).catch(() => {});

          const variance = await checkPhotoQuality(saved.fileUri ?? result.uri);
          if (cancelled || captureGenRef.current !== thisGen) return;

          const pct = varianceToPercent(variance);
          qualitySetter(pct);
          cacheSet(qualityKey, pct).catch(() => {});
          if (variance < 80) setBlurWarning(true);
        } catch {}
      };

      applyCaptureResult().catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [
      F.after,
      F.before,
      F.tag,
      captureReturnKey,
      capturedGps,
      params.to_pole_id,
      toPoleGpsRef,
    ]),
  );

  async function captureFromCamera() {
    if (!cameraRef.current || !cameraReady || photoCapturing) return;
    if (isCapturingRef.current) return;
    isCapturingRef.current = true;

    setBlurWarning(false);

    // Use pre-warmed GPS for distance check — no blocking network call
    if (capturedGps && prewarmedGps.current) {
      const dist = computeDistanceMeters(
        capturedGps.latitude, capturedGps.longitude,
        prewarmedGps.current.latitude, prewarmedGps.current.longitude,
      );
      if (!DEV_SKIP_GPS_CHECKS && dist > 50) {
        isCapturingRef.current = false;
        setOutOfAreaAlert({ visible: true, distance: dist });
        return;
      }
    }

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.92,
        skipProcessing: true,
        exif: false,
      });
      if (!photo?.uri) { isCapturingRef.current = false; return; }

      const capturedAt  = getPHTNow();
      const tab         = activeCameraTab;
      const setter      = tab === "before" ? setPhotoBefore : tab === "after" ? setPhotoAfter : setPhotoTag;
      const qualitySetter = tab === "before" ? setQualityBefore : tab === "after" ? setQualityAfter : setQualityTag;
      const file        = tab === "before" ? F.before : tab === "after" ? F.after : F.tag;

      // Show raw photo immediately
      const thisGen = ++captureGenRef.current;
      setter(createPhotoField(photo.uri, file));
      setTimeout(() => { isCapturingRef.current = false; setPhotoCapturing(false); }, 400);

      // Stamp + quality check in background
      (async () => {
        try {
          const gpsLat = capturedGps?.latitude ?? null;
          const gpsLng = capturedGps?.longitude ?? null;
          const saved = await savePhotoDraft(file, photo.uri, buildStampLines(tab), gpsLat, gpsLng);
          if (captureGenRef.current !== thisGen) return;
          setter(saved);
          cacheSet(`photo_captured_at_${params.to_pole_id}_${tab}`, capturedAt).catch(() => {});

          const variance = await checkPhotoQuality(saved.fileUri ?? photo.uri);
          if (captureGenRef.current !== thisGen) return;
          const pct = varianceToPercent(variance);
          qualitySetter(pct);
          const qualityKey = tab === "before" ? `td_quality_before_${params.to_pole_id}`
            : tab === "after" ? `td_quality_after_${params.to_pole_id}`
            : `td_quality_tag_${params.to_pole_id}`;
          cacheSet(qualityKey, pct).catch(() => {});
          if (variance < 80) setBlurWarning(true);
        } catch {}
      })();

    } catch (e: any) {
      const msg = (e?.message ?? "").toLowerCase();
      if (!msg.includes("not running") && !msg.includes("already")) {
        Alert.alert("Photo Error", "Failed to capture image. Make sure camera is ready and try again.");
      }
      isCapturingRef.current = false;
      setPhotoCapturing(false);
    }
  }


  async function handleSaveToPoleName() {
    const trimmed = editToNameDraft.trim();
    if (!trimmed) return;
    setSavingToName(true);

    // 1. Update local state immediately (works offline too)
    setEditedToPoleName(trimmed);

    // 2. Patch local pole caches in the background so the edited destination
    // code replaces NPT — doesn't block the save when online.
    cacheSet(`draft_to_pole_name_${params.to_pole_id}`, trimmed).catch(() => {});
    if (params.node_id) {
      const patchPoleList = async (cacheKey: string) => {
        const cachedPoles = await cacheGet<any[]>(cacheKey).catch(() => null);
        if (!cachedPoles) return;
        const updated = cachedPoles.map((p) => {
          const matchId =
            String(p.id) === String(params.to_pole_id) ||
            String(p.pole_id) === String(params.to_pole_id) ||
            String(p.pole?.id) === String(params.to_pole_id);
          if (!matchId) return p;
          return {
            ...p,
            pole_name: trimmed,
            pole_code: trimmed,
            pole: p.pole ? { ...p.pole, pole_code: trimmed } : p.pole,
          };
        });
        await cacheSet(cacheKey, updated).catch(() => {});
      };

      patchPoleList(`poles_node_${params.node_id}`).catch(() => {});
      patchPoleList(`sitemap_poles_${params.node_id}`).catch(() => {});
    }

    setSavingToName(false);
    setEditToNameModalOpen(false);

    // 3. Sync in the background — don't block the user.
    (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await api.put(`/skycable/poles/${params.to_pole_id}`, { pole_code: trimmed });
          return;
        } catch (e: any) {
          const status = e?.response?.status;
          if (status && status < 500) return;
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            continue;
          }
          await simpleQueuePush({
            method: "put",
            url: `/skycable/poles/${params.to_pole_id}`,
            body: { pole_code: trimmed },
          }, true).catch(() => {});
        }
      }
    })().catch(() => {});
  }

  function goToComponents() {
    const gps = capturedGps ?? toPoleGpsRef.current;

    // Mark span as in_progress immediately — fire-and-forget, don't block navigation
    if (params.span_id) {
      api.put(`/skycable/spans/${params.span_id}`, { status: 'in_progress' }).catch(() => {});
    }

    router.push({
      pathname: "/teardowns/components" as any,
      params: {
        ...params,
        to_pole_code: editedToPoleName || params.to_pole_name || params.to_pole_code,
        to_pole_name: editedToPoleName || params.to_pole_name,
        to_pole_latitude: gps ? String(gps.latitude) : "",
        to_pole_longitude: gps ? String(gps.longitude) : "",
        to_pole_gps_captured_at: gps?.captured_at ?? "",
        to_pole_gps_accuracy: gps?.accuracy != null ? String(gps.accuracy) : "",
        destination_slot: slot,
        destination_landmark: landmark,
        teardown_started_at: startedAtRef.current,
      },
    });
  }

  const gpsTopLabel = hasGps
    ? `${capturedGps?.latitude.toFixed(6)}, ${capturedGps?.longitude.toFixed(6)}`
    : "GPS Required";

  const gpsSecondaryLabel = hasGps
    ? gpsFromSitemap
      ? "📍 Sitemap GPS — pre-placed by sitemap APK"
      : "📱 Captured on this device"
    : gpsAccuracy === null
      ? "⚠️ Required — acquiring signal…"
      : gpsAccuracy <= REQUIRED_GPS_ACCURACY_METERS
        ? `⚠️ Required — accuracy ${gpsAccuracy}m, ready to capture`
        : `⚠️ Required — accuracy ${gpsAccuracy}m, tap to capture`;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.floatingHeader}>
          <TouchableOpacity
            onPress={() => {
              // Mark destination pole as recently visited so it floats to the top of the poles list
              cacheSet(`pole_last_selected_${params.to_pole_id}`, Date.now()).catch(() => {});
              router.navigate({
                pathname: "/teardowns/poles" as any,
                params: { nodeId: params.node_id, nodeName: params.node_name || "", accent: params.accent },
              });
            }}
            style={styles.backBtn}
          >
            <ChevronLeft size={22} color="#111827" />
          </TouchableOpacity>
          <View style={styles.floatingHeaderText}>
            <Text style={styles.headerTitle}>{editedToPoleName || params.to_pole_code || "Destination Pole"}</Text>
            <Text style={styles.headerSub}>{params.node_name || "Skycable Teardown"}</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >


          {/* ── Hero card (matches pole-detail.tsx) ── */}
          <View style={styles.heroCard}>
            <View style={[styles.heroBg, { backgroundColor: "#0F172A" }]} />
            <View style={[styles.heroGlowLeft,  { backgroundColor: accentColor }]} />
            <View style={styles.heroGlowRight} />
            <View style={styles.heroGlassOverlay} />

            <View style={styles.heroContent}>
              {/* Top line: badge + timer */}
              <View style={[styles.heroTopLine, { justifyContent: "space-between" }]}>
                <View style={[styles.heroBadge, {
                  backgroundColor: `${accentColor}25`,
                  borderColor: `${accentColor}50`,
                  maxWidth: "70%",
                }]}>
                  <Text style={[styles.heroBadgeText, { color: "#A7F3D0" }]} numberOfLines={1}>
                    📍  DESTINATION POLE
                  </Text>
                </View>
                {poleStartedAt && (
                  <View style={styles.heroTopTimerPill}>
                    <Text style={styles.heroTopTimerIcon}>⏱</Text>
                    <Text style={styles.heroTopTimerText}>
                      {String(Math.floor(poleDuration / 60)).padStart(2, "0")}:{String(poleDuration % 60).padStart(2, "0")}
                    </Text>
                  </View>
                )}
              </View>

              {/* Title + edit */}
              <View style={styles.heroMainBlock}>
                <View style={styles.heroTitleRowWrapper}>
                  <Text style={styles.heroTitle} numberOfLines={2}>
                    {editedToPoleName || params.to_pole_code || "Destination Pole"}
                  </Text>
                  <TouchableOpacity
                    style={styles.heroEditPill}
                    onPress={() => { setEditToNameDraft(editedToPoleName); setEditToNameModalOpen(true); }}
                  >
                    <Text style={styles.heroEditPillIcon}>✎</Text>
                    <Text style={styles.heroEditPillText}>EDIT</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Integrated footer: summary table + progress */}
              <View style={styles.heroIntegratedFooter}>
                {/* Summary table */}
                <View style={styles.heroSummaryTable}>
                  <View style={styles.heroSummaryCol}>
                    <Text style={styles.heroSummaryLabel}>STARTED AT</Text>
                    <Text style={styles.heroSummaryValue}>
                      {poleStartedAt ? fmtPHT(poleStartedAt) : "—"}
                    </Text>
                  </View>
                  <View style={styles.heroSummaryDivider} />
                  <View style={styles.heroSummaryCol}>
                    <Text style={styles.heroSummaryLabel}>ELAPSED</Text>
                    <Text style={[styles.heroSummaryValue, { color: poleStartedAt ? "#FBBF24" : "#94A3B8" }]}>
                      {poleStartedAt ? fmtDuration(poleDuration) : "—"}
                    </Text>
                  </View>
                  <View style={styles.heroSummaryDivider} />
                  <View style={styles.heroSummaryCol}>
                    <Text style={styles.heroSummaryLabel}>STATUS</Text>
                    <Text style={[styles.heroSummaryValue, {
                      color: !poleStartedAt ? "#94A3B8" : progress.percent >= 100 ? "#A7F3D0" : "#FBBF24",
                    }]}>
                      {!poleStartedAt ? "Pending" : progress.percent >= 100 ? "Ready" : "In Progress"}
                    </Text>
                  </View>
                </View>


                {/* Progress section */}
                <View style={styles.heroFooterHeaderRow}>
                  <Text style={styles.heroFooterTitle}>PROGRESS</Text>
                  <Text style={[styles.heroFooterPercentText, { color: accentColor }]}>
                    {progress.percent}%
                  </Text>
                </View>
                <View style={styles.heroTrackerNodesRow}>
                  <TrackerMini done={hasGps}          label="GPS" />
                  <TrackerMini done={!!photoBefore}   label="Before" />
                  <TrackerMini done={!!photoAfter}    label="After" />
                  <TrackerMini done={!!photoTag}      label="Tag" />
                  <TrackerMini done={!!slot}          label="Slot" />
                  <TrackerMini done={!!landmark.trim()} label="Landmark" />
                </View>
                <View style={{ marginTop: 4 }}>
                  <ProgressWaveBar progress={progress.percent} accentColor={accentColor} />
                </View>
              </View>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <SectionHeading
              title="GPS Location"
              right={
                <View
                  style={[
                    styles.sectionPill,
                    hasGps
                      ? styles.sectionPillSuccess
                      : styles.sectionPillMuted,
                  ]}
                >
                  <Text
                    style={[
                      styles.sectionPillText,
                      hasGps
                        ? styles.sectionPillTextSuccess
                        : styles.sectionPillTextMuted,
                    ]}
                  >
                    {hasGps ? "Captured" : "Required"}
                  </Text>
                </View>
              }
            />

            {hasGps && capturedGps ? (
              <TouchableOpacity
                activeOpacity={0.95}
                onPress={() => setMapFullscreen(true)}
                style={styles.gpsMapBox}
              >
                <WebView
                  key={`map-${capturedGps.latitude}-${capturedGps.longitude}-${mapSatellite}`}
                  style={StyleSheet.absoluteFillObject}
                  scrollEnabled={false}
                  originWhitelist={["*"]}
                  javaScriptEnabled
                  domStorageEnabled
                  mixedContentMode="always"
                  source={{
                    html: buildPoleMapHtml(
                      capturedGps.latitude,
                      capturedGps.longitude,
                      accentColor,
                      mapSatellite,
                      editedToPoleName || params.to_pole_name || params.to_pole_code || "",
                    ),
                    baseUrl: "https://local.telcovantage/",
                  }}
                  cacheEnabled={false}
                  pointerEvents="none"
                />
                <TouchableOpacity
                  style={styles.mapLayerBtn}
                  onPress={() => setMapSatellite((v) => !v)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.mapLayerBtnText}>
                    {mapSatellite ? "🗺 Map" : "🛰 Sat"}
                  </Text>
                </TouchableOpacity>
                <View style={styles.mapExpandHint}>
                  <Text style={styles.mapExpandHintText}>⛶ Tap to expand</Text>
                </View>
                <View style={styles.mapCoordsOverlay}>
                  <Text style={styles.mapCoordsText}>
                    {capturedGps.latitude.toFixed(6)},{"  "}
                    {capturedGps.longitude.toFixed(6)}
                  </Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={styles.noGpsPlaceholder}>
                <Image
                  source={require("../../assets/images/telcovantage-logo.png")}
                  style={styles.noGpsLogo}
                  resizeMode="contain"
                />
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.gpsCardButton,
                hasGps
                  ? styles.gpsCardButtonSuccess
                  : styles.gpsCardButtonRequired,
                !poleStartedAt && { opacity: 0.4 },
                pressed && poleStartedAt && !gpsCapturing && styles.pressedDown,
              ]}
              onPress={captureGps}
              disabled={!poleStartedAt || gpsCapturing}
            >
              <View
                style={[
                  styles.gpsIconWrap,
                  hasGps
                    ? { backgroundColor: `${accentColor}16` }
                    : { backgroundColor: `${accentColor}10` },
                ]}
              >
                {gpsCapturing ? (
                  <ActivityIndicator color={accentColor} size="small" />
                ) : hasGps && capturedGps ? (
                  <StaticTileMap
                    lat={capturedGps.latitude}
                    lng={capturedGps.longitude}
                  />
                ) : (
                  <Text style={[styles.gpsIcon, { color: accentColor }]}>
                    📍
                  </Text>
                )}
              </View>

              <View style={styles.gpsTextWrap}>
                <Text style={styles.gpsEyebrow}>GPS DISPLAY</Text>

                <Text
                  style={[
                    styles.gpsCoordinateText,
                    hasGps && { color: "#0F172A" },
                  ]}
                  numberOfLines={1}
                >
                  {gpsTopLabel}
                </Text>

                <Text style={styles.gpsLocationText} numberOfLines={2}>
                  {gpsSecondaryLabel}
                </Text>

                {capturedGps?.captured_at ? (
                  <Text style={styles.gpsCapturedAt}>
                    Captured at{" "}
                    {new Date(capturedGps.captured_at).toLocaleString()}
                  </Text>
                ) : null}

              </View>

              <View style={styles.gpsArrowWrap}>
                <Text style={[styles.gpsArrow, { color: accentColor }]}>
                  {hasGps ? "✓" : "›"}
                </Text>
              </View>
            </Pressable>
          </View>

          {/* Slot */}
          <View style={styles.sectionCard}>
            <SectionHeading
              title="Slot"
              right={
                <View style={[styles.sectionPill, slot ? styles.sectionPillSuccess : styles.sectionPillMuted]}>
                  <Text style={[styles.sectionPillText, slot ? styles.sectionPillTextSuccess : styles.sectionPillTextMuted]}>
                    {slot ? slot : "Required"}
                  </Text>
                </View>
              }
            />
            <View style={[styles.slotRowStatic, !poleStartedAt && { opacity: 0.4 }]}>
              {SLOTS.map((s) => (
                <Pressable
                  key={s}
                  style={({ pressed }) => [
                    styles.slotBtn,
                    slot === s && { backgroundColor: accentColor, borderColor: accentColor },
                    pressed && poleStartedAt && styles.pressedDown,
                  ]}
                  onPress={() => poleStartedAt && setSlot(s)}
                >
                  <Text style={[styles.slotText, slot === s && { color: "#FFFFFF" }]}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Landmark */}
          <View style={styles.sectionCard}>
            <SectionHeading
              title="Landmark"
              right={
                <View style={[styles.sectionPill, landmark.trim() ? styles.sectionPillSuccess : styles.sectionPillMuted]}>
                  <Text style={[styles.sectionPillText, landmark.trim() ? styles.sectionPillTextSuccess : styles.sectionPillTextMuted]}>
                    {landmark.trim() ? "Filled" : "Optional"}
                  </Text>
                </View>
              }
            />
            <TextInput
              style={[styles.textArea, !poleStartedAt && { opacity: 0.4 }]}
              placeholder="e.g. Beside blue gate, near convenience store"
              placeholderTextColor="#9CA3AF"
              value={landmark}
              onChangeText={setLandmark}
              multiline
              numberOfLines={3}
              editable={!!poleStartedAt}
            />
          </View>

          {/* Photo capture button — unlocks after GPS + Slot + Landmark */}
          <View style={styles.sectionCard}>
            <SectionHeading
              title="Pole Photos"
              subtitle={!poleStartedAt ? "Start pole teardown first" : infoComplete ? "Click a card to capture · tap again to view" : "Fill GPS & Slot first"}
            />
            <View style={styles.photoTileRow}>
              <PhotoTile
                label="Before"
                photo={photoBefore}
                accentColor={accentColor}
                disabled={!infoComplete}
                onCapture={() => openSharedCapture("before")}
                onView={() => openViewer("before", () => openSharedCapture("before"))}
              />
              <PhotoTile
                label="After"
                photo={photoAfter}
                accentColor={accentColor}
                disabled={!infoComplete}
                onCapture={() => openSharedCapture("after")}
                onView={() => openViewer("after", () => openSharedCapture("after"))}
              />
              <PhotoTile
                label="Tag"
                photo={photoTag}
                accentColor={accentColor}
                disabled={!infoComplete}
                onCapture={() => openSharedCapture("tag")}
                onView={() => openViewer("tag", () => openSharedCapture("tag"))}
              />
            </View>
          </View>
        </ScrollView>

        <View style={styles.ctaBar}>
          {!poleStartedAt ? (
            <Pressable
              style={({ pressed }) => [
                styles.submitBtn,
                { backgroundColor: accentColor, opacity: poleStarting ? 0.7 : pressed ? 0.85 : 1 },
              ]}
              onPress={handleStartPoleTeardown}
              disabled={poleStarting}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                <Text style={styles.submitText}>
                  {poleStarting ? "Starting…" : "Start Pole Teardown"}
                </Text>
                {poleStarting
                  ? <ActivityIndicator size="small" color="#FFFFFF" style={{ marginLeft: 8 }} />
                  : <Play size={15} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 8 } as any} />}
              </View>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.submitBtn,
                { backgroundColor: progress.percent >= 100 ? accentColor : "#C9CED6" },
                pressed && progress.percent >= 100 && styles.pressedDown,
              ]}
              onPress={progress.percent >= 100 ? goToComponents : undefined}
              disabled={progress.percent < 100}
            >
              <Text style={styles.submitText}>
                {progress.percent >= 100 ? "Next  →" : "Complete required fields first"}
              </Text>
            </Pressable>
          )}
        </View>

        {/* ── Edit Destination Pole Name Modal ── */}
        <Modal
          visible={editToNameModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setEditToNameModalOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.editNameCard}>
              <Text style={styles.editNameTitle}>Edit Pole Name</Text>
              <Text style={styles.editNameSub}>
                Changes will be saved to the server immediately.
              </Text>
              <TextInput
                style={styles.editNameInput}
                value={editToNameDraft}
                onChangeText={setEditToNameDraft}
                placeholder="Enter pole name"
                placeholderTextColor="#9CA3AF"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (!savingToName && editToNameDraft.trim()) handleSaveToPoleName();
                }}
                selectionColor={accentColor}
              />
              <View style={styles.editNameActions}>
                <Pressable
                  style={({ pressed }) => [styles.editNameCancelBtn, pressed && styles.pressedDown]}
                  onPress={() => setEditToNameModalOpen(false)}
                  disabled={savingToName}
                >
                  <Text style={styles.editNameCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.editNameSaveBtn,
                    { backgroundColor: accentColor },
                    (savingToName || !editToNameDraft.trim()) && { opacity: 0.5 },
                    pressed && styles.pressedDown,
                  ]}
                  onPress={handleSaveToPoleName}
                  disabled={savingToName || !editToNameDraft.trim()}
                >
                  {savingToName ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.editNameSaveText}>Save</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Tabbed Camera Modal ── */}
        <Modal
          visible={showCameraModal}
          animationType="slide"
          statusBarTranslucent
          onRequestClose={() => setShowCameraModal(false)}
        >
          <SafeAreaView style={styles.cameraModalRoot} edges={["top", "bottom"]}>
            {/* Header */}
            <View style={styles.cameraModalHeader}>
              <Pressable onPress={() => { setShowCameraModal(false); setCameraReady(false); }} style={styles.cameraModalBackBtn}>
                <Text style={styles.cameraModalBackText}>‹</Text>
              </Pressable>
              <Text style={styles.cameraModalTitle}>Capture Photos</Text>
              <View style={{ width: 40 }} />
            </View>

            {/* Tabs */}
            <View style={styles.cameraTabRow}>
              {(["before", "after", "tag"] as const).map((tab) => {
                const done = tab === "before" ? !!photoBefore : tab === "after" ? !!photoAfter : !!photoTag;
                const label = tab === "tag" ? "POLE TAG" : tab.toUpperCase();
                return (
                  <Pressable
                    key={tab}
                    style={[styles.cameraTab, activeCameraTab === tab && { borderBottomColor: accentColor, borderBottomWidth: 2 }]}
                    onPress={() => setActiveCameraTab(tab)}
                  >
                    {done && <View style={[styles.cameraTabDot, { backgroundColor: accentColor }]} />}
                    <Text style={[styles.cameraTabText, activeCameraTab === tab && { color: accentColor }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Live camera + photo preview */}
            <View style={styles.cameraPreviewArea}>
              {(() => {
                const photo = activeCameraTab === "before" ? photoBefore : activeCameraTab === "after" ? photoAfter : photoTag;
                const photoQuality = activeCameraTab === "before" ? qualityBefore : activeCameraTab === "after" ? qualityAfter : qualityTag;
                const clearPhoto = activeCameraTab === "before"
                  ? () => { captureGenRef.current++; setBlurWarning(false); setPhotoBefore(null); setQualityBefore(null); cacheSet(`td_quality_before_${params.to_pole_id}`, null).catch(() => {}); }
                  : activeCameraTab === "after"
                  ? () => { captureGenRef.current++; setBlurWarning(false); setPhotoAfter(null); setQualityAfter(null); cacheSet(`td_quality_after_${params.to_pole_id}`, null).catch(() => {}); }
                  : () => { captureGenRef.current++; setBlurWarning(false); setPhotoTag(null); setQualityTag(null); cacheSet(`td_quality_tag_${params.to_pole_id}`, null).catch(() => {}); };
                if (photo && !blurWarning) {
                  const badgeColor = photoQuality === null ? "#6b7280"
                    : photoQuality >= 80 ? "#22c55e"
                    : photoQuality >= 65 ? "#84cc16"
                    : photoQuality >= 50 ? "#f97316"
                    : "#ef4444";
                  return (
                    <View style={{ flex: 1, width: "100%", alignSelf: "stretch", backgroundColor: "#000" }}>
                      <Pressable style={StyleSheet.absoluteFillObject} onPress={clearPhoto}>
                        <ExpoImage source={{ uri: photo.uri }} style={StyleSheet.absoluteFillObject} contentFit="contain" />
                        <View style={styles.cameraRetakeBadge}>
                          <Text style={styles.cameraRetakeText}>Tap to retake</Text>
                        </View>
                        <View style={styles.photoQualityBadgeWrap}>
                          <View style={[styles.photoQualityBadge, { backgroundColor: badgeColor }]}>
                            <Text style={styles.photoQualityBadgeLabel}>HD QUALITY</Text>
                            <Text style={styles.photoQualityBadgePercent}>
                              {photoQuality !== null ? `${photoQuality}%` : "—"}
                            </Text>
                          </View>
                        </View>
                      </Pressable>
                      {(capturedGps as any)?.lat && (capturedGps as any)?.lng && (
                        <View
                          style={{
                            position: "absolute",
                            bottom: 24,
                            left: 16,
                            right: 16,
                            backgroundColor: "rgba(13, 17, 23, 0.85)",
                            borderRadius: 12,
                            paddingVertical: 10,
                            paddingHorizontal: 14,
                            flexDirection: "row",
                            alignItems: "center",
                            borderWidth: 1,
                            borderColor: "rgba(255,255,255,0.15)"
                          }}
                        >
                          <Text style={{ fontSize: 16, marginRight: 8 }}>📍</Text>
                          <View>
                            <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "600" }}>Geotag Location</Text>
                            <Text style={{ color: "#9CA3AF", fontSize: 11 }}>{(capturedGps as any).lat.toFixed(6)}, {(capturedGps as any).lng.toFixed(6)}</Text>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                }
                if (cameraPermission?.granted) {
                  const stampPreviewLines = buildStampLines(activeCameraTab as any);
                  const previewLat = capturedGps?.latitude ?? null;
                  const previewLng = capturedGps?.longitude ?? null;
                  const mapInfo = previewLat != null && previewLng != null
                    ? streetTileInfo(previewLat, previewLng, 18)
                    : null;

                  return (
                    <GestureDetector gesture={pinchGesture}>
                      <View style={StyleSheet.absoluteFillObject}>
                        <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="back" zoom={cameraZoom} onCameraReady={() => setCameraReady(true)} />

                        {capturedGps && (
                          <View
                            style={{
                              position: "absolute",
                              top: 16,
                              left: 16,
                              right: 16,
                              backgroundColor: "rgba(13, 17, 23, 0.85)",
                              borderRadius: 12,
                              paddingVertical: 10,
                              paddingHorizontal: 14,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                              borderWidth: 1,
                              borderColor: "rgba(255,255,255,0.15)",
                            }}
                          >
                            <View style={{ flexDirection: "row", alignItems: "center" }}>
                              <Text style={{ fontSize: 16, marginRight: 8 }}>📍</Text>
                              <View>
                                <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "600" }}>Target Coordinates</Text>
                                <Text style={{ color: "#9CA3AF", fontSize: 11 }}>
                                  {capturedGps.latitude.toFixed(6)}, {capturedGps.longitude.toFixed(6)}
                                </Text>
                              </View>
                            </View>
                            {prewarmedGps.current ? (
                              <View style={{ alignItems: "flex-end" }}>
                                <Text style={{ color: accentColor, fontSize: 13, fontWeight: "800" }}>
                                  {computeDistanceMeters(
                                    capturedGps.latitude,
                                    capturedGps.longitude,
                                    prewarmedGps.current.latitude,
                                    prewarmedGps.current.longitude,
                                  )}m Range
                                </Text>
                                <Text style={{ color: "#A7F3D0", fontSize: 9 }}>Verified</Text>
                              </View>
                            ) : (
                              <Text style={{ color: accentColor, fontSize: 12, fontWeight: "600" }}>Active</Text>
                            )}
                          </View>
                        )}

                        {/* Live stamp preview overlay */}
                        <View style={{
                          position: "absolute", bottom: 8, left: 8, right: 8,
                          flexDirection: "row", alignItems: "stretch", gap: 6,
                        }}>
                          <View style={{
                            flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
                            borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10,
                            borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
                          }}>
                            {stampPreviewLines.map((line, i) => (
                              <Text key={i} style={{
                                color: i === stampPreviewLines.length - 1 ? "rgba(255,255,255,0.62)" : "#FFF",
                                fontSize: i === 0 ? 11 : 10,
                                fontWeight: i === 0 ? "700" : "600",
                                lineHeight: 15,
                              }} numberOfLines={1}>{line}</Text>
                            ))}
                          </View>
                          {mapInfo && (
                            <MapThumbnail info={mapInfo} />
                          )}
                        </View>

                        {blurWarning && (
                          <View style={styles.blurWarningOverlay}>
                            <Text style={styles.blurWarningIcon}>⚠️</Text>
                            <Text style={styles.blurWarningTitle}>Photo is dark or blurry</Text>
                            <Text style={styles.blurWarningBody}>Please retake for a clearer image</Text>
                            <View style={styles.blurWarningActions}>
                              <Pressable
                                style={[styles.blurRetakeBtn, { backgroundColor: accentColor }]}
                                onPress={() => {
                                  captureGenRef.current++;
                                  setBlurWarning(false);
                                  if (activeCameraTab === "before") { setPhotoBefore(null); setQualityBefore(null); cacheSet(`td_quality_before_${params.to_pole_id}`, null).catch(() => {}); }
                                  else if (activeCameraTab === "after") { setPhotoAfter(null); setQualityAfter(null); cacheSet(`td_quality_after_${params.to_pole_id}`, null).catch(() => {}); }
                                  else { setPhotoTag(null); setQualityTag(null); cacheSet(`td_quality_tag_${params.to_pole_id}`, null).catch(() => {}); }
                                }}
                              >
                                <Text style={styles.blurRetakeBtnText}>Retake</Text>
                              </Pressable>
                              <Pressable style={styles.blurKeepBtn} onPress={() => setBlurWarning(false)}>
                                <Text style={styles.blurKeepBtnText}>Keep</Text>
                              </Pressable>
                            </View>
                          </View>
                        )}
                      </View>
                    </GestureDetector>
                  );
                }
                return (
                  <Pressable style={styles.cameraEmptyPreview} onPress={requestCameraPermission}>
                    <Text style={styles.cameraEmptyIcon}>📷</Text>
                    <Text style={styles.cameraEmptyText}>Tap to allow camera access</Text>
                  </Pressable>
                );
              })()}
            </View>

            {/* Bottom controls */}
            <View style={styles.cameraControls}>
              <Pressable style={styles.cameraControlSide} onPress={() => setShowCameraModal(false)}>
                <Text style={styles.cameraControlSideText}>‹</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.cameraCaptureBtn,
                  { borderColor: accentColor, opacity: cameraReady ? 1 : 0.4 },
                  pressed && { transform: [{ scale: 0.94 }] }
                ]}
                onPress={captureFromCamera}
                disabled={!cameraReady || photoCapturing}
                hitSlop={{ top: 30, bottom: 30, left: 30, right: 30 }}
              >
                <View style={[styles.cameraCaptureInner, { backgroundColor: accentColor }, photoCapturing && { opacity: 0.4 }]} />
              </Pressable>

              {(() => {
                const currentPhoto = activeCameraTab === "before" ? photoBefore : activeCameraTab === "after" ? photoAfter : photoTag;
                const hasPhoto = !!currentPhoto && !blurWarning;
                const isLastTab = activeCameraTab === "tag";
                const onConfirm = hasPhoto
                  ? () => {
                      if (isLastTab) { setShowCameraModal(false); setCameraReady(false); }
                      else if (activeCameraTab === "before") setActiveCameraTab("after");
                      else setActiveCameraTab("tag");
                    }
                  : undefined;
                return (
                  <Pressable
                    style={[
                      styles.cameraControlSide,
                      hasPhoto
                        ? { backgroundColor: `${accentColor}20`, borderColor: accentColor }
                        : { borderColor: "#3A3A3A" },
                    ]}
                    onPress={onConfirm}
                    disabled={!hasPhoto}
                  >
                    <Text style={[styles.cameraControlSideText, hasPhoto && { color: accentColor }]}>✓</Text>
                  </Pressable>
                );
              })()}
            </View>
          </SafeAreaView>
        </Modal>


        {/* Photo viewer modal */}
        <Modal visible={viewerOpen} transparent animationType="fade" onRequestClose={() => setViewerOpen(false)}>
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setViewerOpen(false)} />
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>{viewerLabel}</Text>
                  <Text style={styles.modalSubtitle}>Preview photo</Text>
                </View>
                <Pressable onPress={() => setViewerOpen(false)} style={({ pressed }) => [styles.modalCloseBtn, pressed && styles.pressedDown]}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              {viewerPhoto ? (
                <ExpoImage
                  key={viewerPhoto.version}
                  source={{ uri: viewerPhoto.uri }}
                  style={styles.modalImage}
                  contentFit="contain"
                  contentPosition="top"
                  cachePolicy="none"
                  recyclingKey={String(viewerPhoto.version)}
                  transition={150}
                />
              ) : null}
              <View style={styles.modalFooter}>
                <Pressable style={({ pressed }) => [styles.modalGhostBtn, pressed && styles.pressedDown]} onPress={() => setViewerOpen(false)}>
                  <Text style={styles.modalGhostBtnText}>Close</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.modalPrimaryBtn, { backgroundColor: accentColor }, pressed && styles.pressedDown]}
                  onPress={() => { setViewerOpen(false); viewerRetake?.(); }}
                >
                  <Text style={styles.modalPrimaryBtnText}>Retake</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Premium Out of Area Alert Modal ── */}
        <Modal
          visible={!!outOfAreaAlert?.visible}
          transparent
          animationType="fade"
          onRequestClose={() => setOutOfAreaAlert(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.qualityAlertCard}>
              <View style={[styles.qualityAlertIconWrap, { backgroundColor: "#FFF1F2", borderColor: "#FECDD3" }]}>
                <Text style={{ fontSize: 28 }}>📍</Text>
              </View>
              <Text style={styles.qualityAlertTitle}>Too Far From Pole</Text>
              <Text style={styles.qualityAlertBody}>
                You must be within <Text style={styles.qualityAlertBold}>50 meters</Text> of the captured destination pole coordinates to take authentic site photos.{"\n\n"}
                Current distance: <Text style={{ fontWeight: "800", color: "#111827" }}>{outOfAreaAlert?.distance} meters</Text>.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.qualityRetakeBtn,
                  { backgroundColor: accentColor, width: "100%" },
                  pressed && styles.pressedDown,
                ]}
                onPress={() => setOutOfAreaAlert(null)}
              >
                <Text style={styles.qualityRetakeBtnText}>Understood</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Hidden WebView for blur detection */}
        <WebView
          ref={blurCheckRef}
          style={{ position: "absolute", width: 0, height: 0, opacity: 0 }}
          source={{ html: BLUR_DETECT_HTML }}
          onMessage={handleBlurMessage}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={["*"]}
        />

        {/* Hidden WebView for photo stamping */}
        <WebView
          ref={stampRef}
          style={{ position: "absolute", width: 0, height: 0, opacity: 0 }}
          source={{ html: STAMP_HTML }}
          onMessage={handleStampMessage}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={["*"]}
        />

        <Modal
          transparent
          visible={gpsSuccessModal}
          animationType="fade"
          onRequestClose={() => setGpsSuccessModal(false)}
        >
          <View style={styles.prModalOverlay}>
            <View style={styles.alertModalCard}>
              <View style={styles.alertModalSuccessIcon}>
                <Text style={{ fontSize: 24, color: "#10b981", fontWeight: "900" }}>✓</Text>
              </View>
              <Text style={styles.alertModalTitle}>GPS Captured</Text>
              <Text style={styles.alertModalText}>
                Location successfully saved:{"\n"}
                {capturedGps?.latitude?.toFixed(6)}, {capturedGps?.longitude?.toFixed(6)}
              </Text>

              <TouchableOpacity
                style={styles.alertModalBtnFull}
                onPress={() => setGpsSuccessModal(false)}
              >
                <Text style={styles.alertModalBtnFullText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F4F6F8",
  },
  floatingHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
    backgroundColor: "#F4F6F8",
    zIndex: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#E7ECF2",
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7ECF2",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#101828",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  floatingHeaderText: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: "900", color: "#111827" },
  headerSub: { marginTop: 1, fontSize: 11, color: "#667085", fontWeight: "600" },

  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 170,
  },

  pressedDown: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },

  floatingBackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E7EBEF",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },

  floatingBackIcon: {
    fontSize: 28,
    color: "#111827",
    fontWeight: "700",
    marginTop: -2,
  },

  // ── Hero card (matches pole-detail.tsx) ──────────────────────────────────
  heroCard: {
    borderRadius: 30,
    overflow: "hidden",
    marginBottom: 14,
    backgroundColor: "#0F172A",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },

  heroBg: {
    ...StyleSheet.absoluteFillObject,
    opacity: 1,
  },

  heroGlowLeft: {
    position: "absolute",
    left: -60,
    bottom: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    opacity: 0.18,
  },

  heroGlowRight: {
    position: "absolute",
    right: -40,
    top: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(99,102,241,0.12)",
  },

  heroGlassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.55)",
  },

  heroContent: {
    paddingHorizontal: 20,
    paddingVertical: 20,
  },

  heroTopLine: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },

  heroBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },

  heroBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  heroTopTimerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  heroTopTimerIcon: {
    fontSize: 11,
  },

  heroTopTimerText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#FFFFFF",
    fontVariant: ["tabular-nums"] as any,
  },

  heroMainBlock: {
    marginBottom: 16,
  },

  heroTitleRowWrapper: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },

  heroTitle: {
    flex: 1,
    fontSize: 26,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },

  heroEditPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 4,
  },

  heroEditPillIcon: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
  },

  heroEditPillText: {
    fontSize: 10,
    fontWeight: "900",
    color: "rgba(255,255,255,0.8)",
    letterSpacing: 0.5,
  },

  // Integrated footer inside hero
  heroIntegratedFooter: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 18,
    padding: 14,
    gap: 12,
  },

  heroSummaryTable: {
    flexDirection: "row",
    alignItems: "center",
  },

  heroSummaryCol: {
    flex: 1,
    alignItems: "center",
  },

  heroSummaryLabel: {
    fontSize: 8,
    fontWeight: "900",
    color: "rgba(255,255,255,0.45)",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 3,
  },

  heroSummaryValue: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
  },

  heroSummaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginHorizontal: 2,
  },

  heroPoleStartBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,122,90,0.85)",
    borderRadius: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(167,243,208,0.3)",
  },

  heroPoleStartBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },

  heroFooterHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  heroFooterTitle: {
    fontSize: 9,
    fontWeight: "900",
    color: "rgba(255,255,255,0.45)",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  heroFooterPercentText: {
    fontSize: 14,
    fontWeight: "900",
  },

  heroTrackerNodesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  // Keep heroMeta for any remaining usage
  heroTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 18,
  },

  heroEditIcon: {
    fontSize: 15,
    color: "rgba(255,255,255,0.45)",
    marginTop: 4,
  },

  editNameCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    marginHorizontal: 24,
    gap: 14,
  },

  editNameTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.3,
  },

  editNameSub: {
    fontSize: 13,
    color: "#6B7280",
    lineHeight: 18,
    marginTop: -6,
  },

  editNameInput: {
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },

  editNameActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },

  editNameCancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#F3F4F6",
  },

  editNameCancelText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#374151",
  },

  editNameSaveBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },

  editNameSaveText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  heroMeta: {
    marginTop: 4,
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    fontWeight: "600",
  },

  // progressCard removed — merged into hero integrated footer

  trackerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    marginBottom: 12,
  },

  trackerMini: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
  },

  trackerMiniDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 5,
  },

  trackerMiniDotDone: {
    backgroundColor: "#DCFCE7",
  },

  trackerMiniDotText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#64748B",
  },

  trackerMiniDotTextDone: {
    color: "#166534",
  },

  trackerMiniLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#6B7280",
  },

  trackerMiniLabelDone: {
    color: "#166534",
  },

  progressBarTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: "#E8EDF2",
    overflow: "hidden",
  },

  progressBarFill: {
    height: "100%",
    borderRadius: 999,
    overflow: "hidden",
    justifyContent: "center",
  },

  progressWave: {
    position: "absolute",
    top: -10,
    bottom: -10,
    width: 70,
    backgroundColor: "rgba(255,255,255,0.24)",
    borderRadius: 24,
  },

  sectionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#E9EDF2",
    shadowColor: "#0F172A",
    shadowOpacity: 0.035,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 14,
    gap: 10,
  },

  sectionHeaderTextWrap: {
    flex: 1,
    minWidth: 0,
  },

  sectionTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#151826",
  },

  sectionSubtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: "#667085",
    fontWeight: "500",
  },

  sectionPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 2,
  },

  sectionPillSuccess: {
    backgroundColor: "#DCFCE7",
  },

  sectionPillMuted: {
    backgroundColor: "#F3F4F6",
  },

  sectionPillText: {
    fontSize: 11,
    fontWeight: "800",
  },

  sectionPillTextSuccess: {
    color: "#166534",
  },

  sectionPillTextMuted: {
    color: "#667085",
  },

  noGpsPlaceholder: {
    height: 180,
    backgroundColor: "#F3F4F6",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  noGpsLogo: {
    width: "40%",
    height: "40%",
    opacity: 0.15,
  },
  gpsMapBox: {
    height: 200,
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 12,
    backgroundColor: "#0d1117",
  },
  mapLayerBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    zIndex: 10,
  },
  mapLayerBtnText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  mapExpandHint: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    zIndex: 10,
  },
  mapExpandHintText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 10,
    fontWeight: "600",
  },
  mapCoordsOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingVertical: 7,
    paddingHorizontal: 14,
    zIndex: 10,
  },
  mapCoordsText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "monospace",
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: 0.5,
  },
  gpsCardButton: {
    borderWidth: 1.25,
    borderRadius: 22,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  gpsCardButtonSuccess: {
    backgroundColor: "#F7FBF9",
    borderColor: "#CFE7DB",
  },
  gpsCardButtonRequired: {
    backgroundColor: "#FFFBEB",
    borderColor: "#F59E0B",
    borderWidth: 1.5,
  },
  gpsIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  gpsIcon: {
    fontSize: 24,
  },
  gpsTextWrap: {
    flex: 1,
    paddingRight: 10,
  },
  gpsEyebrow: {
    fontSize: 10,
    fontWeight: "900",
    color: "#667085",
    letterSpacing: 1,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  gpsCoordinateText: {
    fontSize: 16,
    lineHeight: 21,
    color: "#111827",
    fontWeight: "900",
  },
  gpsLocationText: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    color: "#667085",
    fontWeight: "500",
  },
  gpsCapturedAt: {
    fontSize: 11,
    color: "#475467",
    fontWeight: "600",
    marginTop: 6,
  },
  gpsArrowWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#F4F6F8",
    alignItems: "center",
    justifyContent: "center",
  },
  gpsArrow: {
    fontSize: 18,
    fontWeight: "900",
  },
  gpsPendingLabel: {
    fontSize: 11,
    color: "#B45309",
    fontWeight: "700",
    marginTop: 5,
  },

  photoRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
    alignItems: "stretch",
  },

  photoHalf: {
    flex: 1,
    alignSelf: "stretch",
  },

  fieldGroup: {
    marginBottom: 18,
  },

  photoTileRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },

  photoTileCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 3,
  },

  photoTileImgWrap: {
    aspectRatio: 3 / 4,
    backgroundColor: "#F3F4F6",
  },

  photoViewHint: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingVertical: 6,
    alignItems: "center",
  },

  photoViewHintText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  photoTilePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#D1D5DB",
    margin: 6,
    borderRadius: 10,
  },

  photoTilePlaceholderIcon: {
    fontSize: 22,
    marginBottom: 4,
  },

  photoTilePlaceholderText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 0.5,
  },

  photoTileLabel: {
    textAlign: "center",
    fontSize: 11,
    fontWeight: "800",
    color: "#9CA3AF",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingVertical: 7,
  },

  photoTile: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E8ECF0",
    padding: 14,
    alignItems: "center",
    justifyContent: "space-between",
    height: 255,
  },

  photoTileCompact: {
    padding: 14,
    height: 255,
  },

  photoTileEyebrow: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    marginBottom: 10,
    alignSelf: "center",
  },

  photoPreviewWrap: {
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#F3F4F6",
    width: "100%",
  },

  photoPreviewWrapCompact: {
    borderRadius: 18,
  },

  photoThumb: {
    width: "100%",
    height: 180,
    backgroundColor: "#E5E7EB",
  },

  photoThumbCompact: {
    height: 180,
  },

  photoDoneBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },

  photoDoneBadgeText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 16,
  },

  photoOverlay: {
    position: "absolute",
    right: 10,
    bottom: 10,
  },

  photoOverlayButton: {
    minWidth: 56,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    backgroundColor: "rgba(17,24,39,0.78)",
    alignItems: "center",
    justifyContent: "center",
  },

  photoOverlayButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },

  photoEmpty: {
    width: "100%",
    height: 180,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1.2,
    borderColor: "#D8E0E8",
    borderStyle: "dashed",
    borderRadius: 18,
  },

  photoEmptyCompact: {
    width: "100%",
    height: 180,
  },

  photoEmptyIcon: {
    fontSize: 28,
    marginBottom: 10,
  },

  photoEmptyTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 4,
    letterSpacing: -0.1,
  },

  photoEmptyTitleCompact: {
    fontSize: 13,
    fontWeight: "800",
    color: "#111827",
  },

  photoSavedRow: {
    alignItems: "center",
    marginTop: 8,
    minHeight: 32,
    justifyContent: "center",
    width: "100%",
  },

  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },

  statusChipSuccess: {
    backgroundColor: "#DDF5E8",
  },

  statusChipText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.45,
    textTransform: "uppercase",
  },

  statusChipTextSuccess: {
    color: "#166534",
  },

  captureMiniBtn: {
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },

  captureMiniBtnText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.35,
  },

  inlineHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 10,
  },

  fieldLabelInline: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
  },

  fieldMeta: {
    fontSize: 12,
    fontWeight: "700",
    color: "#667085",
  },

  slotRowStatic: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },

  slotBtn: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1.2,
    borderColor: "#E1E5EA",
    backgroundColor: "#FAFAFA",
    alignItems: "center",
    justifyContent: "center",
  },

  slotText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#384152",
  },

  textArea: {
    backgroundColor: "#FCFCFD",
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    color: "#111827",
    minHeight: 84,
    textAlignVertical: "top",
    lineHeight: 19,
  },

  ctaBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -3 },
    elevation: 10,
    gap: 8,
  },

  submitBtn: {
    borderRadius: 20,
    paddingVertical: 18,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },

  submitText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },

  timerBadge: {
    backgroundColor: "#F3F4F6",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },

  timerText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#374151",
    letterSpacing: 0.5,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(12,16,24,0.62)",
    justifyContent: "center",
    padding: 18,
  },

  qualityAlertCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    padding: 24,
    marginHorizontal: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },

  qualityAlertIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "#FFF7E7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },

  qualityAlertIcon: {
    fontSize: 30,
  },

  qualityAlertTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 10,
    textAlign: "center",
  },

  qualityAlertBody: {
    fontSize: 14,
    lineHeight: 22,
    color: "#667085",
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 24,
  },

  qualityAlertBold: {
    fontWeight: "800",
    color: "#B45309",
  },

  qualityAlertActions: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },

  qualityKeepBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#F3F4F6",
  },

  qualityKeepBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#374151",
  },

  qualityRetakeBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
  },

  qualityRetakeBtnText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  photoStatusRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },

  photoStatusChip: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    paddingVertical: 8,
    alignItems: "center",
  },

  photoStatusChipText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#9CA3AF",
    letterSpacing: 0.3,
  },

  capturePhotosBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },

  capturePhotosBtnText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },

  // Camera modal
  cameraModalRoot: {
    flex: 1,
    backgroundColor: "#0D0D0D",
  },

  cameraModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },

  cameraModalBackBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },

  cameraModalBackText: {
    fontSize: 28,
    color: "#FFFFFF",
    fontWeight: "300",
  },

  cameraModalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },

  cameraTabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#2A2A2A",
  },

  cameraTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },

  cameraTabDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  cameraTabText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#6B7280",
    letterSpacing: 0.5,
  },

  cameraPreviewRow: {
    flex: 1,
    flexDirection: "row",
    margin: 16,
    gap: 8,
  },

  cameraPreviewArea: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    borderRadius: 20,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },

  cameraEmptyPreview: {
    alignItems: "center",
    gap: 12,
  },

  cameraEmptyIcon: {
    fontSize: 48,
  },

  cameraEmptyText: {
    fontSize: 14,
    color: "#6B7280",
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 22,
  },

  cameraControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 32,
    paddingBottom: 24,
    paddingTop: 8,
  },

  cameraControlSide: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "#3A3A3A",
    alignItems: "center",
    justifyContent: "center",
  },

  cameraControlSideText: {
    fontSize: 22,
    color: "#9CA3AF",
    fontWeight: "600",
  },

  cameraCaptureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },

  cameraCaptureInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },

  cameraRetakeBadge: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },

  cameraRetakeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },

  blurWarningOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.78)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },

  blurWarningIcon: {
    fontSize: 36,
  },

  blurWarningTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },

  blurWarningBody: {
    color: "#D1D5DB",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
  },

  blurRetakeBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: "center",
  },

  blurRetakeBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },

  blurWarningActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },

  blurKeepBtn: {
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.4)",
    alignItems: "center",
  },

  blurKeepBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },

  photoQualityBadgeWrap: {
    position: "absolute",
    top: 20,
    left: 0,
    right: 0,
    alignItems: "center",
  },

  photoQualityBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
    elevation: 6,
  },

  photoQualityBadgeLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 7,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 1,
  },

  photoQualityBadgePercent: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.5,
    lineHeight: 18,
  },

  zoomControls: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
  },

  zoomBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },

  zoomBtnText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 22,
  },

  zoomTrack: {
    flex: 1,
    width: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 2,
    overflow: "hidden",
    maxHeight: 120,
  },

  zoomFill: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 2,
  },

  modalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 14,
    overflow: "hidden",
    maxHeight: "85%",
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },

  modalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#161A25",
  },

  modalSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: "#667085",
    fontWeight: "600",
  },

  modalCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },

  modalCloseText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
  },

  modalImage: {
    width: "100%",
    height: 440,
    borderRadius: 14,
    backgroundColor: "#000",
  },

  modalFooter: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
  },

  modalGhostBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
    backgroundColor: "#F3F4F6",
  },

  modalGhostBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#374151",
  },

  modalPrimaryBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
  },

  modalPrimaryBtnText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  prModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },

  alertModalCard: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },

  alertModalSuccessIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#ECFDF5",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 2,
    borderColor: "#A7F3D0",
  },

  alertModalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#0F172A",
    marginBottom: 8,
    textAlign: "center",
  },

  alertModalText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#64748B",
    textAlign: "center",
    lineHeight: 20,
  },

  alertModalBtnFull: {
    marginTop: 24,
    width: "100%",
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#0B7A5A",
    alignItems: "center",
  },

  alertModalBtnFullText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },

  // ── Pole Session Card ──────────────────────────────────────────────────
  poleSessionGate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  poleSessionGateIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#ECFDF5",
    borderWidth: 1.5,
    borderColor: "#A7F3D0",
    alignItems: "center",
    justifyContent: "center",
  },
  poleSessionGateTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 2,
  },
  poleSessionGateSub: {
    fontSize: 11,
    fontWeight: "500",
    color: "#6B7280",
    lineHeight: 16,
  },
  poleSessionStartBtn: {
    backgroundColor: "#0B7A5A",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: "#0B7A5A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  poleSessionStartBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },

  poleSessionActive: {
    gap: 10,
  },
  poleSessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  poleSessionDuration: {
    flex: 1,
    fontSize: 22,
    fontWeight: "900",
    color: "#0B7A5A",
    letterSpacing: -0.5,
  },
  poleSessionActiveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#ECFDF5",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  poleSessionActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#059669",
  },
  poleSessionActiveBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#065F46",
  },
  poleSessionMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  poleSessionMetaLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94A3B8",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  poleSessionMetaValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#374151",
  },
});
