import { useAuth } from "@/context/auth-context";
import api from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/cache";
import { useFocusEffect } from "expo-router";
import { ChevronDown, X, Search, MapPin } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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

const STATUS_FILTERS = [
  { key: "all", label: "All Status" },
  { key: "pending", label: "Pending" },
  { key: "completed", label: "Completed" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["key"];

function normalizeStatus(s: string | null): "completed" | "pending" {
  if (!s) return "pending";
  if (s === "cleared" || s === "completed" || s === "in_progress") {
    return "completed";
  }
  return "pending";
}

// ─── MAP HTML BUILDER LOGIC ──────────────────────────────────────────────────
function buildMapHtml(
  mode: "nodes" | "poles",
  payloadJson: string,
  boundsJson: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body,#map{width:100%;height:100%;background:#f8fafc;}
.leaflet-container{background:#f8fafc;}

/* Pole Marker Pin */
.pp{
  width:12px;
  height:12px;
  border-radius:50%;
  border:2px solid rgba(255,255,255,0.95);
  box-shadow:0 0 8px rgba(0,0,0,0.35);
}

/* Node Centroid Pill */
.node-pill{
  background:#4F46E5;
  color:#ffffff;
  font-size:11px;
  font-weight:900;
  padding:4px 10px;
  border-radius:100px;
  border:2px solid #ffffff;
  box-shadow:0 6px 14px rgba(0,0,0,0.25);
  display:flex;
  align-items:center;
  gap:5px;
  white-space:nowrap;
  cursor:pointer;
  font-family:system-ui,-apple-system,sans-serif;
}

.node-pill-dot{
  width:6px;
  height:6px;
  border-radius:3px;
}

.leaflet-popup-content-wrapper{
  border-radius:16px;
  background:#ffffff;
  color:#111827;
  border:1px solid rgba(15,23,42,0.08);
  box-shadow:0 12px 28px rgba(0,0,0,0.16);
}

.leaflet-popup-content{
  margin:12px 14px;
  font-family:system-ui,-apple-system,sans-serif;
}

.leaflet-popup-tip{background:#ffffff;}
.leaflet-popup-close-button{color:#64748b!important;}
</style>
</head>

<body>
<div id="map"></div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<script>
var MODE="${mode}";
var PAYLOAD=${payloadJson};
var BOUNDS=${boundsJson};
var PH_CENTER=[12.8797,121.7740];

var map=L.map('map',{
  zoomControl:false,
  attributionControl:false,
  zoomSnap:0.25
});

L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom:19 }
).addTo(map);

L.tileLayer(
  'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  { maxZoom:19, opacity:1 }
).addTo(map);

function label(s){
  return s === 'completed' ? 'Completed' : 'Pending';
}

if(MODE === "nodes"){
  // RENDER AGGREGATED NODE CENTROIDS
  PAYLOAD.forEach(function(item){
    var hasPending = item.pending > 0;
    var dotColor = hasPending ? '#F59E0B' : '#10B981';
    
    var icon = L.divIcon({
      className:'',
      html:'<div class="node-pill" onclick="selectNode(\''+item.node+'\')">' +
             '<span class="node-pill-dot" style="background:'+dotColor+'"></span>' +
             item.node +
           '</div>',
      iconSize:null
    });

    L.marker([item.lat,item.lng],{icon:icon}).addTo(map);
  });
} else {
  // RENDER INDIVIDUAL POLES
  PAYLOAD.forEach(function(p){
    var c = p.status === 'completed' ? '#10b981' : '#f59e0b';

    var icon = L.divIcon({
      className:'',
      html:'<div class="pp" style="background:'+c+'"></div>',
      iconSize:[12,12],
      iconAnchor:[6,6]
    });

    var m = L.marker([p.lat,p.lng],{icon:icon}).addTo(map);

    m.bindPopup(
      '<div style="min-width:170px">'+
        '<div style="font-size:13px;font-weight:900;color:#111827;font-family:monospace">'+p.pole_code+'</div>'+
        (p.node ? '<div style="font-size:11px;color:#2563eb;margin-top:4px;font-weight:700">'+p.node+'</div>' : '')+
        (p.barangay ? '<div style="font-size:11px;color:#6b7280;margin-top:2px">'+p.barangay+'</div>' : '')+
        '<div style="margin-top:8px;display:inline-block;padding:4px 9px;border-radius:999px;background:'+c+'22;color:'+c+';font-size:10px;font-weight:800">'+label(p.status)+'</div>'+
      '</div>'
    );
  });
}

// Intercept inline HTML button taps to notify React Native Webview
function selectNode(nodeName){
  if(window.ReactNativeWebView){
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "SELECT_NODE", node: nodeName }));
  }
}

// Auto fit bounds
if(BOUNDS && BOUNDS.length > 0){
  try{
    map.fitBounds(BOUNDS,{padding:[48,48],maxZoom:17});
  }catch(e){
    map.setView(PH_CENTER,6);
  }
}else{
  map.setView(PH_CENTER,6);
}

setTimeout(function(){
  map.invalidateSize();
},150);
</script>
</body>
</html>`;
}

// ─── MAIN DASHBOARD SCREEN COMPONENT ─────────────────────────────────────────
export default function PoleMapScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);

  // Raw fetched API dataset
  const [pins, setPins] = useState<PolePin[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);

  // Hierarchical Tiers State
  const [selectedSite, setSelectedSite] = useState<string>("all");
  const [selectedNode, setSelectedNode] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>("all");

  // Search States
  const [searchNode, setSearchNode] = useState("");
  const [searchedNodeObj, setSearchedNodeObj] = useState<{
    node: string;
    site: string;
    total: number;
    completed: number;
    pending: number;
    lat: number;
    lng: number;
  } | null>(null);

  // Overlay Modals
  const [siteModalVisible, setSiteModalVisible] = useState(false);
  const [nodeModalVisible, setNodeModalVisible] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [searchModalVisible, setSearchModalVisible] = useState(false);

  // Live web map payload cache
  const [mapHtml, setMapHtml] = useState(() =>
    buildMapHtml("nodes", "[]", "[]")
  );

  // Fetch logic
  const fetchPins = useCallback(
    async (bustCache = false) => {
      if (!token) return;

      if (bustCache) {
        await cacheSet(CACHE_KEY, null);
      }

      const cached = await cacheGet<PolePin[]>(CACHE_KEY);

      if (cached && cached.length > 0) {
        setPins(cached);
        setLoading(false);
      }

      setFetching(true);

      try {
        const { data } = await api.get("/skycable/poles/all");
        const rows: any[] = Array.isArray(data) ? data : data?.data ?? [];

        const all: PolePin[] = rows.map((p) => {
          const lat = p.lat ? Number(p.lat) : null;
          const lng = p.lng ? Number(p.lng) : null;

          return {
            id: p.id,
            pole_code: p.pole_code,
            lat,
            lng,
            has_gps:
              typeof lat === "number" &&
              typeof lng === "number" &&
              !Number.isNaN(lat) &&
              !Number.isNaN(lng),
            status: p.skycable_status ?? "pending",
            barangay: p.barangay ?? null,
            node: p.node ?? null,
          };
        });

        setPins(all);
        await cacheSet(CACHE_KEY, all);
      } catch {
        // preserve cached values upon failure
      } finally {
        setFetching(false);
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    fetchPins();
  }, [fetchPins]);

  useFocusEffect(
    useCallback(() => {
      fetchPins(true);
    }, [fetchPins])
  );

  // ─── TIER 1 COMPUTATIONS: SITES ────────────────────────────────────────────
  const sitesList = useMemo(() => {
    const unique = Array.from(
      new Set(
        pins
          .map((p) => p.barangay)
          .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
      )
    ).sort((a, b) => a.localeCompare(b));

    return ["all", ...unique];
  }, [pins]);

  // ─── TIER 2 COMPUTATIONS: NODES ────────────────────────────────────────────
  const nodesList = useMemo(() => {
    if (selectedSite === "all") return ["all"];

    const sitePins = pins.filter((p) => p.barangay === selectedSite);
    const unique = Array.from(
      new Set(
        sitePins
          .map((p) => p.node)
          .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
      )
    ).sort((a, b) => a.localeCompare(b));

    return ["all", ...unique];
  }, [pins, selectedSite]);

  // Handle dynamic Site selection -> reset internal Node and Status parameters
  const handleSelectSite = (siteName: string) => {
    setSelectedSite(siteName);
    setSelectedNode("all");
    setSelectedStatus("all");
    setSiteModalVisible(false);
  };

  // ─── TIER 3 COMPUTATIONS: VISIBILITY STATS & CENTROIDS ─────────────────────
  // Active Scoped Pins matching active Site and Node parameters
  const activeScopedPins = useMemo(() => {
    let result = pins;
    if (selectedSite !== "all") {
      result = result.filter((p) => p.barangay === selectedSite);
    }
    if (selectedNode !== "all") {
      result = result.filter((p) => p.node === selectedNode);
    }
    return result;
  }, [pins, selectedSite, selectedNode]);

  // GPS and No-GPS counts
  const gpsPoles = useMemo(
    () => activeScopedPins.filter((p) => p.has_gps),
    [activeScopedPins]
  );
  const noGpsPoles = useMemo(
    () => activeScopedPins.filter((p) => !p.has_gps),
    [activeScopedPins]
  );

  const completedNoGps = useMemo(
    () =>
      noGpsPoles.filter((p) => normalizeStatus(p.status) === "completed")
        .length,
    [noGpsPoles]
  );
  const pendingNoGps = useMemo(
    () =>
      noGpsPoles.filter((p) => normalizeStatus(p.status) === "pending").length,
    [noGpsPoles]
  );

  const visibleCount = useMemo(() => {
    if (selectedStatus === "all") return gpsPoles.length;
    return gpsPoles.filter((p) => normalizeStatus(p.status) === selectedStatus)
      .length;
  }, [gpsPoles, selectedStatus]);

  // Aggregate Node Centroids (Used when selectedNode === 'all')
  const nodeCentroids = useMemo(() => {
    if (selectedSite === "all") return [];

    const groups: Record<
      string,
      {
        latSum: number;
        lngSum: number;
        total: number;
        completed: number;
        pending: number;
      }
    > = {};

    const targetPins = pins.filter((p) => p.barangay === selectedSite);

    targetPins.forEach((p) => {
      const n = p.node;
      if (!n || !n.trim()) return;

      if (!groups[n]) {
        groups[n] = {
          latSum: 0,
          lngSum: 0,
          total: 0,
          completed: 0,
          pending: 0,
        };
      }
      if (p.has_gps && p.lat && p.lng) {
        groups[n].latSum += p.lat;
        groups[n].lngSum += p.lng;
        groups[n].total += 1;
        if (normalizeStatus(p.status) === "completed") {
          groups[n].completed += 1;
        } else {
          groups[n].pending += 1;
        }
      }
    });

    return Object.entries(groups)
      .map(([nodeName, stats]) => {
        if (stats.total === 0) return null;
        return {
          node: nodeName,
          lat: stats.latSum / stats.total,
          lng: stats.lngSum / stats.total,
          total: stats.total,
          completed: stats.completed,
          pending: stats.pending,
        };
      })
      .filter(Boolean);
  }, [pins, selectedSite]);

  // Re-generate MapView bundle payload
  useEffect(() => {
    if (selectedSite === "all") {
      // MODE: Classic View - render all status colored Pole pins across the whole region
      const filteredPoles =
        selectedStatus === "all"
          ? gpsPoles
          : gpsPoles.filter(
              (p) => normalizeStatus(p.status) === selectedStatus
            );

      const normalizedPayload = filteredPoles.map((p) => ({
        ...p,
        status: normalizeStatus(p.status),
      }));

      const bounds = filteredPoles.map((p) => [p.lat, p.lng]);
      setMapHtml(
        buildMapHtml(
          "poles",
          JSON.stringify(normalizedPayload),
          JSON.stringify(bounds)
        )
      );
    } else if (selectedNode === "all") {
      // MODE: Render aggregated distinct Node centroid cards
      const bounds = nodeCentroids.map((c) => [c.lat, c.lng]);
      setMapHtml(
        buildMapHtml(
          "nodes",
          JSON.stringify(nodeCentroids),
          JSON.stringify(bounds)
        )
      );
    } else {
      // MODE: Render explicit targeted status colored Pole pins
      const filteredPoles =
        selectedStatus === "all"
          ? gpsPoles
          : gpsPoles.filter(
              (p) => normalizeStatus(p.status) === selectedStatus
            );

      const normalizedPayload = filteredPoles.map((p) => ({
        ...p,
        status: normalizeStatus(p.status),
      }));

      const bounds = filteredPoles.map((p) => [p.lat, p.lng]);
      setMapHtml(
        buildMapHtml(
          "poles",
          JSON.stringify(normalizedPayload),
          JSON.stringify(bounds)
        )
      );
    }
  }, [selectedSite, selectedNode, selectedStatus, gpsPoles, nodeCentroids]);

  // Intercept messages triggered by inline HTML WebView tap events
  const onWebViewMessage = (event: any) => {
    try {
      const parsed = JSON.parse(event.nativeEvent.data);
      if (parsed.type === "SELECT_NODE" && parsed.node) {
        setSelectedNode(parsed.node);
      }
    } catch {}
  };

  // ─── DEBOUNCED SEARCH LISTENER LOGIC ───────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = searchNode.trim().toUpperCase();
      if (!q) {
        setSearchedNodeObj(null);
        return;
      }

      // Discover an explicit node whose code matches the search input query exactly
      const matchedPin = pins.find(
        (p) => p.node && p.node.toUpperCase().includes(q)
      );

      if (matchedPin && matchedPin.node) {
        const subPoles = pins.filter((p) => (p.node || "") === matchedPin.node);
        const comp = subPoles.filter(
          (p) => normalizeStatus(p.status) === "completed"
        ).length;

        // Obtain an active valid GPS reference if one exists to enable zoom routing
        const gpsRef = subPoles.find((p) => p.has_gps && p.lat && p.lng);

        setSearchedNodeObj({
          node: matchedPin.node,
          site: matchedPin.barangay || "Unassigned",
          total: subPoles.length,
          completed: comp,
          pending: subPoles.length - comp,
          lat: gpsRef?.lat ?? 12.8797,
          lng: gpsRef?.lng ?? 121.774,
        });
        setSearchModalVisible(true);
      } else {
        setSearchedNodeObj(null);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [searchNode, pins]);

  const selectedStatusLabel =
    STATUS_FILTERS.find((s) => s.key === selectedStatus)?.label ?? "All Status";

  return (
    <View style={s.rootContainer}>
      {/* ── 1. Full Screen Immersive Map Canvas ── */}
      <View style={StyleSheet.absoluteFillObject}>
        {loading ? (
          <View style={s.loader}>
            <ActivityIndicator size="large" color="#8b5cf6" />
            <Text style={s.loaderText}>Loading GIS Map Data…</Text>
          </View>
        ) : (
          <WebView
            ref={webRef}
            source={{ html: mapHtml }}
            style={s.map}
            originWhitelist={["*"]}
            scrollEnabled={false}
            javaScriptEnabled
            onMessage={onWebViewMessage}
          />
        )}
      </View>

      {/* ── 2. Premium Elevated Header Filter Cards ── */}
      <View style={[s.floatingTopCard, { top: Math.max(insets.top + 8, 12) }]}>
        <View style={s.headerTopRow}>
          <View style={s.titleWrap}>
            <Text style={s.title}>GIS Pole Map</Text>
            <Text style={s.subtitle}>
              {loading
                ? "Indexing poles…"
                : `${visibleCount} markers · ${activeScopedPins.length} scoped`}
              {fetching && !loading ? "  ↻" : ""}
            </Text>
          </View>

          {/* Right Aligned Modern Search Bar Container */}
          <View style={s.searchContainer}>
            <Search size={14} color="#64748B" style={s.searchIcon} />
            <TextInput
              style={s.searchInput}
              placeholder="Search Node ID…"
              placeholderTextColor="#94A3B8"
              value={searchNode}
              onChangeText={setSearchNode}
              autoCapitalize="characters"
            />
            {!!searchNode && (
              <Pressable
                onPress={() => setSearchNode("")}
                style={s.clearSearch}
              >
                <X size={12} color="#64748B" />
              </Pressable>
            )}
          </View>
        </View>

        {/* Tiered Hierarchical Selections Row */}
        <View style={s.dropdownRow}>
          {/* Site Selection */}
          <Pressable
            style={s.dropdown}
            onPress={() => setSiteModalVisible(true)}
          >
            <Text style={s.dropdownLabel}>Site</Text>
            <Text style={s.dropdownText} numberOfLines={1}>
              {selectedSite === "all" ? "All Sites" : selectedSite}
            </Text>
            <ChevronDown size={14} color="#64748B" />
          </Pressable>

          {/* Node Selection */}
          <Pressable
            style={s.dropdown}
            onPress={() => setNodeModalVisible(true)}
          >
            <Text style={s.dropdownLabel}>Node</Text>
            <Text style={s.dropdownText} numberOfLines={1}>
              {selectedNode === "all" ? "All Nodes" : selectedNode}
            </Text>
            <ChevronDown size={14} color="#64748B" />
          </Pressable>

          {/* Status Visibility Selection */}
          <Pressable
            style={s.dropdown}
            onPress={() => setStatusModalVisible(true)}
          >
            <Text style={s.dropdownLabel}>Status</Text>
            <Text style={s.dropdownText} numberOfLines={1}>
              {selectedStatusLabel}
            </Text>
            <ChevronDown size={14} color="#64748B" />
          </Pressable>
        </View>
      </View>

      {/* ── 3. Bottom Layered Without-GPS Counters ── */}
      {!loading && noGpsPoles.length > 0 && (
        <View pointerEvents="none" style={s.floatingNoGpsCard}>
          <Text style={s.floatingTitle}>{noGpsPoles.length} without GPS</Text>

          <View style={s.floatingBadges}>
            {pendingNoGps > 0 && (
              <View
                style={[
                  s.glassBadge,
                  { backgroundColor: "rgba(255, 251, 235, 0.88)" },
                ]}
              >
                <View style={[s.badgeDot, { backgroundColor: "#f59e0b" }]} />
                <Text style={[s.badgeText, { color: "#f59e0b" }]}>
                  {pendingNoGps} pending
                </Text>
              </View>
            )}

            {completedNoGps > 0 && (
              <View
                style={[
                  s.glassBadge,
                  { backgroundColor: "rgba(236, 253, 245, 0.88)" },
                ]}
              >
                <View style={[s.badgeDot, { backgroundColor: "#10b981" }]} />
                <Text style={[s.badgeText, { color: "#10b981" }]}>
                  {completedNoGps} completed
                </Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ─── MODALS DIALOG SECTION ────────────────────────────────────────── */}

      {/* 1. SITES MODAL */}
      <Modal
        visible={siteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSiteModalVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <View>
                <Text style={s.modalTitle}>Select Site Area</Text>
                <Text style={s.modalSub}>Tier 1 geographical hierarchy</Text>
              </View>
              <Pressable
                style={s.modalClose}
                onPress={() => setSiteModalVisible(false)}
              >
                <X size={18} color="#64748B" />
              </Pressable>
            </View>

            {sitesList.length <= 1 ? (
              <Text style={s.noResultText}>No available site for you right now</Text>
            ) : (
              <ScrollView style={s.itemList} showsVerticalScrollIndicator={false}>
                {sitesList.map((site) => {
                  const active = selectedSite === site;
                  const label = site === "all" ? "All Sites Overview" : site;

                  return (
                    <Pressable
                      key={site}
                      style={[s.optionRow, active && s.optionRowActive]}
                      onPress={() => handleSelectSite(site)}
                    >
                      <Text
                        style={[s.optionTitle, active && s.optionTitleActive]}
                      >
                        {label}
                      </Text>
                      {active && <View style={s.activeDot} />}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* 2. NODES MODAL */}
      <Modal
        visible={nodeModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNodeModalVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <View>
                <Text style={s.modalTitle}>Select Target Node</Text>
                <Text style={s.modalSub}>Tier 2 local sub-network</Text>
              </View>
              <Pressable
                style={s.modalClose}
                onPress={() => setNodeModalVisible(false)}
              >
                <X size={18} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView style={s.itemList} showsVerticalScrollIndicator={false}>
              {nodesList.map((node) => {
                const active = selectedNode === node;
                const label = node === "all" ? "All Nodes Aggregated" : node;

                return (
                  <Pressable
                    key={node}
                    style={[s.optionRow, active && s.optionRowActive]}
                    onPress={() => {
                      setSelectedNode(node);
                      setNodeModalVisible(false);
                    }}
                  >
                    <Text
                      style={[s.optionTitle, active && s.optionTitleActive]}
                    >
                      {label}
                    </Text>
                    {active && <View style={s.activeDot} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 3. STATUS FILTERS MODAL */}
      <Modal
        visible={statusModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusModalVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <View>
                <Text style={s.modalTitle}>Filter Completion Status</Text>
                <Text style={s.modalSub}>Filter scoped active child pins</Text>
              </View>
              <Pressable
                style={s.modalClose}
                onPress={() => setStatusModalVisible(false)}
              >
                <X size={18} color="#64748B" />
              </Pressable>
            </View>

            {STATUS_FILTERS.map((item) => {
              const active = selectedStatus === item.key;
              const color =
                item.key === "all"
                  ? "#8b5cf6"
                  : item.key === "completed"
                    ? "#10b981"
                    : "#f59e0b";

              return (
                <Pressable
                  key={item.key}
                  style={[s.optionRow, active && s.optionRowActive]}
                  onPress={() => {
                    setSelectedStatus(item.key);
                    setStatusModalVisible(false);
                  }}
                >
                  <View style={s.optionLeft}>
                    <View style={[s.optionDot, { backgroundColor: color }]} />
                    <Text
                      style={[s.optionTitle, active && s.optionTitleActive]}
                    >
                      {item.label}
                    </Text>
                  </View>
                  {active && <View style={s.activeDot} />}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* 4. SEARCH NODE SUMMARY PREVIEW MODAL */}
      <Modal
        visible={searchModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSearchModalVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <View>
                <Text style={s.modalTitle}>Searched Node Overview</Text>
                <Text style={s.modalSub}>Real-time search match</Text>
              </View>
              <Pressable
                style={s.modalClose}
                onPress={() => setSearchModalVisible(false)}
              >
                <X size={18} color="#64748B" />
              </Pressable>
            </View>

            {searchedNodeObj ? (
              <View style={s.searchModalBody}>
                <View style={s.metaCard}>
                  <Text style={s.metaLabel}>TARGET NODE ID</Text>
                  <Text style={s.metaValue}>{searchedNodeObj.node}</Text>
                  <Text style={s.metaSub}>
                    Parent Assigned Site: {searchedNodeObj.site}
                  </Text>
                </View>

                <View style={s.statsGrid}>
                  <View style={s.statBox}>
                    <Text style={s.statNum}>{searchedNodeObj.total}</Text>
                    <Text style={s.statLbl}>Total Poles</Text>
                  </View>
                  <View style={s.statBox}>
                    <Text style={[s.statNum, { color: "#10B981" }]}>
                      {searchedNodeObj.completed}
                    </Text>
                    <Text style={s.statLbl}>Completed</Text>
                  </View>
                  <View style={s.statBox}>
                    <Text style={[s.statNum, { color: "#F59E0B" }]}>
                      {searchedNodeObj.pending}
                    </Text>
                    <Text style={s.statLbl}>Pending</Text>
                  </View>
                </View>

                {/* Directive Action: View on Map */}
                <Pressable
                  style={s.viewMapBtn}
                  onPress={() => {
                    setSelectedSite(searchedNodeObj.site);
                    setSelectedNode(searchedNodeObj.node);
                    setSelectedStatus("all");
                    setSearchModalVisible(false);
                    setSearchNode("");
                  }}
                >
                  <MapPin
                    size={16}
                    color="#ffffff"
                    style={{ marginRight: 6 }}
                  />
                  <Text style={s.viewMapBtnText}>View on Map</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={s.noResultText}>
                No localized matching nodes discoverable.
              </Text>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── CENTRALIZED COMPONENT STYLESHEETS ───────────────────────────────────────
const s = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    position: "relative",
  },

  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#FFFFFF",
  },

  loaderText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748B",
  },

  map: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },

  floatingTopCard: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "rgba(255, 255, 255, 0.82)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.86)",
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

  searchContainer: {
    flex: 1,
    maxWidth: 155,
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end", // Aligned perfectly to the right side
    backgroundColor: "#F1F5F9",
    borderRadius: 100,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },

  searchIcon: {
    marginRight: 4,
  },

  searchInput: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    color: "#0F172A",
    padding: 0,
    height: "100%",
  },

  clearSearch: {
    padding: 2,
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

  dropdownLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#94A3B8",
    textTransform: "uppercase",
  },

  dropdownText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "800",
    color: "#334155",
    textAlign: "center",
  },

  floatingNoGpsCard: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 94,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(255, 255, 255, 0.82)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.86)",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 7,
  },

  floatingTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#0F172A",
    marginBottom: 8,
  },

  floatingBadges: {
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

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.55)",
    justifyContent: "center", // Displayed centrally
    paddingHorizontal: 20,
  },

  modalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 20,
    maxHeight: "80%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 10,
  },

  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },

  modalTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#0F172A",
  },

  modalSub: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
    marginTop: 2,
  },

  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },

  itemList: {
    marginTop: 4,
  },

  optionRow: {
    minHeight: 52,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  optionRowActive: {
    backgroundColor: "#EEF2FF",
    borderColor: "#8B5CF6",
  },

  optionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  optionDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },

  optionTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#0F172A",
  },

  optionTitleActive: {
    color: "#6D28D9",
  },

  activeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#8B5CF6",
  },

  searchModalBody: {
    marginTop: 4,
  },

  metaCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 14,
  },

  metaLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#8B5CF6",
    textTransform: "uppercase",
  },

  metaValue: {
    fontSize: 18,
    fontWeight: "900",
    color: "#0F172A",
    marginTop: 2,
  },

  metaSub: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
    marginTop: 4,
  },

  statsGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },

  statBox: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },

  statNum: {
    fontSize: 17,
    fontWeight: "900",
    color: "#0F172A",
  },

  statLbl: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748B",
    marginTop: 3,
  },

  viewMapBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#8B5CF6",
    borderRadius: 16,
    height: 48,
    shadowColor: "#8B5CF6",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },

  viewMapBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#ffffff",
  },

  noResultText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748B",
    textAlign: "center",
    marginVertical: 20,
  },
});