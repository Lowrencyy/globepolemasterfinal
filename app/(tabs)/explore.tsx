import { useAuth } from "@/context/auth-context";
import { cacheGet, cacheSet } from "@/lib/cache";
import api from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
const CACHE_KEY = "pole_map_pins_v1";

type PolePin = {
  id: number;
  pole_code: string;
  lat: number | null;
  lng: number | null;
  has_gps: boolean;
  status: string | null;
  barangay: string | null;
  node: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  cleared:     "#10b981",
  completed:   "#10b981",
  in_progress: "#10b981",
  pending:     "#f59e0b",
};

// Normalize any backend status to just "completed" or "pending"
function normalizeStatus(s: string | null): "completed" | "pending" {
  if (!s) return "pending";
  if (s === "cleared" || s === "completed" || s === "in_progress") return "completed";
  return "pending";
}

const STATUS_FILTERS = [
  { key: "all",       label: "All" },
  { key: "pending",   label: "Pending" },
  { key: "completed", label: "Completed" },
] as const;

type StatusFilter = typeof STATUS_FILTERS[number]["key"];

function buildMapHtml(pins: PolePin[], filter: StatusFilter): string {
  // Only plot poles that have GPS coordinates
  const withGps = pins.filter(p => p.has_gps);
  const normalized = withGps.map(p => ({ ...p, status: normalizeStatus(p.status) }));
  const filtered = filter === "all" ? normalized : normalized.filter(p => p.status === filter);
  const pinsJson = JSON.stringify(filtered);
  const colorsJson = JSON.stringify({ completed: "#10b981", pending: "#f59e0b" });

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body,#map{width:100%;height:100%;background:#0f172a;}
.pp{width:9px;height:9px;border-radius:50%;border:1.5px solid rgba(255,255,255,0.7);box-shadow:0 0 5px rgba(0,0,0,0.5);}
.leaflet-popup-content-wrapper{border-radius:12px;background:#1e293b;color:#f1f5f9;border:1px solid rgba(255,255,255,0.1);}
.leaflet-popup-content{margin:10px 14px;font-family:system-ui,sans-serif;}
.leaflet-popup-tip{background:#1e293b;}
.leaflet-popup-close-button{color:#94a3b8!important;}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var PINS=${pinsJson};
var COLORS=${colorsJson};
var map=L.map('map',{zoomControl:true,attributionControl:false});
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19}).addTo(map);

function color(s){return COLORS[s]||'#f59e0b';}
function label(s){return s==='completed'?'Completed':'Pending';}

var bounds=[];
PINS.forEach(function(p){
  var c=color(p.status);
  var icon=L.divIcon({className:'',html:'<div class="pp" style="background:'+c+'"></div>',iconSize:[9,9],iconAnchor:[4.5,4.5]});
  var m=L.marker([p.lat,p.lng],{icon:icon}).addTo(map);
  m.bindPopup(
    '<div style="min-width:160px">'+
    '<div style="font-size:13px;font-weight:800;color:#e2e8f0;font-family:monospace">'+p.pole_code+'</div>'+
    (p.node?'<div style="font-size:11px;color:#7dd3fc;margin-top:3px;font-weight:600">'+p.node+'</div>':'')+
    (p.barangay?'<div style="font-size:11px;color:#94a3b8;margin-top:2px">'+p.barangay+'</div>':'')+
    '<div style="margin-top:7px;display:inline-block;padding:2px 8px;border-radius:99px;background:'+c+'22;color:'+c+';font-size:10px;font-weight:700">'+label(p.status)+'</div>'+
    '</div>'
  );
  bounds.push([p.lat,p.lng]);
});

if(bounds.length>0){
  try{map.fitBounds(bounds,{padding:[32,32]});}
  catch(e){map.setView([12.8797,121.7740],6);}
}else{
  map.setView([12.8797,121.7740],6);
}
setTimeout(function(){map.invalidateSize();},150);
</script>
</body>
</html>`;
}

export default function PoleMapScreen() {
  const { token } = useAuth();
  const webRef = useRef<WebView>(null);

  const [pins, setPins] = useState<PolePin[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [mapHtml, setMapHtml] = useState("");

  const fetchPins = useCallback(async (bustCache = false) => {
    if (!token) return;
    if (bustCache) await cacheSet(CACHE_KEY, null);

    // Show cached data immediately
    const cached = await cacheGet<PolePin[]>(CACHE_KEY);
    if (cached && cached.length > 0) {
      setPins(cached);
      setLoading(false);
    }

    // Always fetch fresh — use allPoles so poles without GPS still count in totals
    setFetching(true);
    try {
      const { data } = await api.get("/skycable/poles/all");
      const rows: any[] = Array.isArray(data) ? data : (data?.data ?? []);
      const all: PolePin[] = rows.map(p => ({
        id:        p.id,
        pole_code: p.pole_code,
        lat:       p.lat ? Number(p.lat) : null,
        lng:       p.lng ? Number(p.lng) : null,
        has_gps:   !!(p.lat && p.lng),
        status:    p.skycable_status ?? "pending",
        barangay:  p.barangay ?? null,
        node:      p.node ?? null,
      }));
      if (all.length > 0) {
        setPins(all);
        await cacheSet(CACHE_KEY, all);
      }
    } catch {}
    finally {
      setFetching(false);
      setLoading(false);
    }
  }, [token]);

  // Initial load
  useEffect(() => { fetchPins(); }, [fetchPins]);

  // Bust cache and refresh every time the tab comes into focus
  useFocusEffect(useCallback(() => {
    fetchPins(true);
  }, [fetchPins]));

  // Rebuild map HTML whenever pins or filter changes
  useEffect(() => {
    if (pins.length > 0) {
      setMapHtml(buildMapHtml(pins, filter));
    }
  }, [pins, filter]);

  const gpspoles   = pins.filter(p => p.has_gps);
  const noGpsPoles = pins.filter(p => !p.has_gps);
  const completedNoGps = noGpsPoles.filter(p => normalizeStatus(p.status) === "completed").length;
  const pendingNoGps   = noGpsPoles.filter(p => normalizeStatus(p.status) === "pending").length;

  const visibleCount = filter === "all"
    ? gpspoles.length
    : gpspoles.filter(p => normalizeStatus(p.status) === filter).length;

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>Pole Map</Text>
          <Text style={s.subtitle}>
            {loading
              ? "Loading…"
              : `${visibleCount} on map · ${pins.length} total`}
            {fetching && !loading ? "  ↻" : ""}
          </Text>
        </View>
      </View>

      {/* Status filter pills */}
      <View style={s.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterScroll}>
          {STATUS_FILTERS.map(f => {
            const active = filter === f.key;
            const color = f.key === "all" ? "#8b5cf6" : (STATUS_COLORS[f.key] ?? "#8b5cf6");
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[s.pill, active && { backgroundColor: color, borderColor: color }]}
              >
                {f.key !== "all" && (
                  <View style={[s.pillDot, { backgroundColor: active ? "#fff" : color }]} />
                )}
                <Text style={[s.pillText, active && s.pillTextActive]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Map */}
      <View style={s.mapContainer}>
        {loading ? (
          <View style={s.loader}>
            <ActivityIndicator size="large" color="#8b5cf6" />
            <Text style={s.loaderText}>Loading poles…</Text>
          </View>
        ) : gpspoles.length === 0 ? (
          <View style={s.loader}>
            <Text style={s.loaderText}>No poles with GPS yet. Capture GPS during teardown to pin them here.</Text>
          </View>
        ) : (
          <WebView
            ref={webRef}
            source={{ html: mapHtml }}
            style={s.map}
            originWhitelist={["*"]}
            scrollEnabled={false}
            javaScriptEnabled
          />
        )}
      </View>

      {/* No-GPS poles strip */}
      {noGpsPoles.length > 0 && (
        <View style={s.noGpsStrip}>
          <View style={s.noGpsLeft}>
            <Text style={s.noGpsIcon}>📍</Text>
            <Text style={s.noGpsLabel}>
              {noGpsPoles.length} pole{noGpsPoles.length !== 1 ? "s" : ""} without GPS
            </Text>
          </View>
          <View style={s.noGpsRight}>
            {completedNoGps > 0 && (
              <View style={[s.noGpsBadge, { backgroundColor: "#10b98122" }]}>
                <View style={[s.noGpsDot, { backgroundColor: "#10b981" }]} />
                <Text style={[s.noGpsBadgeText, { color: "#10b981" }]}>{completedNoGps} done</Text>
              </View>
            )}
            {pendingNoGps > 0 && (
              <View style={[s.noGpsBadge, { backgroundColor: "#f59e0b22" }]}>
                <View style={[s.noGpsDot, { backgroundColor: "#f59e0b" }]} />
                <Text style={[s.noGpsBadgeText, { color: "#f59e0b" }]}>{pendingNoGps} pending</Text>
              </View>
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 22,
    fontWeight: "900",
    color: "#f1f5f9",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
    marginTop: 2,
  },
  filterRow: {
    paddingBottom: 10,
  },
  filterScroll: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 99,
    borderWidth: 1.5,
    borderColor: "#334155",
    backgroundColor: "#1e293b",
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#94a3b8",
  },
  pillTextActive: {
    color: "#ffffff",
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loaderText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
    textAlign: "center",
    paddingHorizontal: 32,
  },
  noGpsStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1e293b",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#334155",
  },
  noGpsLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  noGpsIcon: { fontSize: 14 },
  noGpsLabel: { fontSize: 12, fontWeight: "600", color: "#94a3b8" },
  noGpsRight: { flexDirection: "row", gap: 8 },
  noGpsBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99 },
  noGpsDot: { width: 5, height: 5, borderRadius: 3 },
  noGpsBadgeText: { fontSize: 11, fontWeight: "700" },
});
