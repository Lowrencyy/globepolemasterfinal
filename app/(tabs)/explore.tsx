import { useAuth } from "@/context/auth-context";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getPoles } from "@/services/pole";
import { useEffect, useRef, useState } from "react";
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
const PER_PAGE = 500;

type PolePin = {
  id: number;
  pole_code: string;
  lat: number;
  lng: number;
  status: string | null;
  barangay: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  active:      "#10b981",
  cleared:     "#10b981",
  inactive:    "#6b7280",
  pending:     "#f59e0b",
  in_progress: "#3b82f6",
  for_removal: "#ef4444",
};

const STATUS_FILTERS = [
  { key: "all",        label: "All" },
  { key: "pending",    label: "Pending" },
  { key: "active",     label: "Active" },
  { key: "inactive",   label: "Inactive" },
  { key: "for_removal",label: "For Removal" },
] as const;

type StatusFilter = typeof STATUS_FILTERS[number]["key"];

function buildMapHtml(pins: PolePin[], filter: StatusFilter): string {
  const filtered = filter === "all" ? pins : pins.filter(p => p.status === filter);
  const pinsJson = JSON.stringify(filtered);
  const colorsJson = JSON.stringify(STATUS_COLORS);

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

function color(s){return COLORS[s]||'#8b5cf6';}
function label(s){return s?(s.replace(/_/g,' ').replace(/\\b\\w/g,function(c){return c.toUpperCase()})):'Unknown';}

var bounds=[];
PINS.forEach(function(p){
  var c=color(p.status);
  var icon=L.divIcon({className:'',html:'<div class="pp" style="background:'+c+'"></div>',iconSize:[9,9],iconAnchor:[4.5,4.5]});
  var m=L.marker([p.lat,p.lng],{icon:icon}).addTo(map);
  m.bindPopup(
    '<div style="min-width:140px">'+
    '<div style="font-size:13px;font-weight:800;color:#e2e8f0;font-family:monospace">'+p.pole_code+'</div>'+
    (p.barangay?'<div style="font-size:11px;color:#94a3b8;margin-top:3px">'+p.barangay+'</div>':'')+
    '<div style="margin-top:6px;display:inline-block;padding:2px 8px;border-radius:99px;background:'+c+'22;color:'+c+';font-size:10px;font-weight:700">'+label(p.status)+'</div>'+
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

  // Load from cache then fetch fresh
  useEffect(() => {
    if (!token) return;

    (async () => {
      // 1. Show cached data instantly
      const cached = await cacheGet<PolePin[]>(CACHE_KEY);
      if (cached && cached.length > 0) {
        setPins(cached);
        setLoading(false);
      }

      // 2. Fetch all pages in background
      setFetching(true);
      try {
        const all: PolePin[] = [];
        let page = 1;
        let lastPage = 1;

        do {
          const res = await getPoles(token, { page, per_page: PER_PAGE });
          const rows = res.data ?? [];
          rows.forEach(p => {
            if (p.lat && p.lng) {
              all.push({
                id:       p.id,
                pole_code: p.pole_code,
                lat:      parseFloat(p.lat),
                lng:      parseFloat(p.lng),
                status:   p.globe_status,
                barangay: p.barangay?.name ?? null,
              });
            }
          });
          lastPage = res.meta?.last_page ?? res.last_page ?? 1;
          page++;
        } while (page <= lastPage);

        if (all.length > 0) {
          setPins(all);
          await cacheSet(CACHE_KEY, all);
        }
      } catch {}
      finally {
        setFetching(false);
        setLoading(false);
      }
    })();
  }, [token]);

  // Rebuild map HTML whenever pins or filter changes
  useEffect(() => {
    if (pins.length > 0) {
      setMapHtml(buildMapHtml(pins, filter));
    }
  }, [pins, filter]);

  const visibleCount = filter === "all"
    ? pins.length
    : pins.filter(p => p.status === filter).length;

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>Pole Map</Text>
          <Text style={s.subtitle}>
            {loading ? "Loading…" : `${visibleCount.toLocaleString()} poles with GPS`}
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
        ) : pins.length === 0 ? (
          <View style={s.loader}>
            <Text style={s.loaderText}>No poles with GPS coordinates found.</Text>
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
  },
});
