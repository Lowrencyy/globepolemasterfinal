import { useAuth } from "@/context/auth-context";
import api from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getPHTNow } from "@/lib/display-time";
import { gpsQueueReadAll } from "@/lib/gps-queue";
import { getNodeDetail, getNodePoles, SkycablePole, startNodeTeardown } from "@/services/skycable";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  CalendarCheck2,
  CalendarClock,
  ChevronLeft,
  CircleDot,
  Lock,
  Play,
  Search,
  TrendingUp,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  LayoutChangeEvent,
  Modal,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

// ─── Static tile map ─────────────────────────────────────────────────────────
const ZOOM = 17;
const TILE_PX = 256;

function latLngToTileFrac(lat: number, lng: number, z: number) {
  const n = Math.pow(2, z);
  const xFrac = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yFrac =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { xFrac, yFrac, tileX: Math.floor(xFrac), tileY: Math.floor(yFrac) };
}

function StaticTileMap({ lat, lng }: { lat: number; lng: number }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const { xFrac, yFrac, tileX, tileY } = latLngToTileFrac(lat, lng, ZOOM);

  const tileUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM}/${tileY}/${tileX}`;
  const tileUrlLeft = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM}/${tileY}/${tileX - 1}`;
  const tileUrlRight = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM}/${tileY}/${tileX + 1}`;

  const fracX = xFrac - tileX;
  const fracY = yFrac - tileY;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  const scale = size ? Math.max(size.w / TILE_PX, size.h / TILE_PX) : 1;
  const imgW = TILE_PX * scale;
  const imgH = TILE_PX * scale;
  const offsetX = size ? size.w / 2 - fracX * imgW : 0;
  const offsetY = size ? size.h / 2 - fracY * imgH : 0;

  const PIN = 18;
  const pinLeft = size ? size.w / 2 - PIN / 2 : 0;
  const pinTop = size ? size.h / 2 - PIN : 0;

  return (
    <View style={StyleSheet.absoluteFillObject} onLayout={onLayout}>
      <Image
        source={{ uri: tileUrlLeft }}
        style={{
          position: "absolute",
          left: offsetX - imgW,
          top: offsetY,
          width: imgW,
          height: imgH,
        }}
        resizeMode="cover"
      />
      <Image
        source={{ uri: tileUrl }}
        style={{
          position: "absolute",
          left: offsetX,
          top: offsetY,
          width: imgW,
          height: imgH,
        }}
        resizeMode="cover"
      />
      <Image
        source={{ uri: tileUrlRight }}
        style={{
          position: "absolute",
          left: offsetX + imgW,
          top: offsetY,
          width: imgW,
          height: imgH,
        }}
        resizeMode="cover"
      />
      {size && (
        <View
          style={{
            position: "absolute",
            left: pinLeft,
            top: pinTop,
            width: PIN,
            height: PIN,
            borderRadius: PIN / 2,
            backgroundColor: "#2563EB",
            borderWidth: 3,
            borderColor: "#FFF",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 6,
            elevation: 4,
          }}
        />
      )}
    </View>
  );
}

// ─── Multi-point vicinity map ────────────────────────────────────────────────
function VicinityMap({
  locs,
}: {
  locs: { lat: number; lng: number; cleared: boolean }[];
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  if (!locs.length) {
    return <View style={StyleSheet.absoluteFillObject} onLayout={onLayout} />;
  }

  const lats = locs.map(l => l.lat);
  const lngs = locs.map(l => l.lng);

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  const w = size?.w ?? 320;
  const h = size?.h ?? 180;

  const latSpan = Math.max(maxLat - minLat, 0.001);
  const lngSpan = Math.max(maxLng - minLng, 0.001);

  const zLng = Math.log2((w * 0.6 * 360) / (256 * lngSpan));
  const zLat = Math.log2((h * 0.6 * 180) / (256 * latSpan));
  const zoom = Math.max(12, Math.min(17, Math.floor(Math.min(zLng, zLat))));

  const { xFrac, yFrac, tileX, tileY } = latLngToTileFrac(centerLat, centerLng, zoom);

  const fracX = xFrac - tileX;
  const fracY = yFrac - tileY;

  const scale = size ? Math.max(size.w / TILE_PX, size.h / TILE_PX) : 1;
  const imgW = TILE_PX * scale;
  const imgH = TILE_PX * scale;

  const offsetX = size ? size.w / 2 - fracX * imgW : 0;
  const offsetY = size ? size.h / 2 - fracY * imgH : 0;

  const tileBase = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tileY}`;

  return (
    <View style={StyleSheet.absoluteFillObject} onLayout={onLayout}>
      <Image
        source={{ uri: `${tileBase}/${tileX - 1}` }}
        style={{
          position: "absolute",
          left: offsetX - imgW,
          top: offsetY,
          width: imgW,
          height: imgH,
        }}
        resizeMode="cover"
      />
      <Image
        source={{ uri: `${tileBase}/${tileX}` }}
        style={{
          position: "absolute",
          left: offsetX,
          top: offsetY,
          width: imgW,
          height: imgH,
        }}
        resizeMode="cover"
      />
      <Image
        source={{ uri: `${tileBase}/${tileX + 1}` }}
        style={{
          position: "absolute",
          left: offsetX + imgW,
          top: offsetY,
          width: imgW,
          height: imgH,
        }}
        resizeMode="cover"
      />

      {size &&
        locs.map((p, i) => {
          const { xFrac: px, yFrac: py } = latLngToTileFrac(p.lat, p.lng, zoom);
          const left = offsetX + (px - tileX) * imgW - 5;
          const top = offsetY + (py - tileY) * imgH - 5;

          return (
            <View
              key={i}
              style={{
                position: "absolute",
                left,
                top,
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: p.cleared ? "#10b981" : "#f59e0b",
                borderWidth: 1.5,
                borderColor: "#FFFFFF",
              }}
            />
          );
        })}
    </View>
  );
}

// ─── Full Leaflet map HTML for WebView preview ───────────────────────────────
function buildPolesMapHtml(
  poles: { lat: number; lng: number; cleared: boolean; code: string }[]
): string {
  const data = JSON.stringify(poles);

  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body,#map{width:100%;height:100%;background:#f8fafc;}
.leaflet-container{background:#f8fafc;font-family:system-ui,-apple-system,sans-serif;}
.pp{
  width:13px;
  height:13px;
  border-radius:50%;
  border:2px solid rgba(255,255,255,0.98);
  box-shadow:0 0 0 1px rgba(15,23,42,0.15),0 5px 12px rgba(0,0,0,0.35);
}
.popup-wrap{min-width:140px;}
.popup-title{font-size:13px;font-weight:900;color:#111827;}
.popup-badge{
  margin-top:6px;
  display:inline-block;
  padding:3px 8px;
  border-radius:999px;
  font-size:10px;
  font-weight:900;
}
.leaflet-popup-content-wrapper{
  border-radius:14px;
  box-shadow:0 10px 24px rgba(0,0,0,0.15);
}
</style>
</head><body>
<div id="map"></div>
<script>
window.bootMap=function(){
  var map=L.map("map",{zoomControl:false,attributionControl:false,preferCanvas:true});
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:19}).addTo(map);

  var poles=${data};
  var bounds=[];

  poles.forEach(function(p){
    if(typeof p.lat === "number" && typeof p.lng === "number" && p.lat !== 0) {
      var color=p.cleared?"#10b981":"#f59e0b";
      var label=p.cleared?"Completed":"Pending";
      var icon=L.divIcon({
        className:"",
        html:'<div class="pp" style="background:'+color+'"></div>',
        iconSize:[13,13],
        iconAnchor:[6,6]
      });

      L.marker([p.lat,p.lng],{icon:icon})
        .addTo(map)
        .bindPopup(
          '<div class="popup-wrap">' +
            '<div class="popup-title">'+p.code+'</div>' +
            '<div class="popup-badge" style="background:'+color+'22;color:'+color+'">'+label+'</div>' +
          '</div>'
        );

      bounds.push([p.lat,p.lng]);
    }
  });

  setTimeout(function(){
    map.invalidateSize(true);
    if(bounds.length===1){
      map.setView(bounds[0],17);
    } else if(bounds.length>1){
      map.fitBounds(bounds,{padding:[48,48],maxZoom:18});
    } else {
      map.setView([12.8797,121.774],6);
    }
  }, 250);
};
</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onload="bootMap()"></script>
</body></html>`;
}

// ─── Map Preview Modal ───────────────────────────────────────────────────────
function MapPreviewModal({
  visible,
  onClose,
  poles,
  nodeName,
}: {
  visible: boolean;
  onClose: () => void;
  poles: { lat: number; lng: number; cleared: boolean; code: string }[];
  nodeName: string;
}) {
  const html = useMemo(() => buildPolesMapHtml(poles), [poles]);
  const insets = useSafeAreaInsets();
  const completedCount = poles.filter(p => p.cleared).length;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#F8FAFC", position: "relative" }}>
        <View style={StyleSheet.absoluteFillObject}>
          <WebView
            source={{ html }}
            style={{ flex: 1, backgroundColor: "#F8FAFC" }}
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled={false}
            mixedContentMode="always"
            androidLayerType="hardware"
            cacheEnabled={false}
          />
        </View>

        <View style={[mp.floatingTopCard, { top: Math.max(insets.top + 8, 12) }]}>
          <View style={mp.headerTopRow}>
            <View style={mp.titleWrap}>
              <Text style={mp.title}>{nodeName}</Text>
              <Text style={mp.subtitle}>
                {poles.length} poles · {completedCount} completed ↻
              </Text>
            </View>

            <TouchableOpacity style={mp.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <X size={18} color="#64748B" />
            </TouchableOpacity>
          </View>

          <View style={mp.dropdownRow}>
            <View style={mp.dropdown}>
              <View style={[mp.legendDot, { backgroundColor: "#10b981" }]} />
              <Text style={mp.dropdownLabel}>COMPLETED</Text>
              <Text style={[mp.dropdownText, { color: "#10b981" }]}>{completedCount}</Text>
            </View>

            <View style={mp.dropdown}>
              <View style={[mp.legendDot, { backgroundColor: "#f59e0b" }]} />
              <Text style={mp.dropdownLabel}>PENDING</Text>
              <Text style={[mp.dropdownText, { color: "#f59e0b" }]}>{poles.length - completedCount}</Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const mp = StyleSheet.create({
  floatingTopCard: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.9)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 7,
    zIndex: 10,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  titleWrap: {
    flex: 1,
  },
  title: {
    fontSize: 19,
    fontWeight: "900",
    color: "#0F172A",
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  dropdownRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  dropdown: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dropdownLabel: {
    fontSize: 9,
    fontWeight: "900",
    color: "#94A3B8",
    letterSpacing: 0.5,
  },
  dropdownText: {
    fontSize: 12,
    fontWeight: "900",
    marginLeft: "auto",
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pht = new Date(d.getTime() + 8 * 3600 * 1000);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    pht.getUTCMonth()
  ];
  return `${mon} ${pht.getUTCDate()}, ${pht.getUTCFullYear()}`;
}

function fmtPHT(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pht = new Date(d.getTime() + 8 * 3600 * 1000);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    pht.getUTCMonth()
  ];
  const h = pht.getUTCHours();
  const min = String(pht.getUTCMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${mon} ${pht.getUTCDate()} · ${h12}:${min} ${ampm}`;
}

// ─── Types ───────────────────────────────────────────────────────────────────
type NodeSession = {
  date_start: string | null;
  due_date: string | null;
  date_finished: string | null;
  expected_cable: number | null;
  actual_cable: number | null;
  progress_percentage: number | null;
};

const SC: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: "#B54708", bg: "#FFF7E8" },
  in_progress: { label: "In Progress", color: "#1D4ED8", bg: "#EFF6FF" },
  cleared: { label: "Completed", color: "#067647", bg: "#ECFDF3" },
};

const SLOT_COLORS: Record<string, string> = {
  skycable: "#DC2626",
  globe: "#1D4ED8",
  meralco: "#F59E0B",
  free: "#E2E8F0",
};

// ─── Progress bar component ──────────────────────────────────────────────────
function ProgressBar({ pct, color = "#0B7A5A" }: { pct: number; color?: string }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: pct / 100,
      duration: 600,
      useNativeDriver: false,
    }).start();
  }, [pct]);

  return (
    <View style={ps.trackOuter}>
      <Animated.View style={[ps.trackFill, { flex: anim, backgroundColor: color }]} />
      <Animated.View style={{ flex: Animated.subtract(1, anim) as any }} />
    </View>
  );
}

// ─── Gate Modal ──────────────────────────────────────────────────────────────
function GateModal({
  visible,
  nodeName,
  totalPoles,
  dueDate,
  starting,
  onStart,
  onLater,
}: {
  visible: boolean;
  nodeName: string;
  totalPoles: number;
  dueDate: string | null;
  starting: boolean;
  onStart: () => void;
  onLater: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onLater}>
      <View style={gm.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onLater} />

        <View style={gm.sheet}>
          <View style={gm.handle} />

          <View style={gm.iconRing}>
            <View style={gm.iconInner}>
              <Play size={28} color="#0B7A5A" fill="#0B7A5A" />
            </View>
          </View>

          <Text style={gm.title}>Start Teardown?</Text>
          <Text style={gm.nodeName}>{nodeName}</Text>

          <Text style={gm.sub}>
            Once started, the teardown session is recorded in the system and poles will unlock for inspection.
          </Text>

          <View style={gm.chips}>
            <View style={gm.chip}>
              <CircleDot size={14} color="#0B7A5A" />
              <Text style={gm.chipText}>{totalPoles} poles</Text>
            </View>

            {dueDate && (
              <View style={[gm.chip, { backgroundColor: "#FFF7E8" }]}>
                <CalendarClock size={14} color="#B54708" />
                <Text style={[gm.chipText, { color: "#B54708" }]}>Due {fmtDate(dueDate)}</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[gm.startBtn, starting && { opacity: 0.65 }]}
            activeOpacity={0.85}
            onPress={onStart}
            disabled={starting}
          >
            {starting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Play size={16} color="#FFF" fill="#FFF" />
            )}
            <Text style={gm.startBtnText}>{starting ? "Starting…" : "Start Teardown"}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={gm.laterBtn} onPress={onLater} activeOpacity={0.7}>
            <Text style={gm.laterText}>Maybe Later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function PolesScreen() {
  const router = useRouter();
  const { token, user } = useAuth();

  const { nodeId, nodeName, nodeTeamId } = useLocalSearchParams<{
    nodeId: string;
    nodeName: string;
    nodeTeamId?: string;
  }>();

  const userTeamId = (user as any)?.team_id ?? null;
  const accessDenied = !!nodeTeamId && !!userTeamId && String(nodeTeamId) !== String(userTeamId);

  const [search, setSearch] = useState("");
  const [poles, setPoles] = useState<SkycablePole[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  const [session, setSession] = useState<NodeSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [gateVisible, setGateVisible] = useState(false);
  const GATE_KEY = `td_gate_seen_${nodeId}`;

  const [mapPreviewVisible, setMapPreviewVisible] = useState(false);

  const isStarted = !!session?.date_start;

  // ── Load node session ────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !nodeId) return;

    getNodeDetail(Number(nodeId), token)
      .then(node => {
        setSession({
          date_start: node.date_start ?? null,
          due_date: node.due_date ?? null,
          date_finished: node.date_finished ?? null,
          expected_cable: node.expected_cable ?? null,
          actual_cable: node.actual_cable ?? null,
          progress_percentage: node.progress_percentage ?? null,
        });
      })
      .catch(() => { })
      .finally(() => setSessionLoading(false));
  }, [token, nodeId]);

  // ── Show gate modal once ─────────────────────────────────────────────────
  useEffect(() => {
    if (sessionLoading || isStarted) return;

    AsyncStorage.getItem(GATE_KEY).then(val => {
      if (!val) setGateVisible(true);
    });
  }, [sessionLoading, isStarted]);


  // ── Load poles ───────────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      if (!token || !nodeId) return;

      const CACHE_KEY = `sitemap_poles_${nodeId}`;

      const mergeGps = async (basePoles: SkycablePole[]) => {
        const q = await gpsQueueReadAll().catch(() => []);
        if (!q.length) return basePoles;

        return basePoles.map(p => {
          const pending = q.find(e => String(e.pole_id) === String(p.pole_id));
          return pending
            ? {
              ...p,
              pole: {
                ...p.pole,
                lat: String(pending.lat),
                lng: String(pending.lng),
              },
            }
            : p;
        });
      };

      // Show cached poles immediately, then always fetch fresh so
      // coordinates and status updated on backend reflect right away
      cacheGet<SkycablePole[]>(CACHE_KEY).then(async cached => {
        if (cached?.length) {
          setPoles(await mergeGps(cached));
          setLoading(false);
        }

        // Always fetch fresh from API regardless of cache
        getNodePoles(Number(nodeId), token)
          .then(async data => {
            // Preserve locally cached coordinates if the server response is missing or stale
            const enhancedData = data.map(freshPole => {
              if (!freshPole.pole?.lat || !freshPole.pole?.lng) {
                const cachedMatch = cached?.find(c => String(c.pole_id) === String(freshPole.pole_id));
                if (cachedMatch?.pole?.lat && cachedMatch?.pole?.lng) {
                  return {
                    ...freshPole,
                    pole: {
                      ...freshPole.pole,
                      lat: cachedMatch.pole.lat,
                      lng: cachedMatch.pole.lng,
                    },
                  };
                }
              }
              return freshPole;
            });
            const merged = await mergeGps(enhancedData);
            cacheSet(CACHE_KEY, merged).catch(() => {});
            setPoles(merged);
            setOffline(false);
          })
          .catch(() => {
            if (!cached?.length) setOffline(true);
          })
          .finally(() => setLoading(false));
      });
    }, [token, nodeId])
  );

  // ── Derived values ───────────────────────────────────────────────────────
  const isCompleted = (p: SkycablePole) => p.pole?.skycable_status === "cleared";

  const activePoles = useMemo(() => poles.filter(p => !isCompleted(p)), [poles]);
  const completedPoles = useMemo(() => poles.filter(p => isCompleted(p)), [poles]);

  const totalCount = poles.length;
  const completedCount = completedPoles.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const allDone = totalCount > 0 && completedCount === totalCount;

  const filtered = useMemo(() => {
    const base = showCompleted ? completedPoles : activePoles;
    const q = search.toLowerCase();
    return q ? base.filter(p => p.pole?.pole_code?.toLowerCase().includes(q)) : base;
  }, [search, showCompleted, activePoles, completedPoles]);

  const vicinityLocs = useMemo(
    () =>
      poles
        .filter(p => p.pole?.lat && p.pole?.lng)
        .map(p => ({
          lat: parseFloat(p.pole.lat),
          lng: parseFloat(p.pole.lng),
          cleared: p.pole.skycable_status === "cleared",
        })),
    [poles]
  );

  const mapPolePins = useMemo(
    () =>
      poles
        .filter(p => p.pole?.lat && p.pole?.lng)
        .map(p => ({
          lat: parseFloat(p.pole.lat),
          lng: parseFloat(p.pole.lng),
          cleared: p.pole.skycable_status === "cleared",
          code: p.pole.pole_code ?? "Pole",
        })),
    [poles]
  );

  // ── Sync progress to backend ─────────────────────────────────────────────
  const lastSyncedPct = useRef<number | null>(null);

  useEffect(() => {
    if (!isStarted || !nodeId || totalCount === 0) return;
    if (lastSyncedPct.current === progressPct) return;

    lastSyncedPct.current = progressPct;

    api.put(`/skycable/nodes/${nodeId}`, { progress_percentage: progressPct }).catch(() => { });
    setSession(prev => (prev ? { ...prev, progress_percentage: progressPct } : prev));
  }, [progressPct, isStarted, nodeId, totalCount]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  function dismissGate() {
    AsyncStorage.setItem(GATE_KEY, "1").catch(() => { });
    setGateVisible(false);
  }

  async function handleStartTeardown() {
    if (!token || !nodeId || starting) return;

    setStarting(true);

    try {
      const now = getPHTNow();
      await startNodeTeardown(Number(nodeId), token, now);
      setSession(prev => ({ ...prev!, date_start: now }));
      dismissGate();
    } catch {
      Alert.alert("Error", "Could not start teardown. Check your connection.");
    } finally {
      setStarting(false);
    }
  }

  // ── Access denied ────────────────────────────────────────────────────────
  if (accessDenied) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar barStyle="dark-content" backgroundColor="#F4F6F8" />

        <SafeAreaView style={s.container}>
          <View style={s.floatingHeader}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <ChevronLeft size={22} color="#111827" />
            </TouchableOpacity>

            <View style={s.floatingHeaderText}>
              <Text style={s.headerTitle}>Poles</Text>
              <Text style={s.headerSub}>{nodeName || "Node"}</Text>
            </View>
          </View>

          <View style={s.deniedWrap}>
            <View style={s.deniedIcon}>
              <Lock size={36} color="#EF4444" />
            </View>

            <Text style={s.deniedTitle}>Access Restricted</Text>
            <Text style={s.deniedSub}>
              This node is assigned to a different team.{"\n"}
              You can only access nodes assigned to your team.
            </Text>

            <TouchableOpacity style={s.deniedBtn} onPress={() => router.back()}>
              <Text style={s.deniedBtnText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" backgroundColor="#F4F6F8" />

      <GateModal
        visible={gateVisible}
        nodeName={nodeName || "Node"}
        totalPoles={totalCount}
        dueDate={session?.due_date ?? null}
        starting={starting}
        onStart={handleStartTeardown}
        onLater={dismissGate}
      />

      <MapPreviewModal
        visible={mapPreviewVisible}
        onClose={() => setMapPreviewVisible(false)}
        poles={mapPolePins}
        nodeName={nodeName || "Node"}
      />

      <SafeAreaView style={s.container}>
        <View style={s.floatingHeader}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color="#111827" />
          </TouchableOpacity>

          <View style={s.floatingHeaderText}>
            <Text style={s.headerTitle}>Poles</Text>
            <Text style={s.headerSub}>{nodeName || "Node"}</Text>
          </View>
        </View>

        {!sessionLoading && !isStarted ? (
          <View style={s.notStartedScreen}>
            <View style={s.nsStatsCard}>
              <View style={s.nsStatBox}>
                <Text style={s.nsStatNum}>{totalCount}</Text>
                <Text style={s.nsStatLbl}>Total Poles</Text>
              </View>

              <View style={s.nsStatDivider} />

              <View style={s.nsStatBox}>
                <Text style={[s.nsStatNum, { color: "#10b981" }]}>{completedCount}</Text>
                <Text style={s.nsStatLbl}>Completed</Text>
              </View>

              <View style={s.nsStatDivider} />

              <View style={s.nsStatBox}>
                <Text style={[s.nsStatNum, { color: "#f59e0b" }]}>{activePoles.length}</Text>
                <Text style={s.nsStatLbl}>Pending</Text>
              </View>
            </View>

            {vicinityLocs.length > 0 && (
              <TouchableOpacity
                style={s.nsMapCard}
                activeOpacity={0.88}
                onPress={() => setMapPreviewVisible(true)}
              >
                <View style={s.nsMapShell}>
                  <VicinityMap locs={vicinityLocs} />

                  <View style={s.nsMapOverlay}>
                    <View style={s.nsMapBadge}>
                      <Text style={s.nsMapBadgeText}>📍 {vicinityLocs.length} GPS poles</Text>
                    </View>

                    <View style={s.nsMapViewBtn}>
                      <Text style={s.nsMapViewBtnText}>View Full Map →</Text>
                    </View>
                  </View>

                  <View style={s.nsMapLegend}>
                    <View style={s.nsLegendChip}>
                      <View style={[s.nsLegendDot, { backgroundColor: "#10b981" }]} />
                      <Text style={s.nsLegendText}>{completedCount} done</Text>
                    </View>

                    <View style={s.nsLegendChip}>
                      <View style={[s.nsLegendDot, { backgroundColor: "#f59e0b" }]} />
                      <Text style={s.nsLegendText}>{activePoles.length} pending</Text>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            )}

            <Image
              source={require("../../assets/images/telco-mainlogo.png")}
              style={s.notStartedLogo}
              resizeMode="contain"
            />

            <Text style={s.notStartedTitle}>Teardown Not Started</Text>

            <Text style={s.notStartedSub}>
              Press the button below to officially begin{"\n"}this node's teardown session.
            </Text>

            <TouchableOpacity
              style={[s.notStartedBtn, starting && { opacity: 0.65 }]}
              activeOpacity={0.85}
              onPress={() => setGateVisible(true)}
              disabled={starting}
            >
              {starting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Play size={18} color="#FFFFFF" fill="#FFFFFF" />
              )}

              <Text style={s.notStartedBtnText}>{starting ? "Starting…" : "Start Teardown"}</Text>
            </TouchableOpacity>
          </View>
        ) : sessionLoading ? (
          <View style={s.empty}>
            <ActivityIndicator size="large" color="#0B7A5A" />
            <Text style={s.emptyTitle}>Checking session…</Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <View style={s.searchWrap}>
              <View style={s.searchBox}>
                <Search size={18} color="#98A2B3" />

                <TextInput
                  style={s.searchInput}
                  placeholder="Search poles…"
                  placeholderTextColor="#98A2B3"
                  value={search}
                  onChangeText={setSearch}
                  autoCapitalize="none"
                />

                {!!search && (
                  <TouchableOpacity onPress={() => setSearch("")}>
                    <X size={16} color="#98A2B3" />
                  </TouchableOpacity>
                )}
              </View>

              <View style={s.filterRow}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    setShowCompleted(false);
                    setSearch("");
                  }}
                  style={[s.filterChip, !showCompleted && s.filterChipActive]}
                >
                  <Text style={[s.filterChipText, !showCompleted && s.filterChipTextActive]}>
                    Pending ({activePoles.length})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    setShowCompleted(true);
                    setSearch("");
                  }}
                  style={[s.filterChip, showCompleted && s.filterChipDone]}
                >
                  <Text style={[s.filterChipText, showCompleted && s.filterChipTextActive]}>
                    Completed ({completedPoles.length})
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {loading ? (
              <View style={s.empty}>
                <ActivityIndicator size="large" color="#0B7A5A" />
                <Text style={s.emptyTitle}>Loading Poles…</Text>
              </View>
            ) : offline ? (
              <View style={s.empty}>
                <CircleDot size={40} color="#F59E0B" />
                <Text style={s.emptyTitle}>No offline data</Text>
                <Text style={s.emptySub}>Connect once to cache poles for offline use.</Text>
              </View>
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={i => String(i.id)}
                contentContainerStyle={s.list}
                showsVerticalScrollIndicator={false}
                ListHeaderComponent={
                  <View style={s.sessionCard}>
                    {/* 1. Vicinity Map at the top */}
                    <TouchableOpacity
                      style={s.activeMapCard}
                      activeOpacity={0.88}
                      onPress={() => setMapPreviewVisible(true)}
                    >
                      <View style={s.activeMapShell}>
                        {vicinityLocs.length > 0 ? (
                          <VicinityMap locs={vicinityLocs} />
                        ) : (
                          <View style={s.noVicinityMap}>
                            <Image
                              source={require("../../assets/images/telcovantage-logo.png")}
                              style={s.vicinityFallbackLogo}
                              resizeMode="contain"
                            />
                          </View>
                        )}

                        <View style={s.activeMapTopOverlay}>
                          <View style={[s.activeMapTitleBadge, { backgroundColor: "#ECFDF5", borderWidth: 1, borderColor: "#A7F3D0" }]}>
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#059669" }} />
                            <Text style={[s.activeMapTitleText, { color: "#059669" }]}>In Progress</Text>
                          </View>

                          <View style={s.activeMapViewBadge}>
                            <Text style={s.activeMapViewText}>View Map →</Text>
                          </View>
                        </View>

                        <View style={s.activeMapBottomOverlay}>
                          <View style={s.activeLegendChip}>
                            <View style={[s.activeLegendDot, { backgroundColor: "#10b981" }]} />
                            <Text style={s.activeLegendText}>{completedCount} completed</Text>
                          </View>

                          <View style={s.activeLegendChip}>
                            <View style={[s.activeLegendDot, { backgroundColor: "#f59e0b" }]} />
                            <Text style={s.activeLegendText}>{activePoles.length} pending</Text>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>

                    {/* 2. Date Pills */}
                    <View style={s.datePillsRow}>
                      <View style={s.datePill}>
                        <CalendarCheck2 size={12} color="#1D4ED8" />
                        <View>
                          <Text style={s.datePillLabel}>STARTED</Text>
                          <Text style={s.datePillValue}>{fmtPHT(session?.date_start)}</Text>
                        </View>
                      </View>

                      <View style={[s.datePill, { backgroundColor: "#FFF7E8", borderColor: "#FED7AA" }]}>
                        <CalendarClock size={12} color="#B54708" />
                        <View>
                          <Text style={[s.datePillLabel, { color: "#B54708" }]}>DUE DATE</Text>
                          <Text style={[s.datePillValue, { color: "#92400E" }]}>
                            {session?.due_date ? fmtDate(session.due_date) : "No due date"}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Progress Section */}
                    <View style={s.progressSection}>
                      <View style={s.progressLabelRow}>
                        <View style={s.progressLabelLeft}>
                          <TrendingUp size={13} color="#0B7A5A" />
                          <Text style={s.progressLabel}>Progress</Text>
                        </View>

                        <Text style={s.progressPct}>{progressPct}%</Text>
                      </View>

                      <ProgressBar pct={progressPct} color={allDone ? "#059669" : "#0B7A5A"} />

                      <Text style={s.progressSub}>
                        {completedCount} of {totalCount} poles completed
                      </Text>
                    </View>

                    {/* Node Stats Grid */}
                    <View style={s.nodeStatsGrid}>
                      <View style={s.nodeStatBox}>
                        <Text style={s.nodeStatNumber}>{totalCount}</Text>
                        <Text style={s.nodeStatLabel}>Total Poles</Text>
                      </View>

                      <View style={s.nodeStatDivider} />

                      <View style={s.nodeStatBox}>
                        <Text style={[s.nodeStatNumber, { color: "#059669" }]}>{completedCount}</Text>
                        <Text style={s.nodeStatLabel}>Completed</Text>
                      </View>

                      <View style={s.nodeStatDivider} />

                      <View style={s.nodeStatBox}>
                        <Text style={[s.nodeStatNumber, { color: "#D97706" }]}>{activePoles.length}</Text>
                        <Text style={s.nodeStatLabel}>Pending</Text>
                      </View>
                    </View>

                    {allDone && (
                      <View style={s.completionBanner}>
                        <View style={s.completionIcon}>
                          <CalendarCheck2 size={16} color="#059669" />
                        </View>

                        <View style={{ flex: 1 }}>
                          <Text style={s.completionTitle}>All Poles Completed!</Text>
                          {session?.date_finished && (
                            <Text style={s.completionDate}>Finished {fmtPHT(session.date_finished)}</Text>
                          )}
                        </View>
                      </View>
                    )}
                  </View>
                }
                ListEmptyComponent={
                  isStarted ? (
                    <View style={s.empty}>
                      <CircleDot size={40} color="#D0D5DD" />
                      <Text style={s.emptyTitle}>No poles found</Text>
                    </View>
                  ) : null
                }
                renderItem={({ item: np }) => {
                  const poleInfo = np.pole;
                  if (!poleInfo) return null;

                  const sc = SC[poleInfo.skycable_status] || SC.pending;
                  const slots = poleInfo.cableSlots || [];
                  const usedSlots = slots.filter(sl => sl.occupied_by !== "free").length;

                  return (
                    <TouchableOpacity
                      style={s.cardContainer}
                      activeOpacity={isStarted ? 0.8 : 1}
                      onPress={() => {
                        if (!isStarted) {
                          setGateVisible(true);
                          return;
                        }

                        router.push({
                          pathname: "/teardowns/pole-detail",
                          params: {
                            pole_id: np.pole_id,
                            pole_code: poleInfo.pole_code,
                            pole_name: poleInfo.pole_code,
                            node_id: nodeId,
                            node_name: nodeName,
                            accent: "#0B7A5A",
                            report_type: "teardown",
                          },
                        });
                      }}
                    >
                      {poleInfo.lat && poleInfo.lng ? (
                        <View style={s.heroMapShell}>
                          <StaticTileMap lat={parseFloat(poleInfo.lat)} lng={parseFloat(poleInfo.lng)} />
                        </View>
                      ) : (
                        <View style={s.heroMapShell}>
                          <Image
                            source={require("../../assets/images/telcovantage-logo.png")}
                            style={s.noGpsLogo}
                            resizeMode="contain"
                          />
                        </View>
                      )}

                      <View style={s.cardBody}>
                        <View style={s.info}>
                          <Text style={s.poleCode}>{poleInfo.pole_code}</Text>

                          {poleInfo.lat && poleInfo.lng ? (
                            <Text style={s.poleSub}>
                              {poleInfo.lat}, {poleInfo.lng}
                            </Text>
                          ) : (
                            <Text style={s.noCoordLabel}>No Coordinates</Text>
                          )}

                          {!!np.date_start && (
                            <View style={s.tsRow}>
                              <View style={[s.tsDot, { backgroundColor: "#1D4ED8" }]} />
                              <Text style={s.tsText}>Started {fmtPHT(np.date_start)}</Text>
                            </View>
                          )}

                          {!!np.cleared_at && (
                            <View style={s.tsRow}>
                              <View style={[s.tsDot, { backgroundColor: "#067647" }]} />
                              <Text style={[s.tsText, { color: "#067647" }]}>
                                Cleared {fmtPHT(np.cleared_at)}
                              </Text>
                            </View>
                          )}
                        </View>

                        <View style={[s.badge, { backgroundColor: sc.bg }]}>
                          <View style={[s.badgeDot, { backgroundColor: sc.color }]} />
                          <Text style={[s.badgeText, { color: sc.color }]}>{sc.label}</Text>
                        </View>
                      </View>

                      <View style={s.slotsRow}>
                        {slots.map(sl => {
                          const isFree = sl.occupied_by === "free";
                          const col = SLOT_COLORS[sl.occupied_by] || "#E2E8F0";

                          return (
                            <View
                              key={sl.slot_label}
                              style={[s.slotBox, { borderColor: isFree ? "#E2E8F0" : col + "60" }]}
                            >
                              <View style={[s.slotDot, { backgroundColor: isFree ? "#E2E8F0" : col }]} />
                              <Text style={[s.slotLabel, { color: isFree ? "#94A3B8" : "#0F172A" }]}>
                                {sl.slot_label}
                              </Text>
                            </View>
                          );
                        })}
                      </View>

                      {slots.length > 0 && (
                        <Text style={s.slotInfo}>
                          {usedSlots}/{slots.length} slots occupied
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        )}
      </SafeAreaView>
    </>
  );
}

// ─── Gate modal styles ───────────────────────────────────────────────────────
const gm = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E2E8F0",
    marginBottom: 28,
  },
  iconRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "#ECFDF5",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    borderWidth: 2,
    borderColor: "#A7F3D0",
  },
  iconInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#D1FAE5",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  nodeName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0B7A5A",
    marginBottom: 12,
  },
  sub: {
    fontSize: 13,
    fontWeight: "500",
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 8,
    marginBottom: 20,
  },
  chips: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 28,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#065F46",
  },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#0B7A5A",
    borderRadius: 16,
    paddingHorizontal: 32,
    paddingVertical: 16,
    width: "100%",
    justifyContent: "center",
    shadowColor: "#0B7A5A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
    marginBottom: 12,
  },
  startBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  laterBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  laterText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#94A3B8",
  },
});

// ─── Progress bar styles ─────────────────────────────────────────────────────
const ps = StyleSheet.create({
  trackOuter: {
    flexDirection: "row",
    height: 8,
    borderRadius: 999,
    backgroundColor: "#E2E8F0",
    overflow: "hidden",
  },
  trackFill: {
    borderRadius: 999,
  },
});

// ─── Main screen styles ──────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: {
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
  },
  backBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
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
  floatingHeaderText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
  },
  headerSub: {
    marginTop: 2,
    fontSize: 12,
    color: "#667085",
    fontWeight: "600",
  },

  searchWrap: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#E7ECF2",
    shadowColor: "#101828",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
    padding: 0,
  },

  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#E7ECF2",
    backgroundColor: "#FFFFFF",
  },
  filterChipActive: {
    backgroundColor: "#0B7A5A",
    borderColor: "#0B7A5A",
  },
  filterChipDone: {
    backgroundColor: "#059669",
    borderColor: "#059669",
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#667085",
  },
  filterChipTextActive: {
    color: "#FFFFFF",
  },

  list: {
    padding: 16,
    paddingTop: 4,
    gap: 16,
    paddingBottom: 40,
  },
  empty: {
    alignItems: "center",
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginTop: 16,
  },
  emptySub: {
    fontSize: 13,
    color: "#98A2B3",
    fontWeight: "500",
    marginTop: 8,
    textAlign: "center",
    paddingHorizontal: 32,
  },

  // ── Not started fullscreen ───────────────────────────────────────────────
  notStartedScreen: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
    backgroundColor: "#F4F6F8",
  },
  nsStatsCard: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    paddingVertical: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E7ECF2",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  nsStatBox: {
    flex: 1,
    alignItems: "center",
  },
  nsStatNum: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
  },
  nsStatLbl: {
    fontSize: 9,
    fontWeight: "800",
    color: "#98A2B3",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 3,
  },
  nsStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: "#E7ECF2",
  },
  nsMapCard: {
    width: "100%",
    marginBottom: 16,
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 4,
  },
  nsMapShell: {
    height: 190,
    backgroundColor: "#1a1a2e",
    borderRadius: 20,
    overflow: "hidden",
    position: "relative",
  },
  nsMapOverlay: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  nsMapBadge: {
    backgroundColor: "rgba(15,23,42,0.72)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  nsMapBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  nsMapViewBtn: {
    backgroundColor: "#0B7A5A",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  nsMapViewBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  nsMapLegend: {
    position: "absolute",
    bottom: 10,
    left: 10,
    flexDirection: "row",
    gap: 8,
  },
  nsLegendChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(15,23,42,0.68)",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  nsLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  nsLegendText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  notStartedLogo: {
    width: 110,
    height: 110,
    marginBottom: 12,
    opacity: 0.9,
    marginTop: 4,
  },
  notStartedTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  notStartedSub: {
    fontSize: 13,
    fontWeight: "500",
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  notStartedBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#0B7A5A",
    borderRadius: 16,
    paddingHorizontal: 36,
    paddingVertical: 16,
    width: "100%",
    justifyContent: "center",
    shadowColor: "#0B7A5A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 6,
  },
  notStartedBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },

  // ── Session card ─────────────────────────────────────────────────────────
  sessionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#D1FAE5",
    shadowColor: "#0B7A5A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    gap: 14,
  },
  sessionTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sessionTimerBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sessionTimerText: {
    fontSize: 18,
    fontWeight: "900",
    color: "#0B7A5A",
    letterSpacing: -0.4,
  },
  sessionStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  sessionStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#059669",
  },
  sessionStatusText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#059669",
  },

  // ── Date pills ───────────────────────────────────────────────────────────
  datePillsRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  datePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    flex: 1,
  },
  datePillLabel: {
    fontSize: 9,
    fontWeight: "900",
    color: "#1D4ED8",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  datePillValue: {
    fontSize: 12,
    fontWeight: "800",
    color: "#1E3A8A",
    marginTop: 1,
  },

  // ── Progress ─────────────────────────────────────────────────────────────
  progressSection: {
    gap: 6,
  },
  progressLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  progressLabelLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#374151",
  },
  progressPct: {
    fontSize: 15,
    fontWeight: "900",
    color: "#0B7A5A",
  },
  progressSub: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94A3B8",
    marginTop: 2,
  },

  // ── Node counts ──────────────────────────────────────────────────────────
  nodeStatsGrid: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    paddingVertical: 12,
  },
  nodeStatBox: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  nodeStatNumber: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    fontVariant: ["tabular-nums"],
  },
  nodeStatLabel: {
    fontSize: 9,
    fontWeight: "900",
    color: "#94A3B8",
    textTransform: "uppercase",
    letterSpacing: 0.55,
  },
  nodeStatDivider: {
    width: 1,
    height: 34,
    backgroundColor: "#E2E8F0",
  },

  // ── Vicinity map area ────────────────────────────────────────────────────
  activeMapCard: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#D1FAE5",
    backgroundColor: "#0F172A",
  },
  activeMapShell: {
    height: 190,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#1a1a2e",
    position: "relative",
  },
  activeMapTopOverlay: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  activeMapTitleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(15,23,42,0.75)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  activeMapTitleText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  activeMapViewBadge: {
    backgroundColor: "#0B7A5A",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  activeMapViewText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  activeMapBottomOverlay: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  activeLegendChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(15,23,42,0.72)",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  activeLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#FFFFFF",
  },
  activeLegendText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  noVicinityMap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
  },
  vicinityFallbackLogo: {
    width: 150,
    height: 45,
    opacity: 1,
  },

  // ── Completion banner ───────────────────────────────────────────────────
  completionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#ECFDF5",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  completionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#D1FAE5",
    alignItems: "center",
    justifyContent: "center",
  },
  completionTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#065F46",
  },
  completionDate: {
    fontSize: 11,
    fontWeight: "600",
    color: "#059669",
    marginTop: 1,
  },

  // ── Pole cards ───────────────────────────────────────────────────────────
  cardContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    marginTop: 42,
    marginBottom: 8,
    marginHorizontal: 4,
    paddingHorizontal: 16,
    paddingBottom: 16,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  cardBody: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 18,
  },
  info: {
    flex: 1,
  },
  poleCode: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
  },
  poleSub: {
    fontSize: 12,
    fontWeight: "600",
    color: "#667085",
    marginTop: 2,
  },
  noCoordLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94A3B8",
    marginTop: 3,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 4,
  },
  tsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tsText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },
  heroMapShell: {
    height: 140,
    backgroundColor: "#F3F4F6",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    overflow: "hidden",
    marginTop: -28,
    borderWidth: 2,
    borderColor: "#E2E8F0",
  },
  noGpsLogo: {
    width: "40%",
    height: "40%",
    opacity: 0.15,
  },
  slotsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  slotBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
  },
  slotDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  slotLabel: {
    fontSize: 11,
    fontWeight: "800",
  },
  slotInfo: {
    fontSize: 11,
    fontWeight: "700",
    color: "#98A2B3",
    textAlign: "center",
  },

  // ── Access denied ────────────────────────────────────────────────────────
  deniedWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  deniedIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#FEF2F2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  deniedTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 10,
    textAlign: "center",
  },
  deniedSub: {
    fontSize: 14,
    fontWeight: "500",
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  deniedBtn: {
    backgroundColor: "#0B7A5A",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
  },
  deniedBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#fff",
  },
});