import { useAuth } from "@/context/auth-context";
import api from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getAreas, getNodes, getNodePoles } from "@/services/skycable";
import { useFocusEffect } from "expo-router";
import { ChevronDown, MapPin, Search, X } from "lucide-react-native";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

const CACHE_KEY = "pole_map_pins_v2";

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

type NormalizedStatus = "completed" | "pending";

const STATUS_FILTERS = [
  { key: "all", label: "All Status" },
  { key: "pending", label: "Pending" },
  { key: "completed", label: "Completed" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["key"];

type NodeCentroid = {
  node: string;
  lat: number;
  lng: number;
  total: number;
  completed: number;
  pending: number;
};

type SearchNodeSummary = {
  node: string;
  siteKey: string;
  siteLabel: string;
  total: number;
  completed: number;
  pending: number;
  lat: number;
  lng: number;
  hasGps: boolean;
};

const LAT_KEYS = [
  "lat",
  "latitude",
  "gps_lat",
  "gpsLat",
  "gpsLatitude",
  "pole_lat",
  "poleLat",
  "location_lat",
  "locationLat",
  "map_lat",
  "mapLat",
  "y",
  "Y",
];

const LNG_KEYS = [
  "lng",
  "lon",
  "long",
  "longitude",
  "gps_lng",
  "gps_lon",
  "gpsLng",
  "gpsLon",
  "gpsLongitude",
  "pole_lng",
  "pole_lon",
  "poleLng",
  "poleLon",
  "location_lng",
  "location_lon",
  "locationLng",
  "locationLon",
  "map_lng",
  "map_lon",
  "mapLng",
  "mapLon",
  "x",
  "X",
];

const PAIR_KEYS = [
  "gps",
  "gps_location",
  "gpsLocation",
  "coordinates",
  "coordinate",
  "coords",
  "latlng",
  "lat_lng",
  "location",
  "geo",
  "geometry",
];

function cleanString(value: any): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function pickFirst(source: any, keys: string[]): any {
  if (!source || typeof source !== "object") return null;

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;

    const value = source[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;

    return value;
  }

  return null;
}

function toCoord(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  return Number.isFinite(n) ? n : null;
}

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001)
  );
}

function normalizeLatLngPair(
  first: number | null,
  second: number | null,
): { lat: number; lng: number } | null {
  if (first === null || second === null) return null;

  let lat = first;
  let lng = second;

  // Common issue: GeoJSON / database sometimes stores [lng, lat]
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
    [lat, lng] = [lng, lat];
  }

  if (isValidLatLng(lat, lng)) {
    return { lat, lng };
  }

  // Last attempt: swap them.
  if (isValidLatLng(second, first)) {
    return { lat: second, lng: first };
  }

  return null;
}

function parsePairFromString(
  value: string,
): { lat: number; lng: number } | null {
  const nums = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length < 2) return null;

  return normalizeLatLngPair(nums[0], nums[1]);
}

function parsePairValue(value: any): { lat: number; lng: number } | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Try JSON first.
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return parsePairValue(JSON.parse(trimmed));
      } catch {
        return parsePairFromString(trimmed);
      }
    }

    return parsePairFromString(trimmed);
  }

  if (Array.isArray(value)) {
    if (value.length < 2) return null;
    return normalizeLatLngPair(toCoord(value[0]), toCoord(value[1]));
  }

  if (typeof value === "object") {
    const directLat = toCoord(pickFirst(value, LAT_KEYS));
    const directLng = toCoord(pickFirst(value, LNG_KEYS));
    const directPair = normalizeLatLngPair(directLat, directLng);

    if (directPair) return directPair;

    if (Array.isArray(value.coordinates)) {
      return parsePairValue(value.coordinates);
    }
  }

  return null;
}

function extractCoordinates(row: any): { lat: number; lng: number } | null {
  const directLat = toCoord(pickFirst(row, LAT_KEYS));
  const directLng = toCoord(pickFirst(row, LNG_KEYS));
  const directPair = normalizeLatLngPair(directLat, directLng);

  if (directPair) return directPair;

  for (const key of PAIR_KEYS) {
    const parsed = parsePairValue(row?.[key]);
    if (parsed) return parsed;
  }

  return null;
}

function normalizeStatus(value: string | null): NormalizedStatus {
  const s = cleanString(value)?.toLowerCase().replace(/\s+/g, "_");

  if (!s) return "pending";

  if (
    [
      "cleared",
      "completed",
      "complete",
      "done",
      "verified",
      "approved",
      "in_progress",
    ].includes(s)
  ) {
    return "completed";
  }

  return "pending";
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function mapApiPoleToPin(row: any, index: number): PolePin {
  const coords = extractCoordinates(row);

  const idRaw = pickFirst(row, ["id", "pole_id", "poleId", "ID"]);
  const idNum = Number(idRaw);

  const poleCode =
    cleanString(
      row?.pole_code ??
        row?.poleCode ??
        row?.code ??
        row?.pole_id ??
        row?.poleId ??
        row?.name,
    ) ?? `POLE-${index + 1}`;

  const barangay = cleanString(
    row?.barangay ??
      row?.site ??
      row?.site_name ??
      row?.siteName ??
      row?.area ??
      row?.area_name ??
      row?.location_barangay,
  );

  const node = cleanString(
    row?.node ??
      row?.node_id ??
      row?.nodeId ??
      row?.node_code ??
      row?.nodeCode ??
      row?.node_name ??
      row?.nodeName,
  );

  const status =
    cleanString(
      row?.skycable_status ??
        row?.status ??
        row?.completion_status ??
        row?.inspection_status,
    ) ?? "pending";

  return {
    id: Number.isFinite(idNum) ? idNum : index + 1,
    pole_code: poleCode,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    has_gps: !!coords,
    status,
    barangay,
    node,
  };
}

function buildBaseMapHtml(): string {
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
.pp{
  width:13px;
  height:13px;
  border-radius:50%;
  border:2px solid rgba(255,255,255,0.98);
  box-shadow:0 0 0 1px rgba(15,23,42,0.15),0 5px 12px rgba(0,0,0,0.35);
}
.node-pill{
  background:#3b82f6;
  color:#ffffff;
  font-size:11px;
  font-weight:900;
  padding:5px 11px;
  border-radius:999px;
  border:2px solid #ffffff;
  box-shadow:0 8px 18px rgba(0,0,0,0.26);
  display:flex;
  align-items:center;
  gap:6px;
  white-space:nowrap;
  cursor:pointer;
}
.node-pill-dot{
  width:7px;
  height:7px;
  border-radius:999px;
  flex:none;
}
.popup-wrap{
  min-width:175px;
}
.popup-title{
  font-size:13px;
  font-weight:900;
  color:#111827;
  font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
}
.popup-node{
  font-size:11px;
  color:#2563eb;
  margin-top:4px;
  font-weight:800;
}
.popup-sub{
  font-size:11px;
  color:#6b7280;
  margin-top:2px;
  font-weight:700;
}
.popup-badge{
  margin-top:8px;
  display:inline-block;
  padding:4px 9px;
  border-radius:999px;
  font-size:10px;
  font-weight:900;
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
}
.leaflet-popup-tip{
  background:#ffffff;
}
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

  window.updateMap = function(mode, payload, bounds){
    if(!map || !markerGroup) return;
    markerGroup.clearLayers();

    if(Array.isArray(payload)){
      payload.forEach(function(item){
        if(!validLatLng(item.lat, item.lng)) return;
        var icon;
        if(mode === "nodes"){
          var hasPending = Number(item.pending || 0) > 0;
          var dotColor = hasPending ? "#f59e0b" : "#10b981";
          icon = L.divIcon({
            className: "",
            html: '<div class="node-pill"><span class="node-pill-dot" style="background:'+dotColor+'"></span><span>'+(item.node||"Node")+'</span></div>',
            iconSize: null
          });
        } else {
          var color = item.status === "completed" ? "#10b981" : "#f59e0b";
          icon = L.divIcon({
            className: "",
            html: '<div class="pp" style="background:'+color+'"></div>',
            iconSize: [13,13],
            iconAnchor: [6,6]
          });
        }

        var marker = L.marker([item.lat, item.lng], {icon: icon}).addTo(markerGroup);
        if(mode === "nodes"){
          marker.on("click", function(){ post({type:"SELECT_NODE", node:item.node}); });
          marker.bindPopup('<div class="popup-wrap"><div class="popup-title">'+item.node+'</div><div class="popup-sub">'+(item.total||0)+' poles</div><div class="popup-sub" style="color:#10b981">'+(item.completed||0)+' completed</div><div class="popup-sub" style="color:#f59e0b">'+(item.pending||0)+' pending</div></div>');
        } else {
          marker.bindPopup('<div class="popup-wrap"><div class="popup-title">'+(item.pole_code||"Pole")+'</div>'+(item.node?'<div class="popup-node">'+item.node+'</div>':'')+(item.barangay?'<div class="popup-sub">'+item.barangay+'</div>':'')+'<div class="popup-badge" style="background:'+(item.status==="completed"?"#10b981":"#f59e0b")+'22;color:'+(item.status==="completed"?"#10b981":"#f59e0b")+'">'+(item.status==="completed"?"Completed":"Pending")+'</div></div>');
        }
      });
    }

    if(Array.isArray(bounds) && bounds.length > 0){
      var validBounds = bounds.filter(function(b){ return validLatLng(b[0], b[1]); });
      if(validBounds.length === 1) map.setView(validBounds[0], 17);
      else if(validBounds.length > 1) map.fitBounds(validBounds, {padding:[48,48], maxZoom:17});
    }
  };

  function init(){
    if(map) return;
    map = L.map("map", {zoomControl:false, attributionControl:false, preferCanvas:true}).setView(PH_CENTER, 12);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {maxZoom:19}).addTo(map);
    markerGroup = L.layerGroup().addTo(map);
    hideFallback();
    post({type:"MAP_READY"});
  }

  window.onload = init;
  setTimeout(init, 1000); // fallback
})();
</script>
</body>
</html>`;
}

export default function PoleMapScreen() {
  const { token, user } = useAuth();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);
  const didInitialFetch = useRef(false);

  const [pins, setPins] = useState<PolePin[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [mapIssue, setMapIssue] = useState<string | null>(null);
  const [isFromCache, setIsFromCache] = useState(false);

  const [selectedSite, setSelectedSite] = useState<string>("all");
  const [selectedNode, setSelectedNode] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>("all");

  const [searchNode, setSearchNode] = useState("");
  const [searchedNodeObj, setSearchedNodeObj] =
    useState<SearchNodeSummary | null>(null);

  const [siteModalVisible, setSiteModalVisible] = useState(false);
  const [nodeModalVisible, setNodeModalVisible] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [searchModalVisible, setSearchModalVisible] = useState(false);

  const [mapReady, setMapReady] = useState(false);
  const [mapHtml] = useState(() => buildBaseMapHtml());

  const fetchPins = useCallback(
    async () => {
      if (!token) {
        setLoading(false);
        return;
      }

      const teamId = user?.team_id ?? null;
      const activeCacheKey = teamId ? `pole_map_pins_team_${teamId}` : CACHE_KEY;

      // 1. Instant cache load
      try {
        const cached = await cacheGet<PolePin[]>(activeCacheKey);
        if (cached && cached.length > 0) {
          setPins(cached);
          setIsFromCache(true);
          setLoading(false);
        }
      } catch {}

      // 2. Load persistent filter state
      try {
        const savedState = await cacheGet<any>(`pole_map_state_${user?.id || "anon"}`);
        if (savedState) {
          if (savedState.selectedSite) setSelectedSite(savedState.selectedSite);
          if (savedState.selectedNode) setSelectedNode(savedState.selectedNode);
          if (savedState.selectedStatus) setSelectedStatus(savedState.selectedStatus);
        }
      } catch {}

      setFetching(true);

      try {
        let all: PolePin[] = [];

        if (teamId) {
          const areas = await getAreas(token, teamId);
          const allNodes = (
            await Promise.all(
              areas.map((area) =>
                getNodes(area.id, token, teamId)
                  .then((res) => res.data ?? [])
                  .catch(() => []),
              ),
            )
          ).flat();

          const poleLists = await Promise.all(
            allNodes.map((node) =>
              getNodePoles(node.id, token)
                .then((poles) =>
                  poles.map((sp): PolePin => {
                    const lat = sp.pole?.lat ? parseFloat(sp.pole.lat) : null;
                    const lng = sp.pole?.lng ? parseFloat(sp.pole.lng) : null;
                    const validCoords = lat !== null && lng !== null && isValidLatLng(lat, lng);
                    return {
                      id: sp.pole?.id ?? sp.pole_id,
                      pole_code: sp.pole?.pole_code ?? `POLE-${sp.pole_id}`,
                      lat: validCoords ? lat : null,
                      lng: validCoords ? lng : null,
                      has_gps: validCoords,
                      status: sp.pole?.skycable_status ?? "pending",
                      barangay: node.barangay_name ?? null,
                      node: node.name ?? null,
                    };
                  }),
                )
                .catch(() => []),
            ),
          );
          all = poleLists.flat();
        } else {
          const { data } = await api.get("/skycable/poles/all");
          const rows: any[] = Array.isArray(data) ? data : (data?.data ?? []);
          all = rows.map(mapApiPoleToPin);
        }

        setPins(all);
        setIsFromCache(false);
        await cacheSet(activeCacheKey, all);
      } catch (error) {
        if (__DEV__) console.log("PoleMap fetch failed:", error);
      } finally {
        setFetching(false);
        setLoading(false);
      }
    },
    [token, user],
  );

  // Persistence of filters
  useEffect(() => {
    if (user?.id) {
      cacheSet(`pole_map_state_${user.id}`, {
        selectedSite,
        selectedNode,
        selectedStatus
      }).catch(() => {});
    }
  }, [selectedSite, selectedNode, selectedStatus, user?.id]);

  useFocusEffect(
    useCallback(() => {
      fetchPins();
    }, [fetchPins]),
  );

  const sitesList = useMemo(() => {
    const unique = Array.from(
      new Set(
        pins
          .map((p) => p.barangay)
          .filter(
            (b): b is string => typeof b === "string" && b.trim().length > 0,
          ),
      ),
    ).sort((a, b) => a.localeCompare(b));

    return ["all", ...unique];
  }, [pins]);

  const nodesList = useMemo(() => {
    const sourcePins =
      selectedSite === "all"
        ? pins
        : pins.filter((p) => p.barangay === selectedSite);

    const unique = Array.from(
      new Set(
        sourcePins
          .map((p) => p.node)
          .filter(
            (n): n is string => typeof n === "string" && n.trim().length > 0,
          ),
      ),
    ).sort((a, b) => a.localeCompare(b));

    return ["all", ...unique];
  }, [pins, selectedSite]);

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

  const statusScopedPins = useMemo(() => {
    if (selectedStatus === "all") return activeScopedPins;

    return activeScopedPins.filter(
      (p) => normalizeStatus(p.status) === selectedStatus,
    );
  }, [activeScopedPins, selectedStatus]);

  const gpsPoles = useMemo(
    () =>
      statusScopedPins.filter(
        (p) => p.has_gps && p.lat !== null && p.lng !== null,
      ),
    [statusScopedPins],
  );

  const noGpsPoles = useMemo(
    () => statusScopedPins.filter((p) => !p.has_gps),
    [statusScopedPins],
  );

  const completedNoGps = useMemo(
    () =>
      noGpsPoles.filter((p) => normalizeStatus(p.status) === "completed")
        .length,
    [noGpsPoles],
  );

  const pendingNoGps = useMemo(
    () =>
      noGpsPoles.filter((p) => normalizeStatus(p.status) === "pending").length,
    [noGpsPoles],
  );

  const nodeCentroids = useMemo<NodeCentroid[]>(() => {
    if (selectedSite === "all" || selectedNode !== "all") return [];

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

    statusScopedPins.forEach((p) => {
      if (!p.node || !p.node.trim()) return;
      if (!p.has_gps || p.lat === null || p.lng === null) return;

      if (!groups[p.node]) {
        groups[p.node] = {
          latSum: 0,
          lngSum: 0,
          total: 0,
          completed: 0,
          pending: 0,
        };
      }

      groups[p.node].latSum += p.lat;
      groups[p.node].lngSum += p.lng;
      groups[p.node].total += 1;

      if (normalizeStatus(p.status) === "completed") {
        groups[p.node].completed += 1;
      } else {
        groups[p.node].pending += 1;
      }
    });

    return Object.entries(groups)
      .map(([nodeName, stats]) => {
        if (stats.total <= 0) return null;

        return {
          node: nodeName,
          lat: stats.latSum / stats.total,
          lng: stats.lngSum / stats.total,
          total: stats.total,
          completed: stats.completed,
          pending: stats.pending,
        };
      })
      .filter((x): x is NodeCentroid => x !== null);
  }, [selectedSite, selectedNode, statusScopedPins]);

  useEffect(() => {
    if (!mapReady) return;

    let mode: "nodes" | "poles" = "poles";
    let payload: any[] = [];
    let bounds: number[][] = [];

    if (selectedSite !== "all" && selectedNode === "all") {
      mode = "nodes";
      payload = nodeCentroids;
      bounds = nodeCentroids.map((c) => [c.lat, c.lng]);
    } else {
      mode = "poles";
      payload = gpsPoles.map((p) => ({
        id: p.id,
        pole_code: p.pole_code,
        lat: p.lat,
        lng: p.lng,
        status: normalizeStatus(p.status),
        barangay: p.barangay,
        node: p.node,
      }));
      bounds = payload.map((p) => [p.lat, p.lng]);
    }

    const script = `window.updateMap(${safeJson(mode)}, ${safeJson(payload)}, ${safeJson(bounds)});`;
    webRef.current?.injectJavaScript(script);
  }, [mapReady, selectedSite, selectedNode, gpsPoles, nodeCentroids]);

  const handleSelectSite = (siteName: string) => {
    setSelectedSite(siteName);
    setSelectedNode("all");
    setSelectedStatus("all");
    setSiteModalVisible(false);
  };

  const onWebViewMessage = useCallback((event: any) => {
    try {
      const parsed = JSON.parse(event.nativeEvent.data);

      if (parsed.type === "SELECT_NODE" && parsed.node) {
        setSelectedNode(parsed.node);
        return;
      }

      if (parsed.type === "MAP_READY") {
        setMapReady(true);
        setMapIssue(null);
        return;
      }

      if (parsed.type === "MAP_ERROR") {
        setMapIssue(parsed.message || "Map failed to render.");
        return;
      }

      if (parsed.type === "TILE_ERROR") {
        setMapIssue(
          (current) =>
            current ?? "Base map tiles are not loading. Check device internet.",
        );
      }
    } catch {}
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const q = searchNode.trim().toUpperCase();

      if (!q) {
        setSearchedNodeObj(null);
        return;
      }

      const matchedPin = pins.find(
        (p) => p.node && p.node.toUpperCase().includes(q),
      );

      if (!matchedPin || !matchedPin.node) {
        setSearchedNodeObj(null);
        return;
      }

      const siteKey = matchedPin.barangay || "all";
      const siteLabel = matchedPin.barangay || "Unassigned / All Sites";

      const subPoles = pins.filter((p) => {
        const sameNode = (p.node || "") === matchedPin.node;
        const sameSite = siteKey === "all" || p.barangay === siteKey;
        return sameNode && sameSite;
      });

      const completed = subPoles.filter(
        (p) => normalizeStatus(p.status) === "completed",
      ).length;

      const gpsRef = subPoles.find(
        (p) => p.has_gps && p.lat !== null && p.lng !== null,
      );

      setSearchedNodeObj({
        node: matchedPin.node,
        siteKey,
        siteLabel,
        total: subPoles.length,
        completed,
        pending: subPoles.length - completed,
        lat: gpsRef?.lat ?? 12.8797,
        lng: gpsRef?.lng ?? 121.774,
        hasGps: !!gpsRef,
      });

      setSearchModalVisible(true);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchNode, pins]);

  const selectedStatusLabel =
    STATUS_FILTERS.find((s) => s.key === selectedStatus)?.label ?? "All Status";

  const mapSummaryLabel =
    selectedSite !== "all" && selectedNode === "all"
      ? `${nodeCentroids.length} nodes`
      : `${gpsPoles.length} markers`;

  const mapKey = `${selectedSite}|${selectedNode}|${selectedStatus}|${pins.length}|${gpsPoles.length}|${nodeCentroids.length}`;

  return (
    <View style={s.rootContainer}>
      <View style={StyleSheet.absoluteFillObject}>
        {loading ? (
          <View style={s.loader}>
            <ActivityIndicator size="large" color="#00856F" />
            <Text style={s.loaderText}>Loading Site Map Data...</Text>
          </View>
        ) : (
          <WebView
            key={mapKey}
            ref={webRef}
            source={{
              html: mapHtml,
              baseUrl: "https://gis-pole-map.local/",
            }}
            style={s.map}
            originWhitelist={["*"]}
            scrollEnabled={false}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="always"
            allowFileAccess
            allowUniversalAccessFromFileURLs
            cacheEnabled={true}
            androidLayerType="hardware"
            textZoom={100}
            setSupportMultipleWindows={false}
            onMessage={onWebViewMessage}
            onLoadStart={() => setMapIssue(null)}
            onError={(e) => {
              if (__DEV__) console.log("WEBVIEW ERROR:", e.nativeEvent);
              setMapIssue("WebView failed to load the map.");
            }}
            onHttpError={(e) => {
              if (__DEV__) console.log("WEBVIEW HTTP ERROR:", e.nativeEvent);
            }}
          />
        )}
      </View>

      <View style={[s.floatingTopCard, { top: Math.max(insets.top + 8, 12) }]}>
        <View style={s.headerTopRow}>
          <View style={s.titleWrap}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={s.title}>Site Pole Map Preview</Text>
              {isFromCache && !fetching && (
                <View style={{ backgroundColor: "#F59E0B22", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: "#F59E0B55" }}>
                  <Text style={{ color: "#F59E0B", fontSize: 9, fontWeight: "700", letterSpacing: 0.5 }}>CACHED</Text>
                </View>
              )}
            </View>
            <Text style={s.subtitle}>
              {loading
                ? "Indexing poles..."
                : `${mapSummaryLabel} · ${activeScopedPins.length} scoped`}
              {fetching && !loading ? "  ↻" : ""}
            </Text>
          </View>

          <View style={s.searchContainer}>
            <Search size={14} color="#64748B" style={s.searchIcon} />
            <TextInput
              style={s.searchInput}
              placeholder="Search Node ID..."
              placeholderTextColor="#94A3B8"
              value={searchNode}
              onChangeText={setSearchNode}
              autoCapitalize="characters"
              returnKeyType="search"
            />
            {!!searchNode && (
              <Pressable
                onPress={() => {
                  setSearchNode("");
                  setSearchedNodeObj(null);
                  setSearchModalVisible(false);
                }}
                style={s.clearSearch}
              >
                <X size={12} color="#64748B" />
              </Pressable>
            )}
          </View>
        </View>

        <View style={s.dropdownRow}>
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

      {!loading && mapIssue && (
        <View
          pointerEvents="none"
          style={[s.mapIssueCard, { top: Math.max(insets.top + 118, 128) }]}
        >
          <Text style={s.mapIssueTitle}>Map notice</Text>
          <Text style={s.mapIssueText}>{mapIssue}</Text>
        </View>
      )}

      {!loading && noGpsPoles.length > 0 && (
        <View pointerEvents="none" style={s.floatingNoGpsCard}>
          <Text style={s.floatingTitle}>{noGpsPoles.length} without GPS</Text>

          <View style={s.floatingBadges}>
            {pendingNoGps > 0 && (
              <View
                style={[
                  s.glassBadge,
                  { backgroundColor: "rgba(255, 251, 235, 0.92)" },
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
                  { backgroundColor: "rgba(236, 253, 245, 0.92)" },
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
              <Text style={s.noResultText}>
                No available site for you right now
              </Text>
            ) : (
              <ScrollView
                style={s.itemList}
                showsVerticalScrollIndicator={false}
              >
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
                const label = node === "all" ? "All Nodes" : node;

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
                <Text style={s.modalSub}>Filter active scoped pins</Text>
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
                  ? "#00856F"
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
                  <Text style={s.metaLabel}>Target Node ID</Text>
                  <Text style={s.metaValue}>{searchedNodeObj.node}</Text>
                  <Text style={s.metaSub}>
                    Parent Assigned Site: {searchedNodeObj.siteLabel}
                  </Text>
                  {!searchedNodeObj.hasGps && (
                    <Text style={[s.metaSub, { color: "#f59e0b" }]}>
                      This node has no valid GPS pole yet.
                    </Text>
                  )}
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

                <Pressable
                  style={s.viewMapBtn}
                  onPress={() => {
                    setSelectedSite(searchedNodeObj.siteKey);
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
    backgroundColor: "#F8FAFC",
  },

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

  searchContainer: {
    flex: 1,
    maxWidth: 155,
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
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

  mapIssueCard: {
    position: "absolute",
    left: 20,
    right: 20,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(255, 251, 235, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.28)",
    zIndex: 9,
  },

  mapIssueTitle: {
    fontSize: 11,
    fontWeight: "900",
    color: "#92400E",
    marginBottom: 2,
  },

  mapIssueText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#B45309",
  },

  floatingNoGpsCard: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 94,
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
    justifyContent: "center",
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
    backgroundColor: "#ECFDF5",
    borderColor: "#00856F",
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
    color: "#006B59",
  },

  activeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#00856F",
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
    color: "#00856F",
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
    backgroundColor: "#00856F",
    borderRadius: 16,
    height: 48,
    shadowColor: "#00856F",
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
