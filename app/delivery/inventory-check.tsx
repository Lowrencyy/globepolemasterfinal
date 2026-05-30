import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Animated, Dimensions, Image, KeyboardAvoidingView,
  PanResponder, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { Camera, CheckCircle, ChevronLeft, MapPin } from "lucide-react-native";
import { WebView } from "react-native-webview";
import {
  getWarehouseReceiptById,
  markWarehouseReceiptArrived,
  verifyWarehouseReceipt,
  type WarehouseReceipt,
  type WarehouseReceiptItem,
} from "@/services/skycable";
import { getBridgeToken } from "@/lib/token-bridge";

const DEVICE_H           = Dimensions.get("window").height;
const SHEET_COLLAPSED = DEVICE_H * 0.82;    // peek at bottom
const SHEET_EN_ROUTE  = DEVICE_H - 390;     // exact fit: drag handle + tracker + arrived btn
const SHEET_EXPANDED  = DEVICE_H * 0.18;    // full form when at warehouse

const G      = "#006241";
const GDARK  = "#004d30";
const MUTED  = "#667085";
const BORDER = "#E7ECF2";
const WHITE  = "#FFFFFF";
const BG     = "#F4F8F5";
const AMBER  = "#f59e0b";

const ITEM_LABELS: Record<string, string> = {
  cable:     "Cable",
  node:      "Node",
  amplifier: "Amplifier",
  extender:  "Extender",
  tsc:       "TSC",
  psu:       "PSU",
  psu_case:  "PSU Case",
};

const ITEM_UNITS: Record<string, string> = {
  cable: "m",
};

const ITEM_ICONS: Record<string, string> = {
  cable:     "🔌",
  node:      "📡",
  amplifier: "📶",
  extender:  "🔧",
  tsc:       "⚡",
  psu:       "🔋",
  psu_case:  "📦",
};

// ─────────────────────────────────────────────────────────────────────────────

// Warehouse SVG — encoded once at module level so buildLeafletHtml can embed it as a safe data: URI
const WAREHOUSE_SVG_RAW = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="54" height="54">`,
  `<rect x="6" y="34" width="50" height="34" rx="2" fill="#cce8f4" stroke="#2d3e50" stroke-width="2.2"/>`,
  `<polygon points="2,36 31,10 60,36" fill="#f07060" stroke="#2d3e50" stroke-width="2.2"/>`,
  `<circle cx="31" cy="24" r="5" fill="#2d3e50"/>`,
  `<circle cx="31" cy="24" r="3" fill="#5ce0f0"/>`,
  `<rect x="8" y="36" width="5" height="5" rx="1" fill="#2d3e50" opacity="0.5"/>`,
  `<rect x="15" y="36" width="5" height="5" rx="1" fill="#2d3e50" opacity="0.5"/>`,
  `<rect x="38" y="36" width="5" height="5" rx="1" fill="#2d3e50" opacity="0.5"/>`,
  `<rect x="45" y="36" width="5" height="5" rx="1" fill="#2d3e50" opacity="0.5"/>`,
  `<rect x="22" y="46" width="18" height="22" rx="2" fill="#f0f5fa" stroke="#2d3e50" stroke-width="1.8"/>`,
  `<line x1="22" y1="52" x2="40" y2="52" stroke="#2d3e50" stroke-width="0.9"/>`,
  `<line x1="22" y1="58" x2="40" y2="58" stroke="#2d3e50" stroke-width="0.9"/>`,
  `<line x1="22" y1="64" x2="40" y2="64" stroke="#2d3e50" stroke-width="0.9"/>`,
  `<rect x="36" y="54" width="30" height="14" rx="2" fill="#f07060" stroke="#2d3e50" stroke-width="2"/>`,
  `<rect x="57" y="57" width="12" height="11" rx="2" fill="#dde8f4" stroke="#2d3e50" stroke-width="1.8"/>`,
  `<rect x="59" y="59" width="8" height="5" rx="1" fill="#7fd4e8"/>`,
  `<circle cx="43" cy="70" r="4" fill="#2d3e50"/>`,
  `<circle cx="43" cy="70" r="2" fill="#888"/>`,
  `<circle cx="60" cy="70" r="4" fill="#2d3e50"/>`,
  `<circle cx="60" cy="70" r="2" fill="#888"/>`,
  `<rect x="1" y="60" width="12" height="8" rx="1" fill="#c8924a" stroke="#2d3e50" stroke-width="1.5"/>`,
  `<rect x="1" y="50" width="12" height="8" rx="1" fill="#e0a860" stroke="#2d3e50" stroke-width="1.5"/>`,
  `<rect x="15" y="56" width="10" height="12" rx="1" fill="#c8924a" stroke="#2d3e50" stroke-width="1.5"/>`,
  `</svg>`,
].join("");

// Encode once — safe to embed inside any JS string as a data: URI (no quote escaping needed)
const WAREHOUSE_ICON_URI = "data:image/svg+xml," + encodeURIComponent(WAREHOUSE_SVG_RAW);

function buildLeafletHtml(
  fromLat: number | null, fromLng: number | null,
  toLat:   number | null, toLng:   number | null,
  warehouseName: string
): string {
  const hasFrom = fromLat != null && fromLng != null;
  const hasTo   = toLat   != null && toLng   != null;

  const cLat = hasFrom ? fromLat : hasTo ? toLat : 12.8797;
  const cLng = hasFrom ? fromLng : hasTo ? toLng : 121.774;
  const zoom  = (hasFrom || hasTo) ? 13 : 6;

  // Orange pulsing dot — current location (updated live via injectJavaScript)
  const fromJs = `
var pinIcon = L.divIcon({
  html: "<div style='position:relative;width:22px;height:22px'>"
      + "<div style='position:absolute;inset:0;border-radius:50%;background:rgba(234,88,12,0.22);animation:pulse 1.8s infinite'></div>"
      + "<div style='position:absolute;top:5px;left:5px;width:12px;height:12px;border-radius:50%;background:#ea580c;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4)'></div>"
      + "</div>",
  iconSize:[22,22], iconAnchor:[11,11], className:""
});
var myMarker = ${hasFrom
  ? `L.marker([${fromLat},${fromLng}],{icon:pinIcon,zIndexOffset:1000}).addTo(map)
      .bindTooltip("My Location",{permanent:true,direction:"top",offset:[0,-14],className:"lbl"})`
  : `null`};
var routeLine = null;
function drawRoute(fLat, fLng) {
  fetch("https://router.project-osrm.org/route/v1/driving/"+fLng+","+fLat+";${toLng ?? 0},${toLat ?? 0}?geometries=geojson&overview=full")
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.routes&&d.routes[0]){
        if(routeLine){map.removeLayer(routeLine);}
        var pts=d.routes[0].geometry.coordinates.map(function(c){return[c[1],c[0]];});
        routeLine=L.polyline(pts,{color:"#ea580c",weight:5,opacity:0.9,lineCap:"round",lineJoin:"round"}).addTo(map);
      }
    }).catch(function(){});
}
window.updateMyLocation = function(lat, lng) {
  if(!myMarker){
    myMarker = L.marker([lat,lng],{icon:pinIcon,zIndexOffset:1000}).addTo(map)
      .bindTooltip("My Location",{permanent:true,direction:"top",offset:[0,-14],className:"lbl"});
  } else {
    myMarker.setLatLng([lat,lng]);
  }
  ${hasTo ? `drawRoute(lat,lng);` : ""}
};
${hasFrom && hasTo ? `drawRoute(${fromLat},${fromLng});
map.fitBounds(L.latLngBounds([[${fromLat},${fromLng}],[${toLat},${toLng}]]),{padding:[70,70]});` : ""}
`;

  // Warehouse icon via data: URI — zero quoting/escaping issues
  const whJs = hasTo ? `
L.circle([${toLat},${toLng}],{
  radius:150, color:"#2563eb", weight:2,
  fillColor:"#3b82f6", fillOpacity:0.13, dashArray:"8,5"
}).addTo(map)
  .bindTooltip("Arrival zone (~150m)",{permanent:false,direction:"top",className:"lbl"});

function whIconAt(sz) {
  return L.icon({ iconUrl:"${WAREHOUSE_ICON_URI}", iconSize:[sz,sz], iconAnchor:[sz/2,sz/2] });
}
function zoomToSize(z) {
  if(z<=10) return 20;
  if(z<=12) return 28;
  if(z<=14) return 40;
  return 54;
}
var whMarker = L.marker([${toLat},${toLng}],{icon:whIconAt(zoomToSize(map.getZoom())),zIndexOffset:900}).addTo(map)
  .bindTooltip("${warehouseName.replace(/"/g, "&quot;")}",{permanent:true,direction:"top",offset:[0,-10],className:"lbl"});
map.on("zoomend",function(){
  var sz = zoomToSize(map.getZoom());
  whMarker.setIcon(whIconAt(sz));
});
` : "";

  // Initial view when only warehouse is known (no GPS yet)
  const routeJs = (!hasFrom && hasTo) ? `map.setView([${toLat},${toLng}],15);`
    : (!hasFrom && !hasTo) ? `map.setView([${cLat},${cLng}],${zoom});`
    : "";

  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
html,body,#m{height:100%;margin:0;padding:0;background:#e8ead8;}
.lbl{background:rgba(255,255,255,0.95);border-radius:8px;padding:3px 8px;font-size:11px;font-weight:700;white-space:nowrap;border:none!important;box-shadow:0 2px 6px rgba(0,0,0,0.18);}
@keyframes pulse{0%{transform:scale(1);opacity:0.7}70%{transform:scale(2.4);opacity:0}100%{transform:scale(2.4);opacity:0}}
</style>
</head><body><div id="m"></div>
<script>
var map=L.map("m",{zoomControl:false,attributionControl:false}).setView([${cLat},${cLng}],${zoom});
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19}).addTo(map);
${fromJs}
${whJs}
${routeJs}
</script></body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function InventoryCheck() {
  const router = useRouter();
  const { receiptId, nodeId, nodeName } = useLocalSearchParams<{
    receiptId: string;
    nodeId: string;
    nodeName: string;
  }>();
  const decodedName = nodeName ? decodeURIComponent(nodeName) : `Node #${nodeId}`;

  const [receipt,     setReceipt]    = useState<WarehouseReceipt | null>(null);
  const [loading,     setLoading]    = useState(true);
  const [saving,      setSaving]     = useState(false);
  const [photo,       setPhoto]      = useState<{ uri: string; name: string; type: string } | null>(null);
  const [notes,       setNotes]      = useState("");
  const [quantities,  setQuantities] = useState<Record<string, string>>({});
  const [currentLoc,  setCurrentLoc] = useState<{ lat: number; lng: number } | null>(null);
  const webViewRef = useRef<WebView>(null);

  // ── Bottom sheet pan ──────────────────────────────────────────────────────
  const panY          = useRef(new Animated.Value(SHEET_COLLAPSED)).current;
  const panBase       = useRef(SHEET_COLLAPSED);
  const expandedLimit = useRef(SHEET_EN_ROUTE);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  (_, g) => Math.abs(g.dy) > 4,
      onPanResponderGrant: () => { panBase.current = (panY as any)._value; },
      onPanResponderMove:  (_, g) => {
        const next = panBase.current + g.dy;
        if (next >= expandedLimit.current && next <= SHEET_COLLAPSED) panY.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const cur    = (panY as any)._value;
        const limit  = expandedLimit.current;
        const mid    = (limit + SHEET_COLLAPSED) / 2;
        const target = (g.vy < -0.3 || cur < mid) ? limit : SHEET_COLLAPSED;
        Animated.spring(panY, { toValue: target, useNativeDriver: false, tension: 55, friction: 11 }).start();
      },
    })
  ).current;

  async function markArrived() {
    const token = getBridgeToken() ?? "";
    try {
      const updated = await markWarehouseReceiptArrived(token, Number(receiptId));
      setReceipt(updated);
      expandedLimit.current = SHEET_EXPANDED;
      Animated.spring(panY, { toValue: SHEET_EXPANDED, useNativeDriver: false, tension: 50, friction: 11 }).start();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not mark as arrived.");
    }
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  const loadReceipt = useCallback(async () => {
    const token = getBridgeToken() ?? "";
    try {
      const r = await getWarehouseReceiptById(token, Number(receiptId));
      setReceipt(r);
      const init: Record<string, string> = {};
      (r.items ?? []).forEach(it => { init[it.item_type] = String(it.quantity); });
      setQuantities(init);

      // Sync sheet limit to status — also re-applies updated constants after hot reload
      expandedLimit.current = (r.status === "arrived" || r.status === "approved")
        ? SHEET_EXPANDED
        : SHEET_EN_ROUTE;
    } catch {
      Alert.alert("Error", "Could not load receipt.");
      router.back();
    } finally {
      setLoading(false);
    }
  }, [receiptId]);

  useEffect(() => { loadReceipt(); }, [loadReceipt]);

  // ── Live GPS ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat0, longitude: lng0 } = initial.coords;
      setCurrentLoc({ lat: lat0, lng: lng0 });
      webViewRef.current?.injectJavaScript(
        `if(window.updateMyLocation){window.updateMyLocation(${lat0},${lng0});}true;`
      );
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 15, timeInterval: 6000 },
        (loc) => {
          const { latitude: lat, longitude: lng } = loc.coords;
          setCurrentLoc({ lat, lng });
          webViewRef.current?.injectJavaScript(
            `if(window.updateMyLocation){window.updateMyLocation(${lat},${lng});}true;`
          );
        }
      );
    })();
    return () => { sub?.remove(); };
  }, []);

  // ── Photo helpers ─────────────────────────────────────────────────────────
  async function pickPhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission required", "Allow camera access."); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: false });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      const ext = a.uri.split(".").pop() ?? "jpg";
      setPhoto({ uri: a.uri, name: `proof_${Date.now()}.${ext}`, type: `image/${ext}` });
    }
  }

  async function pickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission required", "Allow photo library access."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      const ext = a.uri.split(".").pop() ?? "jpg";
      setPhoto({ uri: a.uri, name: `proof_${Date.now()}.${ext}`, type: `image/${ext}` });
    }
  }

  function handlePhotoPress() {
    Alert.alert("Proof Photo", "Choose source", [
      { text: "Camera",  onPress: pickPhoto },
      { text: "Library", onPress: pickFromLibrary },
      { text: "Cancel",  style: "cancel" },
    ]);
  }

  // ── Approve ───────────────────────────────────────────────────────────────
  async function handleApprove() {
    if (!receipt) return;
    if (!photo) { Alert.alert("Photo required", "Attach a proof photo before approving."); return; }

    Alert.alert(
      "Approve Receipt?",
      "This will mark the delivery as approved and increment warehouse stock.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve",
          onPress: async () => {
            setSaving(true);
            try {
              const token = getBridgeToken() ?? "";
              const items = (receipt.items ?? []).map(it => ({
                item_type: it.item_type,
                quantity:  parseFloat(quantities[it.item_type] ?? String(it.quantity)) || 0,
              }));
              await verifyWarehouseReceipt(token, receipt.id, { items, notes: notes.trim() || undefined, proof_image: photo });
              Alert.alert("Approved ✓", "Receipt approved and stock incremented.", [
                { text: "OK", onPress: () => router.back() },
              ]);
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "Failed to approve receipt.");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  // ── Loading screen ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color={G} />
      </View>
    );
  }

  const items: WarehouseReceiptItem[] = receipt?.items ?? [];
  const arrivedAtWarehouse = receipt?.status === "arrived" || receipt?.status === "approved";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Full-screen map — built once with submitted coords; live GPS updates via injectJavaScript */}
      <WebView
        ref={webViewRef}
        style={StyleSheet.absoluteFill}
        originWhitelist={["*"]}
        scrollEnabled={false}
        javaScriptEnabled
        source={{ html: buildLeafletHtml(
          receipt?.submitted_lat ?? null,
          receipt?.submitted_lng ?? null,
          receipt?.warehouse?.lat ?? null,
          receipt?.warehouse?.lng ?? null,
          receipt?.warehouse?.name ?? "Warehouse"
        ) }}
      />

      {/* Floating header */}
      <View style={s.headerOverlay}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <ChevronLeft size={22} color="#1a2e22" />
        </TouchableOpacity>
        <View style={s.headerPill}>
          <Text style={s.headerTitle}>Inventory Check</Text>
          <Text style={s.headerSub} numberOfLines={1}>{decodedName}</Text>
        </View>
        {currentLoc != null && (
          <View style={s.coordsBadge}>
            <MapPin size={10} color={WHITE} />
            <Text style={s.coordsTxt}>
              {currentLoc.lat.toFixed(4)}, {currentLoc.lng.toFixed(4)}
            </Text>
          </View>
        )}
      </View>

      {/* Sliding bottom sheet */}
      <Animated.View style={[s.sheet, { top: panY }]}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.sheetInner}>

            {/* Drag zone — the whole peek handle area */}
            <View style={s.dragZone} {...panResponder.panHandlers}>
              <View style={s.handle} />

              {/* Peek summary — visible when collapsed */}
              <View style={s.peekRow}>
                <View style={s.peekLeft}>
                  <View style={[s.statusDot, !arrivedAtWarehouse && { backgroundColor: AMBER }]} />
                  <Text style={s.peekStatus}>
                    {arrivedAtWarehouse ? "At Warehouse" : "En Route"}
                  </Text>
                </View>
                <View style={s.peekRight}>
                  <Text style={s.peekCount}>{items.length} item{items.length !== 1 ? "s" : ""}</Text>
                  <Text style={s.peekHint}>
                    {arrivedAtWarehouse ? "swipe up to verify ↑" : "swipe up to mark arrived ↑"}
                  </Text>
                </View>
              </View>
            </View>

            <ScrollView
              contentContainerStyle={s.scroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* ── Tracker ── */}
              <View style={s.trackerCard}>
                {([
                  { label: "Submitted",    emoji: "📦", done: true,               current: false                },
                  { label: "En Route",     emoji: "🚛", done: true,               current: !arrivedAtWarehouse  },
                  { label: "At Warehouse", emoji: "🏭", done: arrivedAtWarehouse, current: arrivedAtWarehouse   },
                  { label: "Approved",     emoji: "✅", done: false,              current: false                },
                ] as const).map((step, i, arr) => (
                  <View key={step.label} style={s.trackStep}>
                    {i > 0 && (
                      <View style={[s.trackLine, arr[i - 1].done && s.trackLineDone]} />
                    )}
                    <View style={[
                      s.trackDot,
                      step.done    && s.trackDotDone,
                      (step as any).current && s.trackDotCurrent,
                    ]}>
                      <Text style={s.trackEmoji}>{step.emoji}</Text>
                    </View>
                    <Text style={[s.trackLbl, (step as any).current && s.trackLblCurrent]}>
                      {step.label}
                    </Text>
                  </View>
                ))}
              </View>

              {!arrivedAtWarehouse ? (
                /* ── EN ROUTE: only show arrived button ── */
                <TouchableOpacity style={s.arrivedBtn} onPress={markArrived} activeOpacity={0.85}>
                  <Text style={s.arrivedEmoji}>🏭</Text>
                  <View>
                    <Text style={s.arrivedBtnTxt}>Mark as Arrived at Warehouse</Text>
                    <Text style={s.arrivedBtnSub}>Tap when the delivery reaches the warehouse</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <>
                  {/* ── Info banner ── */}
                  <View style={s.infoBanner}>
                    <Text style={s.infoEmoji}>📋</Text>
                    <Text style={s.infoTxt}>
                      Verify quantities below. Adjust if needed, attach a proof photo, then approve.
                    </Text>
                  </View>

                  {/* ── Items ── */}
                  <View style={s.card}>
                    <Text style={s.cardTitle}>Items to Receive</Text>
                    {items.length === 0 ? (
                      <Text style={s.emptyTxt}>No items on this receipt.</Text>
                    ) : (
                      items.map((it, idx) => (
                        <View key={it.item_type} style={[s.itemRow, idx === items.length - 1 && { borderBottomWidth: 0 }]}>
                          <Text style={s.itemIcon}>{ITEM_ICONS[it.item_type] ?? "📦"}</Text>
                          <Text style={s.itemLabel}>{ITEM_LABELS[it.item_type] ?? it.item_type}</Text>
                          <View style={s.itemQtyWrap}>
                            <TextInput
                              style={s.itemQtyInput}
                              value={quantities[it.item_type] ?? String(it.quantity)}
                              onChangeText={v => setQuantities(p => ({ ...p, [it.item_type]: v }))}
                              keyboardType="decimal-pad"
                              selectTextOnFocus
                            />
                            <Text style={s.itemUnit}>{ITEM_UNITS[it.item_type] ?? it.unit ?? "pcs"}</Text>
                          </View>
                        </View>
                      ))
                    )}
                  </View>

                  {/* ── Notes ── */}
                  <View style={s.card}>
                    <Text style={s.cardTitle}>Notes  <Text style={s.cardTitleMuted}>(optional)</Text></Text>
                    <TextInput
                      style={s.notesInput}
                      value={notes}
                      onChangeText={setNotes}
                      placeholder="Remarks about the delivery condition…"
                      placeholderTextColor={MUTED}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                    />
                  </View>

                  {/* ── Proof Photo ── */}
                  <View style={s.card}>
                    <Text style={s.cardTitle}>
                      Proof Photo  <Text style={s.required}>*required</Text>
                    </Text>
                    <TouchableOpacity style={[s.photoBox, photo && { borderStyle: "solid" }]} onPress={handlePhotoPress} activeOpacity={0.85}>
                      {photo ? (
                        <Image source={{ uri: photo.uri }} style={s.photoPreview} resizeMode="cover" />
                      ) : (
                        <View style={s.photoPlaceholder}>
                          <Camera size={32} color={G + "99"} />
                          <Text style={s.photoHint}>Tap to capture or pick a photo</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                    {photo && (
                      <TouchableOpacity onPress={() => setPhoto(null)} style={s.removeBtn}>
                        <Text style={s.removeTxt}>✕  Remove photo</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* ── Approve button ── */}
                  <TouchableOpacity
                    style={[s.approveBtn, (saving || !photo) && s.approveBtnDisabled]}
                    onPress={handleApprove}
                    disabled={saving || !photo}
                    activeOpacity={0.85}
                  >
                    {saving
                      ? <ActivityIndicator size="small" color={WHITE} />
                      : <CheckCircle size={18} color={WHITE} />}
                    <Text style={s.approveTxt}>{saving ? "Approving…" : "Approve & Increment Stock"}</Text>
                  </TouchableOpacity>
                </>
              )}

              <View style={{ height: 48 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: BG },

  // ── Floating header ──
  headerOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
    paddingTop: Platform.OS === "ios" ? 56 : 44,
    paddingBottom: 10, paddingHorizontal: 14,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  backBtn:     { width: 38, height: 38, borderRadius: 19, backgroundColor: WHITE, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, elevation: 5 },
  headerPill:  { flex: 1, backgroundColor: "rgba(255,255,255,0.93)", borderRadius: 13, paddingHorizontal: 13, paddingVertical: 7, shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 4, elevation: 3 },
  headerTitle: { fontSize: 14, fontWeight: "800", color: "#1a2e22" },
  headerSub:   { fontSize: 11, color: MUTED, fontWeight: "600", marginTop: 1 },
  coordsBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(0,0,0,0.48)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  coordsTxt:   { fontSize: 9, fontWeight: "700", color: WHITE },

  // ── Sheet ──
  sheet:      { position: "absolute", bottom: 0, left: 0, right: 0 },
  sheetInner: { flex: 1, backgroundColor: WHITE, borderTopLeftRadius: 26, borderTopRightRadius: 26, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 20, elevation: 20, overflow: "hidden" },

  // ── Drag zone & peek ──
  dragZone: { paddingTop: 10, paddingBottom: 12, paddingHorizontal: 16, alignItems: "center", borderBottomWidth: 1, borderBottomColor: BORDER },
  handle:   { width: 44, height: 4, borderRadius: 2, backgroundColor: "#d1d5db", marginBottom: 12 },

  peekRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%" },
  peekLeft:   { flexDirection: "row", alignItems: "center", gap: 7 },
  statusDot:  { width: 9, height: 9, borderRadius: 5, backgroundColor: G },
  peekStatus: { fontSize: 13, fontWeight: "800", color: GDARK },
  peekRight:  { alignItems: "flex-end", gap: 1 },
  peekCount:  { fontSize: 12, fontWeight: "700", color: "#1a2e22" },
  peekHint:   { fontSize: 10, color: MUTED, fontWeight: "500" },

  scroll: { padding: 16, gap: 14 },

  // ── Tracker ──
  trackerCard:    { backgroundColor: WHITE, borderRadius: 18, padding: 16, flexDirection: "row", alignItems: "flex-start", borderWidth: 1, borderColor: BORDER },
  trackStep:      { flex: 1, alignItems: "center", position: "relative" },
  trackLine:      { position: "absolute", top: 17, left: "-50%", right: "50%", height: 2, backgroundColor: BORDER },
  trackLineDone:  { backgroundColor: G },
  trackDot:       { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: BORDER, backgroundColor: WHITE, alignItems: "center", justifyContent: "center", marginBottom: 7 },
  trackDotDone:   { borderColor: G, backgroundColor: G + "14" },
  trackDotCurrent:{ borderColor: G, backgroundColor: G + "22", shadowColor: G, shadowOpacity: 0.4, shadowRadius: 6, elevation: 4 },
  trackEmoji:     { fontSize: 15 },
  trackLbl:       { fontSize: 9, fontWeight: "700", color: MUTED, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.5 },
  trackLblCurrent:{ color: G, fontWeight: "900" },

  // ── Info banner ──
  infoBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: AMBER + "15", borderRadius: 13, borderWidth: 1, borderColor: AMBER + "40", paddingVertical: 11, paddingHorizontal: 13 },
  infoEmoji:  { fontSize: 15, marginTop: 1 },
  infoTxt:    { flex: 1, fontSize: 12, color: "#7c5c00", fontWeight: "600", lineHeight: 19 },

  // ── Card ──
  card:          { backgroundColor: WHITE, borderRadius: 18, padding: 16, gap: 12, borderWidth: 1, borderColor: BORDER },
  cardTitle:     { fontSize: 11, fontWeight: "800", color: MUTED, textTransform: "uppercase", letterSpacing: 1 },
  cardTitleMuted:{ fontWeight: "500", textTransform: "none", letterSpacing: 0 },
  required:      { fontSize: 10, color: "#ef4444", fontWeight: "700", textTransform: "none", letterSpacing: 0 },

  // ── Item rows ──
  itemRow:     { flexDirection: "row", alignItems: "center", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  itemIcon:    { fontSize: 18, width: 26, textAlign: "center" },
  itemLabel:   { flex: 1, fontSize: 14, fontWeight: "700", color: "#1a2e22" },
  itemQtyWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  itemQtyInput:{ width: 74, height: 40, borderRadius: 11, borderWidth: 1.5, borderColor: G + "55", backgroundColor: BG, textAlign: "center", fontSize: 16, fontWeight: "800", color: GDARK, paddingHorizontal: 6 },
  itemUnit:    { fontSize: 12, color: MUTED, fontWeight: "600", width: 30 },
  emptyTxt:    { fontSize: 13, color: MUTED, textAlign: "center", paddingVertical: 8 },

  // ── Notes ──
  notesInput: { borderWidth: 1.5, borderColor: BORDER, borderRadius: 12, backgroundColor: BG, padding: 12, fontSize: 13, color: "#1a2e22", minHeight: 76 },

  // ── Photo ──
  photoBox:        { borderRadius: 14, borderWidth: 1.5, borderColor: G + "55", borderStyle: "dashed", overflow: "hidden", minHeight: 148 },
  photoPreview:    { width: "100%", height: 210 },
  photoPlaceholder:{ flex: 1, minHeight: 148, alignItems: "center", justifyContent: "center", gap: 10 },
  photoHint:       { fontSize: 13, color: MUTED, fontWeight: "600" },
  removeBtn:       { alignSelf: "center", marginTop: 4, paddingVertical: 6 },
  removeTxt:       { fontSize: 12, color: "#ef4444", fontWeight: "700" },

  // ── Arrived button ──
  arrivedBtn:    { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: AMBER + "18", borderRadius: 18, borderWidth: 1.5, borderColor: AMBER + "55", padding: 18 },
  arrivedEmoji:  { fontSize: 32 },
  arrivedBtnTxt: { fontSize: 15, fontWeight: "800", color: "#7c5c00" },
  arrivedBtnSub: { fontSize: 11, fontWeight: "500", color: MUTED, marginTop: 2 },

  // ── Approve ──
  approveBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, backgroundColor: GDARK, borderRadius: 18, paddingVertical: 16, shadowColor: G, shadowOpacity: 0.35, shadowRadius: 10, elevation: 6 },
  approveBtnDisabled: { opacity: 0.45 },
  approveTxt:         { fontSize: 15, fontWeight: "900", color: WHITE, letterSpacing: 0.3 },
});
