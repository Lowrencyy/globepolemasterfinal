import api from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getDisplayTime, getPHTNow } from "@/lib/display-time";
import { simpleQueuePush } from "@/lib/simple-queue";
import { gpsQueueGet } from "@/lib/gps-queue";
import * as FileSystem from "expo-file-system/legacy";
import { Image as ExpoImage } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import * as MediaLibrary from "expo-media-library";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
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

const SLOTS = ["DA", "C1", "C2", "C3", "C4", "C5"] as const;
const REQUIRED_GPS_ACCURACY_METERS = 10;

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

function sanitize(s?: string) {
  return (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "_");
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

function getCompletionState({
  hasGps,
  photoBefore,
  photoAfter,
  photoTag,
  slot,
  landmark,
}: {
  hasGps: boolean;
  photoBefore: PhotoField;
  photoAfter: PhotoField;
  photoTag: PhotoField;
  slot: string;
  landmark: string;
}) {
  const completed = [
    hasGps,
    !!photoBefore,
    !!photoAfter,
    !!photoTag,
    !!slot,
    !!landmark.trim(),
  ].filter(Boolean).length;

  return {
    completed,
    total: 6,
    percent: Math.round((completed / 6) * 100),
  };
}

function buildPoleMapHtml(lat: number, lng: number, accentColor: string) {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body,#map{width:100%;height:100%;background:#f0f4f8;}
.leaflet-div-icon{background:none!important;border:none!important;}
.pin-pulse{
  width:20px;height:20px;border-radius:50%;
  background:${accentColor};
  box-shadow:0 0 0 0 ${accentColor}66;
  animation:pulse 1.8s infinite;
}
@keyframes pulse{
  0%{box-shadow:0 0 0 0 ${accentColor}66;}
  70%{box-shadow:0 0 0 14px ${accentColor}00;}
  100%{box-shadow:0 0 0 0 ${accentColor}00;}
}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('map',{
  zoomControl:true,
  scrollWheelZoom:false,
  dragging:true,
  doubleClickZoom:false,
  touchZoom:true
}).setView([${lat},${lng}],17);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{
  subdomains:'abcd',
  maxZoom:20
}).addTo(map);

var icon=L.divIcon({
  className:'',
  html:'<div class="pin-pulse"></div>',
  iconSize:[20,20],
  iconAnchor:[10,10]
});

L.marker([${lat},${lng}],{icon:icon}).addTo(map);

setTimeout(function(){map.invalidateSize();},100);
</script>
</body>
</html>`;
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
  label,
  photo,
  accentColor,
  onCapture,
  onView,
}: {
  label: string;
  photo: PhotoField;
  accentColor: string;
  onCapture: () => void;
  onView: () => void;
}) {
  return (
    <Pressable
      style={[styles.photoTileCard, photo ? { borderColor: accentColor } : {}]}
      onPress={photo ? onView : onCapture}
    >
      <View style={styles.photoTileImgWrap}>
        {photo ? (
          <>
            <ExpoImage source={{ uri: photo.uri }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={150} />
            <View style={[styles.photoDoneBadge, { backgroundColor: accentColor }]}>
              <Text style={styles.photoDoneBadgeText}>✓</Text>
            </View>
            <View style={styles.photoViewHint}>
              <Text style={styles.photoViewHintText}>VIEW</Text>
            </View>
          </>
        ) : (
          <View style={styles.photoTilePlaceholder}>
            <Text style={styles.photoTilePlaceholderIcon}>📷</Text>
            <Text style={styles.photoTilePlaceholderText}>Tap</Text>
          </View>
        )}
      </View>
      <Text style={[styles.photoTileLabel, photo ? { color: accentColor } : {}]}>
        {label}
      </Text>
    </Pressable>
  );
}

const STAMP_HTML = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#000"><canvas id="c"></canvas><script>
function stamp(payload){
  var data;try{data=JSON.parse(payload);}catch(ex){window.ReactNativeWebView.postMessage(JSON.stringify({error:'parse'}));return;}
  var img=new Image();
  img.onload=function(){
    var c=document.getElementById('c');
    c.width=img.width;c.height=img.height;
    var ctx=c.getContext('2d');
    ctx.drawImage(img,0,0);
    var lines=data.lines;
    var fSize=Math.max(22,Math.round(img.width*0.024));
    var lh=Math.round(fSize*1.6);
    var pad=Math.round(fSize*0.9);
    var totalH=lines.length*lh+pad*2;
    var grad=ctx.createLinearGradient(0,img.height-totalH-30,0,img.height);
    grad.addColorStop(0,'rgba(0,0,0,0)');
    grad.addColorStop(0.35,'rgba(0,0,0,0.55)');
    grad.addColorStop(1,'rgba(0,0,0,0.80)');
    ctx.fillStyle=grad;
    ctx.fillRect(0,img.height-totalH-30,img.width,totalH+30);
    ctx.font='bold '+fSize+'px Arial,sans-serif';
    ctx.fillStyle='#FFFFFF';
    ctx.shadowColor='rgba(0,0,0,0.9)';
    ctx.shadowBlur=5;
    lines.forEach(function(line,i){
      ctx.fillText(line,pad,img.height-totalH+pad+(i+1)*lh-6);
    });
    var b64=c.toDataURL('image/jpeg',0.92).split(',')[1];
    window.ReactNativeWebView.postMessage(JSON.stringify({stamped:b64}));
  };
  img.onerror=function(){window.ReactNativeWebView.postMessage(JSON.stringify({error:'load'}));};
  img.src='data:image/jpeg;base64,'+data.b64;
}
document.addEventListener('message',function(e){stamp(e.data);});
window.addEventListener('message',function(e){stamp(e.data);});
window.ReactNativeWebView.postMessage(JSON.stringify({ready:1}));
<\/script></body></html>`;

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
  const [viewerPhoto, setViewerPhoto] = useState<PhotoField>(null);
  const [viewerRetake, setViewerRetake] = useState<(() => void) | null>(null);
  const [slot, setSlot] = useState("");
  const [landmark, setLandmark] = useState("");

  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [capturedGps, setCapturedGps] = useState<GpsData | null>(null);
  const [gpsCapturing, setGpsCapturing] = useState(false);

  const [showCameraModal, setShowCameraModal] = useState(false);
  const [activeCameraTab, setActiveCameraTab] = useState<"before" | "after" | "tag">("before");
  const cameraRef = useRef<React.ComponentRef<typeof CameraView>>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraZoom, setCameraZoom] = useState(0);
  const pinchBaseZoom = useRef(0);
  const pinchGesture = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => { pinchBaseZoom.current = cameraZoom; })
    .onUpdate((e) => {
      setCameraZoom(Math.min(1, Math.max(0, pinchBaseZoom.current + (e.scale - 1) * 0.5)));
    });
  const [blurWarning, setBlurWarning] = useState(false);


  const [elapsedSecs, setElapsedSecs] = useState(0);

  const timerStartRef = useRef(Date.now());
  // Record ISO start time when lineman enters this screen — sent to backend as started_at
  const startedAtRef  = useRef(new Date().toISOString());
  const toPoleGpsRef = useRef<GpsData | null>(null);
  const locationWatcher = useRef<Location.LocationSubscription | null>(null);
  const blurCheckRef = useRef<WebView>(null);
  const blurResolverRef = useRef<((variance: number) => void) | null>(null);
  const stampRef = useRef<WebView>(null);
  const stampResolverRef = useRef<((b64: string | null) => void) | null>(null);

  const hasGps = !!capturedGps;
  const infoComplete = hasGps && !!slot && !!landmark.trim();

  // Always allow starting — don't block the user with "complete required fields first"
  // Missing fields will be indicated by the progress tracker but won't block navigation
  const canProceed = true;

  const progress = useMemo(
    () =>
      getCompletionState({
        hasGps,
        photoBefore,
        photoAfter,
        photoTag,
        slot,
        landmark,
      }),
    [hasGps, photoBefore, photoAfter, photoTag, slot, landmark],
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
          setCapturedGps({
            latitude: g.lat,
            longitude: g.lng,
            accuracy: null,
            captured_at: new Date().toISOString(),
          });
        } else {
          const q = await gpsQueueGet(params.to_pole_id);
          if (q?.lat && q?.lng) {
            setCapturedGps({
              latitude: q.lat,
              longitude: q.lng,
              accuracy: null,
              captured_at: await getDisplayTime(),
            });
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
            setCapturedGps(
              (prev) =>
                prev ?? {
                  latitude: lat,
                  longitude: lng,
                  accuracy: null,
                  captured_at: getPHTNow(),
                },
            );
            cacheSet(`pole_gps_${params.to_pole_id}`, { lat, lng }).catch(
              () => {},
            );
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

    (async () => {
      await FileSystem.makeDirectoryAsync(draftDir, { intermediates: true });

      const poleDraftDir = `${FileSystem.documentDirectory}pole_drafts/${projFolder}/${params.node_id}/${params.to_pole_id}/`;

      // Load a photo for this teardown session.
      // Priority 1: teardown_drafts (captured on this screen — always fresh).
      // Priority 2 (before & tag only): pole_drafts from a previous pole-detail visit.
      //   → copied into teardown_drafts so submission reads from one place.
      // After is NEVER reused — each span needs a fresh after photo.
      const load = async (
        tdFile: string,
        pdFile: string | null, // null = never fall back to pole_drafts
      ): Promise<PhotoField | null> => {
        const tdPath = draftDir + tdFile;
        const tdInfo = await FileSystem.getInfoAsync(tdPath).catch(() => ({ exists: false }));
        if ((tdInfo as any).exists) {
          const viewPath = tdPath.replace(/\.jpg$/i, "_view.jpg");
          const viewInfo = await FileSystem.getInfoAsync(viewPath).catch(() => ({ exists: false }));
          const version = Date.now();
          return {
            uri: `${(viewInfo as any).exists ? viewPath : tdPath}?v=${version}`,
            fileUri: tdPath,
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
            const version = Date.now();
            return {
              uri: `${(viewInfo as any).exists ? tdViewPath : tdPath}?v=${version}`,
              fileUri: tdPath,
              name: tdFile,
              type: "image/jpeg",
              version,
            };
          }
        }

        return null;
      };

      const [b, a, t] = await Promise.all([
        load(F.before, `pole_${params.to_pole_id}_before.jpg`),  // reuse if available
        load(F.after,  null),                                     // always fresh
        load(F.tag,    `pole_${params.to_pole_id}_poletag.jpg`),  // reuse if available
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
    params.pole_code,
    params.to_pole_code,
    params.to_pole_id,
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

  function buildStampLines(tab: "before" | "after" | "tag"): string[] {
    const name = editedToPoleName || params.to_pole_name || params.to_pole_code || "";
    const tabLabel = tab === "before" ? "BEFORE" : tab === "after" ? "AFTER" : "POLE TAG";
    const gps = capturedGps;
    const gpsText = gps ? `${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}` : "GPS not captured";
    const time = getPHTNow().replace("T", " ").substring(0, 19) + " PHT";
    return [
      `${name}  [${tabLabel}]`,
      `GPS: ${gpsText}`,
      `${time}  \u2022  ${params.project_name || ""}`,
    ];
  }

  async function stampPhoto(uri: string, lines: string[]): Promise<string> {
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" as any });
      const payload = JSON.stringify({ b64, lines });
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

    setGpsCapturing(true);
    try {
      setCapturedGps({ ...coords });
      cacheSet(`pole_gps_${params.to_pole_id}`, {
        lat: coords.latitude,
        lng: coords.longitude,
      }).catch(() => {});

      // GPS stored locally — will be sent with the teardown submission
      Alert.alert("GPS Captured", `Location saved.\n${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`);
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
  ): Promise<NonNullable<PhotoField>> {
    await FileSystem.makeDirectoryAsync(draftDir, { intermediates: true });

    const compressed = await compressPhoto(uri);

    // ── Clean version → disk (uploaded to backend) ──
    const dest = draftDir + fileName;
    const existing = await FileSystem.getInfoAsync(dest);
    if (existing.exists) await FileSystem.deleteAsync(dest, { idempotent: true });
    await FileSystem.copyAsync({ from: compressed, to: dest });

    // ── Stamped version → _view file on disk + gallery (display + lineman backup) ──
    let displayUri = dest;
    if (stampLines?.length) {
      const stamped = await stampPhoto(compressed, stampLines);
      const viewDest = dest.replace(/\.jpg$/i, "_view.jpg");
      const viewExisting = await FileSystem.getInfoAsync(viewDest);
      if ((viewExisting as any).exists) await FileSystem.deleteAsync(viewDest, { idempotent: true });
      await FileSystem.copyAsync({ from: stamped, to: viewDest });
      displayUri = viewDest;
      MediaLibrary.requestPermissionsAsync()
        .then(({ status }) => {
          if (status === "granted") MediaLibrary.saveToLibraryAsync(stamped).catch(() => {});
        })
        .catch(() => {});
    }

    // Cross-copy clean + stamped view to pole_drafts for before/tag (reused on future spans)
    if (fileName === F.before || fileName === F.tag) {
      const suffix = fileName === F.before ? "_before" : "_poletag";
      const poleDir = `${FileSystem.documentDirectory}pole_drafts/${projFolder}/${params.node_id}/${params.to_pole_id}/`;
      const poleCleanDest = `${poleDir}pole_${params.to_pole_id}${suffix}.jpg`;
      const poleViewDest = `${poleDir}pole_${params.to_pole_id}${suffix}_view.jpg`;

      FileSystem.makeDirectoryAsync(poleDir, { intermediates: true })
        .then(async () => {
          const existingClean = await FileSystem.getInfoAsync(poleCleanDest);
          if ((existingClean as any).exists) await FileSystem.deleteAsync(poleCleanDest, { idempotent: true });
          await FileSystem.copyAsync({ from: compressed, to: poleCleanDest });
          if (displayUri !== dest) {
            const existingView = await FileSystem.getInfoAsync(poleViewDest);
            if ((existingView as any).exists) await FileSystem.deleteAsync(poleViewDest, { idempotent: true });
            return FileSystem.copyAsync({ from: displayUri, to: poleViewDest });
          }
        })
        .catch(() => {});
    }

    const version = Date.now();
    return {
      uri: `${displayUri}?v=${version}`,
      fileUri: dest,
      name: fileName,
      type: "image/jpeg",
      version,
    };
  }

  function openViewer(label: string, photo: PhotoField, retakeFn: () => void) {
    if (!photo) return;
    setViewerLabel(label);
    setViewerPhoto(photo);
    setViewerRetake(() => retakeFn);
    setViewerOpen(true);
  }

  async function captureFromCamera() {
    if (!cameraRef.current || !cameraReady) return;
    setBlurWarning(false);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1, skipProcessing: false });
      if (!photo?.uri) return;
      const capturedAt = getPHTNow();
      const setter = activeCameraTab === "before" ? setPhotoBefore : activeCameraTab === "after" ? setPhotoAfter : setPhotoTag;
      const qualitySetter = activeCameraTab === "before" ? setQualityBefore : activeCameraTab === "after" ? setQualityAfter : setQualityTag;
      const file = activeCameraTab === "before" ? F.before : activeCameraTab === "after" ? F.after : F.tag;
      setter(createPhotoField(photo.uri, file));
      const saved = await savePhotoDraft(file, photo.uri, buildStampLines(activeCameraTab));
      setter(saved);
      cacheSet(`photo_captured_at_${params.to_pole_id}_${activeCameraTab}`, capturedAt).catch(() => {});
      const variance = await checkPhotoQuality(saved.fileUri ?? photo.uri);
      const pct = varianceToPercent(variance);
      qualitySetter(pct);
      const qualityKey = activeCameraTab === "before" ? `td_quality_before_${params.to_pole_id}` : activeCameraTab === "after" ? `td_quality_after_${params.to_pole_id}` : `td_quality_tag_${params.to_pole_id}`;
      cacheSet(qualityKey, pct).catch(() => {});
      if (variance < 80) {
        setBlurWarning(true);
      }
    } catch (e: any) {
      Alert.alert("Photo Error", e?.message ?? "Failed to capture photo.");
    }
  }


  async function handleSaveToPoleName() {
    const trimmed = editToNameDraft.trim();
    if (!trimmed) return;
    setSavingToName(true);

    // 1. Update local state immediately (works offline too)
    setEditedToPoleName(trimmed);
    await cacheSet(`draft_to_pole_name_${params.to_pole_id}`, trimmed).catch(() => {});

    // 2. Patch the poles list cache so the list screen shows the new name without a sync
    if (params.node_id) {
      const polesCacheKey = `poles_node_${params.node_id}`;
      const cachedPoles = await cacheGet<any[]>(polesCacheKey).catch(() => null);
      if (cachedPoles) {
        const updated = cachedPoles.map((p) =>
          String(p.id) === String(params.to_pole_id) ? { ...p, pole_name: trimmed } : p,
        );
        await cacheSet(polesCacheKey, updated).catch(() => {});
      }
    }

    // 3. Try to save to backend immediately; queue if offline
    try {
      await api.put(`/poles/${params.to_pole_id}`, { pole_name: trimmed });
    } catch (e: any) {
      const status = e?.response?.status;
      if (!status) {
        // Network error — queue for later
        await simpleQueuePush({
          method: "put",
          url: `/poles/${params.to_pole_id}`,
          body: { pole_name: trimmed },
        }).catch(() => {});
      }
    }

    setSavingToName(false);
    setEditToNameModalOpen(false);
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
    : "Captured GPS";

  const gpsSecondaryLabel = hasGps
    ? "Location saved"
    : gpsAccuracy === null
      ? "Acquiring signal…"
      : gpsAccuracy <= REQUIRED_GPS_ACCURACY_METERS
        ? `Accuracy: ${gpsAccuracy}m • Ready to capture`
        : gpsAccuracy <= 20
          ? `Accuracy: ${gpsAccuracy}m • Tap to capture`
          : `Accuracy: ${gpsAccuracy}m • Weak signal — tap to capture anyway`;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.floatingHeader}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
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


          <View style={styles.heroCard}>
            <View style={[styles.heroBg, { backgroundColor: accentColor }]} />
            <View style={styles.heroNoise} />
            <View style={styles.heroGlow} />
            <View style={styles.heroContent}>
              <View style={styles.heroTopLine}>
                <View style={styles.heroBadge}>
                  <Text style={styles.heroBadgeText}>Destination Pole</Text>
                </View>
              </View>

              <Pressable
                onPress={() => {
                  setEditToNameDraft(editedToPoleName);
                  setEditToNameModalOpen(true);
                }}
                style={styles.heroTitleRow}
              >
                <Text style={[styles.heroTitle, { marginTop: 0, flexShrink: 1 }]} numberOfLines={2}>
                  {editedToPoleName || params.to_pole_code || "Destination Pole"}
                </Text>
                <Text style={styles.heroEditIcon}>✎</Text>
              </Pressable>

              <Text style={styles.heroMeta} numberOfLines={1}>
                {params.project_name || "—"} • {params.to_pole_code || "—"}
              </Text>
            </View>
          </View>

          <View style={styles.progressCard}>
            <View style={styles.progressTopRow}>
              <Text style={styles.progressTitle}>Completion Tracker</Text>
              <View style={styles.timerBadge}>
                <Text style={styles.timerText}>
                  ⏱ {String(Math.floor(elapsedSecs / 60)).padStart(2, "0")}:
                  {String(elapsedSecs % 60).padStart(2, "0")}
                </Text>
              </View>
              <Text style={[styles.progressPercent, { color: accentColor }]}>
                {progress.percent}%
              </Text>
            </View>

            <View style={styles.trackerRow}>
              <TrackerMini done={hasGps} label="GPS" />
              <TrackerMini done={!!photoBefore} label="Before" />
              <TrackerMini done={!!photoAfter} label="After" />
              <TrackerMini done={!!photoTag} label="Tag" />
              <TrackerMini done={!!slot} label="Slot" />
              <TrackerMini done={!!landmark.trim()} label="Landmark" />
            </View>

            <ProgressWaveBar
              progress={progress.percent}
              accentColor={accentColor}
            />
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
              <View style={styles.gpsMapBox}>
                <WebView
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
                    ),
                    baseUrl: "https://local.telcovantage/",
                  }}
                  cacheEnabled={false}
                />
              </View>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.gpsCardButton,
                hasGps
                  ? styles.gpsCardButtonSuccess
                  : {
                      borderColor: `${accentColor}35`,
                      backgroundColor: "#FFFFFF",
                    },
                pressed && !gpsCapturing && styles.pressedDown,
              ]}
              onPress={captureGps}
              disabled={gpsCapturing}
            >
              <View
                style={[
                  styles.gpsBigIconWrap,
                  hasGps
                    ? { backgroundColor: `${accentColor}16` }
                    : { backgroundColor: `${accentColor}10` },
                ]}
              >
                {gpsCapturing ? (
                  <ActivityIndicator color={accentColor} size="small" />
                ) : (
                  <Text style={[styles.gpsEmoji, { color: accentColor }]}>
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
            <View style={styles.slotRowStatic}>
              {SLOTS.map((s) => (
                <Pressable
                  key={s}
                  style={({ pressed }) => [
                    styles.slotBtn,
                    slot === s && { backgroundColor: accentColor, borderColor: accentColor },
                    pressed && styles.pressedDown,
                  ]}
                  onPress={() => setSlot(s)}
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
                    {landmark.trim() ? "Filled" : "Required"}
                  </Text>
                </View>
              }
            />
            <TextInput
              style={styles.textArea}
              placeholder="e.g. Beside blue gate, near convenience store"
              placeholderTextColor="#9CA3AF"
              value={landmark}
              onChangeText={setLandmark}
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Photo capture button — unlocks after GPS + Slot + Landmark */}
          <View style={styles.sectionCard}>
            <SectionHeading
              title="Pole Photos"
              subtitle={infoComplete ? "Tap a photo to view or capture" : "Fill GPS, Slot & Landmark first"}
            />
            <View style={styles.photoTileRow}>
              <PhotoTile
                label="Before"
                photo={photoBefore}
                accentColor={accentColor}
                onCapture={() => { if (infoComplete) { setActiveCameraTab("before"); setShowCameraModal(true); } }}
                onView={() => openViewer("Before", photoBefore, () => { setActiveCameraTab("before"); setShowCameraModal(true); })}
              />
              <PhotoTile
                label="After"
                photo={photoAfter}
                accentColor={accentColor}
                onCapture={() => { if (infoComplete) { setActiveCameraTab("after"); setShowCameraModal(true); } }}
                onView={() => openViewer("After", photoAfter, () => { setActiveCameraTab("after"); setShowCameraModal(true); })}
              />
              <PhotoTile
                label="Tag"
                photo={photoTag}
                accentColor={accentColor}
                onCapture={() => { if (infoComplete) { setActiveCameraTab("tag"); setShowCameraModal(true); } }}
                onView={() => openViewer("Tag", photoTag, () => { setActiveCameraTab("tag"); setShowCameraModal(true); })}
              />
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.capturePhotosBtn,
                { backgroundColor: infoComplete ? accentColor : "#C9CED6" },
                pressed && infoComplete && styles.pressedDown,
              ]}
              onPress={infoComplete ? () => { setActiveCameraTab("before"); setShowCameraModal(true); } : undefined}
              disabled={!infoComplete}
            >
              <Text style={styles.capturePhotosBtnText}>
                {infoComplete ? "📷  Capture Photos" : "Complete GPS, Slot & Landmark first"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        <View style={styles.ctaBar}>
          <Pressable
            style={({ pressed }) => [
              styles.submitBtn,
              { backgroundColor: accentColor },
              pressed && styles.pressedDown,
            ]}
            onPress={goToComponents}
          >
            <Text style={styles.submitText}>Start Teardown  →</Text>
          </Pressable>
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
                  <Text style={styles.editNameSaveText}>Save</Text>
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
                  ? () => { setPhotoBefore(null); setQualityBefore(null); cacheSet(`td_quality_before_${params.to_pole_id}`, null).catch(() => {}); }
                  : activeCameraTab === "after"
                  ? () => { setPhotoAfter(null); setQualityAfter(null); cacheSet(`td_quality_after_${params.to_pole_id}`, null).catch(() => {}); }
                  : () => { setPhotoTag(null); setQualityTag(null); cacheSet(`td_quality_tag_${params.to_pole_id}`, null).catch(() => {}); };
                if (photo && !blurWarning) {
                  const badgeColor = photoQuality === null ? "#6b7280"
                    : photoQuality >= 80 ? "#22c55e"
                    : photoQuality >= 65 ? "#84cc16"
                    : photoQuality >= 50 ? "#f97316"
                    : "#ef4444";
                  return (
                    <Pressable style={StyleSheet.absoluteFillObject} onPress={clearPhoto}>
                      <ExpoImage source={{ uri: photo.uri }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
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
                  );
                }
                if (cameraPermission?.granted) {
                  return (
                    <GestureDetector gesture={pinchGesture}>
                      <View style={StyleSheet.absoluteFillObject}>
                        <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="back" zoom={cameraZoom} onCameraReady={() => setCameraReady(true)} />
                        {blurWarning && (
                          <View style={styles.blurWarningOverlay}>
                            <Text style={styles.blurWarningIcon}>⚠️</Text>
                            <Text style={styles.blurWarningTitle}>Photo is dark or blurry</Text>
                            <Text style={styles.blurWarningBody}>Please retake for a clearer image</Text>
                            <View style={styles.blurWarningActions}>
                              <Pressable
                                style={[styles.blurRetakeBtn, { backgroundColor: accentColor }]}
                                onPress={() => {
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
                style={[styles.cameraCaptureBtn, { borderColor: accentColor, opacity: cameraReady ? 1 : 0.4 }]}
                onPress={captureFromCamera}
                disabled={!cameraReady}
              >
                <View style={[styles.cameraCaptureInner, { backgroundColor: accentColor }]} />
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
                <ExpoImage source={{ uri: viewerPhoto.uri }} style={styles.modalImage} contentFit="cover" transition={150} />
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

  heroCard: {
    borderRadius: 30,
    overflow: "hidden",
    marginBottom: 14,
    minHeight: 164,
    backgroundColor: "#0B7A5A",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7,
  },

  heroBg: {
    ...StyleSheet.absoluteFillObject,
    opacity: 1,
  },

  heroNoise: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.03)",
  },

  heroGlow: {
    position: "absolute",
    right: -30,
    top: -20,
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  heroContent: {
    paddingHorizontal: 18,
    paddingVertical: 18,
    justifyContent: "space-between",
    flex: 1,
  },

  heroTopLine: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  heroBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.16)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },

  heroBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
  },

  heroTitle: {
    marginTop: 18,
    fontSize: 28,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -0.6,
  },

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

  gpsMapBox: {
    height: 200,
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 12,
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

  gpsBigIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  gpsEmoji: {
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
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#E8ECF0",
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
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
    aspectRatio: 3 / 4,
    borderRadius: 14,
    backgroundColor: "#E5E7EB",
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
});
