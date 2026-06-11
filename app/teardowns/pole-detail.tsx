import api from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getDisplayTime, getPHTNow } from "@/lib/display-time";
import { simpleQueuePush } from "@/lib/simple-queue";
import { imageQueuePush, persistImage } from "@/lib/sync-queue";
import { pingNow } from "@/lib/location-tracker";
import { gpsQueueGet } from "@/lib/gps-queue";
import * as FileSystem from "expo-file-system/legacy";
import { Image as ExpoImage } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import * as MediaLibrary from "expo-media-library";
import { Stack, router, useFocusEffect, useLocalSearchParams, usePathname } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
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
import { buildPoleMapHtml, StaticTileMap, STAMP_HTML } from "./components";
import { captureEvents } from "@/lib/capture-events";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

type PhotoField = {
  uri: string;
  fileUri: string;
  name: string;
  type: string;
  version: number;
} | null;

type GpsDraft = {
  lat: number;
  lng: number;
  capturedAt: string;
};

type SpanPoleRef = {
  id: number;
  pole?: { id: number; pole_code: string } | null;
} | null;

type Span = {
  id: number;
  span_code: string | null;
  strand_length: number;
  number_of_runs: number;
  status?: string;
  from_pole: SpanPoleRef;
  to_pole: SpanPoleRef;
  components?: { component_type: string; expected_count: number }[];
};

function getExpected(span: Span, type: string) {
  return span.components?.find((c) => c.component_type === type)?.expected_count ?? 0;
}

const SLOTS = ["DA", "C1", "C2", "C3", "C4", "C5"] as const;
const REQUIRED_GPS_ACCURACY_METERS = 10;
// TEMP: GPS capture + 50m proximity requirements disabled for testing — re-enable before production
const DEV_SKIP_GPS_CHECKS = true;

// ── Pole Report constants ────────────────────────────────────────────────────
const POLE_CONDITIONS = ["good", "fair", "poor", "critical", "replaced"] as const;
const POLE_MATERIALS  = ["wood", "concrete", "steel", "composite", "fiberglass"] as const;
const POLE_HEIGHTS    = ["20 ft", "25 ft", "30 ft", "35 ft", "40 ft", "45 ft", "50 ft", "55 ft", "60 ft", "70 ft", "80 ft"] as const;
const ATTACH_SLOT_TYPES = ["C1", "C2", "C3", "C4", "C5"] as const;
const SLOT_OWNERS     = ["PLDT", "Globe", "Converge", "Sky", "DITO", "Others"] as const;
const CABLE_TYPES     = ["fiber-optic", "copper", "coaxial", "messenger wire", "service drop wire", "others"] as const;
const EQUIPMENT_TYPES = ["fiber optic splice box", "amplifier", "node box", "splitter", "repeater", "power supply", "others"] as const;
const ACCESSORY_TYPES = ["pole clamps", "bolts", "lashing wire", "cable ties", "grounding rod", "dead-end clamp", "others"] as const;

type CableItem = {
  tempId: string;
  cable_type: string;
  runs: number;
  extracted: boolean;
};
type AttachmentItem = {
  tempId: string;
  item_type: string;
  quantity: number;
  unit: string;
};
type PoleSlot = {
  tempId: string;
  slot_type: string;
  owner: string;
  cables: CableItem[];
  equipment: AttachmentItem[];
  accessories: AttachmentItem[];
  expanded: boolean;
};


function sanitize(s?: string) {
  return (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "_");
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

function staticMapUrl(lat: number, lng: number) {
  const w = Math.round(SCREEN_W * 0.35 * 2);
  const h = Math.round(SCREEN_H * 0.22 * 2);
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=16&size=${w}x${h}&markers=${lat},${lng},red`;
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

function PhotoTile({
  label,
  photo,
  accentColor,
  onCapture,
  onView,
  disabled,
  locked,
}: {
  label: string;
  photo: PhotoField;
  accentColor: string;
  onCapture: () => void;
  onView: () => void;
  disabled?: boolean;
  locked?: boolean;
}) {
  const isDisabled = disabled || locked;
  return (
    <Pressable
      style={[
        styles.photoTileCard,
        photo ? { borderColor: locked ? "#DC2626" : accentColor } : {},
        isDisabled && !locked && { opacity: 0.45 },
      ]}
      onPress={locked ? (photo ? onView : undefined) : isDisabled ? undefined : photo ? onView : onCapture}
      disabled={!locked && isDisabled}
    >
      <View style={styles.photoTileImgWrap}>
        {photo ? (
          <>
            <ExpoImage
              key={photo.version}
              source={{ uri: photo.uri }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              cachePolicy="none"
              transition={100}
            />
            {/* Lock overlay — view only, no retake */}
            {locked ? (
              <View style={{ position: "absolute", inset: 0, backgroundColor: "rgba(220,38,38,0.18)", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 20 }}>🔒</Text>
              </View>
            ) : (
              <View style={styles.photoViewHint}>
                <Text style={styles.photoViewHintText}>VIEW</Text>
              </View>
            )}
          </>
        ) : locked ? (
          <View style={[styles.photoTilePlaceholder, { backgroundColor: "#FEF2F2" }]}>
            <Text style={{ fontSize: 20 }}>🔒</Text>
            <Text style={[styles.photoTileTapText, { color: "#DC2626", fontSize: 9 }]}>LOCKED</Text>
          </View>
        ) : (
          <View style={styles.photoTilePlaceholder}>
            <Text style={styles.photoTileCameraIcon}>📷</Text>
            <Text style={styles.photoTileTapText}>Tap to capture</Text>
          </View>
        )}
      </View>
      {/* Label + status row */}
      <View style={styles.photoTileLabelRow}>
        <Text style={[styles.photoTileLabel, photo ? { color: locked ? "#DC2626" : accentColor } : {}]}>
          {label.toUpperCase()}
        </Text>
        {locked ? (
          <View style={{ backgroundColor: "#DC2626", borderRadius: 99, paddingHorizontal: 5, paddingVertical: 2 }}>
            <Text style={{ color: "#fff", fontSize: 7, fontWeight: "900" }}>LOCKED</Text>
          </View>
        ) : photo ? (
          <View style={[styles.photoTileCheck, { backgroundColor: accentColor }]}>
            <Text style={styles.photoTileCheckText}>✓</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
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

export function PoleDetailScreen() {
    const pathname = usePathname();
	  const {
	    pole_id,
	    pole_row_id,
	    pole_code,
	    pole_name,
	    node_id,
	    node_code,
	    node_name,
    project_id,
    project_name,
    accent,
    report_type,
    sitemap_lat,
    sitemap_lng,
    batch_before_capture,
    auto_capture_tab,
    return_to_map,
    return_to_poles,
	  } = useLocalSearchParams<{
	    pole_id: string;
	    pole_row_id?: string;
	    pole_code: string;
	    pole_name: string;
	    node_id: string;
	    node_code: string;
	    node_name: string;
	    project_id: string;
	    project_name: string;
	    accent: string;
	    report_type: string;
	    sitemap_lat: string;
	    sitemap_lng: string;
    batch_before_capture?: string;
    auto_capture_tab?: string;
    return_to_map?: string;
    return_to_poles?: string;
	  }>();

  const isPoleReport = report_type === "pole_report" || pathname.includes("/teardowns/pole-report");
  const isBatchBeforeCaptureMode = batch_before_capture === "1";
  const shouldReturnToMapAfterCapture = return_to_map === "1";
  const shouldReturnToPoles = return_to_poles === "1";

  const accentColor = accent || "#0B7A5A";

  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [gpsCapturedAt, setGpsCapturedAt] = useState("");
  // Before photo lock — set from backend when GET /skycable/poles/:id/photos returns locked:true
  // Backend team controls this flag to allow/disallow re-capture of before photo
  // Lock immediately if this pole was batch-before captured before (cache key check)
  const [beforeLocked, setBeforeLocked] = useState(false);
  // Upload feedback: "uploaded" | "queued" | null
  const [batchUploadStatus, setBatchUploadStatus] = useState<"uploaded" | "queued" | null>(null);
  useEffect(() => {
    if (!pole_id) return;
    cacheGet<string>(`photo_captured_at_${pole_id}_before`).then(hit => {
      if (hit) setBeforeLocked(true);
    }).catch(() => {});
  }, [pole_id]);

  // true = GPS came from sitemap APK (valid, no re-capture needed)
  const [gpsFromSitemap, setGpsFromSitemap] = useState(false);
  const [gpsConfirmModal, setGpsConfirmModal] = useState(false);
  const [gpsSuccessModal, setGpsSuccessModal] = useState(false);
  const [poleLoading, setPoleLoading] = useState(true);
  const [gpsCapturing, setGpsCapturing] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const prewarmedGps = useRef<{
    latitude: number;
    longitude: number;
    accuracy: number | null;
  } | null>(null);
  const [liveCoords, setLiveCoords] = useState<{ lat: number; lng: number } | null>(null);
  const locationWatcher = useRef<Location.LocationSubscription | null>(null);
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");

  const [editedPoleName, setEditedPoleName] = useState(pole_name ?? "");
  const [editNameModalOpen, setEditNameModalOpen] = useState(false);
  const [editNameDraft, setEditNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [photoBefore, setPhotoBefore] = useState<PhotoField>(null);
  const [photoAfter, setPhotoAfter] = useState<PhotoField>(null);
  const [photoTag, setPhotoTag] = useState<PhotoField>(null);
  const [qualityBefore, setQualityBefore] = useState<number | null>(null);
  const [qualityAfter, setQualityAfter] = useState<number | null>(null);
  const [qualityTag, setQualityTag] = useState<number | null>(null);

  const [slot, setSlot] = useState("");
  const [landmark, setLandmark] = useState("");
  const [spans, setSpans] = useState<Span[]>([]);

  // ── Pole Report state ──────────────────────────────────────────────────────
  const [poleCondition, setPoleCondition] = useState("");
  const [poleMaterial, setPoleMaterial] = useState("");
  const [poleHeight, setPoleHeight] = useState("");
  const [poleNotes, setPoleNotes] = useState("");
  const [poleSlots, setPoleSlots] = useState<PoleSlot[]>([]);
  const [submittingReport, setSubmittingReport] = useState(false);
  const [submitSuccessOpen, setSubmitSuccessOpen] = useState(false);
  const [submitSuccessTime, setSubmitSuccessTime] = useState("");
	  const draftMountedRef = useRef(false);
	  // (Pole report draft autosave removed.)
  // Add-slot modal
  const [addSlotOpen, setAddSlotOpen] = useState(false);
  const [addSlotType, setAddSlotType] = useState("C1");
  const [addSlotOwner, setAddSlotOwner] = useState("Others");
  // Generic picker modal (cable/equip/accy type selection)
  const [pickerModal, setPickerModal] = useState<{
    options: readonly string[];
    current: string;
    onSelect: (v: string) => void;
  } | null>(null);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerLabel, setViewerLabel] = useState("");
  const [viewerTab, setViewerTab] = useState<"before" | "after" | "tag" | null>(null);
  const [viewerRetake, setViewerRetake] = useState<(() => void) | null>(null);
  const viewerPhoto =
    viewerTab === "before" ? photoBefore :
    viewerTab === "after"  ? photoAfter  :
    viewerTab === "tag"    ? photoTag    :
    null;

  // ── Teardown gate ──────────────────────────────────────────────────────────
  const teardownStartedKey = `teardown_started_${pole_id}`;
  const [teardownStarted, setTeardownStarted] = useState(false);
  const [poleStartedAt, setPoleStartedAt]     = useState<string | null>(null);
  const [afterCapturedAt, setAfterCapturedAt] = useState<string | null>(null);
  const [poleFinishedAt, setPoleFinishedAt]   = useState<string | null>(null);
  const [startingPole, setStartingPole]       = useState(false);
  const [gateAlertModal, setGateAlertModal]   = useState<{ title: string; message: string } | null>(null);


  // Prevents double auto-navigation to select-pair when pole is already done
  const autoNavigatedToSpanRef = useRef(false);
  // Work timer — only counts after Start Teardown is pressed
  const timerStartRef = useRef<number | null>(null);
  const blurCheckRef = useRef<WebView>(null);
  const blurResolverRef = useRef<((variance: number) => void) | null>(null);
  const stampRef = useRef<WebView>(null);
  const stampResolverRef = useRef<((b64: string | null) => void) | null>(null);
  // Stores the last stamp payload so it can be re-injected when the WebView restarts
  const lastStampPayloadRef = useRef<string | null>(null);
  // Pre-loaded map tile cache — populated as soon as GPS is available so
  // stamping is instant (no network call during photo processing).
  const mapTileCache = useRef<StampMapResult | null>(null);
  const gpsWarmKeyRef = useRef("");
  const gpsWarmPromiseRef = useRef<Promise<void> | null>(null);
  const captureMapPrefetchedRef = useRef(false);
  const captureReturnKey = `__pole_capture_${pole_id}`;
  // Timestamp of the last fresh capture — draft loader skips overwriting for 3s after a capture
  const lastFreshCaptureRef = useRef(0);

  // Instant card update via event emitter — fires before navigation animation starts
  useEffect(() => {
    return captureEvents.on((result) => {
      if (result.ownerType !== "pole-detail" || String(result.ownerPoleId) !== String(pole_id ?? "")) return;
      const tab  = result.tab;
      const setter = tab === "before" ? setPhotoBefore : tab === "after" ? setPhotoAfter : setPhotoTag;
      const file   = tab === "before" ? `pole_${pole_id}_before.jpg`
                   : tab === "after"  ? `pole_${pole_id}_after.jpg`
                                      : `pole_${pole_id}_poletag.jpg`;
      lastFreshCaptureRef.current = Date.now();
      setter(createPhotoField(result.uri, file));
    });
  }, [pole_id]);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  useEffect(() => {
    if (!teardownStarted || timerStartRef.current === null || poleFinishedAt) return;
    const startTime = timerStartRef.current;
    const id = setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [teardownStarted, poleFinishedAt]);

  // Draft recovery

  const projFolder = sanitize(project_name);
  const draftDir = `${FileSystem.documentDirectory}pole_drafts/${projFolder}/${node_id ?? "node"}/${pole_id}/`;
  const gpsDraftKey = `pole_gps_${pole_id}`;
  const F = {
    before: `pole_${pole_id}_before.jpg`,
    after: `pole_${pole_id}_after.jpg`,
    tag: `pole_${pole_id}_poletag.jpg`,
  };

  const setGpsDraftState = useCallback((draft: GpsDraft) => {
    setLat(draft.lat);
    setLng(draft.lng);
    setGpsCapturedAt(draft.capturedAt);
  }, []);

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
          prewarmedGps.current = loc.coords;
          setLiveCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          setGpsAccuracy(Math.round(loc.coords.accuracy ?? 999));
        },
      );

      if (mounted) {
        locationWatcher.current = sub;
      } else {
        sub.remove();
      }
    })();

    return () => {
      mounted = false;
      locationWatcher.current?.remove();
      locationWatcher.current = null;
    };
  }, []);

  useEffect(() => {
    if (slot) cacheSet(`draft_slot_${pole_id}`, slot).catch(() => {});
  }, [slot, pole_id]);

  useEffect(() => {
    if (landmark) cacheSet(`draft_landmark_${pole_id}`, landmark).catch(() => {});
  }, [landmark, pole_id]);

	  useEffect(() => {
	    // Restore teardown started state.
	    cacheGet<{ startedAt: string; startMs?: number }>(teardownStartedKey).then(async v => {
      // If backend reset this pole to 'pending' (e.g. new span added), clear local started-cache
      // so the Start button shows again even if we previously started it.
      if (v?.startedAt && node_id) {
        try {
          const polesList = await cacheGet<any[]>(`sitemap_poles_${node_id}`);
          const match = polesList?.find((p) => String(p.pole_id) === String(pole_id));
          if (match?.pole?.skycable_status === 'pending') {
            await cacheSet(teardownStartedKey, null).catch(() => {});
            return; // fall through to show Start button
          }
        } catch {}
      }

      if (v?.startedAt) {
        setTeardownStarted(true);
        setPoleStartedAt(v.startedAt);
        const baseMs = v.startMs || new Date(v.startedAt).getTime();
        timerStartRef.current = baseMs;

        // Check if already finished
        cacheGet<string>(`teardown_finished_${pole_id}`).then(async finishedTs => {
          if (finishedTs) {
            setPoleFinishedAt(finishedTs);
            const delta = Math.floor((new Date(finishedTs).getTime() - baseMs) / 1000);
            setElapsedSecs(Math.max(0, delta));

            // No auto-redirect — stay on pole detail so the user can review without being forced to span selection.
          } else {
            setElapsedSecs(Math.max(0, Math.floor((Date.now() - baseMs) / 1000)));
          }
        }).catch(() => {
          setElapsedSecs(Math.max(0, Math.floor((Date.now() - baseMs) / 1000)));
        });

	      } else if (node_id) {
	        // Pole was previously visited as a DESTINATION pole — inherit its date_start
	        // from the sitemap cache so the "Start Pole Teardown" gate doesn't re-appear.
	        const polesList = await cacheGet<any[]>(`sitemap_poles_${node_id}`).catch(() => null);
        const match = polesList?.find((p) => String(p.pole_id) === String(pole_id));
        if (match?.date_start) {
          const startedAt = match.date_start;
          const startMs = new Date(startedAt).getTime();
          setTeardownStarted(true);
          setPoleStartedAt(startedAt);
          timerStartRef.current = startMs;
          setElapsedSecs(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
          await cacheSet(teardownStartedKey, { startedAt, startMs }).catch(() => {});
        }
      }
    }).catch(() => {});

    // Restore after-photo captured timestamp
    cacheGet<string>(`photo_captured_at_${pole_id}_after`).then(v => {
      if (v) setAfterCapturedAt(v);
    }).catch(() => {});

    cacheGet<GpsDraft>(gpsDraftKey)
      .then(async (cached) => {
        if (cached?.lat && cached?.lng) {
          setGpsDraftState(cached);
          setPoleLoading(false);
          return;
        }

        const queued = await gpsQueueGet(pole_id);
        if (queued?.lat && queued?.lng) {
          setGpsDraftState({
            lat: queued.lat,
            lng: queued.lng,
            capturedAt: "",
          });
          return;
        }

        // Pre-seed from the poles list cache so the map shows immediately
        // without waiting for the /poles/:id API response
        if (node_id) {
          const polesList = await cacheGet<any[]>(`sitemap_poles_${node_id}`).catch(() => null);
          const match = polesList?.find((p) => String(p.pole_id) === String(pole_id));
          if (match?.pole?.lat && match?.pole?.lng) {
            const pLat = parseFloat(match.pole.lat);
            const pLng = parseFloat(match.pole.lng);
            setLat(pLat);
            setLng(pLng);
            setGpsFromSitemap(true);
            // Pre-load map tile in background as soon as GPS is known
            fetchMapTileB64(pLat, pLng)
              .then(r => { if (r) mapTileCache.current = r; })
              .catch(() => {});
          }
        }
      })
      .catch(() => {});

    cacheGet<string>(`draft_slot_${pole_id}`)
      .then((v) => {
        if (v) setSlot(v);
      })
      .catch(() => {});

    cacheGet<string>(`draft_landmark_${pole_id}`)
      .then((v) => {
        if (typeof v === "string") setLandmark(v);
      })
      .catch(() => {});

    const SPANS_KEY = `spans_pole_${pole_id}`;
    if (!isPoleReport) cacheGet<Span[]>(SPANS_KEY).then((cached) => {
      if (cached?.length) {
        setSpans(cached);
        return; // Skip background fetch if we have cache
      }

      api
        .get(`/skycable/spans?node_id=${node_id}`)
        .then(({ data }) => {
          const all: Span[] = Array.isArray(data) ? data : (data?.data ?? []);
          // Cross-cache spans for every pole in the node so vice-versa works without extra API calls
          const poleIdsInNode = new Set<string>();
          all.forEach(s => {
            if (s.from_pole?.pole?.id) poleIdsInNode.add(String(s.from_pole.pole.id));
            if (s.to_pole?.pole?.id)   poleIdsInNode.add(String(s.to_pole.pole.id));
          });
          poleIdsInNode.forEach(pid => {
            const pSpans = all.filter(s =>
              String(s.from_pole?.pole?.id) === pid ||
              String(s.to_pole?.pole?.id)   === pid,
            );
            if (pSpans.length > 0) cacheSet(`spans_pole_${pid}`, pSpans).catch(() => {});
          });
          const list = all.filter(
            (s) =>
              String(s.from_pole?.pole?.id) === String(pole_id) ||
              String(s.to_pole?.pole?.id) === String(pole_id),
          );
          setSpans(list);
        })
        .catch(() => {});
    });

    api
      .get(`/poles/${pole_id}`)
      .then(({ data }) => {
        const d = data?.data ?? data;

        if (d?.slot) setSlot(d.slot);
        if (typeof d?.remarks === "string") setLandmark(d.remarks);

        if (d?.map_latitude && d?.map_longitude) {
          const draft: GpsDraft = {
            lat: Number(d.map_latitude),
            lng: Number(d.map_longitude),
            capturedAt:
              d.gps_captured_at || d.map_captured_at || d.updated_at || "",
          };
          setGpsDraftState(draft);
          cacheSet(gpsDraftKey, draft).catch(() => {});
          // Only mark as sitemap if capturedAt is empty (not a device capture)
          if (!d.gps_captured_at) setGpsFromSitemap(true);
        }

        setPoleLoading(false);
      })
      .catch(() => {
        setPoleLoading(false);
      });

    (async () => {
      const dirInfo = await FileSystem.getInfoAsync(draftDir);
      if (!dirInfo.exists) return;

      const load = async (file: string): Promise<PhotoField | null> => {
        const cleanPath = draftDir + file;
        const info = await FileSystem.getInfoAsync(cleanPath);
        if (!info.exists) return null;
        const viewPath = cleanPath.replace(/\.jpg$/i, "_view.jpg");
        const viewInfo = await FileSystem.getInfoAsync(viewPath).catch(() => ({ exists: false }));
        const chosenPath = (viewInfo as any).exists ? viewPath : cleanPath;
        const version = Date.now();
        return {
          uri: `${chosenPath}?v=${version}`,
          // Use stamped view for upload (matches what the lineman sees in-gallery)
          fileUri: chosenPath,
          name: file,
          type: "image/jpeg",
          version,
        };
      };

      const [pb, pa, pt] = await Promise.all([
        load(F.before),
        load(F.after),
        load(F.tag),
      ]);

      if (pb) setPhotoBefore(pb);
      if (pa) setPhotoAfter(pa);
      if (pt) setPhotoTag(pt);

      // Fetch backend photos — fills in photos from other linesmen + applies lock
      // GET /teardown/pole-images/:pole_id?inventory_type=skycable
      api.get(`/teardown/pole-images/${pole_id}?inventory_type=skycable`).then((res: any) => {
        const backendPhotos: { image_type: string; image_url: string; locked?: boolean }[] =
          Array.isArray(res?.data) ? res.data : (res?.data?.data ?? []);

        const bBefore = backendPhotos.find(p => p.image_type === "before");
        const bAfter  = backendPhotos.find(p => p.image_type === "after");
        const bTag    = backendPhotos.find(p => p.image_type === "pole_tag");

        // Backend is authoritative — overrides the cache check on mount.
        // locked=true  → lineman cannot retake (batch before upload, default)
        // locked=false → backend admin explicitly unlocked via PATCH /unlock
        if (bBefore) setBeforeLocked(bBefore.locked !== false);
        else setBeforeLocked(false); // backend has no before photo → not locked

        // Download backend photos to local pole_drafts so components.tsx can re-upload
        // them with a report_id during full teardown submission (prevents dead links in logs)
        const downloadToDraft = async (
          img: { image_url: string },
          fileName: string,
          setter: (fn: (prev: PhotoField) => PhotoField) => void,
        ) => {
          if (!img.image_url) return;
          try {
            await FileSystem.makeDirectoryAsync(draftDir, { intermediates: true }).catch(() => {});
            const dest = draftDir + fileName;
            const existing = await FileSystem.getInfoAsync(dest);
            if (!existing.exists) {
              await FileSystem.downloadAsync(img.image_url, dest);
            }
            const version = Date.now();
            setter(prev => prev ?? { uri: `${dest}?v=${version}`, fileUri: dest, name: fileName, type: "image/jpeg", version });
          } catch {
            // Fallback: display-only from backend URL (won't be re-uploadable)
            setter(prev => prev ?? createPhotoField(img.image_url, fileName));
          }
        };

        if (bBefore) downloadToDraft(bBefore, F.before, setPhotoBefore as any);
        if (bAfter)  downloadToDraft(bAfter,  F.after,  setPhotoAfter  as any);
        if (bTag)    downloadToDraft(bTag,    F.tag,    setPhotoTag    as any);
      }).catch(() => {});

      const [qb, qa, qt] = await Promise.all([
        cacheGet<number>(`pole_quality_before_${pole_id}`),
        cacheGet<number>(`pole_quality_after_${pole_id}`),
        cacheGet<number>(`pole_quality_tag_${pole_id}`),
      ]);
      if (pb && qb != null) setQualityBefore(qb);
      if (pa && qa != null) setQualityAfter(qa);
      if (pt && qt != null) setQualityTag(qt);
    })();

    cacheGet<string>(`draft_pole_name_${pole_id}`)
      .then((v) => { if (v) setEditedPoleName(v); })
      .catch(() => {});

	    // Pole report draft mount marker
	    draftMountedRef.current = true;
	  }, [
    pole_id,
    node_id,
    teardownStartedKey,
    gpsDraftKey,
    draftDir,
    F.after,
    F.before,
    F.tag,
    setGpsDraftState,
  ]);

  // Reload photos from disk each time this screen comes into focus.
  // Catches: stale in-memory photo URIs when files were deleted after submission,
  // and ensures correct photos show when navigating back to a previously-visited pole.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      (async () => {
        const loadFile = async (file: string): Promise<PhotoField> => {
          const cleanPath = draftDir + file;
          const info = await FileSystem.getInfoAsync(cleanPath).catch(() => null);
          if (!(info as any)?.exists) return null;
          const viewPath = cleanPath.replace(/\.jpg$/i, "_view.jpg");
          const viewInfo = await FileSystem.getInfoAsync(viewPath).catch(() => ({ exists: false }));
          const chosenPath = (viewInfo as any).exists ? viewPath : cleanPath;
          const version = Date.now();
          return {
            uri: `${chosenPath}?v=${version}`,
            fileUri: chosenPath,
            name: file,
            type: "image/jpeg",
            version,
          };
        };

        // Skip overwrite if a fresh capture just happened (race guard)
        if (Date.now() - lastFreshCaptureRef.current < 3000) return;

        const [pb, pa, pt] = await Promise.all([
          loadFile(F.before),
          loadFile(F.after),
          loadFile(F.tag),
        ]);

        if (cancelled) return;

        setPhotoBefore(pb);
        setPhotoAfter(pa);
        setPhotoTag(pt);
              })();

      return () => { cancelled = true; };
    }, [draftDir, F.before, F.after, F.tag]),
  );

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
      if (data.ready) {
        // WebView reloaded (happens when navigating to/from capture.tsx on Android).
        // Re-inject the pending payload so the stamp completes instead of timing out.
        if (stampResolverRef.current && lastStampPayloadRef.current) {
          const p = lastStampPayloadRef.current;
          stampRef.current?.injectJavaScript(
            `(function(){document.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(p)}}));})();true;`
          );
        }
        return;
      }
      if (!stampResolverRef.current) return;
      stampResolverRef.current(data.stamped ?? null);
      stampResolverRef.current = null;
      lastStampPayloadRef.current = null;
    } catch {}
  }

  function buildStampLines(tab: "before" | "after" | "tag"): string[] {
    const name = editedPoleName || pole_name || pole_code || "";
    const tabLabel = tab === "before" ? "BEFORE" : tab === "after" ? "AFTER" : "POLE TAG";
    // Use server-synced PHT time — cannot be spoofed by changing device clock
    const phtIso = getPHTNow(); // "2026-05-19T23:34:50+08:00"
    const [datePart, timeRaw] = phtIso.substring(0, 19).split("T");
    const [yr, mo, dy] = datePart.split("-").map(Number);
    const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const dateTimeLine = `${MON[mo - 1]} ${dy}, ${yr}  ${timeRaw}`;
    const lines: string[] = [dateTimeLine];
    if (street) lines.push(street);
    const cityProv = [city, province].filter(Boolean).join(", ");
    if (cityProv) lines.push(cityProv);
    if (lat != null && lng != null) {
      const latStr = `${Math.abs(lat).toFixed(6)}\u00b0 ${lat >= 0 ? "N" : "S"}`;
      const lngStr = `${Math.abs(lng).toFixed(6)}\u00b0 ${lng >= 0 ? "E" : "W"}`;
      lines.push(`${latStr}  ${lngStr}`);
    }
    lines.push(`${name}  (${tabLabel})`);
    const nodeLabel = node_name || node_code || node_id || "";
    if (nodeLabel) lines.push(`Node: ${nodeLabel}`);
    return lines;
  }

  /** Returns tile URL + exact fractional position (0-1) of the GPS point within the tile. */
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
      dotX: xFrac - tileX,   // 0 = left edge of tile, 1 = right edge
      dotY: yFrac - tileY,   // 0 = top edge of tile, 1 = bottom edge
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

          // Try CARTO subdomains first, then fall back to standard OSM tiles.
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
            const tmp = `${FileSystem.cacheDirectory}maptile_${Date.now()}_${dx}_${dy}_${attempt}.png`;
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

  async function stampPhoto(uri: string, lines: string[], lat?: number | null, lng?: number | null): Promise<string> {
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" as any });
      // Use pre-loaded tile cache (filled when GPS was captured) — no network wait
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
          lastStampPayloadRef.current = null;
          resolve(uri);
        }, 15000);
        stampResolverRef.current = (result: string | null) => {
          clearTimeout(timer);
          lastStampPayloadRef.current = null;
          if (!result) { resolve(uri); return; }
          const tmp = `${FileSystem.cacheDirectory}stamp_${Date.now()}.jpg`;
          FileSystem.writeAsStringAsync(tmp, result, { encoding: "base64" as any })
            .then(() => resolve(tmp))
            .catch(() => resolve(uri));
        };
        // Store payload so handleStampMessage can re-inject if WebView restarts mid-stamp
        lastStampPayloadRef.current = payload;
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

    // ── Clean version → disk, used for backend upload ──
    const dest = draftDir + fileName;
    const existing = await FileSystem.getInfoAsync(dest);
    if (existing.exists) await FileSystem.deleteAsync(dest, { idempotent: true });
    await FileSystem.copyAsync({ from: compressed, to: dest });

    // ── Stamped version → _view file on disk + gallery (display + lineman backup) ──
    let displayUri = dest; // UI display (may be a temp file to avoid Android stale file:// cache)
    let uploadUri = dest;  // stable on-disk URI for backend + draft restore
    if (stampLines?.length) {
      const stamped = await stampPhoto(compressed, stampLines, gpsLat, gpsLng);
      const viewDest = dest.replace(/\.jpg$/i, "_view.jpg");
      const viewExisting = await FileSystem.getInfoAsync(viewDest);
      if (viewExisting.exists) await FileSystem.deleteAsync(viewDest, { idempotent: true });
      await FileSystem.copyAsync({ from: stamped, to: viewDest });
      uploadUri = viewDest;
      // Important: after a retake we overwrite the same *_view.jpg file.
      // Some Android image pipelines keep showing the old bytes until the screen remounts.
      // Using the freshly created stamped temp file for UI display avoids the stale-cache issue.
      displayUri = stamped;
      // Save stamped copy to device gallery (lineman backup)
      MediaLibrary.requestPermissionsAsync(true)
        .then(({ status }) => {
          if (status === "granted") MediaLibrary.saveToLibraryAsync(stamped).catch(() => {});
        })
        .catch(() => {});
    }

    const version = Date.now();
    return {
      uri: `${displayUri}?v=${version}`,  // stamped view for display
      fileUri: uploadUri,                   // stable stamped file for backend upload to preserve visual audits
      name: fileName,
      type: "image/jpeg",
      version,
    };
  }

  async function captureFromCamera() {
    if (!cameraRef.current || !cameraReady || photoCapturing) return;
    if (isCapturingRef.current) return; // prevent rapid double-tap
    isCapturingRef.current = true;
    setPhotoCapturing(true);

    // ── Distance check using already-warmed GPS (no blocking network call) ──
    // The background watcher updates prewarmedGps every 2s — use it directly.
    if (lat !== null && lng !== null && prewarmedGps.current) {
      const live = prewarmedGps.current;
      setLiveCoords({ lat: live.latitude, lng: live.longitude });
      const dist = computeDistanceMeters(lat, lng, live.latitude, live.longitude);
      if (!DEV_SKIP_GPS_CHECKS && dist > 50) {
        setOutOfAreaAlert({ visible: true, distance: dist });
        isCapturingRef.current = false;
        setPhotoCapturing(false);
        return;
      }
    }

    setBlurWarning(false);
    try {
      // skipProcessing:true = instant capture; we compress + stamp ourselves below
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.92,
        skipProcessing: true,
        exif: false,
      });
      if (!photo?.uri) {
        isCapturingRef.current = false;
        setPhotoCapturing(false);
        return;
      }

      const capturedAt   = getPHTNow();
      const tab          = activeCameraTab;
      const setter       = tab === "before" ? setPhotoBefore : tab === "after" ? setPhotoAfter : setPhotoTag;
      const qualitySetter= tab === "before" ? setQualityBefore : tab === "after" ? setQualityAfter : setQualityTag;
      const file         = tab === "before" ? F.before : tab === "after" ? F.after : F.tag;

      // ── Show raw photo immediately so the user sees it right away ──
      // Stamp a generation number so the background can be cancelled if
      // the user taps "Retake" before processing finishes.
      const thisGen = ++captureGenRef.current;
      setter(createPhotoField(photo.uri, file));
      // Set cache key immediately so poles.tsx fast-pass detects it before IIFE finishes
      cacheSet(`photo_captured_at_${pole_id}_${tab}`, capturedAt).catch(() => {});
      // Release the capture lock now — user can interact again
      setTimeout(() => {
        isCapturingRef.current = false;
        setPhotoCapturing(false);
      }, 400);

      // ── Stamp + save + quality check in background (non-blocking) ──
      (async () => {
        try {
          const saved = await savePhotoDraft(file, photo.uri, buildStampLines(tab), lat, lng);
          // Abort if user already retook or cleared the photo
          if (captureGenRef.current !== thisGen) return;
          setter(saved);
          // Cache key already set above — no-op here but keep for completeness
          cacheSet(`photo_captured_at_${pole_id}_${tab}`, capturedAt).catch(() => {});

          if (tab === "after") {
            setAfterCapturedAt(capturedAt);
            api.put(`/skycable/nodes/${node_id}/poles/${pole_id}`, {
              cleared_at: capturedAt,
            }).catch(() => {});
          }

          // Batch before mode — push status + upload photo to backend immediately
          if (tab === "before" && isBatchBeforeCaptureMode) {
            api.put(`/skycable/nodes/${node_id}/poles/${pole_row_id}`, {
              date_start: capturedAt,
            }).catch(() => {});
            api.put(`/skycable/poles/${pole_id}`, {
              skycable_status: "in_progress",
            }).catch(() => {});
            // Upload to backend — queue for retry if offline
            const batchBeforeUpload = async () => {
              const form = new FormData();
              form.append("pole_id",        String(pole_id));
              form.append("pole_code",      String(pole_code));
              form.append("node_id",        String(node_id));
              form.append("image_type",     "before");
              form.append("inventory_type", "skycable");
              form.append("lock",           "1");
              form.append("image", { uri: saved.fileUri, name: "before.jpg", type: "image/jpeg" } as any);
              try {
                await api.post("/teardown/upload-image", form);
                setBatchUploadStatus("uploaded");
                setTimeout(() => setBatchUploadStatus(null), 3000);
              } catch (err: any) {
                const httpStatus = (err as any)?.response?.status;
                if (!httpStatus || httpStatus >= 500) {
                  const persistedUri = await persistImage(saved.fileUri, `batch_before_${pole_id}.jpg`).catch(() => saved.fileUri);
                  await imageQueuePush([{
                    reportLocalId: `batch_before_${pole_id}`,
                    fieldName: "before",
                    uri: persistedUri,
                    meta: { pole_id: String(pole_id), pole_code: String(pole_code), node_id: String(node_id), image_type: "before", lock: "1" },
                  }]).catch(() => {});
                  setBatchUploadStatus("queued");
                  setTimeout(() => setBatchUploadStatus(null), 3000);
                }
              }
            };
            batchBeforeUpload();
          }

          const variance = await checkPhotoQuality(saved.fileUri);
          // Abort if user already retook or cleared the photo
          if (captureGenRef.current !== thisGen) return;
          const pct = varianceToPercent(variance);
          qualitySetter(pct);
          cacheSet(
            tab === "before" ? `pole_quality_before_${pole_id}` :
            tab === "after"  ? `pole_quality_after_${pole_id}`  :
                               `pole_quality_tag_${pole_id}`,
            pct,
          ).catch(() => {});
          if (variance < 80) setBlurWarning(true);
        } catch {}
      })();

    } catch (e: any) {
      const msg = (e?.message ?? "").toLowerCase();
      if (!msg.includes("not running") && !msg.includes("already")) {
        Alert.alert("Photo Error", "Failed to capture image. Make sure the camera is ready and try again.");
      }
      isCapturingRef.current = false;
      setPhotoCapturing(false);
    }
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

  const warmPoleGpsBundle = useCallback(async (
    nextLat: number,
    nextLng: number,
    opts?: { force?: boolean },
  ) => {
    const key = `${nextLat.toFixed(6)},${nextLng.toFixed(6)}`;
    if (!opts?.force && gpsWarmKeyRef.current === key && gpsWarmPromiseRef.current) {
      return gpsWarmPromiseRef.current;
    }

    gpsWarmKeyRef.current = key;
    captureMapPrefetchedRef.current = false;

    const warmPromise = (async () => {
      await Promise.allSettled([
        fetchMapTileB64(nextLat, nextLng).then((result) => {
          if (result) mapTileCache.current = result;
        }),
        Location.reverseGeocodeAsync({ latitude: nextLat, longitude: nextLng }).then((res) => {
          const a = res[0];
          if (!a) return;
          const parsed = parseGpsAddress(a);
          setStreet(parsed.road);
          setCity(parsed.city);
          setProvince(parsed.province);
        }),
        Image.prefetch(staticMapUrl(nextLat, nextLng)).then((ok) => {
          captureMapPrefetchedRef.current = !!ok;
        }),
      ]);
    })();

    gpsWarmPromiseRef.current = warmPromise;
    await warmPromise;
  }, []);

  useEffect(() => {
    if (lat == null || lng == null) return;
    warmPoleGpsBundle(lat, lng).catch(() => {});
  }, [lat, lng, warmPoleGpsBundle]);

  const openSharedCapture = useCallback((tab: "before" | "after" | "tag") => {
    if (lat == null || lng == null) return;
    const tabLabel = tab === "before" ? "BEFORE" : tab === "after" ? "AFTER" : "POLE TAG";
    router.push({
      pathname: "/capture" as any,
      params: {
        tab,
        returnKey: captureReturnKey,
        ownerType: "pole-detail",
        ownerPoleId: String(pole_id ?? ""),
        label: tabLabel,
        poleCode: editedPoleName || pole_name || pole_code || "Pole",
        nodeName: node_name || node_code || node_id || "",
        lat: String(lat),
        lng: String(lng),
        road: street,
        city,
        province,
        prefetchedMap: captureMapPrefetchedRef.current ? "1" : "0",
      },
    });
  }, [
    captureReturnKey,
    city,
    editedPoleName,
    lat,
    lng,
    node_code,
    node_id,
    node_name,
    pole_code,
    pole_id,
    pole_name,
    province,
    street,
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

        const expectedPoleId = String(pole_id ?? "");
        if (result.ownerType !== "pole-detail" || String(result.ownerPoleId ?? "") !== expectedPoleId) {
          delete (global as any)[captureReturnKey];
          return;
        }

        delete (global as any)[captureReturnKey];

        const tab = result.tab;
        const setter = tab === "before" ? setPhotoBefore : tab === "after" ? setPhotoAfter : setPhotoTag;
        const qualitySetter = tab === "before" ? setQualityBefore : tab === "after" ? setQualityAfter : setQualityTag;
        const file = tab === "before" ? F.before : tab === "after" ? F.after : F.tag;
        const qualityKey = tab === "before"
          ? `pole_quality_before_${pole_id}`
          : tab === "after"
          ? `pole_quality_after_${pole_id}`
          : `pole_quality_tag_${pole_id}`;

        setActiveCameraTab(tab);
        setBlurWarning(false);

        const thisGen = ++captureGenRef.current;
        lastFreshCaptureRef.current = Date.now(); // block draft loader from overwriting for 3s
        setter(createPhotoField(result.uri, file)); // show raw photo immediately

        try {
          // Skip re-stamp if capture.tsx already burned the metadata in
          const stampLines = result.skipStamp ? undefined : buildStampLinesRef.current(tab);
          const saved = await savePhotoDraftRef.current(file, result.uri, stampLines, lat, lng);
          if (cancelled || captureGenRef.current !== thisGen) return;

          setter(saved);
          const capturedAt = getPHTNow();
          cacheSet(`photo_captured_at_${pole_id}_${tab}`, capturedAt).catch(() => {});

          if (tab === "after") {
            setAfterCapturedAt(capturedAt);
            api.put(`/skycable/nodes/${node_id}/poles/${pole_id}`, {
              cleared_at: capturedAt,
            }).catch(() => {});
          }

          // Batch before mode — push status + upload photo to backend immediately
          if (tab === "before" && isBatchBeforeCaptureMode) {
            api.put(`/skycable/nodes/${node_id}/poles/${pole_row_id}`, {
              date_start: capturedAt,
            }).catch(() => {});
            api.put(`/skycable/poles/${pole_id}`, {
              skycable_status: "in_progress",
            }).catch(() => {});
            // Upload to backend — queue for retry if offline
            const batchBeforeUpload2 = async () => {
              const form = new FormData();
              form.append("pole_id",        String(pole_id));
              form.append("pole_code",      String(pole_code));
              form.append("node_id",        String(node_id));
              form.append("image_type",     "before");
              form.append("inventory_type", "skycable");
              form.append("lock",           "1");
              form.append("image", { uri: saved.fileUri, name: "before.jpg", type: "image/jpeg" } as any);
              try {
                await api.post("/teardown/upload-image", form);
              } catch (err: any) {
                const httpStatus = (err as any)?.response?.status;
                if (!httpStatus || httpStatus >= 500) {
                  const persistedUri = await persistImage(saved.fileUri, `batch_before_${pole_id}.jpg`).catch(() => saved.fileUri);
                  await imageQueuePush([{
                    reportLocalId: `batch_before_${pole_id}`,
                    fieldName: "before",
                    uri: persistedUri,
                    meta: { pole_id: String(pole_id), pole_code: String(pole_code), node_id: String(node_id), image_type: "before", lock: "1" },
                  }]).catch(() => {});
                }
              }
            };
            batchBeforeUpload2();
          }

          const variance = await checkPhotoQuality(saved.fileUri);
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
      lat,
      lng,
      node_id,
      pole_id,
    ]),
  );

  async function handleOpenCapture(tab: "before" | "after" | "tag") {
    // Before photo is locked by backend — view only, no re-capture allowed
    if (tab === "before" && beforeLocked) {
      setGateAlertModal({ title: "Before Photo Locked", message: "The before photo has been locked by the backend team. Contact your supervisor to request an edit." });
      return;
    }

    const batchBeforeAllowed = isBatchBeforeCaptureMode && tab === "before";

    if (!batchBeforeAllowed && !teardownStarted) {
      setGateAlertModal({ title: "Teardown Not Started", message: "Please tap 'Start Pole Teardown' below to start recording site progress." });
      return;
    }
    if (!batchBeforeAllowed && !infoComplete) {
      setGateAlertModal({ title: "Requirement Missing", message: isPoleReport ? "Please capture GPS coordinates first." : "Please capture GPS coordinates and set the Slot first." });
      return;
    }
    if (batchBeforeAllowed && (lat === null || lng === null)) {
      setGateAlertModal({ title: "GPS Required", message: "This pole needs saved map coordinates before batch before-photo capture can start." });
      return;
    }

    if (lat !== null && lng !== null) {
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest })
        .then((pos) => {
          const live = pos.coords as any;
          prewarmedGps.current = live;
          if (live) setLiveCoords({ lat: live.latitude, lng: live.longitude });
        })
        .catch(() => {});
      warmPoleGpsBundle(lat, lng).catch(() => {});
    }

    setActiveCameraTab(tab);
    openSharedCapture(tab);
  }

  async function captureGps() {
    if (!teardownStarted && !isBatchBeforeCaptureMode) {
      setGateAlertModal({ title: "Teardown Not Started", message: "Please tap 'Start Pole Teardown' below to start recording site progress." });
      return;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setGateAlertModal({ title: "Permission required", message: "Please allow location access." });
      return;
    }

    // If sitemap GPS is set but no device capture yet, capture immediately (don't ask to confirm)
    // If already captured on device, show confirmation to overwrite
    if (lat !== null && lng !== null && !gpsFromSitemap) {
      setGpsConfirmModal(true);
      return;
    }

    await confirmAndCaptureGps();
  }

  async function confirmAndCaptureGps() {
    setGpsCapturing(true);

    try {
      const coords = prewarmedGps.current;

      if (!coords) {
        Alert.alert(
          "GPS not ready",
          "Still acquiring signal. Please wait a moment.",
        );
        return;
      }

      // No distance check on GPS capture — the purpose of recapturing is to
      // replace the sitemap coordinates with the actual field coordinates.

      const capturedAt = await getDisplayTime();
      const draft: GpsDraft = {
        lat: coords.latitude,
        lng: coords.longitude,
        capturedAt,
      };

      setGpsDraftState(draft);
      setGpsFromSitemap(false); // actual device capture — overrides sitemap GPS
      await cacheSet(gpsDraftKey, draft).catch(() => {});

      // Update the parent poles list cache so the map appears instantly
      if (node_id && pole_id) {
        const listCacheKey = `sitemap_poles_${node_id}`;
        const listCache = await cacheGet<any[]>(listCacheKey);
        if (listCache) {
          const updatedList = listCache.map((p) => {
            if (String(p.pole_id) === String(pole_id) && p.pole) {
              return {
                ...p,
                pole: {
                  ...p.pole,
                  lat: draft.lat.toFixed(6),
                  lng: draft.lng.toFixed(6),
                },
              };
            }
            return p;
          });
          await cacheSet(listCacheKey, updatedList).catch(() => {});
        }
      }

      // Commit captured GPS coordinates directly to backend database `poles` table via dedicated GPS endpoint
      try {
        await api.post(`/skycable/poles/${pole_id}/gps`, { lat: draft.lat, lng: draft.lng });
      } catch (err: any) {
        if (!err?.response?.status) {
          await simpleQueuePush({
            method: "post",
            url: `/skycable/poles/${pole_id}/gps`,
            body: { lat: draft.lat, lng: draft.lng },
          }).catch(() => {});
        }
      }

      // Pre-load street map tile in background so stamp is instant when photo is taken
      warmPoleGpsBundle(draft.lat, draft.lng, { force: true }).catch(() => {});

      // Trigger high-fidelity custom success popup modal
      setGpsSuccessModal(true);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to capture GPS.");
    } finally {
      setGpsCapturing(false);
    }
  }

  const hasGps = !!(lat && lng);
  const hasRecapturedGps = hasGps && !gpsFromSitemap && !!gpsCapturedAt;
  const gpsDoneForUi = DEV_SKIP_GPS_CHECKS ? hasGps : hasRecapturedGps;
  const infoComplete = teardownStarted && (DEV_SKIP_GPS_CHECKS || hasRecapturedGps) && !!slot;

  const [showCameraModal, setShowCameraModal]   = useState(false);
  const [mapFullscreen, setMapFullscreen]       = useState(false);
  const [mapSatellite, setMapSatellite]         = useState(true);
  const [activeCameraTab, setActiveCameraTab] = useState<"before" | "after" | "tag">("before");
  const cameraRef = useRef<React.ComponentRef<typeof CameraView>>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const isCapturingRef = useRef(false);  // prevents concurrent takePictureAsync calls
  const [cameraZoom, setCameraZoom] = useState(0);
  const pinchBaseZoom = useRef(0);
  const pinchGesture = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => { pinchBaseZoom.current = cameraZoom; })
    .onUpdate((e) => {
      setCameraZoom(Math.min(1, Math.max(0, pinchBaseZoom.current + (e.scale - 1) * 0.5)));
    });
  const [blurWarning, setBlurWarning] = useState(false);
  const [photoCapturing, setPhotoCapturing] = useState(false);
  // Incremented on every retake/clear — background capture callbacks check
  // this and discard their results if the generation has moved on.
  const captureGenRef = useRef(0);
  const [outOfAreaAlert, setOutOfAreaAlert] = useState<{ visible: boolean; distance: number } | null>(null);


  const canSelectPair =
    (DEV_SKIP_GPS_CHECKS || hasRecapturedGps) &&
    !!photoBefore &&
    !!photoAfter &&
    !!photoTag &&
    !!slot;
  const batchBeforeReadyForSpans = isBatchBeforeCaptureMode && (DEV_SKIP_GPS_CHECKS || hasRecapturedGps) && !!photoBefore;
  const canBatchBeforeSave = batchBeforeReadyForSpans;
  const canProceedToSpans = canSelectPair;

  const gpsTopLabel = hasGps
    ? `${lat?.toFixed(6)}, ${lng?.toFixed(6)}`
    : prewarmedGps.current
      ? `${prewarmedGps.current.latitude.toFixed(6)}, ${prewarmedGps.current.longitude.toFixed(6)}`
      : "Acquiring GPS Signal...";

	  const gpsSecondaryLabel = hasGps
	    ? gpsFromSitemap
	      ? (isPoleReport
	          ? "📍 Sitemap GPS — tap to recapture for this pole report"
	          : "📍 Sitemap GPS — pre-placed by sitemap APK")
	      : street ? `📱 ${street}` : "📱 Captured on this device"
	    : gpsAccuracy === null
	      ? "⚠️ Required — acquiring signal…"
      : gpsAccuracy <= REQUIRED_GPS_ACCURACY_METERS
        ? `⚠️ Required — accuracy ${gpsAccuracy}m, ready to capture`
        : `⚠️ Required — accuracy ${gpsAccuracy}m, tap to capture`;

  async function handleSavePoleNameEdit() {
    const trimmed = editNameDraft.trim();
    if (!trimmed) return;
    setSavingName(true);

    // 1. Update local state immediately (works offline too)
    setEditedPoleName(trimmed);

    // 2. Patch local pole caches in the background so the edited pole code
    // replaces the old NPT — doesn't block the save when online.
    cacheSet(`draft_pole_name_${pole_id}`, trimmed).catch(() => {});
    if (node_id) {
      const patchPoleList = async (cacheKey: string) => {
        const cachedPoles = await cacheGet<any[]>(cacheKey).catch(() => null);
        if (!cachedPoles) return;
        const updated = cachedPoles.map((p) => {
          const matchId =
            String(p.id) === String(pole_id) ||
            String(p.pole_id) === String(pole_id) ||
            String(p.pole?.id) === String(pole_id);
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

      patchPoleList(`poles_node_${node_id}`).catch(() => {});
      patchPoleList(`sitemap_poles_${node_id}`).catch(() => {});
    }

    setSavingName(false);
    setEditNameModalOpen(false);

    // 3. Sync in the background — don't block the user.
    (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await api.put(`/skycable/poles/${pole_id}`, { pole_code: trimmed });
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
            url: `/skycable/poles/${pole_id}`,
            body: { pole_code: trimmed },
          }, true).catch(() => {});
        }
      }
    })().catch(() => {});
  }

  function goToDestination(span: Span) {
    const isFromPole = String(span.from_pole?.pole?.id) === String(pole_id);
    const destPole = isFromPole ? span.to_pole : span.from_pole;
    const actualToId = String(destPole?.pole?.id ?? "");
    const actualToCode = destPole?.pole?.pole_code ?? "";
    const actualToName = destPole?.pole?.pole_code ?? "";
    const destLat = (destPole?.pole as any)?.lat ?? null;
    const destLng = (destPole?.pole as any)?.lng ?? null;

    router.push({
      pathname: "/teardowns/destination-pole" as any,
      params: {
        pole_code: editedPoleName || pole_name || pole_code,
        pole_name: editedPoleName || pole_name,
        node_id,
        node_name: node_name || "",
        project_id,
        project_name,
        accent: accentColor,
        span_id: String(span.id),
        span_code: span.span_code ?? "",
        to_pole_id: actualToId,
        to_pole_code: actualToCode,
        to_pole_name: actualToName,
        expected_cable: String(getExpected(span, "cable")),
        length_meters: String(span.strand_length),
        declared_runs: String(span.number_of_runs),
        expected_node: String(getExpected(span, "node")),
        expected_amplifier: String(getExpected(span, "amplifier")),
        expected_extender: String(getExpected(span, "extender")),
        expected_tsc: String(getExpected(span, "tsc")),
        expected_powersupply: String(getExpected(span, "powersupply")),
        expected_powersupply_housing: String(getExpected(span, "powersupply_case")),
        from_pole_id: pole_id ?? "",
        from_pole_latitude: lat ? String(lat) : "",
        from_pole_longitude: lng ? String(lng) : "",
        from_pole_gps_captured_at: gpsCapturedAt,
        to_pole_sitemap_lat: destLat ? String(destLat) : "",
        to_pole_sitemap_lng: destLng ? String(destLng) : "",
      },
    });
  }

	  async function handleStartPole() {
	    if (!pole_id || !node_id || startingPole) return;
	    setStartingPole(true);
	    const now = getPHTNow();
	    const startNumeric = Date.now();

		    // 1. Instantly write to local UI state and storage cache to unlock task operations offline
		    await cacheSet(teardownStartedKey, { startedAt: now, startMs: startNumeric }).catch(() => {});
		    setPoleStartedAt(now);
		    timerStartRef.current = startNumeric;
		    setTeardownStarted(true);

	    // Instantly update parent list cache so status changes from pending to in_progress immediately
	    const listKey = `sitemap_poles_${node_id}`;
	    const listCache = await cacheGet<any[]>(listKey).catch(() => null);

    // Assign sequence based on start order: max existing sequence + 1
    const nextSequence = listCache
      ? listCache.reduce((max, p) => Math.max(max, Number(p.sequence) || 0), 0) + 1
      : 1;

		    if (listCache) {
		      const updated = listCache.map((p) => {
		        if (String(p.pole_id) === String(pole_id) && p.pole) {
		          return {
		            ...p,
		            sequence: nextSequence,
		            date_start: p.date_start || now,
		            pole: {
		              ...p.pole,
		              skycable_status: "in_progress",
		            },
		          };
		        }
		        return p;
		      });
		      await cacheSet(listKey, updated).catch(() => {});
		    }
	
    // 2. Start teardown on backend — use pole_row_id (skycable_poles.id) for the correct route
    const rowId = pole_row_id || pole_id;
    try {
      await api.put(`/skycable/nodes/${node_id}/poles/${rowId}`, { date_start: now });
    } catch (err: any) {
      if (!err?.response?.status) {
        await simpleQueuePush({
          method: "put",
          url: `/skycable/nodes/${node_id}/poles/${rowId}`,
          body: { date_start: now },
        }).catch(() => {});
      }
    }

    // Update poles.skycable_status directly (this is what the web admin + Navicat shows)
    api.put(`/skycable/poles/${pole_id}`, { skycable_status: "in_progress" }).catch(async (err: any) => {
      if (!err?.response?.status) {
        await simpleQueuePush({
          method: "put",
          url: `/skycable/poles/${pole_id}`,
          body: { skycable_status: "in_progress" },
        }).catch(() => {});
      } else {
        Alert.alert("Start Failed", err?.message ?? "Unable to start pole teardown.");
      }
    });

    // Sync skycable_poles.status via patch endpoint (fire-and-forget backup)
    api.patch(`/skycable/nodes/${node_id}/poles/sync`, {
      pole_id: Number(pole_id),
      date_start: now,
      status: "in_progress",
    }).catch(() => {});

	    // 3. Also push node to in_progress if it's still pending
	    try {
	      await api.put(`/skycable/nodes/${node_id}`, {
	        status: "in_progress",
	        date_start: now,
	      });
    } catch (err: any) {
      if (!err?.response?.status) {
        await simpleQueuePush({
          method: "put",
          url: `/skycable/nodes/${node_id}`,
          body: { status: "in_progress", date_start: now },
        }).catch(() => {});
      }
    }

    // Ping lineman location — records that the lineman is physically at this pole
    pingNow();

    setStartingPole(false);
  }

  function handleBatchBeforeSave() {
    if (!isBatchBeforeCaptureMode || !shouldReturnToMapAfterCapture || !canBatchBeforeSave) return;
    router.back();
  }

  function handleBackNavigation() {
    if (shouldReturnToPoles) {
      router.replace({
        pathname: "/teardowns/poles" as any,
        params: { nodeId: node_id, nodeName: node_name || "" },
      });
      return;
    }

    router.back();
  }

  useFocusEffect(
    useCallback(() => {
      if (!shouldReturnToPoles) return undefined;

      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        handleBackNavigation();
        return true;
      });

      return () => sub.remove();
    }, [shouldReturnToPoles, node_id, node_name]),
  );

  function handleNext() {
    if (isPoleReport || !canProceedToSpans) return;

    // Record that photos are done so auto-redirect works when pole is re-clicked.
    // Do NOT mark as completed here — the pole may have multiple spans.
    // Status changes to "completed" only after the teardown log is submitted in components.tsx.
    if (!isBatchBeforeCaptureMode && !poleFinishedAt) {
      const nowFinished = getPHTNow();
      setPoleFinishedAt(nowFinished);
      cacheSet(`teardown_finished_${pole_id}`, nowFinished).catch(() => {});
    }

    if (spans.length === 1) {
      goToDestination(spans[0]);
    } else {
      router.push({
        pathname: "/teardowns/select-pair" as any,
        params: {
          pole_id,
          pole_code,
          pole_name: editedPoleName || pole_name,
          node_id,
          node_name,
          project_id,
          project_name,
          accent: accentColor,
          from_pole_latitude: lat ? String(lat) : "",
          from_pole_longitude: lng ? String(lng) : "",
          from_pole_gps_captured_at: gpsCapturedAt,
        },
      });
    }
  }

  const progress = useMemo(() => {
    if (isPoleReport) {
      const completed = [
        gpsDoneForUi,
        !!photoBefore,
        !!photoAfter,
        !!photoTag,
      ].filter(Boolean).length;
      const total = 4;
      return {
        completed,
        total,
        percent: Math.round((completed / total) * 100),
      };
    }

    return getCompletionState({
      hasGps,
      photoBefore,
      photoAfter,
      photoTag,
      slot,
    });
  }, [
    isPoleReport,
    gpsDoneForUi,
    hasRecapturedGps,
    hasGps,
    photoBefore,
    photoAfter,
    photoTag,
    slot,
  ]);

  // ── Pole Report helpers ───────────────────────────────────────────────────
  function uid() { return Math.random().toString(36).slice(2); }

  function addSlot() {
    const s: PoleSlot = {
      tempId: uid(),
      slot_type: addSlotType,
      owner: addSlotOwner,
      cables: [],
      equipment: [],
      accessories: [],
      expanded: true,
    };
    setPoleSlots((prev) => [...prev, s]);
    setAddSlotOpen(false);
    setAddSlotType("C1");
    setAddSlotOwner("Others");
  }

  function deleteSlot(tempId: string) {
    setPoleSlots((prev) => prev.filter((s) => s.tempId !== tempId));
  }

  function toggleSlot(tempId: string) {
    setPoleSlots((prev) =>
      prev.map((s) => s.tempId === tempId ? { ...s, expanded: !s.expanded } : s),
    );
  }


  function addCable(slotTempId: string) {
    setPoleSlots((prev) =>
      prev.map((s) =>
        s.tempId === slotTempId
          ? { ...s, cables: [...s.cables, { tempId: uid(), cable_type: "coaxial", runs: 1, extracted: false }] }
          : s,
      ),
    );
  }

  function updateCable(slotTempId: string, cTempId: string, patch: Partial<CableItem>) {
    setPoleSlots((prev) =>
      prev.map((s) =>
        s.tempId === slotTempId
          ? { ...s, cables: s.cables.map((c) => c.tempId === cTempId ? { ...c, ...patch } : c) }
          : s,
      ),
    );
  }

  function deleteCable(slotTempId: string, cTempId: string) {
    setPoleSlots((prev) =>
      prev.map((s) =>
        s.tempId === slotTempId ? { ...s, cables: s.cables.filter((c) => c.tempId !== cTempId) } : s,
      ),
    );
  }

  function addEquipment(slotTempId: string) {
    setPoleSlots((prev) =>
      prev.map((s) =>
        s.tempId === slotTempId
          ? { ...s, equipment: [...s.equipment, { tempId: uid(), item_type: "fiber optic splice box", quantity: 1, unit: "pc" }] }
          : s,
      ),
    );
  }

  function updateEquipment(slotTempId: string, iTempId: string, patch: Partial<AttachmentItem>) {
    setPoleSlots((prev) =>
      prev.map((s) =>
        s.tempId === slotTempId
          ? { ...s, equipment: s.equipment.map((i) => i.tempId === iTempId ? { ...i, ...patch } : i) }
          : s,
      ),
    );
  }

  function deleteEquipment(slotTempId: string, iTempId: string) {
    setPoleSlots((prev) =>
      prev.map((s) =>
        s.tempId === slotTempId ? { ...s, equipment: s.equipment.filter((i) => i.tempId !== iTempId) } : s,
      ),
    );
  }

  function addAccessory(slotTempId: string) {
    setPoleSlots((prev) =>
      prev.map((s) =>
        s.tempId === slotTempId
          ? { ...s, accessories: [...s.accessories, { tempId: uid(), item_type: "pole clamps", quantity: 1, unit: "pc" }] }
          : s,
      ),
    );
  }

  function updateAccessory(slotTempId: string, iTempId: string, patch: Partial<AttachmentItem>) {
    setPoleSlots((prev) =>
      prev.map((s) =>
        s.tempId === slotTempId
          ? { ...s, accessories: s.accessories.map((i) => i.tempId === iTempId ? { ...i, ...patch } : i) }
          : s,
      ),
    );
  }

  function deleteAccessory(slotTempId: string, iTempId: string) {
    setPoleSlots((prev) =>
      prev.map((s) =>
        s.tempId === slotTempId ? { ...s, accessories: s.accessories.filter((i) => i.tempId !== iTempId) } : s,
      ),
    );
  }

  const canSubmitPoleReport =
    isPoleReport &&
    hasRecapturedGps &&
    !!photoBefore &&
    !!photoAfter &&
    !!photoTag;

	  async function handleSubmitPoleReport() {
	    if (!canSubmitPoleReport) return;
	    setSubmittingReport(true);
	    try {
	      const form = new FormData();
	      form.append("landmark",        landmark);
	      form.append("latitude",        String(lat ?? ""));
	      form.append("longitude",       String(lng ?? ""));
	      form.append("gps_captured_at", gpsCapturedAt);
	      if (node_id) form.append("node_id", String(node_id));

	      // Photos are sent inline — backend saves them to PoleTeardownImage
	      const appendPhoto = async (field: string, photo: NonNullable<PhotoField>, tabKey: string) => {
	        form.append(field, { uri: photo.fileUri, name: photo.name, type: "image/jpeg" } as any);
	        const ts = await cacheGet<string>(`photo_captured_at_${pole_id}_${tabKey}`).catch(() => null);
	        if (ts) form.append(`${field}_captured_at`, ts);
      };

      if (photoBefore) await appendPhoto("before_photo", photoBefore, "before");
      if (photoAfter)  await appendPhoto("after_photo",  photoAfter,  "after");
      if (photoTag)    await appendPhoto("tag_photo",    photoTag,    "tag");

      const res: any = await api.post(`/skycable/poles/${pole_id}/report`, form);
      const nowFinished = getPHTNow();

      // Update poles.skycable_status → "cleared"  (backend storeReport already does it, belt+suspenders)
      api.put(`/skycable/poles/${pole_id}`, { skycable_status: "cleared" }).catch(() => {});

      // Post a teardown log so the pole shows in teardown-logs dashboard
      api.post("/skycable/pole-teardown-logs", {
        pole_id: Number(pole_id),
        node_id: Number(node_id),
        finished_at: nowFinished,
        status: "completed",
        report_type: "pole_report",
      }).catch(() => {});

      // Invalidate local cache so poles.tsx re-fetches authoritative status on navigate
      if (node_id && pole_id) {
        const listKey = `sitemap_poles_${node_id}`;
        cacheGet<any[]>(listKey).then(listCache => {
          if (listCache) {
            const updated = listCache.map((p) => {
              if (String(p.pole_id) === String(pole_id) && p.pole) {
                return { ...p, cleared_at: p.cleared_at || nowFinished, pole: { ...p.pole, skycable_status: "cleared" } };
              }
              return p;
            });
            cacheSet(listKey, updated).catch(() => {});
          }
        }).catch(() => {});
        cacheSet(`sitemap_poles_${node_id}`, null).catch(() => {});
      }

      setSubmitSuccessTime(nowFinished);
      setSubmitSuccessOpen(true);
      setTimeout(() => {
        setSubmitSuccessOpen(false);
        router.navigate({ pathname: "/teardowns/poles" as any, params: { nodeId: node_id, nodeName: node_name || "" } });
      }, 1200);
    } catch (e: any) {
      Alert.alert("Submit Failed", e?.message ?? "Please try again.");
    } finally {
      setSubmittingReport(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.floatingHeader}>
          <TouchableOpacity onPress={handleBackNavigation} style={styles.backBtn}>
            <ChevronLeft size={22} color="#0F172A" />
          </TouchableOpacity>
          <View style={styles.floatingHeaderText}>
            <Text style={styles.headerSub}>{node_name || "Skycable Teardown"}</Text>
          </View>
	        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >


          <View style={styles.heroCard}>
            {/* Soft internal accent background layers */}
            <View style={[styles.heroBg, { backgroundColor: "#0F172A" }]} />
            <View style={[styles.heroGlowLeft, { backgroundColor: accentColor }]} />
            <View style={styles.heroGlowRight} />
            <View style={styles.heroGlassOverlay} />

            <View style={styles.heroContent}>
              <View style={[styles.heroTopLine, { justifyContent: "space-between" }]}>
                <View style={[styles.heroBadge, { backgroundColor: `${accentColor}25`, borderColor: `${accentColor}50`, maxWidth: "70%" }]}>
                  <Text style={[styles.heroBadgeText, { color: "#A7F3D0" }]} numberOfLines={1}>
                    📁  {(project_name || "Pole Teardown").toUpperCase()}
                  </Text>
                </View>
                {teardownStarted ? (
                  <View style={styles.heroTopTimerPill}>
                    <Text style={styles.heroTopTimerIcon}>⏱</Text>
                    <Text style={styles.heroTopTimerText}>
                      {String(Math.floor(Math.max(0, elapsedSecs) / 60)).padStart(2, "0")}:{String(Math.max(0, elapsedSecs) % 60).padStart(2, "0")}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.heroMainBlock}>
                <View style={styles.heroTitleRowWrapper}>
                  <Text style={styles.heroTitle} numberOfLines={2}>
                    {editedPoleName || "Pole"}
                  </Text>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                      setEditNameDraft(editedPoleName);
                      setEditNameModalOpen(true);
                    }}
                    style={styles.heroEditPill}
                  >
                    <Text style={styles.heroEditPillIcon}>✎</Text>
                    <Text style={styles.heroEditPillText}>EDIT</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.heroIntegratedFooter}>
                <View style={styles.heroSummaryTable}>
                  <View style={styles.heroSummaryCol}>
                    <Text style={styles.heroSummaryLabel}>STARTED AT</Text>
                    <Text style={styles.heroSummaryValue}>
                      {(() => {
                        if (!poleStartedAt) return "—";
                        const d = new Date(poleStartedAt);
                        const mo = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        const yr = String(d.getFullYear()).slice(-2);
                        let hr = d.getHours();
                        const mn = String(d.getMinutes()).padStart(2, '0');
                        const ampm = hr >= 12 ? 'PM' : 'AM';
                        hr = hr % 12 || 12;
                        return `${mo}/${day}/${yr} - ${hr}:${mn}${ampm}`;
                      })()}
                    </Text>
                  </View>
                  <View style={styles.heroSummaryDivider} />
                  {/* FINISHED AT — timestamp when operator finalizes via Select Pair */}
                  <View style={styles.heroSummaryCol}>
                    <Text style={styles.heroSummaryLabel}>FINISHED AT</Text>
                    <Text style={styles.heroSummaryValue}>
                      {(() => {
                        if (poleFinishedAt) {
                          const d = new Date(poleFinishedAt);
                          const mo  = String(d.getMonth() + 1).padStart(2, '0');
                          const day = String(d.getDate()).padStart(2, '0');
                          const yr  = String(d.getFullYear()).slice(-2);
                          let hr    = d.getHours();
                          const mn  = String(d.getMinutes()).padStart(2, '0');
                          const ap  = hr >= 12 ? 'PM' : 'AM';
                          hr = hr % 12 || 12;
                          return `${mo}/${day}/${yr} - ${hr}:${mn}${ap}`;
                        }
                        if (!teardownStarted) return "—";
                        return "Waiting…";
                      })()}
                    </Text>
                  </View>
                  <View style={styles.heroSummaryDivider} />

                  {/* DURATION — started_at → finished_at/now */}
                  <View style={styles.heroSummaryCol}>
                    <Text style={styles.heroSummaryLabel}>DURATION</Text>
                    <Text style={[styles.heroSummaryValue, { color: poleFinishedAt ? "#A7F3D0" : "#FBBF24" }]}>
                      {(() => {
                        if (!poleStartedAt) return "—";
                        const endMs   = poleFinishedAt ? new Date(poleFinishedAt).getTime() : Date.now();
                        const totalSecs = Math.max(0, Math.floor((endMs - new Date(poleStartedAt).getTime()) / 1000));
                        const h = Math.floor(totalSecs / 3600);
                        const m = Math.floor((totalSecs % 3600) / 60);
                        const s = totalSecs % 60;
                        if (h > 0) return `${h}h ${m}m`;
                        if (m > 0) return `${m}m ${s}s`;
                        return `${s}s`;
                      })()}
                    </Text>
                  </View>
                  <View style={styles.heroSummaryDivider} />

                  {/* STATUS */}
                  <View style={styles.heroSummaryCol}>
                    <Text style={styles.heroSummaryLabel}>STATUS</Text>
                    <Text style={[styles.heroSummaryValue, { color: !teardownStarted ? "#94A3B8" : canSelectPair ? "#A7F3D0" : "#FBBF24" }]}>
                      {!teardownStarted ? "Pending" : canSelectPair ? "Ready" : "In Progress"}
                    </Text>
                  </View>
                </View>

                <View style={styles.heroFooterHeaderRow}>
                  <Text style={styles.heroFooterTitle}>PROGRESS</Text>
                  <Text style={[styles.heroFooterPercentText, { color: accentColor }]}>
                    {progress.percent}%
                  </Text>
                </View>

	                <View style={styles.heroTrackerNodesRow}>
	                  <TrackerMini done={gpsDoneForUi} label="GPS" />
	                  <TrackerMini done={!!photoBefore} label="Before" />
	                  <TrackerMini done={!!photoAfter} label="After" />
	                  <TrackerMini done={!!photoTag} label="Tag" />
	                  {!isPoleReport && <TrackerMini done={!!slot} label="Slot" />}
	                </View>

                <View style={{ marginTop: 4 }}>
                  <ProgressWaveBar
                    progress={progress.percent}
                    accentColor={accentColor}
                  />
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
                    gpsDoneForUi
                      ? styles.sectionPillSuccess
                      : styles.sectionPillMuted,
                  ]}
                >
                  <Text
                    style={[
                      styles.sectionPillText,
                      gpsDoneForUi
                        ? styles.sectionPillTextSuccess
                        : styles.sectionPillTextMuted,
                    ]}
                  >
                    {gpsDoneForUi
                      ? "Captured"
                      : poleLoading
                        ? "Checking…"
                        : "Required"}
                  </Text>
                </View>
              }
            />

            {hasGps && lat !== null && lng !== null ? (
              <TouchableOpacity
                activeOpacity={0.95}
                onPress={() => setMapFullscreen(true)}
                style={styles.gpsMapBox}
              >
                <WebView
                  key={`map-${lat}-${lng}-${mapSatellite}`}
                  style={StyleSheet.absoluteFillObject}
                  scrollEnabled={false}
                  originWhitelist={["*"]}
                  javaScriptEnabled
                  domStorageEnabled
                  mixedContentMode="always"
                  source={{
                    html: buildPoleMapHtml(lat, lng, accentColor, mapSatellite),
                    baseUrl: "https://local.telcovantage/",
                  }}
                  cacheEnabled={false}
                  pointerEvents="none"
                />
                {/* Satellite toggle pill */}
                <TouchableOpacity
                  style={styles.mapLayerBtn}
                  onPress={() => setMapSatellite(v => !v)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.mapLayerBtnText}>
                    {mapSatellite ? '🗺 Map' : '🛰 Sat'}
                  </Text>
                </TouchableOpacity>
                {/* Fullscreen hint */}
                <View style={styles.mapExpandHint}>
                  <Text style={styles.mapExpandHintText}>⛶ Tap to expand</Text>
                </View>
                {/* Coordinates overlay */}
                <View style={styles.mapCoordsOverlay}>
                  <Text style={styles.mapCoordsText}>
                    {lat.toFixed(6)},  {lng.toFixed(6)}
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
                gpsDoneForUi
                  ? styles.gpsCardButtonSuccess
                  : styles.gpsCardButtonRequired,
                pressed && !gpsCapturing && styles.pressedDown,
              ]}
              onPress={captureGps}
              disabled={gpsCapturing}
            >
              <View
                style={[
                  styles.gpsIconWrap,
                  gpsDoneForUi
                    ? { backgroundColor: `${accentColor}16` }
                    : { backgroundColor: `${accentColor}10` },
                ]}
              >
                {gpsCapturing || (poleLoading && !hasGps) ? (
                  <ActivityIndicator color={accentColor} size="small" />
                ) : hasGps && lat && lng ? (
                  <StaticTileMap lat={lat} lng={lng} />
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
                    gpsDoneForUi && { color: "#0F172A" },
                  ]}
                  numberOfLines={1}
                >
                  {gpsDoneForUi ? gpsTopLabel : gpsFromSitemap ? "Tap to capture from device" : gpsTopLabel}
                </Text>

                <Text style={styles.gpsLocationText} numberOfLines={2}>
                  {gpsSecondaryLabel}
                </Text>

                {gpsCapturedAt ? (
                  <View>
                    <Text style={styles.gpsCapturedAt}>
                      Captured at {new Date(gpsCapturedAt).toLocaleString()}
                    </Text>
                    {liveCoords && lat !== null && lng !== null ? (
                      <Text style={[styles.gpsCapturedAt, { color: accentColor, fontWeight: "800", marginTop: 2 }]}>
                        🚶 Live Distance: {computeDistanceMeters(lat, lng, liveCoords.lat, liveCoords.lng)} meters away
                      </Text>
                    ) : null}
                  </View>
                ) : null}

              </View>

              <View style={styles.gpsArrowWrap}>
                <Text style={[styles.gpsArrow, { color: accentColor }]}>
                  {hasGps ? "✓" : "›"}
                </Text>
              </View>
            </Pressable>
          </View>

          {/* Slot — full_report only */}
          {!isPoleReport && <View style={styles.sectionCard}>
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
            <View style={styles.slotRowStatic}>
              {SLOTS.map((s) => (
                <Pressable
                  key={s}
                  style={({ pressed }) => [
                    styles.slotBtn,
                    slot === s && { backgroundColor: accentColor, borderColor: accentColor },
                    pressed && styles.pressedDown,
                  ]}
                  onPress={() => {
                    if (!teardownStarted) {
                      setGateAlertModal({ title: "Teardown Not Started", message: "Please tap 'Start Pole Teardown' below to start recording site progress." });
                      return;
                    }
                    setSlot(s);
                  }}
                >
                  <Text style={[styles.slotText, slot === s && { color: "#FFFFFF" }]}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>}

          {/* Landmark (optional) */}
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
            {teardownStarted ? (
              <TextInput
                style={styles.textArea}
                placeholder="e.g. Near Jollibee corner, 3rd pole from left..."
                placeholderTextColor="#9CA3AF"
                value={landmark}
                onChangeText={setLandmark}
                multiline
                numberOfLines={3}
              />
            ) : (
              <Pressable
                onPress={() => {
                  setGateAlertModal({
                    title: "Teardown Not Started",
                    message: "Please tap 'Start Pole Teardown' below to start recording site progress.",
                  });
                }}
              >
                <View pointerEvents="none">
                  <TextInput
                    style={[styles.textArea, { opacity: 0.6 }]}
                    placeholder="e.g. Near Jollibee corner, 3rd pole from left..."
                    placeholderTextColor="#9CA3AF"
                    value={landmark}
                    editable={false}
                    multiline
                    numberOfLines={3}
                  />
                </View>
              </Pressable>
            )}
          </View>

          {/* Photo capture */}
          <View style={styles.sectionCard}>
            <SectionHeading
              title="Pole Photos"
              subtitle={isBatchBeforeCaptureMode ? "Batch before mode: capture GPS and the before photo, then tap save to return to the map." : !teardownStarted ? "Start teardown first" : !infoComplete ? (isPoleReport ? "Capture GPS first" : "Fill GPS & Slot first") : "Click a card to capture · tap again to view"}
            />
            <View style={styles.photoTileRow}>
              <PhotoTile
                label="Before"
                photo={photoBefore}
                accentColor={accentColor}
                disabled={!(infoComplete || isBatchBeforeCaptureMode)}
                locked={beforeLocked}
                onCapture={() => handleOpenCapture("before")}
                onView={() => openViewer("before", () => handleOpenCapture("before"))}
              />
              <PhotoTile
                label="After"
                photo={photoAfter}
                accentColor={accentColor}
                disabled={!infoComplete}
                onCapture={() => handleOpenCapture("after")}
                onView={() => openViewer("after", () => handleOpenCapture("after"))}
              />
              <PhotoTile
                label="Tag"
                photo={photoTag}
                accentColor={accentColor}
                disabled={!infoComplete}
                onCapture={() => handleOpenCapture("tag")}
                onView={() => openViewer("tag", () => handleOpenCapture("tag"))}
              />
            </View>
          </View>

          {/* ── Pole Report sections ─────────────────────────────────────── */}
	          {false && isPoleReport && (
            <>
              {/* Pole Info */}
              <View style={styles.sectionCard}>
                <SectionHeading
                  title="Pole Info"
                  right={null}
                />

                <View style={{ flexDirection: "row", gap: 12 }}>
                  {/* Condition */}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.prFieldLabel}>Condition</Text>
                    <Pressable
                      style={styles.prDropdownSelectBtn}
                      onPress={() => setPickerModal({
                        options: POLE_CONDITIONS,
                        current: poleCondition,
                        onSelect: setPoleCondition,
                      })}
                    >
                      <Text numberOfLines={1} style={[styles.prDropdownSelectText, !poleCondition && styles.prDropdownPlaceholder]}>
                        {poleCondition ? poleCondition : "Condition..."}
                      </Text>
                      <Text style={styles.prDropdownSelectIcon}>▼</Text>
                    </Pressable>
                  </View>

                  {/* Material */}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.prFieldLabel}>Material</Text>
                    <Pressable
                      style={styles.prDropdownSelectBtn}
                      onPress={() => setPickerModal({
                        options: POLE_MATERIALS,
                        current: poleMaterial,
                        onSelect: setPoleMaterial,
                      })}
                    >
                      <Text numberOfLines={1} style={[styles.prDropdownSelectText, !poleMaterial && styles.prDropdownPlaceholder]}>
                        {poleMaterial ? poleMaterial : "Material..."}
                      </Text>
                      <Text style={styles.prDropdownSelectIcon}>▼</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Height */}
                <Text style={styles.prFieldLabel}>Height</Text>
                <Pressable
                  style={styles.prDropdownSelectBtn}
                  onPress={() => setPickerModal({
                    options: POLE_HEIGHTS,
                    current: poleHeight,
                    onSelect: setPoleHeight,
                  })}
                >
                  <Text style={[styles.prDropdownSelectText, !poleHeight && styles.prDropdownPlaceholder]}>
                    {poleHeight ? poleHeight : "Select height..."}
                  </Text>
                  <Text style={styles.prDropdownSelectIcon}>▼</Text>
                </Pressable>

                {/* Notes */}
                <Text style={styles.prFieldLabel}>Notes</Text>
                <TextInput
                  style={styles.textArea}
                  placeholder="Additional observations..."
                  placeholderTextColor="#9CA3AF"
                  value={poleNotes}
                  onChangeText={setPoleNotes}
                  multiline
                  numberOfLines={3}
                />
              </View>

              {/* Slots & Attachments */}
              <View style={styles.sectionCard}>
                <SectionHeading
                  title="Slots & Attachments"
                  right={
                    <Pressable
                      style={[styles.prAddSlotBtn, { borderColor: accentColor }]}
                      onPress={() => setAddSlotOpen(true)}
                    >
                      <Text style={[styles.prAddSlotBtnText, { color: accentColor }]}>+ Add Slot</Text>
                    </Pressable>
                  }
                />

                {poleSlots.length === 0 && (
                  <Text style={styles.prEmptyHint}>No slots added yet. Tap + Add Slot.</Text>
                )}

                {poleSlots.map((slot) => {
                  const itemCount = slot.cables.length + slot.equipment.length + slot.accessories.length;
                  return (
                    <View key={slot.tempId} style={styles.prSlotCard}>
                      {/* Slot header */}
                      <View style={[styles.prSlotHeader, { backgroundColor: accentColor }]}>
                        <Text style={styles.prSlotTitle}>{slot.slot_type}  {slot.owner}</Text>
                        <Text style={styles.prSlotCount}>({itemCount} item{itemCount !== 1 ? "s" : ""})</Text>
                        <Pressable onPress={() => deleteSlot(slot.tempId)} style={styles.prSlotDel}>
                          <Text style={styles.prSlotDelText}>🗑</Text>
                        </Pressable>
                        <Pressable onPress={() => toggleSlot(slot.tempId)} style={styles.prSlotChevron}>
                          <Text style={styles.prSlotChevronText}>{slot.expanded ? "▲" : "▼"}</Text>
                        </Pressable>
                      </View>

                      {slot.expanded && (
                        <View style={styles.prSlotBody}>
                          {/* Cable rows */}
                          {slot.cables.map((cable) => (
                            <View key={cable.tempId} style={styles.prItemRow}>
                              <View style={styles.prItemCategoryBadge}>
                                <Text style={styles.prItemCategory}>CABLE</Text>
                              </View>
                              <Pressable
                                style={styles.prItemTypePill}
                                onPress={() => setPickerModal({
                                  options: CABLE_TYPES,
                                  current: cable.cable_type,
                                  onSelect: (v) => updateCable(slot.tempId, cable.tempId, { cable_type: v }),
                                })}
                              >
                                <Text style={styles.prItemTypeText}>{cable.cable_type}</Text>
                                <Text style={styles.prItemTypeChev}>›</Text>
                              </Pressable>
                              <View style={styles.prItemQtyRow}>
                                <Pressable onPress={() => updateCable(slot.tempId, cable.tempId, { runs: Math.max(1, cable.runs - 1) })} style={styles.prQtyBtn}>
                                  <Text style={styles.prQtyBtnText}>−</Text>
                                </Pressable>
                                <Text style={styles.prQtyVal}>{cable.runs}</Text>
                                <Pressable onPress={() => updateCable(slot.tempId, cable.tempId, { runs: cable.runs + 1 })} style={styles.prQtyBtn}>
                                  <Text style={styles.prQtyBtnText}>+</Text>
                                </Pressable>
                                <Text style={styles.prQtyUnit}>runs</Text>
                              </View>
                              <Pressable onPress={() => deleteCable(slot.tempId, cable.tempId)} style={styles.prItemDel}>
                                <Text style={styles.prItemDelText}>✕</Text>
                              </Pressable>
                            </View>
                          ))}

                          {/* Equipment rows */}
                          {slot.equipment.map((item) => (
                            <View key={item.tempId} style={styles.prItemRow}>
                              <View style={[styles.prItemCategoryBadge, styles.prItemCategoryEquip]}>
                                <Text style={styles.prItemCategory}>EQUIP</Text>
                              </View>
                              <Pressable
                                style={styles.prItemTypePill}
                                onPress={() => setPickerModal({
                                  options: EQUIPMENT_TYPES,
                                  current: item.item_type,
                                  onSelect: (v) => updateEquipment(slot.tempId, item.tempId, { item_type: v }),
                                })}
                              >
                                <Text style={styles.prItemTypeText}>{item.item_type}</Text>
                                <Text style={styles.prItemTypeChev}>›</Text>
                              </Pressable>
                              <View style={styles.prItemQtyRow}>
                                <Pressable onPress={() => updateEquipment(slot.tempId, item.tempId, { quantity: Math.max(1, item.quantity - 1) })} style={styles.prQtyBtn}>
                                  <Text style={styles.prQtyBtnText}>−</Text>
                                </Pressable>
                                <Text style={styles.prQtyVal}>{item.quantity}</Text>
                                <Pressable onPress={() => updateEquipment(slot.tempId, item.tempId, { quantity: item.quantity + 1 })} style={styles.prQtyBtn}>
                                  <Text style={styles.prQtyBtnText}>+</Text>
                                </Pressable>
                                <Text style={styles.prQtyUnit}>pc</Text>
                              </View>
                              <Pressable onPress={() => deleteEquipment(slot.tempId, item.tempId)} style={styles.prItemDel}>
                                <Text style={styles.prItemDelText}>✕</Text>
                              </Pressable>
                            </View>
                          ))}

                          {/* Accessory rows */}
                          {slot.accessories.map((item) => (
                            <View key={item.tempId} style={styles.prItemRow}>
                              <View style={[styles.prItemCategoryBadge, styles.prItemCategoryAccy]}>
                                <Text style={styles.prItemCategory}>ACCY</Text>
                              </View>
                              <Pressable
                                style={styles.prItemTypePill}
                                onPress={() => setPickerModal({
                                  options: ACCESSORY_TYPES,
                                  current: item.item_type,
                                  onSelect: (v) => updateAccessory(slot.tempId, item.tempId, { item_type: v }),
                                })}
                              >
                                <Text style={styles.prItemTypeText}>{item.item_type}</Text>
                                <Text style={styles.prItemTypeChev}>›</Text>
                              </Pressable>
                              <View style={styles.prItemQtyRow}>
                                <Pressable onPress={() => updateAccessory(slot.tempId, item.tempId, { quantity: Math.max(1, item.quantity - 1) })} style={styles.prQtyBtn}>
                                  <Text style={styles.prQtyBtnText}>−</Text>
                                </Pressable>
                                <Text style={styles.prQtyVal}>{item.quantity}</Text>
                                <Pressable onPress={() => updateAccessory(slot.tempId, item.tempId, { quantity: item.quantity + 1 })} style={styles.prQtyBtn}>
                                  <Text style={styles.prQtyBtnText}>+</Text>
                                </Pressable>
                                <Text style={styles.prQtyUnit}>pc</Text>
                              </View>
                              <Pressable onPress={() => deleteAccessory(slot.tempId, item.tempId)} style={styles.prItemDel}>
                                <Text style={styles.prItemDelText}>✕</Text>
                              </Pressable>
                            </View>
                          ))}

                          {/* Add buttons */}
                          <View style={styles.prItemAddBtns}>
                            <Pressable style={styles.prItemAddBtn} onPress={() => addCable(slot.tempId)}>
                              <Text style={styles.prItemAddBtnText}>⚡ Cable</Text>
                            </Pressable>
                            <Pressable style={styles.prItemAddBtn} onPress={() => addEquipment(slot.tempId)}>
                              <Text style={styles.prItemAddBtnText}>⚙ Equip</Text>
                            </Pressable>
                            <Pressable style={styles.prItemAddBtn} onPress={() => addAccessory(slot.tempId)}>
                              <Text style={styles.prItemAddBtnText}>🔩 Accy</Text>
                            </Pressable>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>

        {/* Add Slot modal */}
        <Modal visible={addSlotOpen} transparent animationType="fade" onRequestClose={() => setAddSlotOpen(false)}>
          <Pressable style={styles.prModalOverlay} onPress={() => setAddSlotOpen(false)}>
            <Pressable style={styles.prModalCard} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.prModalTitle}>Add Slot</Text>

              <Text style={styles.prFieldLabel}>Slot Type</Text>
              <View style={styles.prChipRow}>
                {ATTACH_SLOT_TYPES.map((t) => (
                  <Pressable
                    key={t}
                    style={[styles.prChip, addSlotType === t && { backgroundColor: accentColor, borderColor: accentColor }]}
                    onPress={() => setAddSlotType(t)}
                  >
                    <Text style={[styles.prChipText, addSlotType === t && { color: "#fff" }]}>{t}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.prFieldLabel}>Owner</Text>
              <View style={styles.prChipRow}>
                {SLOT_OWNERS.map((o) => (
                  <Pressable
                    key={o}
                    style={[styles.prChip, addSlotOwner === o && { backgroundColor: accentColor, borderColor: accentColor }]}
                    onPress={() => setAddSlotOwner(o)}
                  >
                    <Text style={[styles.prChipText, addSlotOwner === o && { color: "#fff" }]}>{o}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.prModalActions}>
                <Pressable style={styles.prModalCancel} onPress={() => setAddSlotOpen(false)}>
                  <Text style={styles.prModalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.prModalConfirm, { backgroundColor: accentColor }]} onPress={addSlot}>
                  <Text style={styles.prModalConfirmText}>Add Slot</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Generic type picker modal */}
        <Modal visible={!!pickerModal} transparent animationType="fade" onRequestClose={() => setPickerModal(null)}>
          <Pressable style={styles.prModalOverlay} onPress={() => setPickerModal(null)}>
            <Pressable style={styles.prPickerCard} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.prModalTitle}>Select Type</Text>
              {pickerModal?.options.map((opt) => (
                <Pressable
                  key={opt}
                  style={[
                    styles.prPickerRow,
                    pickerModal.current === opt && { backgroundColor: `${accentColor}15` },
                  ]}
                  onPress={() => { pickerModal.onSelect(opt); setPickerModal(null); }}
                >
                  <Text style={[styles.prPickerRowText, pickerModal.current === opt && { color: accentColor, fontWeight: "700" }]}>
                    {opt}
                  </Text>
                  {pickerModal.current === opt && <Text style={{ color: accentColor }}>✓</Text>}
                </Pressable>
              ))}
            </Pressable>
          </Pressable>
        </Modal>

	        <View style={styles.ctaBar}>
	          {isPoleReport ? (
	            !teardownStarted ? (
	              <Pressable
	                style={({ pressed }) => [
	                  styles.submitBtn,
	                  { backgroundColor: startingPole ? "#6B7280" : accentColor },
	                  pressed && !startingPole && styles.pressedDown,
	                ]}
	                onPress={handleStartPole}
	                disabled={startingPole}
	              >
	                <Text style={styles.submitText}>
	                  {startingPole ? "Starting…" : "Start Pole Teardown"}
	                </Text>
	              </Pressable>
	            ) : (
	              <Pressable
	                style={({ pressed }) => [
	                  styles.submitBtn,
	                  { backgroundColor: canSubmitPoleReport ? accentColor : "#C9CED6" },
	                  pressed && canSubmitPoleReport && styles.pressedDown,
	                ]}
	                onPress={handleSubmitPoleReport}
	                disabled={!canSubmitPoleReport || submittingReport}
	              >
	                <Text style={styles.submitText}>
	                  {submittingReport
	                    ? "Submitting…"
	                    : canSubmitPoleReport
	                      ? "Submit Pole Report  ✓"
	                      : "Recapture GPS + 3 Photos required"}
	                </Text>
	              </Pressable>
	            )
	          ) : isBatchBeforeCaptureMode ? (
            <>
              {batchUploadStatus && (
                <View style={{
                  marginBottom: 8,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  backgroundColor: batchUploadStatus === "uploaded" ? "#ECFDF5" : "#FFF7E8",
                  borderWidth: 1,
                  borderColor: batchUploadStatus === "uploaded" ? "#A7F3D0" : "#FDE68A",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}>
                  <Text style={{ fontSize: 13 }}>
                    {batchUploadStatus === "uploaded" ? "✅" : "📶"}
                  </Text>
                  <Text style={{
                    fontSize: 11,
                    fontWeight: "700",
                    color: batchUploadStatus === "uploaded" ? "#059669" : "#B45309",
                    flex: 1,
                  }}>
                    {batchUploadStatus === "uploaded"
                      ? "Before photo uploaded to server"
                      : "Offline — queued for Sync All"}
                  </Text>
                </View>
              )}
              <Pressable
                style={({ pressed }) => [
                  styles.submitBtn,
                  { backgroundColor: canBatchBeforeSave ? accentColor : "#C9CED6" },
                  pressed && canBatchBeforeSave && styles.pressedDown,
                ]}
                onPress={handleBatchBeforeSave}
                disabled={!canBatchBeforeSave}
              >
                <Text style={styles.submitText}>
                  {canBatchBeforeSave ? "Save Before & Back to Map  →" : "Capture GPS and Before first"}
                </Text>
              </Pressable>
            </>
          ) : !teardownStarted ? (
            <Pressable
              style={({ pressed }) => [
                styles.submitBtn,
                { backgroundColor: startingPole ? "#6B7280" : accentColor },
                pressed && !startingPole && styles.pressedDown,
              ]}
              onPress={handleStartPole}
              disabled={startingPole}
            >
              {startingPole
                ? <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                : <Text style={[styles.submitText, { marginRight: 6 }]}>▶</Text>}
              <Text style={styles.submitText}>
                {startingPole ? "Starting…" : "Start Pole Teardown"}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.submitBtn,
                { backgroundColor: canProceedToSpans ? accentColor : "#C9CED6" },
                pressed && canProceedToSpans && styles.pressedDown,
              ]}
              onPress={handleNext}
              disabled={!canProceedToSpans}
            >
              <Text style={styles.submitText}>
                {canProceedToSpans ? "Select Pair  →" : "Complete required fields first"}
              </Text>
            </Pressable>
          )}
        </View>
        {/* ── Pole Report Success Modal ─────────────────────────────── */}
        <Modal
          visible={submitSuccessOpen}
          transparent
          animationType="fade"
          onRequestClose={() => { setSubmitSuccessOpen(false); router.navigate({ pathname: "/teardowns/poles" as any, params: { nodeId: node_id, nodeName: node_name || "" } }); }}
        >
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", alignItems: "center", padding: 24 }}>
            <View style={{
              backgroundColor: "#0F1A14",
              borderRadius: 28,
              padding: 28,
              width: "100%",
              maxWidth: 380,
              borderWidth: 1,
              borderColor: "rgba(16,185,129,0.25)",
              shadowColor: "#10b981",
              shadowOpacity: 0.2,
              shadowRadius: 24,
              elevation: 12,
            }}>
              {/* Icon ring */}
              <View style={{ alignItems: "center", marginBottom: 20 }}>
                <View style={{
                  width: 80, height: 80, borderRadius: 40,
                  backgroundColor: "rgba(16,185,129,0.12)",
                  borderWidth: 2, borderColor: "rgba(16,185,129,0.4)",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <View style={{
                    width: 52, height: 52, borderRadius: 26,
                    backgroundColor: "#10b981",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <Text style={{ fontSize: 26, color: "#fff" }}>✓</Text>
                  </View>
                </View>
              </View>

              {/* Title */}
              <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900", textAlign: "center", marginBottom: 4, letterSpacing: -0.3 }}>
                Report Submitted!
              </Text>
              <Text style={{ color: "#A7F3D0", fontSize: 13, fontWeight: "700", textAlign: "center", marginBottom: 20 }}>
                Pole report saved successfully
              </Text>

              {/* Info row */}
              <View style={{
                backgroundColor: "rgba(255,255,255,0.05)",
                borderRadius: 16,
                padding: 14,
                gap: 10,
                marginBottom: 24,
              }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: "#6EE7B7", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 }}>Pole</Text>
                  <Text style={{ color: "#fff", fontSize: 13, fontWeight: "900" }} numberOfLines={1}>{editedPoleName || pole_name || pole_code}</Text>
                </View>
                <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.07)" }} />
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: "#6EE7B7", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 }}>Node</Text>
                  <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>{node_name || node_id}</Text>
                </View>
                {submitSuccessTime ? (
                  <>
                    <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.07)" }} />
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ color: "#6EE7B7", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 }}>Submitted</Text>
                      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
                        {(() => {
                          try {
                            const d = new Date(submitSuccessTime);
                            const pht = new Date(d.getTime() + 8 * 3600 * 1000);
                            const h = pht.getUTCHours(), m = pht.getUTCMinutes();
                            const ampm = h >= 12 ? "PM" : "AM";
                            return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2,"0")} ${ampm}`;
                          } catch { return "—"; }
                        })()}
                      </Text>
                    </View>
                  </>
                ) : null}
              </View>

              {/* Done button */}
              <Pressable
                style={({ pressed }) => [{
                  backgroundColor: "#10b981",
                  borderRadius: 16,
                  paddingVertical: 16,
                  alignItems: "center",
                  shadowColor: "#10b981",
                  shadowOpacity: 0.4,
                  shadowRadius: 12,
                  elevation: 6,
                  opacity: pressed ? 0.85 : 1,
                }]}
                onPress={() => {
                  setSubmitSuccessOpen(false);
                  router.navigate({ pathname: "/teardowns/poles" as any, params: { nodeId: node_id, nodeName: node_name || "" } });
                }}
              >
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: "900", letterSpacing: 0.2 }}>Back to Poles  →</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal
          visible={viewerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setViewerOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setViewerOpen(false)}
            />

            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>{viewerLabel}</Text>
                  <Text style={styles.modalSubtitle}>
                    {viewerTab === "before" && beforeLocked ? "🔒 Locked · view only" : "Preview photo"}
                  </Text>
                </View>

                <Pressable
                  onPress={() => setViewerOpen(false)}
                  style={({ pressed }) => [
                    styles.modalCloseBtn,
                    pressed && styles.pressedDown,
                  ]}
                >
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
                <Pressable
                  style={({ pressed }) => [
                    viewerTab === "before" && beforeLocked ? styles.modalPrimaryBtn : styles.modalGhostBtn,
                    viewerTab === "before" && beforeLocked && { backgroundColor: "#6B7280" },
                    pressed && styles.pressedDown,
                  ]}
                  onPress={() => setViewerOpen(false)}
                >
                  <Text style={viewerTab === "before" && beforeLocked ? styles.modalPrimaryBtnText : styles.modalGhostBtnText}>
                    Close
                  </Text>
                </Pressable>

                {!(viewerTab === "before" && beforeLocked) && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.modalPrimaryBtn,
                      { backgroundColor: accentColor },
                      pressed && styles.pressedDown,
                    ]}
                    onPress={() => {
                      setViewerOpen(false);
                      viewerRetake?.();
                    }}
                  >
                    <Text style={styles.modalPrimaryBtnText}>Retake</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </Modal>


        {/* ── Edit Pole Name Modal ── */}
        <Modal
          visible={editNameModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setEditNameModalOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.editNameCard}>
              <Text style={styles.editNameTitle}>Edit Pole Name</Text>
              <Text style={styles.editNameSub}>
                Changes will be saved to the server immediately.
              </Text>
              <TextInput
                style={styles.editNameInput}
                value={editNameDraft}
                onChangeText={setEditNameDraft}
                placeholder="Enter pole name"
                placeholderTextColor="#9CA3AF"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (!savingName && editNameDraft.trim()) handleSavePoleNameEdit();
                }}
                selectionColor={accentColor}
              />
              <View style={styles.editNameActions}>
                <Pressable
                  style={({ pressed }) => [styles.editNameCancelBtn, pressed && styles.pressedDown]}
                  onPress={() => setEditNameModalOpen(false)}
                  disabled={savingName}
                >
                  <Text style={styles.editNameCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.editNameSaveBtn,
                    { backgroundColor: accentColor },
                    (savingName || !editNameDraft.trim()) && { opacity: 0.5 },
                    pressed && styles.pressedDown,
                  ]}
                  onPress={handleSavePoleNameEdit}
                  disabled={savingName || !editNameDraft.trim()}
                >
                  {savingName ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.editNameSaveText}>Save</Text>
                  )}
                </Pressable>
              </View>
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

        {/* ── Fullscreen Map Modal ── */}
        <Modal
          visible={mapFullscreen}
          animationType="slide"
          statusBarTranslucent
          onRequestClose={() => setMapFullscreen(false)}
        >
          <View style={{ flex: 1, backgroundColor: '#0d1117' }}>
            {/* Header */}
            <View style={styles.mapModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.mapModalTitle}>Pole Location</Text>
                {lat !== null && lng !== null && (
                  <Text style={styles.mapModalCoords}>{lat.toFixed(7)},  {lng.toFixed(7)}</Text>
                )}
              </View>
              <TouchableOpacity
                onPress={() => setMapSatellite(v => !v)}
                style={styles.mapModalLayerBtn}
              >
                <Text style={styles.mapModalLayerText}>{mapSatellite ? '🗺 Map' : '🛰 Satellite'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setMapFullscreen(false)}
                style={styles.mapModalCloseBtn}
              >
                <Text style={styles.mapModalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            {/* Full map */}
            {lat !== null && lng !== null && (
              <WebView
                key={`mapfs-${lat}-${lng}-${mapSatellite}`}
                style={{ flex: 1 }}
                originWhitelist={["*"]}
                javaScriptEnabled
                domStorageEnabled
                mixedContentMode="always"
                source={{
                  html: buildPoleMapHtml(lat, lng, accentColor, mapSatellite),
                  baseUrl: "https://local.telcovantage/",
                }}
                cacheEnabled={false}
              />
            )}
          </View>
        </Modal>

        {/* ── Tabbed Camera Modal ── */}
        <Modal
          visible={showCameraModal}
          animationType="slide"
          statusBarTranslucent
          supportedOrientations={["portrait"]}
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
                  ? () => { captureGenRef.current++; setBlurWarning(false); setPhotoBefore(null); setQualityBefore(null); cacheSet(`pole_quality_before_${pole_id}`, null).catch(() => {}); }
                  : activeCameraTab === "after"
                  ? () => { captureGenRef.current++; setBlurWarning(false); setPhotoAfter(null); setQualityAfter(null); cacheSet(`pole_quality_after_${pole_id}`, null).catch(() => {}); }
                  : () => { captureGenRef.current++; setBlurWarning(false); setPhotoTag(null); setQualityTag(null); cacheSet(`pole_quality_tag_${pole_id}`, null).catch(() => {}); };
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
                    </View>
                  );
                }
                if (cameraPermission?.granted) {
                  const stampPreviewLines = buildStampLines(activeCameraTab as any);
                  const previewLat = lat ?? liveCoords?.lat ?? null;
                  const previewLng = lng ?? liveCoords?.lng ?? null;
                  const mapInfo = previewLat != null && previewLng != null
                    ? streetTileInfo(previewLat, previewLng, 18)
                    : null;

                  return (
                    <GestureDetector gesture={pinchGesture}>
                      <View style={StyleSheet.absoluteFillObject}>
                        <CameraView
                          ref={cameraRef}
                          style={StyleSheet.absoluteFillObject}
                          facing="back"
                          zoom={cameraZoom}
                          onCameraReady={() => setCameraReady(true)}
                        />
                        {lat !== null && lng !== null && (
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
                              borderColor: "rgba(255,255,255,0.15)"
                            }}
                          >
                            <View style={{ flexDirection: "row", alignItems: "center" }}>
                              <Text style={{ fontSize: 16, marginRight: 8 }}>📍</Text>
                              <View>
                                <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "600" }}>Target Coordinates</Text>
                                <Text style={{ color: "#9CA3AF", fontSize: 11 }}>{lat.toFixed(6)}, {lng.toFixed(6)}</Text>
                              </View>
                            </View>
                            {liveCoords ? (
                              <View style={{ alignItems: "flex-end" }}>
                                <Text style={{ color: accentColor, fontSize: 13, fontWeight: "800" }}>
                                  {computeDistanceMeters(lat, lng, liveCoords.lat, liveCoords.lng)}m Range
                                </Text>
                                <Text style={{ color: "#A7F3D0", fontSize: 9 }}>Verified</Text>
                              </View>
                            ) : (
                              <Text style={{ color: accentColor, fontSize: 12, fontWeight: "600" }}>Active</Text>
                            )}
                          </View>
                        )}

                        {/* ── Live stamp preview overlay (bottom of camera) ── */}
                        <View style={{
                          position: "absolute", bottom: 8, left: 8, right: 8,
                          flexDirection: "row", alignItems: "stretch", gap: 6,
                        }}>
                          {/* Text info panel */}
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

                          {/* Street map thumbnail — GPS point always at center */}
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
                                  captureGenRef.current++; // cancel any pending background
                                  setBlurWarning(false);
                                  if (activeCameraTab === "before") { setPhotoBefore(null); setQualityBefore(null); cacheSet(`pole_quality_before_${pole_id}`, null).catch(() => {}); }
                                  else if (activeCameraTab === "after") { setPhotoAfter(null); setQualityAfter(null); cacheSet(`pole_quality_after_${pole_id}`, null).catch(() => {}); }
                                  else { setPhotoTag(null); setQualityTag(null); cacheSet(`pole_quality_tag_${pole_id}`, null).catch(() => {}); }
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
                  { borderColor: accentColor, opacity: cameraReady ? 1 : 0.35 },
                  pressed && { transform: [{ scale: 0.94 }] }
                ]}
                onPress={captureFromCamera}
                disabled={!cameraReady || photoCapturing}
                hitSlop={{ top: 30, bottom: 30, left: 30, right: 30 }}
              >
                <View style={[
                  styles.cameraCaptureInner,
                  { backgroundColor: accentColor },
                  photoCapturing && { opacity: 0.4 }
                ]} />
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

        {/* ── Premium Out of Area Alert Modal ── */}
        <Modal
          visible={!!outOfAreaAlert?.visible}
          transparent
          animationType="fade"
          onRequestClose={() => setOutOfAreaAlert(null)}
        >
          <View style={styles.prModalOverlay}>
            <View style={styles.alertModalCard}>
              <View style={[styles.alertModalSuccessIcon, { backgroundColor: "#FFF1F2", borderColor: "#FECDD3" }]}>
                <Text style={{ fontSize: 24 }}>📍</Text>
              </View>
              <Text style={styles.alertModalTitle}>Too Far From Pole</Text>
              <Text style={styles.alertModalText}>
                You must be within <Text style={{ fontWeight: "bold", color: "#111827" }}>50 meters</Text> of the pole coordinates to take authentic site photos.{"\n\n"}
                Current distance: <Text style={{ fontWeight: "900", color: "#111827" }}>{outOfAreaAlert?.distance} meters</Text>.
              </Text>
              <TouchableOpacity
                style={[styles.alertModalBtnFull, { backgroundColor: accentColor, marginTop: 16 }]}
                onPress={() => setOutOfAreaAlert(null)}
              >
                <Text style={styles.alertModalBtnFullText}>Understood</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* ── GPS Confirm Replace Modal ── */}
        <Modal
          transparent
          visible={gpsConfirmModal}
          animationType="fade"
          onRequestClose={() => setGpsConfirmModal(false)}
        >
          <View style={styles.prModalOverlay}>
            <View style={styles.alertModalCard}>
              <Text style={styles.alertModalTitle}>Replace GPS?</Text>
              <Text style={styles.alertModalText}>
                This pole already has coordinates:{"\n"}
                {lat?.toFixed(6)}, {lng?.toFixed(6)}
              </Text>
              <Text style={[styles.alertModalText, { marginTop: 8, color: "#EF4444" }]}>
                Retaking will replace the saved location.
              </Text>

              <View style={styles.alertModalBtnRow}>
                <TouchableOpacity
                  style={styles.alertModalBtnCancel}
                  onPress={() => setGpsConfirmModal(false)}
                >
                  <Text style={styles.alertModalBtnCancelText}>CANCEL</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.alertModalBtnConfirm}
                  onPress={() => {
                    setGpsConfirmModal(false);
                    confirmAndCaptureGps();
                  }}
                >
                  <Text style={styles.alertModalBtnConfirmText}>RETAKE GPS</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── GPS Success Modal ── */}
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
                {lat?.toFixed(6)}, {lng?.toFixed(6)}
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

        {/* ── Custom Gate Intercept Alert Modal ── */}
        <Modal
          transparent
          visible={!!gateAlertModal}
          animationType="fade"
          onRequestClose={() => setGateAlertModal(null)}
        >
          <View style={styles.prModalOverlay}>
            <View style={styles.alertModalCard}>
              <View style={[styles.alertModalSuccessIcon, { backgroundColor: "#FFFBEB", borderColor: "#FCD34D" }]}>
                <Text style={{ fontSize: 22, color: "#F59E0B", fontWeight: "900" }}>⚠️</Text>
              </View>
              <Text style={styles.alertModalTitle}>{gateAlertModal?.title}</Text>
              <Text style={styles.alertModalText}>{gateAlertModal?.message}</Text>

              <TouchableOpacity
                style={[styles.alertModalBtnFull, { backgroundColor: "#F59E0B" }]}
                onPress={() => setGateAlertModal(null)}
              >
                <Text style={styles.alertModalBtnFullText}>GOT IT</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

      </SafeAreaView>
    </>
  );
}

export default PoleDetailScreen;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F4F6F8",
  },
  floatingHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: "transparent",
    zIndex: 20,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.2,
    borderColor: "#E2E8F0",
  },
  floatingHeaderText: { 
    alignItems: "flex-end",
    maxWidth: "75%",
  },
  headerTitle: { fontSize: 18, fontWeight: "900", color: "#0F172A", textAlign: "right" },
  headerSub: { marginTop: 1, fontSize: 12, color: "#334155", fontWeight: "800", textAlign: "right" },

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

  heroCard: {
    borderRadius: 32,
    overflow: "hidden",
    marginBottom: 16,
    minHeight: 180,
    backgroundColor: "#0F172A",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },

  heroBg: {
    ...StyleSheet.absoluteFillObject,
  },

  heroGlowLeft: {
    position: "absolute",
    left: -60,
    top: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    opacity: 0.35,
  },

  heroGlowRight: {
    position: "absolute",
    right: -40,
    bottom: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "#3B82F6",
    opacity: 0.2,
  },

  heroGlassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
  },

  heroContent: {
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 22,
    justifyContent: "space-between",
    flex: 1,
    zIndex: 2,
  },

  heroTopLine: {
    flexDirection: "row",
    justifyContent: "flex-start",
  },

  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },

  heroBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
  },

  heroTopTimerPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    gap: 4,
  },

  heroTopTimerIcon: {
    fontSize: 10,
  },

  heroTopTimerText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#F8FAFC",
    fontVariant: ["tabular-nums"],
  },

  heroMainBlock: {
    marginTop: 16,
    marginBottom: 12,
  },

  heroTitleRowWrapper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  heroTitle: {
    flex: 1,
    fontSize: 30,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -0.8,
    lineHeight: 36,
  },

  heroEditPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    gap: 4,
  },

  heroEditPillIcon: {
    fontSize: 12,
    color: "#94A3B8",
  },

  heroEditPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#E2E8F0",
  },

  heroIntegratedFooter: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  heroSummaryTable: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  heroSummaryCol: {
    flex: 1,
    alignItems: "center",
  },
  heroSummaryDivider: {
    width: 1,
    height: 24,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  heroSummaryLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#64748B",
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  heroSummaryValue: {
    fontSize: 10,
    fontWeight: "800",
    color: "#E2E8F0",
    textAlign: "center",
  },
  heroFooterHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  heroFooterTitle: {
    fontSize: 10,
    fontWeight: "900",
    color: "#94A3B8",
    letterSpacing: 0.8,
  },
  heroFooterPercentText: {
    fontSize: 12,
    fontWeight: "900",
  },
  heroTrackerNodesRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    marginBottom: 8,
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
    marginTop: 8,
    fontSize: 13,
    color: "rgba(255,255,255,0.82)",
    fontWeight: "600",
  },

  progressCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#EAECEF",
    shadowColor: "#0F172A",
    shadowOpacity: 0.035,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },

  poleStartStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 10,
  },
  poleStartLabel: {
    fontSize: 9,
    fontWeight: "900",
    color: "#059669",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  poleStartValue: {
    fontSize: 11,
    fontWeight: "700",
    color: "#065F46",
    flex: 1,
  },

  progressTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  progressTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
  },

  progressPercent: {
    fontSize: 13,
    fontWeight: "900",
  },

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
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 5,
  },

  trackerMiniDotDone: {
    backgroundColor: "#DCFCE7",
    borderColor: "#DCFCE7",
  },

  trackerMiniDotText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#94A3B8",
  },

  trackerMiniDotTextDone: {
    color: "#166534",
  },

  trackerMiniLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#94A3B8",
  },

  trackerMiniLabelDone: {
    color: "#A7F3D0",
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
  lockedSection: {
    opacity: 0.6,
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

  mapModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
    backgroundColor: "#0d1117",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  mapModalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#fff",
  },
  mapModalCoords: {
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    fontFamily: "monospace",
    marginTop: 2,
  },
  mapModalLayerBtn: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  mapModalLayerText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  mapModalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  mapModalCloseText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
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

  gpsPinRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 2,
  },

  gpsPinIcon: {
    fontSize: 14,
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
    alignItems: "flex-start",
  },

  photoHalf: {
    flex: 1,
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
    margin: 6,
    backgroundColor: "transparent",
  },

  photoTilePlaceholderLogo: {
    width: "75%",
    height: "75%",
    opacity: 1,
  },

  photoTilePlaceholderText: {
    position: "absolute",
    bottom: 8,
    fontSize: 9,
    fontWeight: "800",
    color: "#94A3B8",
    letterSpacing: 0.2,
  },
  photoTileCameraIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  photoTileTapText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#94A3B8",
    textAlign: "center",
    letterSpacing: 0.3,
  },
  photoTileLabelRow: {
    flexDirection: "row" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 4,
  },
  photoTileCheck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  photoTileCheckText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
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

  photoTileCompact: {
    padding: 14,
  },

  photoTileTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },

  photoTileTopCompact: {
    marginBottom: 12,
  },

  photoTileIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#F4F6F8",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },

  photoTileIconWrapCompact: {
    width: 40,
    height: 40,
    borderRadius: 14,
    marginRight: 10,
  },

  photoTileIcon: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
  },

  photoTileIconCompact: {
    fontSize: 16,
  },

  photoTileHeaderText: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
    paddingTop: 1,
  },

  photoTileTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
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

  photoRequiredBadge: {
    backgroundColor: "#FFF7E7",
    borderWidth: 1,
    borderColor: "#F5D9A7",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },

  photoRequiredBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#B45309",
  },

  photoTileSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: "#667085",
    fontWeight: "500",
    marginTop: 7,
  },

  photoTileSubtitleCompact: {
    fontSize: 12,
    lineHeight: 17,
    color: "#667085",
    fontWeight: "600",
    marginTop: 6,
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


  photoTileBottom: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },

  photoSavedRow: {
    alignItems: "center",
    marginTop: 8,
  },

  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },

  statusChipSuccess: {
    backgroundColor: "#DDF5E8",
  },

  statusChipMuted: {
    backgroundColor: "#F3F4F6",
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

  statusChipTextMuted: {
    color: "#667085",
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
    backgroundColor: "transparent",
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 8,
  },

  submitBtn: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 16,
    paddingVertical: 14,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },

  submitText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },

  requirementsList: {
    backgroundColor: "#FFF7E7",
    borderRadius: 18,
    padding: 14,
    gap: 5,
    borderWidth: 1,
    borderColor: "#F5D9A7",
  },

  reqItem: {
    fontSize: 12,
    color: "#B45309",
    fontWeight: "700",
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(12,16,24,0.62)",
    justifyContent: "center",
    padding: 18,
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

  // Draft recovery banner
  draftBanner: {
    backgroundColor: "#EFF6FF",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  draftBannerText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1D4ED8",
  },

  // Work timer
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
    paddingBottom: 36,
    paddingTop: 16,
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
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  cameraCaptureInner: {
    width: 70,
    height: 70,
    borderRadius: 35,
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

  cameraPreviewRow: {
    flex: 1,
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 4,
    gap: 10,
  },

  // Blur warning overlay inside the camera view
  blurWarningOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
    borderRadius: 20,
  },

  blurWarningIcon: {
    fontSize: 36,
  },

  blurWarningTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#FFFFFF",
    textAlign: "center",
  },

  blurWarningBody: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
    lineHeight: 20,
  },

  blurRetakeBtn: {
    marginTop: 8,
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },

  blurRetakeBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },

  blurWarningActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },

  blurKeepBtn: {
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.4)",
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

  // Zoom controls
  zoomControls: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
  },

  zoomBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },

  zoomBtnText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "300",
    lineHeight: 26,
  },

  zoomTrack: {
    flex: 1,
    width: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 2,
    overflow: "hidden",
    justifyContent: "flex-end",
  },

  zoomFill: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 2,
  },

  // ── Pole Report styles ───────────────────────────────────────────────────
  prFieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 6,
  },
  prChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  prChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    backgroundColor: "#F9FAFB",
  },
  prChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    textTransform: "capitalize",
  },

  prAddSlotBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  prAddSlotBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  prEmptyHint: {
    fontSize: 13,
    color: "#9CA3AF",
    textAlign: "center",
    paddingVertical: 16,
  },

  prSlotCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    overflow: "hidden",
    marginTop: 10,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 3,
  },
  prSlotHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  prSlotTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  prSlotCount: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    fontWeight: "600",
  },
  prSlotDel: {
    padding: 4,
  },
  prSlotDelText: {
    fontSize: 15,
  },
  prSlotChevron: {
    padding: 4,
  },
  prSlotChevronText: {
    fontSize: 11,
    color: "#FFFFFF",
  },
  prSlotBody: {
    padding: 12,
    gap: 8,
  },

  prItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F9FAFB",
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: "#F3F4F6",
  },
  prItemCategoryBadge: {
    backgroundColor: "#DBEAFE",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  prItemCategoryEquip: {
    backgroundColor: "#FEF3C7",
  },
  prItemCategoryAccy: {
    backgroundColor: "#FCE7F3",
  },
  prItemCategory: {
    fontSize: 9,
    fontWeight: "900",
    color: "#1E40AF",
    letterSpacing: 0.3,
  },
  prItemTypePill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 4,
  },
  prItemTypeText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
  },
  prItemTypeChev: {
    fontSize: 14,
    color: "#9CA3AF",
    fontWeight: "700",
  },
  prDropdownSelectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F9FAFB",
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  prDropdownSelectText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    textTransform: "capitalize",
    marginRight: 4,
  },
  prDropdownPlaceholder: {
    color: "#9CA3AF",
    textTransform: "none",
  },
  prDropdownSelectIcon: {
    fontSize: 11,
    color: "#6B7280",
    fontWeight: "800",
  },
  prItemQtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  prQtyBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
  },
  prQtyBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#374151",
    lineHeight: 18,
  },
  prQtyVal: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
    minWidth: 20,
    textAlign: "center",
  },
  prQtyUnit: {
    fontSize: 11,
    color: "#6B7280",
    fontWeight: "600",
  },
  prItemDel: {
    padding: 4,
  },
  prItemDelText: {
    fontSize: 13,
    color: "#EF4444",
    fontWeight: "700",
  },

  prItemAddBtns: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  prItemAddBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  prItemAddBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#374151",
  },

  // Modals
  prModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  prModalCard: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    padding: 24,
    maxWidth: 380,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 4,
  },
  prPickerCard: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    paddingVertical: 12,
    maxWidth: 340,
    maxHeight: 420,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 4,
  },
  prModalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 12,
  },
  prModalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  prModalCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
  },
  prModalCancelText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#374151",
  },
  prModalConfirm: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  prModalConfirmText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  prPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  prPickerRowText: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "500",
    textTransform: "capitalize",
  },

  draftSavedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#D1FAE5",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  draftSavedText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#065F46",
  },

  // ── Custom Popup Alerts ──────────────────────────────────────────────────
  alertModalCard: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
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
  alertModalBtnRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
    width: "100%",
  },
  alertModalBtnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
  },
  alertModalBtnCancelText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748B",
  },
  alertModalBtnConfirm: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#EF4444",
    alignItems: "center",
  },
  alertModalBtnConfirmText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
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
});











