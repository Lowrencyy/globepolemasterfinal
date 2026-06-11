import { useAuth } from "@/context/auth-context";
import api from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/cache";
import * as FileSystem from "expo-file-system/legacy";
import { getPHTNow } from "@/lib/display-time";
import { gpsQueueReadAll } from "@/lib/gps-queue";
import { simpleQueuePush } from "@/lib/simple-queue";
import { getTileCacheDir, offlineTileLayerJs } from "@/lib/tile-cache";
import { getNodeDetail, getNodePoles, SkycablePole, startNodeTeardown } from "@/services/skycable";
import * as Location from "expo-location";
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
  Dimensions,
  FlatList,
  Image,
  LayoutChangeEvent,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

// ─── Static tile map ─────────────────────────────────────────────────────────
const ZOOM = 17;
const TILE_PX = 256;
const TILE_OFFSETS = [-1, 0, 1] as const;

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
      {TILE_OFFSETS.map(dy =>
        TILE_OFFSETS.map(dx => (
          <Image
            key={`${dx}:${dy}`}
            source={{
              uri: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM}/${tileY + dy}/${tileX + dx}`,
            }}
            style={{
              position: "absolute",
              left: offsetX + dx * imgW,
              top: offsetY + dy * imgH,
              width: imgW,
              height: imgH,
            }}
            resizeMode="cover"
          />
        )),
      )}
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

// ─── Multi-point vicinity map (WebView Leaflet) ──────────────────────────────
function buildVicinityMapHtml(locs: { lat: number; lng: number; cleared: boolean }[]): string {
  const locsJson = JSON.stringify(locs);
  const offlineJs = offlineTileLayerJs(getTileCacheDir());
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body,#map{width:100%;height:100%;overflow:hidden;background:#1a1a2e;}
.leaflet-container{width:100%;height:100%;background:#1a1a2e;}
.pp{width:9px;height:9px;border-radius:50%;border:1.5px solid rgba(255,255,255,0.95);box-shadow:0 2px 6px rgba(0,0,0,.5);}
</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  var locs=${locsJson};
  var map=L.map('map',{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,touchZoom:false,keyboard:false}).setView([14.5995,120.9842],13);
  ${offlineJs}
  addOfflineTiles(map);
  if(!locs.length)return;
  var bounds=[];
  locs.forEach(function(l){
    var c=l.cleared?'#10b981':'#f59e0b';
    L.marker([l.lat,l.lng],{icon:L.divIcon({className:'',html:'<div class="pp" style="background:'+c+'"></div>',iconSize:[9,9],iconAnchor:[4,4]})}).addTo(map);
    bounds.push([l.lat,l.lng]);
  });
  setTimeout(function(){
    map.invalidateSize();
    if(bounds.length>1)map.fitBounds(bounds,{padding:[24,24],maxZoom:17});
    else if(bounds.length===1)map.setView(bounds[0],17);
  },200);
})();
</script>
</body></html>`;
}

function VicinityMap({
  locs,
}: {
  locs: { lat: number; lng: number; cleared: boolean }[];
}) {
  if (!locs.length) {
    return <View style={StyleSheet.absoluteFillObject} />;
  }

  const mapKey = `${locs.length}-${locs[0]?.lat}-${locs[locs.length - 1]?.lat}`;
  const html = buildVicinityMapHtml(locs);

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <WebView
        key={mapKey}
        source={{ html, baseUrl: "https://gis-pole-map.local/" }}
        style={{ flex: 1 }}
        originWhitelist={["*"]}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        allowFileAccess
        allowUniversalAccessFromFileURLs
        cacheEnabled={false}
        androidLayerType="hardware"
        textZoom={100}
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

// ─── Full Leaflet map HTML for WebView preview ───────────────────────────────
// Copied from explore.tsx buildBaseMapHtml — same init pattern that's proven to work
function buildPolesMapHtml(opts?: { isPoleReport?: boolean }): string {
  const offlineJs = offlineTileLayerJs(getTileCacheDir());
  const startLabel = opts?.isPoleReport ? "Open Pole Report" : "Start Teardown";
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body,#map{
  width:100%;
  height:100%;
  overflow:hidden;
  background:#0d1117;
}
.leaflet-container{
  width:100%;
  height:100%;
  background:#0d1117;
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}
#fallback{
  position:absolute;
  inset:0;
  z-index:999;
  display:flex;
  align-items:center;
  justify-content:center;
  text-align:center;
  padding:24px;
  background:#0d1117;
  color:#94a3b8;
  font-size:13px;
  font-weight:800;
  pointer-events:none;
}
#fallback.ready{
  display:none;
}
.pp-wrap{
  width:48px;
  height:48px;
  display:flex;
  align-items:center;
  justify-content:center;
  cursor:pointer;
  -webkit-tap-highlight-color:transparent;
}
.pp{
  width:14px;
  height:14px;
  border-radius:50%;
  border:2px solid rgba(255,255,255,0.98);
  box-shadow:0 0 0 1.5px rgba(15,23,42,0.18),0 3px 8px rgba(0,0,0,0.35);
  pointer-events:none;
}
.pw{min-width:170px;font-family:system-ui,sans-serif;}
.pt{font-size:13px;font-weight:900;color:#111827;margin-bottom:5px;}
.pb{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;}
.pstart{margin-top:8px;width:100%;padding:7px 0;border-radius:8px;background:#0B7A5A;color:#fff;font-size:12px;font-weight:900;border:none;cursor:pointer;}
.leaflet-popup-content-wrapper{
  border-radius:16px;
  background:#ffffff;
  color:#111827;
  border:1px solid rgba(15,23,42,0.08);
  box-shadow:0 12px 28px rgba(0,0,0,0.16);
}
.leaflet-popup-content{margin:12px 14px;}
.leaflet-popup-tip{background:#ffffff;}
@keyframes gps-pulse{0%{opacity:0.7;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(2.4)}}
</style>
</head>
<body>
<div id="map"></div>
<div id="fallback">Loading Map...</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  var map = null;
  var markerGroup = null;
  var PH_CENTER = [14.5995, 120.9842];

  function post(data){
    try{
      if(window.ReactNativeWebView){
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
      }
    }catch(e){}
  }

  function hideFallback(){
    var el = document.getElementById("fallback");
    if(el) el.className = "ready";
  }

  function validLatLng(lat,lng){
    lat = Number(lat); lng = Number(lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  // Store poles by index so onclick never needs string escaping
  var _store = {};
  window._tap = function(i){
    var p = _store[i];
    if(!p) return;
    if(!!p.has_before && !!p.image_mode) return;
    var action = p.status==='in_progress' ? 'start' : 'open';
    post({type:action, pole_id:p.pole_id, id:p.id, code:p.code});
  };
  window.setPoles = function(poles){
    if(!map || !markerGroup) return;
    markerGroup.clearLayers();
    _store = {};
    var bounds = [];
    poles.forEach(function(p, i){
      if(!validLatLng(p.lat, p.lng)) return;
      _store[i] = p;
      var isCleared = p.status==='cleared';
      var hasBefore = !!p.has_before;
      var showBeforeBadge = hasBefore && !isCleared;
      var c = isCleared ? '#10b981' : hasBefore ? '#DC2626' : p.status==='in_progress' ? '#6366f1' : '#f59e0b';
      var lbl = isCleared ? 'Completed' : p.status==='in_progress' ? 'Ongoing' : 'Pending';
      var statusColor = isCleared ? '#10b981' : p.status==='in_progress' ? '#6366f1' : '#f59e0b';
      var icon = L.divIcon({
        className: "",
        html: '<div class="pp-wrap"><div class="pp" style="background:'+c+'"></div></div>',
        iconSize: [48,48],
        iconAnchor: [24,24]
      });
      var btnLabel = ${opts?.isPoleReport ? '"Open Pole Report"' : 'p.status==="in_progress"?"Continue Teardown":"Go to Pole"'};
      var btn = p.status!=='cleared'
        ? '<button class="pstart" onclick="window._tap('+i+')">'+btnLabel+'</button>'
        : '';
      // Before badge — only shown in image captured mode when before photo exists
      var beforeBadge = showBeforeBadge
        ? '<div style="display:inline-flex;align-items:center;gap:4px;background:#FEE2E2;border-radius:999px;padding:2px 8px;margin-top:4px;">'
          +'<span style="width:6px;height:6px;border-radius:50%;background:#DC2626;display:inline-block;"></span>'
          +'<span style="font-size:9px;font-weight:900;color:#DC2626;text-transform:uppercase;letter-spacing:0.08em;">Before ✓</span>'
          +'</div>'
        : '';
      var pop = '<div class="pw">'
        +'<div class="pt">'+p.code+'</div>'
        +'<div class="pb" style="background:'+statusColor+'22;color:'+statusColor+'">'
          +'<span style="width:6px;height:6px;border-radius:50%;background:'+statusColor+';display:inline-block;margin-right:4px"></span>'
          +lbl
        +'</div>'
        +beforeBadge
        +btn
        +'</div>';
      L.marker([p.lat, p.lng], {icon: icon, zIndexOffset: 1000}).addTo(markerGroup).bindPopup(pop);
      bounds.push([p.lat, p.lng]);
      map.invalidateSize(true);
      if(bounds.length > 1) map.fitBounds(bounds, {padding:[50,50], maxZoom:18});
      else if(bounds.length === 1) map.setView(bounds[0], 17);
    }, 300);
  };

  var _tileLayer = null;
  var _labelLayer = null;
  var TILE_URLS = {
    street:    {url:"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",                                                                     sub:"abc",  maxZoom:22, maxNativeZoom:19},
    satellite: {url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",                         sub:null,   maxZoom:22, maxNativeZoom:18},
    dark:      {url:"https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",                                                         sub:"abcd", maxZoom:22, maxNativeZoom:20}
  };
  window.setTileLayer = function(type){
    if(!map) return;
    if(_tileLayer){ map.removeLayer(_tileLayer); _tileLayer=null; }
    if(_labelLayer){ map.removeLayer(_labelLayer); _labelLayer=null; }
    var t = TILE_URLS[type] || TILE_URLS.street;
    var opts = {maxZoom:t.maxZoom, maxNativeZoom:t.maxNativeZoom, attribution:""};
    if(t.sub) opts.subdomains = t.sub;
    _tileLayer = L.tileLayer(t.url, opts).addTo(map);
    if(type==="satellite"){
      _labelLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
        {maxZoom:22, maxNativeZoom:20, opacity:0.85, subdomains:"abcd", attribution:""}).addTo(map);
    }
  };

  function init(){
    if(map) return;
    map = L.map("map", {zoomControl:true, attributionControl:false, preferCanvas:true, maxZoom:22}).setView(PH_CENTER, 13);
    window.setTileLayer('street');
    markerGroup = L.layerGroup().addTo(map);
    hideFallback();
    post({type:"MAP_READY"});
    // User location + compass arrow
    // pointer-events:none → clicks pass through to pole markers underneath
    var _userMarker = null;
    var _locIcon = L.divIcon({
      className:'',
      html:'<div style="position:relative;width:32px;height:32px;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:0.82;">'
        +'<div style="position:absolute;width:52px;height:52px;border-radius:50%;background:rgba(37,99,235,0.15);top:50%;left:50%;transform:translate(-50%,-50%);animation:gps-pulse 1.8s ease-out infinite;"></div>'
        +'<div id="u-arrow" style="display:flex;align-items:center;justify-content:center;transition:transform 0.25s linear;">'
        +'<svg width="24" height="24" viewBox="0 0 24 24"><polygon points="12,2 20,22 12,17 4,22" fill="#2563EB" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-linejoin="round"/></svg>'
        +'</div></div>',
      iconSize:[32,32], iconAnchor:[16,16]
    });
    window.setLoc = function(lat, lng){
      if(!map) return;
      if(!_userMarker){
        // zIndexOffset 2000 → always renders on top of pole markers visually,
        // but pointer-events:none means taps fall through to poles below
        _userMarker = L.marker([lat,lng],{icon:_locIcon,zIndexOffset:2000,interactive:false}).addTo(map);
      } else {
        _userMarker.setLatLng([lat,lng]);
      }
    };
    // Smooth 360° rotation — accumulate angle to avoid shortest-path flip at 0°/360°
    var _hdgAccum = 0;
    window.setHdg = function(deg){
      var el = document.getElementById('u-arrow');
      if(!el) return;
      var diff = ((deg - (_hdgAccum % 360)) + 540) % 360 - 180;
      _hdgAccum += diff;
      el.style.transform = 'rotate('+_hdgAccum+'deg)';
    };
  }

  window.onload = init;
  setTimeout(init, 1000);
})();
</script>
</body>
</html>`;
}

const mp = StyleSheet.create({
  // ── Top card — exact match of explore.tsx floatingTopCard ──
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
  headerActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  captureModeBtn: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    alignItems: "center",
    justifyContent: "center",
  },
  captureModeBtnActive: {
    backgroundColor: "#10B981",
    borderColor: "#10B981",
  },
  captureModeBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#1D4ED8",
  },
  captureModeBtnTextActive: {
    color: "#FFFFFF",
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F1F5F9",
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
    minHeight: 38,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  dropdownLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#94A3B8",
    textTransform: "uppercase",
  },
  dropdownValue: {
    fontSize: 12,
    fontWeight: "900",
    marginLeft: "auto",
  },

  // ── Tile view toggle ──
  tileToggleRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
  },
  tileBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  tileBtnActive: {
    backgroundColor: "#0F172A",
    borderColor: "#0F172A",
  },
  tileBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
  },
  tileBtnTextActive: {
    color: "#FFFFFF",
  },

  // ── Bottom card — exact match of explore.tsx floatingNoGpsCard ──
  floatingBottomCard: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 40,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.9)",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 7,
    zIndex: 8,
  },
  bottomTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#0F172A",
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  glassBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "900",
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
  report_type: "full_report" | "pole_report" | null;
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

  const { nodeId, nodeName, nodeTeamId, reportType } = useLocalSearchParams<{
    nodeId: string;
    nodeName: string;
    nodeTeamId?: string;
    reportType?: string;
  }>();

  const [session, setSession] = useState<NodeSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [gateVisible, setGateVisible] = useState(false);
  const GATE_KEY = `td_gate_seen_${nodeId}`;
  const [pendingOpenPole, setPendingOpenPole] = useState<null | {
    poleRowId: number;
    poleId: string;
    poleCode?: string;
  }>(null);

  const resolvedReportType =
    (reportType === "full_report" || reportType === "pole_report"
      ? reportType
      : null) ??
    (session?.report_type ?? "full_report");

  const isPoleReport = resolvedReportType === "pole_report";
  const poleDetailPath = isPoleReport ? "/teardowns/pole-report" : "/teardowns/pole-detail";

  const userTeamId = (user as any)?.team_id ?? null;
  const accessDenied = !!nodeTeamId && !!userTeamId && String(nodeTeamId) !== String(userTeamId);

  const [search, setSearch] = useState("");
  const [poles, setPoles] = useState<SkycablePole[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  // Tracks when each pole was last tapped from this list — used for most-recent-first sort
  const [lastSelectedMap, setLastSelectedMap] = useState<Record<string, number>>({});

  const [mapPreviewVisible, setMapPreviewVisible] = useState(false);
  const [mapTileView, setMapTileView] = useState<"street" | "satellite" | "dark">("street");
  const [imageCapturedMode, setImageCapturedMode] = useState(false);
  const [beforeCapturedMap, setBeforeCapturedMap] = useState<Record<string, boolean>>({});
  const [completedPole, setCompletedPole] = useState<SkycablePole | null>(null);
  const [completedPhotos, setCompletedPhotos] = useState<{ before: string | null; after: string | null; tag: string | null }>({ before: null, after: null, tag: null });
  const [completedPhotoViewer, setCompletedPhotoViewer] = useState<{ uri: string; label: string } | null>(null);
  const completedModalScale = useRef(new Animated.Value(0.88)).current;
  const completedModalOpacity = useRef(new Animated.Value(0)).current;

  const switchTileView = (view: "street" | "satellite" | "dark") => {
    setMapTileView(view);
    mapWvRef.current?.injectJavaScript(`if(window.setTileLayer)window.setTileLayer('${view}');true;`);
  };

  // ── Inline map overlay (WebView always mounted so CDN loads in background) ─
  const insets = useSafeAreaInsets();
  const lastFetchRef = useRef<number>(0);
  const mapWvRef = useRef<any>(null);
  const mapHtml = useMemo(() => buildPolesMapHtml({ isPoleReport }), [isPoleReport]);
  const [mapReady, setMapReady] = useState(false);
  // Cache last known position/heading so we can inject immediately on MAP_READY
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastHdgRef = useRef<number>(0);
  // Always-current ref for mapPolePins so MAP_READY never reads a stale closure
  // Initialized empty; synced on every render below (after mapPolePins is declared)
  const mapPolePinsRef = useRef<ReturnType<typeof Array<any>>>([]);

  useEffect(() => {
    if (!mapPreviewVisible) setMapReady(false);
  }, [mapPreviewVisible]);

  // ── Live GPS position + native compass heading → injected into map WebView ─
  useEffect(() => {
    let posSub: Location.LocationSubscription | null = null;
    let hdgSub: Location.LocationSubscription | null = null;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;

        posSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1500, distanceInterval: 1 },
          loc => {
            const { latitude: lat, longitude: lng } = loc.coords;
            lastPosRef.current = { lat, lng };
            mapWvRef.current?.injectJavaScript(`if(window.setLoc)window.setLoc(${lat},${lng});true;`);
          }
        );

        if (typeof (Location as any).watchHeadingAsync === "function") {
          hdgSub = await (Location as any).watchHeadingAsync((h: any) => {
            const deg = h.trueHeading ?? h.magHeading ?? 0;
            lastHdgRef.current = deg;
            mapWvRef.current?.injectJavaScript(`if(window.setHdg)window.setHdg(${deg});true;`);
          });
        }
      } catch {}
    })();

    return () => {
      posSub?.remove();
      hdgSub?.remove();
    };
  }, []);

  // ── Add Pole modal (pole_report only) ────────────────────────────────────
  const [addPoleVisible, setAddPoleVisible]     = useState(false);
  const [newPoleCode, setNewPoleCode]           = useState("");
  const [addingPole, setAddingPole]             = useState(false);

  // Pole report mode still respects the node session start gate: poles are "pending"
  // until the node teardown session is started.
  const isStarted = !!session?.date_start;

  // ── Load node session offline-first ──────────────────────────────────────
  useEffect(() => {
    if (!token || !nodeId) return;

    const SESSION_CACHE_KEY = `session_node_${nodeId}`;

    // 1. Instantly unblock layout via local cache
    cacheGet<NodeSession>(SESSION_CACHE_KEY).then(cached => {
      if (cached) {
        setSession(cached);
        setSessionLoading(false);
      }

      // 2. Fetch network layout state transparently in background
      getNodeDetail(Number(nodeId), token)
        .then(node => {
          const freshSession = {
            date_start: node.date_start ?? null,
            due_date: node.due_date ?? null,
            date_finished: node.date_finished ?? null,
            expected_cable: node.expected_cable ?? null,
            actual_cable: node.actual_cable ?? null,
            progress_percentage: node.progress_percentage ?? null,
            report_type: (node.report_type === "full_report" || node.report_type === "pole_report") ? node.report_type : null,
          };
          setSession(freshSession);
          cacheSet(SESSION_CACHE_KEY, freshSession).catch(() => {});
        })
        .catch(() => {})
        .finally(() => setSessionLoading(false));
    });
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

      // Show cached poles immediately; throttle network call to 30s to avoid
      // re-fetching on every return from pole-detail when nothing has changed.
      cacheGet<SkycablePole[]>(CACHE_KEY).then(async cached => {
        if (cached?.length) {
          setPoles(await mergeGps(cached));
        }
        setLoading(false); // Always unblock UI after cache check

        const now = Date.now();
        if (now - lastFetchRef.current < 30_000 && cached?.length) return;
        lastFetchRef.current = now;

        getNodePoles(Number(nodeId), token)
          .then(async data => {
            const enhancedData = data.map(freshPole => {
              const cachedMatch = cached?.find(c => String(c.pole_id) === String(freshPole.pole_id));
              let result = { ...freshPole };

              // Preserve locally cached GPS coordinates if server response is missing
              if (!result.pole?.lat || !result.pole?.lng) {
                if (cachedMatch?.pole?.lat && cachedMatch?.pole?.lng) {
                  result = { ...result, pole: { ...result.pole, lat: cachedMatch.pole.lat, lng: cachedMatch.pole.lng } };
                }
              }

              // Preserve locally edited pole code/name when backend still returns the old AsBuilt value.
              if (cachedMatch?.pole?.pole_code) {
                result = {
                  ...result,
                  pole: {
                    ...result.pole,
                    pole_code: cachedMatch.pole.pole_code,
                  },
                };
              }

              // Preserve in_progress status when:
              // • cache says the pole was started (date_start set + in_progress)
              // • backend still returns pending (update in-flight or queued offline)
              // This prevents the "blink back to pending" on return from pole-detail.
              if (result.pole?.skycable_status === "pending" && cachedMatch?.date_start && cachedMatch?.pole?.skycable_status === "in_progress") {
                result = {
                  ...result,
                  date_start: cachedMatch.date_start,
                  pole: { ...result.pole, skycable_status: "in_progress" as const },
                };
              }

              return result;
            });
            const merged = await mergeGps(enhancedData);
            cacheSet(CACHE_KEY, merged).catch(() => {});
            setPoles(merged);
            setOffline(false);
          })
          .catch(() => {
            if (!cached?.length) setOffline(true);
          });
      });
    }, [token, nodeId])
  );

  // ── Reload last-selected timestamps on every focus (so sort order is fresh after returning) ──
  useFocusEffect(
    useCallback(() => {
      if (!nodeId) return;
      cacheGet<SkycablePole[]>(`sitemap_poles_${nodeId}`).then(cached => {
        if (!cached?.length) return;
        const ids = cached.map(p => String(p.pole_id));
        Promise.all(ids.map(id => cacheGet<number>(`pole_last_selected_${id}`))).then(tsArr => {
          const map: Record<string, number> = {};
          ids.forEach((id, i) => { if (tsArr[i] != null) map[id] = tsArr[i]!; });
          setLastSelectedMap(map);
        });
      }).catch(() => {});
    }, [nodeId])
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
    const result = q ? base.filter(p => p.pole?.pole_code?.toLowerCase().includes(q)) : base;
    // Sort by most-recently-selected first; poles never selected stay in original API order
    return [...result].sort((a, b) => {
      const ta = lastSelectedMap[String(a.pole_id)] ?? 0;
      const tb = lastSelectedMap[String(b.pole_id)] ?? 0;
      return tb - ta;
    });
  }, [search, showCompleted, activePoles, completedPoles, lastSelectedMap]);

  const vicinityLocs = useMemo(
    () =>
      poles
        .filter(p => p.pole?.lat && p.pole?.lng)
        .map(p => ({
          lat: parseFloat(p.pole.lat),
          lng: parseFloat(p.pole.lng),
          cleared: p.pole.skycable_status === "cleared",
        })),
    [beforeCapturedMap, imageCapturedMode, poles]
  );

  const mapPolePins = useMemo(
    () =>
      poles
        .filter(p => p.pole?.lat && p.pole?.lng)
        .map(p => ({
          lat: parseFloat(p.pole.lat),
          lng: parseFloat(p.pole.lng),
          status: p.pole.skycable_status ?? "pending",
          code: p.pole.pole_code ?? "",
          id: p.id,
          pole_id: p.pole.id,
          has_before:
            p.pole.skycable_status === "cleared"
              ? false
              : !!beforeCapturedMap[String(p.pole.id)],
          image_mode: imageCapturedMode, // still needed for block-navigation logic
        })),
    [beforeCapturedMap, imageCapturedMode, poles]
  );
  // Keep ref in sync so MAP_READY handler always uses the latest poles
  mapPolePinsRef.current = mapPolePins;

  // Inject updated pole pins when map is ready and visible
  useEffect(() => {
    if (!mapReady || !mapPreviewVisible) return;
    const j = JSON.stringify(mapPolePins);
    mapWvRef.current?.injectJavaScript(`if(window.setPoles)window.setPoles(${j});true;`);
  }, [mapReady, mapPolePins, mapPreviewVisible]);

  // Re-fetch backend before-captured state whenever map becomes visible
  // (covers Sync All completing while the map is already open)
  useEffect(() => {
    if (!mapPreviewVisible || !nodeId) return;
    api.get(`/teardown/node-images/${nodeId}?inventory_type=skycable&image_type=before`)
      .then((res: any) => {
        const imgs: { pole_id: number }[] = Array.isArray((res as any)?.data)
          ? (res as any).data : ((res as any)?.data?.data ?? []);
        if (imgs.length) {
          setBeforeCapturedMap(prev => {
            const next = { ...prev };
            imgs.forEach(img => { next[String(img.pole_id)] = true; });
            return next;
          });
        }
      })
      .catch(() => {});
  }, [mapPreviewVisible, nodeId]);

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
    setPendingOpenPole(null);
  }

  async function handleStartTeardown() {
    if (!token || !nodeId || starting) return;

    setStarting(true);
    const now = getPHTNow();

    // 1. Immediately apply local state & storage cache to unblock inspection screen instantly
    const updatedSession = { ...session!, date_start: now };
    setSession(updatedSession);
    cacheSet(`session_node_${nodeId}`, updatedSession).catch(() => {});
    dismissGate();

	    // 2. Transmit session start payload to server; fallback to simpleQueue if offline
	    try {
	      await startNodeTeardown(Number(nodeId), token, now);
	    } catch (err: any) {
	      if (!err?.response?.status) {
	        await simpleQueuePush({
	          method: "put",
	          url: `/skycable/nodes/${nodeId}`,
	          body: { date_start: now, status: "in_progress" },
	        }).catch(() => {});
	      } else {
	        Alert.alert("Start Failed", err?.message ?? "Unable to start teardown.");
	      }
	    }
    setStarting(false);

    // If user tapped a pole while pending, continue straight to that pole after starting.
    if (pendingOpenPole) {
      router.push({
        pathname: poleDetailPath,
        params: {
          pole_id: pendingOpenPole.poleId,
          pole_row_id: String(pendingOpenPole.poleRowId),
          pole_code: pendingOpenPole.poleCode,
          pole_name: pendingOpenPole.poleCode,
          node_id: nodeId,
          node_name: nodeName,
          accent: "#0B7A5A",
          report_type: resolvedReportType,
        },
      } as any);
      setPendingOpenPole(null);
    }
  }

  // Load photos from pole_drafts when a completed pole is selected
  useEffect(() => {
    if (!completedPole) {
      setCompletedPhotos({ before: null, after: null, tag: null });
      return;
    }
    const poleId = String(completedPole.pole_id);
    const nId = String(completedPole.node_id ?? nodeId);
    const ts = Date.now();

    (async () => {
      const base = `${FileSystem.documentDirectory}pole_drafts/`;
      const result = { before: null as string | null, after: null as string | null, tag: null as string | null };

      try {
        const projects = await FileSystem.readDirectoryAsync(base).catch(() => [] as string[]);
        for (const proj of projects) {
          const dir = `${base}${proj}/${nId}/${poleId}/`;
          const dirInfo = await FileSystem.getInfoAsync(dir).catch(() => ({ exists: false }));
          if (!(dirInfo as any).exists) continue;

          const tryLoad = async (view: string, raw: string): Promise<string | null> => {
            const vi = await FileSystem.getInfoAsync(dir + view).catch(() => ({ exists: false }));
            if ((vi as any).exists) return `${dir}${view}?v=${ts}`;
            const ri = await FileSystem.getInfoAsync(dir + raw).catch(() => ({ exists: false }));
            if ((ri as any).exists) return `${dir}${raw}?v=${ts}`;
            return null;
          };

          result.before = await tryLoad(`pole_${poleId}_before_view.jpg`, `pole_${poleId}_before.jpg`);
          result.after  = await tryLoad(`pole_${poleId}_after_view.jpg`,  `pole_${poleId}_after.jpg`);
          result.tag    = await tryLoad(`pole_${poleId}_poletag_view.jpg`, `pole_${poleId}_poletag.jpg`);

          if (result.before || result.after || result.tag) break;
        }
      } catch {}

      setCompletedPhotos(result);
    })();
  }, [completedPole?.pole_id]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const refreshBeforeCapturedMap = async () => {
        if (!nodeId || poles.length === 0) {
          if (!cancelled) setBeforeCapturedMap({});
          return;
        }

        // ── Fast pass: check photo_captured_at cache keys (set instantly in pole-detail) ──
        // This runs synchronously from memory and updates the map immediately on return.
        const fast: Record<string, boolean> = {};
        await Promise.all(
          poles.map(async poleRow => {
            const poleId = String(poleRow.pole?.id ?? poleRow.pole_id ?? "");
            if (!poleId) return;
            const hit = await cacheGet<string>(`photo_captured_at_${poleId}_before`);
            if (hit) fast[poleId] = true;
          })
        );
        if (!cancelled && Object.keys(fast).length > 0) setBeforeCapturedMap(fast);

        // ── Slow pass: full filesystem scan as fallback (catches older captures) ──
        const base = `${FileSystem.documentDirectory}pole_drafts/`;
        const projects = await FileSystem.readDirectoryAsync(base).catch(() => [] as string[]);
        const next: Record<string, boolean> = { ...fast };

        for (const poleRow of poles) {
          const poleId = String(poleRow.pole?.id ?? poleRow.pole_id ?? "");
          if (!poleId || next[poleId]) continue; // already found via cache

          for (const proj of projects) {
            const dir = `${base}${proj}/${String(nodeId)}/${poleId}/`;
            const dirInfo = await FileSystem.getInfoAsync(dir).catch(() => ({ exists: false }));
            if (!(dirInfo as any).exists) continue;

            const beforeView = await FileSystem.getInfoAsync(`${dir}pole_${poleId}_before_view.jpg`).catch(() => ({ exists: false }));
            const beforeRaw  = await FileSystem.getInfoAsync(`${dir}pole_${poleId}_before.jpg`).catch(() => ({ exists: false }));
            if ((beforeView as any).exists || (beforeRaw as any).exists) {
              next[poleId] = true;
              break;
            }
          }
        }

        if (!cancelled) setBeforeCapturedMap(next);

        // ── Backend pass: fetch which poles have before photos in the server ──
        // Covers new devices or reinstalls with no local cache/files.
        try {
          const res = await api.get(`/teardown/node-images/${nodeId}?inventory_type=skycable&image_type=before`);
          const imgs: { pole_id: number }[] = Array.isArray((res as any)?.data)
            ? (res as any).data
            : ((res as any)?.data?.data ?? []);
          if (!cancelled && imgs.length > 0) {
            const fromBackend: Record<string, boolean> = { ...next };
            imgs.forEach(img => { fromBackend[String(img.pole_id)] = true; });
            setBeforeCapturedMap(fromBackend);
          }
        } catch {}
      };

      void refreshBeforeCapturedMap();
      return () => { cancelled = true; };
    }, [nodeId, poles])
  );

  // Zoom-in animation when completed pole modal opens
  useEffect(() => {
    if (completedPole) {
      completedModalScale.setValue(0.88);
      completedModalOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(completedModalScale, { toValue: 1, useNativeDriver: true, tension: 180, friction: 12 }),
        Animated.timing(completedModalOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [completedPole?.pole_id]);

  async function handleStartPoleFromList(poleId: number, poleRowId?: number) {
    if (!nodeId || !token) return;
    const now = getPHTNow();
    const CACHE_KEY = `sitemap_poles_${nodeId}`;
    const nextSequence = poles.reduce((max, p) => Math.max(max, Number(p.sequence) || 0), 0) + 1;

    // 1. Optimistic local state update
    setPoles(prev => {
      const updated = prev.map(p =>
        String(p.pole_id) === String(poleId)
          ? {
              ...p,
              date_start: p.date_start || now,
              sequence: p.sequence || nextSequence,
              pole: p.pole ? { ...p.pole, skycable_status: "in_progress" as const } : p.pole,
            }
          : p,
      );
      cacheSet(CACHE_KEY, updated).catch(() => {});
      return updated;
    });

    // 2. Backend sync — queue if offline
    api.patch(`/skycable/nodes/${nodeId}/poles/sync`, {
      pole_id: Number(poleId),
      date_start: now,
      status: "in_progress",
      sequence: nextSequence,
    }).catch(async (err: any) => {
      if (!err?.response?.status) {
        await simpleQueuePush({
          method: "patch",
          url: `/skycable/nodes/${nodeId}/poles/sync`,
          body: {
            pole_id: Number(poleId),
            date_start: now,
            status: "in_progress",
            sequence: nextSequence,
          },
        }).catch(() => {});
      }
    });

    // Skycable pole pivot row (skycable_poles) — use the pivot ID when available
    if (poleRowId) {
      api.put(`/skycable/nodes/${nodeId}/poles/${poleRowId}`, { date_start: now }).catch(async (err: any) => {
        if (!err?.response?.status) {
          await simpleQueuePush({
            method: "put",
            url: `/skycable/nodes/${nodeId}/poles/${poleRowId}`,
            body: { date_start: now },
          }).catch(() => {});
        }
      });
    }

    // Base pole record (poles.skycable_status) — this is what the web admin table shows
    api.put(`/skycable/poles/${poleId}`, { skycable_status: "in_progress" }).catch(async (err: any) => {
      if (!err?.response?.status) {
        await simpleQueuePush({
          method: "put",
          url: `/skycable/poles/${poleId}`,
          body: { skycable_status: "in_progress" },
        }).catch(() => {});
      } else {
        Alert.alert("Start Failed", err?.message ?? "Unable to start pole teardown.");
      }
    });
  }

  // ── Add Pole (pole_report only) ─────────────────────────────────────────
  async function handleAddPole() {
    const code = newPoleCode.trim();
    if (!code) { Alert.alert("Required", "Please enter a pole code."); return; }
    if (!nodeId || !token || addingPole) return;
      setAddingPole(true);
      try {
        const { data } = await api.post("/skycable/poles", {
          pole_code: code,
          node_id: Number(nodeId),
        });
      const payload = (data as any)?.data ?? data;
      const createdPole = payload?.pole ?? null;
      const createdNodePole = payload?.node_pole ?? null;
      const poleId = String(createdPole?.id ?? "");
      const poleRowId = String(createdNodePole?.id ?? "");
      if (!poleId || !poleRowId) throw new Error("Unexpected backend response while creating pole.");

      // Add to local poles list so the listahan stays updated when they come back
      const fakeSkyPole = {
        id: Number(poleRowId),
        node_id: Number(nodeId),
        pole_id: Number(poleId),
        sequence: Number(createdNodePole?.sequence) || poles.length + 1,
        date_start: createdNodePole?.date_start ?? null,
        cleared_at: createdNodePole?.cleared_at ?? null,
        pole: {
          id: Number(poleId),
          pole_code: code,
          lat: createdPole?.lat ?? null,
          lng: createdPole?.lng ?? null,
          skycable_status: (createdPole?.skycable_status ?? "pending") as "pending" | "in_progress" | "cleared",
          cableSlots: [],
        },
      };
      const updated = [...poles, fakeSkyPole];
      setPoles(updated as any);
      cacheSet(`sitemap_poles_${nodeId}`, updated).catch(() => {});

      // Close modal and navigate directly to pole-detail for GPS + photos
      setNewPoleCode("");
      setAddPoleVisible(false);
      router.push({
        pathname: poleDetailPath,
        params: {
          pole_id:   poleId,
          pole_row_id: poleRowId,
          pole_code: code,
          pole_name: code,
          node_id:   nodeId,
          node_name: nodeName,
          accent:    "#0B7A5A",
          report_type: "pole_report",
        },
      });
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? "Failed to add pole.";
      Alert.alert("Error", msg);
    } finally {
      setAddingPole(false);
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
    <View style={{ flex: 1 }}>
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

      {/* ── Always-mounted map overlay — WebView kept alive so CDN loads in background ── */}
      <View
        style={[StyleSheet.absoluteFillObject, { zIndex: mapPreviewVisible ? 99 : -1, opacity: mapPreviewVisible ? 1 : 0 }]}
        pointerEvents={mapPreviewVisible ? "auto" : "none"}
      >
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "#0d1117" }]}>
          <WebView
            ref={mapWvRef}
             key={`pm-${nodeId}-${mapPolePins.length}-${isPoleReport ? "pr" : "fr"}`}
             source={{ html: mapHtml, baseUrl: "https://gis-pole-map.local/" }}
            style={{ flex: 1 }}
            originWhitelist={["*"]}
            scrollEnabled={false}
            javaScriptEnabled
            domStorageEnabled
            geolocationEnabled
            mixedContentMode="always"
            allowFileAccess
            allowUniversalAccessFromFileURLs
            cacheEnabled={true}
            androidLayerType="hardware"
            textZoom={100}
            setSupportMultipleWindows={false}
            onMessage={e => {
              try {
                const msg = JSON.parse(e.nativeEvent.data);
                if (msg.type === "MAP_READY") {
                  setMapReady(true);
                  // Use ref — never reads a stale closure value
                  const j = JSON.stringify(mapPolePinsRef.current);
                  mapWvRef.current?.injectJavaScript(`if(window.setPoles)window.setPoles(${j});true;`);
                  // Apply tile view (user may have switched before MAP_READY)
                  mapWvRef.current?.injectJavaScript(`if(window.setTileLayer)window.setTileLayer('${mapTileView}');true;`);
                  // Immediately show current location — don't wait for next watcher tick
                  if (lastPosRef.current) {
                    const { lat, lng } = lastPosRef.current;
                    mapWvRef.current?.injectJavaScript(
                      `if(window.setLoc)window.setLoc(${lat},${lng});if(window.setHdg)window.setHdg(${lastHdgRef.current});true;`
                    );
                  }
                  return;
                }
                if (msg.type === "start" || msg.type === "open") {
                  const tappedPin = mapPolePinsRef.current.find(p => String(p.pole_id) === String(msg.pole_id));

                  if (imageCapturedMode && !tappedPin?.has_before) {
                    // No before photo yet — do batch before capture
                    if (!tappedPin?.lat || !tappedPin?.lng) {
                      Alert.alert("GPS Required", "This pole has no saved map coordinates yet, so Image Captured Mode cannot open for it.");
                      return;
                    }
                    router.push({
                      pathname: poleDetailPath,
                      params: {
                        pole_id: String(msg.pole_id),
                        pole_row_id: String(msg.id),
                        pole_code: String(msg.code ?? ""),
                        pole_name: String(msg.code ?? ""),
                        node_id: nodeId ?? "",
                        node_name: nodeName,
                        accent: "#0B7A5A",
                        report_type: resolvedReportType,
                        sitemap_lat: String(tappedPin.lat),
                        sitemap_lng: String(tappedPin.lng),
                        batch_before_capture: "1",
                        auto_capture_tab: "before",
                        return_to_map: "1",
                      },
                    } as any);
                    return;
                  }

                  // has_before OR not in imageCapturedMode — normal navigation
                  setMapPreviewVisible(false);

                  if (!isStarted) {
                    setPendingOpenPole({
                      poleRowId: msg.id,
                      poleId: String(msg.pole_id),
                      poleCode: String(msg.code ?? ""),
                    });
                    setGateVisible(true);
                    return;
                  }

                  const shouldAutoStartPole = msg.type === "start" && !isPoleReport;

                  // Only ongoing poles should auto-continue teardown here.
                  // Pending poles should open the pole screen without changing status.
                  if (shouldAutoStartPole) {
                    handleStartPoleFromList(Number(msg.pole_id), Number(msg.id)).catch(() => {});
                  }
                  router.push({
                    pathname: poleDetailPath,
                    params: {
                      pole_id: String(msg.pole_id),
                      pole_row_id: String(msg.id),
                      pole_code: String(msg.code ?? ""),
                      pole_name: String(msg.code ?? ""),
                      node_id: nodeId ?? "",
                      node_name: nodeName,
                      accent: "#0B7A5A",
                      report_type: resolvedReportType,
                      sitemap_lat: tappedPin?.lat ? String(tappedPin.lat) : "",
                      sitemap_lng: tappedPin?.lng ? String(tappedPin.lng) : "",
                    },
                  } as any);
                }
              } catch {}
            }}
          />
        </View>

        {/* Floating top card */}
        <View style={[mp.floatingTopCard, { top: Math.max(insets.top + 8, 12) }]}>
          <View style={mp.headerTopRow}>
            <View style={mp.titleWrap}>
              <Text style={mp.title}>{nodeName || "Node"}</Text>
              <Text style={mp.subtitle}>{mapPolePins.length} poles · {mapPolePins.filter(p => p.status === "cleared").length} completed ↻</Text>
            </View>
            <View style={mp.headerActionsRow}>
              <TouchableOpacity
                style={[mp.captureModeBtn, imageCapturedMode && mp.captureModeBtnActive]}
                onPress={() => setImageCapturedMode(v => !v)}
                activeOpacity={0.8}
              >
                <Text style={[mp.captureModeBtnText, imageCapturedMode && mp.captureModeBtnTextActive]}>Image Captured Mode</Text>
              </TouchableOpacity>
              <TouchableOpacity style={mp.closeBtn} onPress={() => setMapPreviewVisible(false)} activeOpacity={0.7}>
                <X size={18} color="#64748B" />
              </TouchableOpacity>
            </View>
          </View>
          {imageCapturedMode ? (
            // Image Captured Mode — show before capture progress
            (() => {
              const withGps   = mapPolePins.length;
              const captured  = mapPolePins.filter(p => p.has_before).length;
              const remaining = withGps - captured;
              const allDone   = remaining === 0 && withGps > 0;
              return (
                <View style={[mp.dropdownRow, { gap: 8 }]}>
                  <View style={[mp.dropdown, { flex: 1.4, backgroundColor: "#FEE2E2", borderColor: "#FECACA" }]}>
                    <View style={[mp.legendDot, { backgroundColor: "#DC2626" }]} />
                    <Text style={[mp.dropdownLabel, { color: "#DC2626" }]}>CAPTURED</Text>
                    <Text style={[mp.dropdownValue, { color: "#DC2626" }]}>{captured}/{withGps}</Text>
                  </View>
                  <View style={[mp.dropdown, { flex: 1.4, backgroundColor: allDone ? "#ECFDF5" : "#FFF7E8", borderColor: allDone ? "#A7F3D0" : "#FDE68A" }]}>
                    <View style={[mp.legendDot, { backgroundColor: allDone ? "#10b981" : "#f59e0b" }]} />
                    <Text style={[mp.dropdownLabel, { color: allDone ? "#059669" : "#B45309" }]}>
                      {allDone ? "ALL DONE ✓" : "REMAINING"}
                    </Text>
                    <Text style={[mp.dropdownValue, { color: allDone ? "#059669" : "#B45309" }]}>
                      {allDone ? "✓" : remaining}
                    </Text>
                  </View>
                </View>
              );
            })()
          ) : (
            <View style={mp.dropdownRow}>
              <View style={mp.dropdown}>
                <View style={[mp.legendDot, { backgroundColor: "#10b981" }]} />
                <Text style={mp.dropdownLabel}>DONE</Text>
                <Text style={[mp.dropdownValue, { color: "#10b981" }]}>{mapPolePins.filter(p => p.status === "cleared").length}</Text>
              </View>
              <View style={mp.dropdown}>
                <View style={[mp.legendDot, { backgroundColor: "#6366f1" }]} />
                <Text style={mp.dropdownLabel}>ONGOING</Text>
                <Text style={[mp.dropdownValue, { color: "#6366f1" }]}>{mapPolePins.filter(p => p.status === "in_progress").length}</Text>
              </View>
              <View style={mp.dropdown}>
                <View style={[mp.legendDot, { backgroundColor: "#f59e0b" }]} />
                <Text style={mp.dropdownLabel}>PENDING</Text>
                <Text style={[mp.dropdownValue, { color: "#f59e0b" }]}>{mapPolePins.filter(p => p.status !== "cleared" && p.status !== "in_progress").length}</Text>
              </View>
            </View>
          )}

          {/* Tile view toggle */}
          <View style={mp.tileToggleRow}>
            {(["street", "satellite", "dark"] as const).map(v => (
              <TouchableOpacity
                key={v}
                style={[mp.tileBtn, mapTileView === v && mp.tileBtnActive]}
                onPress={() => switchTileView(v)}
                activeOpacity={0.75}
              >
                <Text style={[mp.tileBtnText, mapTileView === v && mp.tileBtnTextActive]}>
                  {v === "street" ? "🗺 Street" : v === "satellite" ? "🛰 Satellite" : "🌑 Dark"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Bottom no-GPS card */}
        {poles.filter(p => !p.pole?.lat || !p.pole?.lng).length > 0 && (
          <View style={mp.floatingBottomCard} pointerEvents="none">
            <Text style={mp.bottomTitle}>{poles.filter(p => !p.pole?.lat || !p.pole?.lng).length} without GPS</Text>
            <View style={mp.badgeRow}>
              <View style={[mp.glassBadge, { backgroundColor: "rgba(255,251,235,0.92)" }]}>
                <View style={[mp.badgeDot, { backgroundColor: "#f59e0b" }]} />
                <Text style={[mp.badgeText, { color: "#f59e0b" }]}>{poles.filter(p => !p.pole?.lat || !p.pole?.lng).length} pending</Text>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* ── Add Pole Modal (pole_report only) ── */}
      <Modal visible={addPoleVisible} transparent animationType="slide" onRequestClose={() => setAddPoleVisible(false)}>
        <View style={s.addPoleBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setAddPoleVisible(false)} />
          <View style={s.addPoleSheet}>
            <View style={s.addPoleHandle} />
            <Text style={s.addPoleTitle}>Add New Pole</Text>
            <Text style={s.addPoleSub}>Enter the pole code/name to register it to this node.</Text>
            <TextInput
              style={s.addPoleInput}
              placeholder="e.g. POLE-12 or BGC-011"
              placeholderTextColor="#94A3B8"
              value={newPoleCode}
              onChangeText={setNewPoleCode}
              autoCapitalize="characters"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleAddPole}
            />
            <TouchableOpacity
              style={[s.addPoleBtn, (!newPoleCode.trim() || addingPole) && { opacity: 0.55 }]}
              activeOpacity={0.85}
              onPress={handleAddPole}
              disabled={!newPoleCode.trim() || addingPole}
            >
              {addingPole
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Text style={s.addPoleBtnText}>+ Add Pole</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.addPoleCancelBtn} onPress={() => { setAddPoleVisible(false); setNewPoleCode(""); }}>
              <Text style={s.addPoleCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Completed Pole Full-Screen Preview ── */}
      <Modal
        visible={!!completedPole}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setCompletedPole(null)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }}>
          <Animated.View style={{ flex: 1, backgroundColor: "#F8FAFC", transform: [{ scale: completedModalScale }], opacity: completedModalOpacity }}>
            {/* Green header */}
            <View style={{ backgroundColor: "#0B7A5A", paddingTop: 54, paddingBottom: 20, paddingHorizontal: 20 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 20 }}>✓</Text>
                  </View>
                  <View>
                    <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "700", letterSpacing: 1.5 }}>LANDMARK</Text>
                    <Text style={{ color: "#FFF", fontSize: 22, fontWeight: "900", marginTop: 2 }}>
                      {completedPole?.pole?.pole_code ?? "Pole"}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setCompletedPole(null)}
                  style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" }}
                >
                  <X size={20} color="#FFF" />
                </TouchableOpacity>
              </View>

              {/* Status + dates row */}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                <View style={{ backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, flex: 1 }}>
                  <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 9, fontWeight: "700", letterSpacing: 1.2 }}>STARTED AT</Text>
                  <Text style={{ color: "#FFF", fontSize: 11, fontWeight: "800", marginTop: 3 }}>
                    {completedPole?.date_start ? fmtPHT(completedPole.date_start) : "—"}
                  </Text>
                </View>
                <View style={{ backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, flex: 1 }}>
                  <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 9, fontWeight: "700", letterSpacing: 1.2 }}>CLEARED AT</Text>
                  <Text style={{ color: "#A7F3D0", fontSize: 11, fontWeight: "800", marginTop: 3 }}>
                    {completedPole?.cleared_at ? fmtPHT(completedPole.cleared_at) : "—"}
                  </Text>
                </View>
                <View style={{ backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, flex: 1 }}>
                  <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 9, fontWeight: "700", letterSpacing: 1.2 }}>STATUS</Text>
                  <Text style={{ color: "#A7F3D0", fontSize: 11, fontWeight: "800", marginTop: 3 }}>Completed</Text>
                </View>
              </View>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
              {/* GPS map */}
              {!!completedPole?.pole?.lat && !!completedPole?.pole?.lng && (
                <View style={{ marginHorizontal: 16, marginTop: 16, borderRadius: 16, overflow: "hidden", height: 180, backgroundColor: "#E2E8F0" }}>
                  <StaticTileMap lat={parseFloat(completedPole.pole.lat)} lng={parseFloat(completedPole.pole.lng)} />
                  <View style={{ position: "absolute", bottom: 8, left: 10, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: "#FFF", fontSize: 10, fontWeight: "700" }}>
                      {Number(completedPole.pole.lat).toFixed(6)}, {Number(completedPole.pole.lng).toFixed(6)}
                    </Text>
                  </View>
                  <View style={{ position: "absolute", top: 8, right: 10, backgroundColor: "rgba(6,118,71,0.85)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: "#FFF", fontSize: 9, fontWeight: "800", letterSpacing: 0.8 }}>CAPTURED</Text>
                  </View>
                </View>
              )}

              {/* Photos section */}
              <View style={{ marginHorizontal: 16, marginTop: 16 }}>
                <Text style={{ color: "#94A3B8", fontSize: 10, fontWeight: "700", letterSpacing: 1.4, marginBottom: 10 }}>PHOTOS</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {([
                    { label: "Before", uri: completedPhotos.before },
                    { label: "After",  uri: completedPhotos.after },
                    { label: "Tag",    uri: completedPhotos.tag },
                  ] as const).map(({ label, uri }) => (
                    <TouchableOpacity
                      key={label}
                      style={{ flex: 1, aspectRatio: 0.75, borderRadius: 14, overflow: "hidden", backgroundColor: "#F1F5F9", borderWidth: 1.5, borderColor: uri ? "#0B7A5A" : "#E2E8F0" }}
                      activeOpacity={uri ? 0.8 : 1}
                      onPress={() => uri && setCompletedPhotoViewer({ uri, label })}
                    >
                      {uri ? (
                        <Image source={{ uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
                      ) : (
                        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: 24, marginBottom: 4 }}>📷</Text>
                          <Text style={{ color: "#CBD5E1", fontSize: 9, fontWeight: "700" }}>NO PHOTO</Text>
                        </View>
                      )}
                      <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.5)", paddingVertical: 5, alignItems: "center" }}>
                        <Text style={{ color: "#FFF", fontSize: 9, fontWeight: "800", letterSpacing: 1 }}>{label.toUpperCase()}</Text>
                      </View>
                      {uri && (
                        <View style={{ position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: "#0B7A5A", alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ color: "#FFF", fontSize: 9, fontWeight: "900" }}>✓</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Cable slots */}
              <View style={{ marginHorizontal: 16, marginTop: 16 }}>
                <Text style={{ color: "#94A3B8", fontSize: 10, fontWeight: "700", letterSpacing: 1.4, marginBottom: 10 }}>CABLE SLOTS</Text>
                {(completedPole?.pole?.cableSlots?.length ?? 0) === 0 ? (
                  <View style={{ backgroundColor: "#F1F5F9", borderRadius: 12, paddingVertical: 18, alignItems: "center", borderWidth: 1, borderColor: "#E2E8F0" }}>
                    <Text style={{ color: "#CBD5E1", fontSize: 13, fontWeight: "700" }}>No slots detected</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {completedPole!.pole.cableSlots.map(sl => {
                      const isFree = sl.occupied_by === "free";
                      const col = SLOT_COLORS[sl.occupied_by] || "#64748B";
                      return (
                        <View
                          key={sl.slot_label}
                          style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: isFree ? "#F8FAFC" : col + "18", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: isFree ? "#E2E8F0" : col + "55" }}
                        >
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isFree ? "#CBD5E1" : col }} />
                          <Text style={{ color: isFree ? "#94A3B8" : "#1E293B", fontSize: 11, fontWeight: "700" }}>{sl.slot_label}</Text>
                          {!isFree && (
                            <Text style={{ color: col, fontSize: 9, fontWeight: "800", textTransform: "uppercase" }}>{sl.occupied_by}</Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Photo viewer modal */}
      <Modal
        visible={!!completedPhotoViewer}
        transparent={false}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setCompletedPhotoViewer(null)}
      >
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          {completedPhotoViewer && (
            <Image source={{ uri: completedPhotoViewer.uri }} style={StyleSheet.absoluteFillObject} resizeMode="contain" />
          )}
          <View style={{ position: "absolute", top: 54, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20 }}>
            <View style={{ backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ color: "#FFF", fontSize: 13, fontWeight: "800" }}>{completedPhotoViewer?.label}</Text>
            </View>
            <TouchableOpacity
              onPress={() => setCompletedPhotoViewer(null)}
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}
            >
              <X size={20} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
	              Press the button below to officially begin{"\n"}this node’s teardown session.
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
                  onPress={() => { setShowCompleted(false); setSearch(""); }}
                  style={[s.filterChip, !showCompleted && s.filterChipActive]}
                >
                  <Text style={[s.filterChipText, !showCompleted && s.filterChipTextActive]}>
                    Pending ({activePoles.length})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => { setShowCompleted(true); setSearch(""); }}
                  style={[s.filterChip, showCompleted && s.filterChipDone]}
                >
                  <Text style={[s.filterChipText, showCompleted && s.filterChipTextActive]}>
                    Completed ({completedPoles.length})
                  </Text>
                </TouchableOpacity>

                {/* Add Pole — only for pole_report nodes after teardown is started */}
                {isPoleReport && isStarted && !showCompleted && (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => setAddPoleVisible(true)}
                    style={s.addPoleFab}
                  >
                    <Text style={s.addPoleFabText}>+ Add Pole</Text>
                  </TouchableOpacity>
                )}
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
                  const isCaptured = imageCapturedMode && !!beforeCapturedMap[String(poleInfo.id ?? np.pole_id)];

                  return (
                    <TouchableOpacity
                      style={[s.cardContainer, isCaptured && { opacity: 0.6 }]}
                      activeOpacity={isCaptured ? 1 : isStarted ? 0.8 : 1}
                      disabled={isCaptured}
                      onPress={() => {
                        if (!isStarted) {
                          setPendingOpenPole({
                            poleRowId: np.id,
                            poleId: String(np.pole_id),
                            poleCode: poleInfo.pole_code,
                          });
                          setGateVisible(true);
                          return;
                        }

                        // Completed poles → show info preview, never navigate or re-start
                        if (poleInfo.skycable_status === "cleared") {
                          setCompletedPole(np);
                          return;
                        }

                        const poleId = String(np.pole_id);
                        const nowMs = Date.now();

                        // Track last-selected for sort order (most-recent-first)
                        cacheSet(`pole_last_selected_${poleId}`, nowMs).catch(() => {});
                        setLastSelectedMap(prev => ({ ...prev, [poleId]: nowMs }));

                        // Only re-sync if the pole was already started — don't auto-start on card tap.
                        // The user explicitly starts via "Start Pole Teardown" on the detail screen.
                        if (!isPoleReport && np.date_start) {
                          handleStartPoleFromList(Number(np.pole_id), Number(np.id)).catch(() => {});
                        }

                        router.push({
                          pathname: poleDetailPath,
                          params: {
                            pole_id: np.pole_id,
                            pole_row_id: np.id,
                            pole_code: poleInfo.pole_code,
                            pole_name: poleInfo.pole_code,
                            node_id: nodeId,
                            node_name: nodeName,
                            accent: "#0B7A5A",
                            report_type: resolvedReportType,
                            sitemap_lat: poleInfo.lat ? String(poleInfo.lat) : "",
                            sitemap_lng: poleInfo.lng ? String(poleInfo.lng) : "",
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
                        {isCaptured && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2 }}>
                            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#DC2626" }} />
                            <Text style={{ fontSize: 9, fontWeight: "800", color: "#DC2626", letterSpacing: 1.2, textTransform: "uppercase" }}>Before Captured · Locked</Text>
                          </View>
                        )}
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
    </View>
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

  // ── Add Pole FAB ──────────────────────────────────────────────────────────
  addPoleFab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#0B7A5A",
    alignSelf: "center",
  },
  addPoleFabText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#FFFFFF",
  },

  // ── Add Pole modal ────────────────────────────────────────────────────────
  addPoleBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "flex-end",
  },
  addPoleSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 14,
  },
  addPoleHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E2E8F0",
    alignSelf: "center",
    marginBottom: 20,
  },
  addPoleTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 6,
  },
  addPoleSub: {
    fontSize: 13,
    fontWeight: "500",
    color: "#6B7280",
    marginBottom: 18,
    lineHeight: 20,
  },
  addPoleInput: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 14,
  },
  addPoleBtn: {
    backgroundColor: "#0B7A5A",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    shadowColor: "#0B7A5A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  addPoleBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  addPoleCancelBtn: {
    alignItems: "center",
    paddingVertical: 10,
  },
  addPoleCancelText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#94A3B8",
  },
});








