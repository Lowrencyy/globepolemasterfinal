import * as FileSystem from "expo-file-system/legacy";
import { Image as ExpoImage } from "expo-image";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

const PRIMARY = "#0A5C3B";

type PhotoFile = { uri: string; label: string } | null;

function buildSpanMapHtml(
  fromLat: number, fromLng: number, fromLabel: string,
  toLat: number, toLng: number, toLabel: string,
  accent: string,
) {
  const midLat = (fromLat + toLat) / 2;
  const midLng = (fromLng + toLng) / 2;
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body,#map{width:100%;height:100%;background:#f0f4f8;}
.leaflet-div-icon{background:none!important;border:none!important;}
.pin{display:flex;flex-direction:column;align-items:center;}
.pin-dot{width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);}
.pin-label{margin-top:3px;background:rgba(15,23,42,0.82);color:#fff;font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;white-space:nowrap;}
</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('map',{zoomControl:true,scrollWheelZoom:false,dragging:true,doubleClickZoom:false,touchZoom:true}).setView([${midLat},${midLng}],16);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:20}).addTo(map);
var fromIcon=L.divIcon({className:'',html:'<div class="pin"><div class="pin-dot" style="background:${accent}"></div><div class="pin-label">${fromLabel}</div></div>',iconAnchor:[7,7]});
var toIcon=L.divIcon({className:'',html:'<div class="pin"><div class="pin-dot" style="background:#6366F1"></div><div class="pin-label">${toLabel}</div></div>',iconAnchor:[7,7]});
L.marker([${fromLat},${fromLng}],{icon:fromIcon}).addTo(map);
L.marker([${toLat},${toLng}],{icon:toIcon}).addTo(map);
L.polyline([[${fromLat},${fromLng}],[${toLat},${toLng}]],{color:'${accent}',weight:3,opacity:0.75,dashArray:'6,4'}).addTo(map);
var bounds=L.latLngBounds([[${fromLat},${fromLng}],[${toLat},${toLng}]]);
map.fitBounds(bounds,{padding:[44,44],maxZoom:18});
setTimeout(function(){map.invalidateSize();},120);
</script>
</body></html>`;
}

function sanitize(s?: string) {
  return (s ?? "").toLowerCase().trim().replace(/[^a-z0-9_-]/g, "_");
}

export default function TeardownCompleteScreen() {
  const params = useLocalSearchParams<Record<string, string>>();

  const {
    from_pole_code,
    to_pole_id, to_pole_code, to_pole_name,
    node_id, project_id, project_name,
    accent, span_id,
    cable_collected, expected_cable, length_meters, recovered_cable, cable_reason,
    node_count, amplifier_count, extender_count,
    tsc_count, ps_count, ps_housing_count,
    submitted_at,
    from_pole_id,
    from_pole_latitude, from_pole_longitude,
    to_pole_latitude, to_pole_longitude,
    pole_draft_dir, teardown_draft_dir, to_code_sanitized,
  } = params;

  const accentColor = accent || PRIMARY;

  const fromLat = Number(from_pole_latitude) || null;
  const fromLng = Number(from_pole_longitude) || null;
  const toLat   = Number(to_pole_latitude)   || null;
  const toLng   = Number(to_pole_longitude)   || null;
  const hasCoords = !!(fromLat && fromLng && toLat && toLng);

  const dateStr = submitted_at
    ? new Date(submitted_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })
    : new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [cablePhotoUri, setCablePhotoUri] = useState<string | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [viewerLabel, setViewerLabel] = useState("");

  useEffect(() => {
    loadPhotos();
  }, []);

  async function loadPhotos() {
    const toCode = to_code_sanitized || sanitize(to_pole_code);
    const fromCode = sanitize(from_pole_code);
    const poleDir = pole_draft_dir || "";
    const tdDir   = teardown_draft_dir || "";

    const candidates: { dir: string; file: string; label: string }[] = [
      { dir: poleDir, file: `pole_${from_pole_id}_before.jpg`,   label: "From Before" },
      { dir: poleDir, file: `pole_${from_pole_id}_after.jpg`,    label: "From After" },
      { dir: poleDir, file: `pole_${from_pole_id}_poletag.jpg`,  label: "From Tag" },
      { dir: tdDir,   file: `${toCode}_before.jpg`,              label: "To Before" },
      { dir: tdDir,   file: `${toCode}_after.jpg`,               label: "To After" },
      { dir: tdDir,   file: `${toCode}_poletag.jpg`,             label: "To Tag" },
    ];

    const found: PhotoFile[] = [];
    for (const { dir, file, label } of candidates) {
      if (!dir) continue;
      const info = await FileSystem.getInfoAsync(dir + file).catch(() => ({ exists: false }));
      if (info.exists) found.push({ uri: (info as any).uri, label });
    }
    setPhotos(found);

    if (tdDir && fromCode) {
      const cableInfo = await FileSystem.getInfoAsync(tdDir + `${fromCode}_cable.jpg`).catch(() => ({ exists: false }));
      if (cableInfo.exists) setCablePhotoUri((cableInfo as any).uri);
    }
  }

  function goToNext() {
    router.replace({
      pathname: "/teardowns/pole-detail" as any,
      params: { pole_id: to_pole_id, pole_code: to_pole_code, pole_name: to_pole_name, node_id, project_id, project_name, accent },
    });
  }

  const components = [
    { label: "Node",          count: node_count ?? "0",          expected: "—" },
    { label: "Amplifier",     count: amplifier_count ?? "0",     expected: "—" },
    { label: "Extender",      count: extender_count ?? "0",      expected: "—" },
    { label: "TSC",           count: tsc_count ?? "0",           expected: "—" },
    { label: "Power Supply",  count: ps_count ?? "0",            expected: "—" },
    { label: "PS Housing",    count: ps_housing_count ?? "0",    expected: "—" },
  ].filter((c) => Number(c.count) > 0);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.floatingHeader}>
          <TouchableOpacity onPress={() => router.replace("/teardowns" as any)} style={styles.backBtn}>
            <ChevronLeft size={22} color="#111827" />
          </TouchableOpacity>
          <View style={styles.floatingHeaderText}>
            <Text style={styles.headerTitle}>Teardown Complete</Text>
            <Text style={styles.headerSub}>{project_name || "Skycable"}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Check badge ── */}
        <View style={styles.checkBadge}>
          <View style={[styles.checkCircle, { backgroundColor: `${accentColor}18` }]}>
            <Text style={[styles.checkIcon, { color: accentColor }]}>✓</Text>
          </View>
          <Text style={styles.titleText}>Teardown Complete</Text>
          <Text style={styles.subtitleText}>{dateStr}</Text>
        </View>

        {/* ── Span map card ── */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>COMPLETED SPAN</Text>

          <View style={styles.spanPoleRow}>
            <View style={styles.spanPoleBox}>
              <View style={[styles.spanPoleDot, { backgroundColor: accentColor }]} />
              <Text style={[styles.spanPoleCode, { color: accentColor }]} numberOfLines={1}>
                {from_pole_code || "—"}
              </Text>
              <Text style={styles.spanPoleLabel}>From</Text>
            </View>

            <View style={styles.spanConnector}>
              <View style={[styles.spanLine, { borderColor: `${accentColor}50` }]} />
              {length_meters ? (
                <View style={[styles.spanDistBadge, { backgroundColor: `${accentColor}12` }]}>
                  <Text style={[styles.spanDistText, { color: accentColor }]}>{length_meters}m</Text>
                </View>
              ) : null}
              <View style={[styles.spanLine, { borderColor: `${accentColor}50` }]} />
            </View>

            <View style={styles.spanPoleBox}>
              <View style={[styles.spanPoleDot, { backgroundColor: "#6366F1" }]} />
              <Text style={[styles.spanPoleCode, { color: "#6366F1" }]} numberOfLines={1}>
                {to_pole_code || "—"}
              </Text>
              <Text style={styles.spanPoleLabel}>To</Text>
            </View>
          </View>

          {hasCoords ? (
            <View style={styles.mapWrap}>
              <WebView
                style={StyleSheet.absoluteFillObject}
                scrollEnabled={false}
                originWhitelist={["*"]}
                javaScriptEnabled
                domStorageEnabled
                mixedContentMode="always"
                cacheEnabled={false}
                source={{
                  html: buildSpanMapHtml(
                    fromLat!, fromLng!, from_pole_code || "FROM",
                    toLat!, toLng!, to_pole_code || "TO",
                    accentColor,
                  ),
                  baseUrl: "https://local.telcovantage/",
                }}
              />
            </View>
          ) : (
            <View style={styles.mapFallback}>
              <Text style={styles.mapFallbackText}>🗺 Map unavailable</Text>
            </View>
          )}

          <Text style={styles.nodeText}>
            {project_name}  ·  Node {node_id}  {span_id ? `·  Span #${span_id}` : ""}
          </Text>
        </View>

        {/* ── Cable summary ── */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>CABLE</Text>
          <View style={styles.cableRow}>
            {cablePhotoUri ? (
              <Pressable onPress={() => { setViewerUri(cablePhotoUri); setViewerLabel("Cable"); }} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
                <ExpoImage source={{ uri: cablePhotoUri }} style={styles.cableThumb} contentFit="cover" />
              </Pressable>
            ) : null}
            <View style={styles.cableStats}>
              <View style={styles.infoCell}>
                <Text style={styles.infoCellLabel}>Status</Text>
                <Text style={[styles.infoCellValue, { color: cable_collected === "1" ? "#16A34A" : "#DC2626" }]}>
                  {cable_collected === "1" ? "All" : "Partial"}
                </Text>
              </View>
              {recovered_cable ? (
                <View style={styles.infoCell}>
                  <Text style={styles.infoCellLabel}>Recovered</Text>
                  <Text style={styles.infoCellValue}>{recovered_cable}m</Text>
                </View>
              ) : null}
              {expected_cable ? (
                <View style={styles.infoCell}>
                  <Text style={styles.infoCellLabel}>Expected</Text>
                  <Text style={styles.infoCellValue}>{expected_cable}m</Text>
                </View>
              ) : null}
            </View>
          </View>
          {cable_reason ? (
            <Text style={styles.cableReason}>Reason: {cable_reason}</Text>
          ) : null}
        </View>

        {/* ── Components ── */}
        {components.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>COMPONENTS COLLECTED</Text>
            <View style={styles.compGrid}>
              {components.map((c) => (
                <View key={c.label} style={styles.compCell}>
                  <Text style={[styles.compCount, { color: accentColor }]}>{c.count}</Text>
                  <Text style={styles.compLabel}>{c.label}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── Photo review ── */}
        {photos.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>PHOTO REVIEW</Text>
            <View style={styles.photoGrid}>
              {photos.map((p) =>
                p ? (
                  <Pressable
                    key={p.label}
                    onPress={() => { setViewerUri(p.uri); setViewerLabel(p.label); }}
                    style={({ pressed }) => [styles.photoItem, pressed && { opacity: 0.85 }]}
                  >
                    <ExpoImage source={{ uri: p.uri }} style={styles.photoThumb} contentFit="cover" />
                    <Text style={styles.photoLabel} numberOfLines={1}>{p.label}</Text>
                  </Pressable>
                ) : null,
              )}
            </View>
          </View>
        ) : null}

        {/* ── Primary action ── */}
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: accentColor }]}
          onPress={goToNext}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Go to Next Pole →</Text>
          <Text style={styles.primaryBtnSub}>Continue teardown on {to_pole_code}</Text>
        </TouchableOpacity>

        {/* ── Secondary actions ── */}
        <View style={styles.secondaryRow}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace("/(tabs)/tasks" as any)} activeOpacity={0.8}>
            <Text style={styles.secondaryIcon}>📊</Text>
            <Text style={styles.secondaryLabel}>Daily{"\n"}Reports</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace("/(tabs)" as any)} activeOpacity={0.8}>
            <Text style={styles.secondaryIcon}>🏠</Text>
            <Text style={styles.secondaryLabel}>Dashboard</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── Photo viewer modal ── */}
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <View style={styles.viewerBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setViewerUri(null)} />
          <View style={styles.viewerCard}>
            <View style={styles.viewerHeader}>
              <Text style={styles.viewerTitle}>{viewerLabel}</Text>
              <Pressable onPress={() => setViewerUri(null)} style={styles.viewerClose}>
                <Text style={styles.viewerCloseText}>✕</Text>
              </Pressable>
            </View>
            {viewerUri ? (
              <ExpoImage source={{ uri: viewerUri }} style={styles.viewerImage} contentFit="cover" transition={150} />
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F4F6F8" },
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
  content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 40 },

  checkBadge: { alignItems: "center", marginBottom: 20 },
  checkCircle: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: "center", justifyContent: "center",
    marginBottom: 12,
  },
  checkIcon:    { fontSize: 36, fontWeight: "900" },
  titleText:    { fontSize: 22, fontWeight: "900", color: "#111827", letterSpacing: -0.5 },
  subtitleText: { fontSize: 12, color: "#6B7280", marginTop: 4 },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E9EDF2",
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },

  cardLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#9CA3AF",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 12,
  },

  spanPoleRow: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  spanPoleBox: { alignItems: "center", width: 80 },
  spanPoleDot: { width: 12, height: 12, borderRadius: 6, marginBottom: 4 },
  spanPoleCode: { fontSize: 13, fontWeight: "900", textAlign: "center" },
  spanPoleLabel: { fontSize: 10, color: "#9CA3AF", fontWeight: "600", marginTop: 2 },
  spanConnector: { flex: 1, flexDirection: "row", alignItems: "center" },
  spanLine: { flex: 1, borderTopWidth: 2, borderStyle: "dashed" },
  spanDistBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  spanDistText: { fontSize: 11, fontWeight: "800" },

  mapWrap: {
    height: 200,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#F0F4F8",
    marginBottom: 12,
  },
  mapFallback: {
    height: 80,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  mapFallbackText: { fontSize: 13, color: "#9CA3AF" },

  nodeText: { fontSize: 12, color: "#6B7280", fontWeight: "600" },

  infoRow: { flexDirection: "row", gap: 12 },
  infoCell: { flex: 1 },
  infoCellLabel: { fontSize: 9, fontWeight: "700", color: "#9CA3AF", marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.5 },
  infoCellValue: { fontSize: 13, fontWeight: "900", color: "#111827" },

  cableRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  cableThumb: { width: 54, height: 44, borderRadius: 8, backgroundColor: "#F0F4F8" },
  cableStats: { flex: 1, flexDirection: "row", gap: 8 },
  cableReason: { fontSize: 12, color: "#6B7280", marginTop: 10, fontStyle: "italic" },

  compGrid: { flexDirection: "row", flexWrap: "wrap" },
  compCell: { width: "33.33%", paddingVertical: 8, paddingRight: 8 },
  compChip: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    minWidth: 90,
  },
  compCount: { fontSize: 22, fontWeight: "900" },
  compLabel: { fontSize: 11, fontWeight: "600", color: "#6B7280", marginTop: 2 },

  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoItem: { width: "30%", alignItems: "center" },
  photoThumb: { width: "100%", aspectRatio: 1, borderRadius: 12, backgroundColor: "#F0F4F8" },
  photoLabel: { fontSize: 10, fontWeight: "700", color: "#374151", marginTop: 4, textAlign: "center" },

  primaryBtn: {
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  primaryBtnText: { fontSize: 17, fontWeight: "900", color: "#fff" },
  primaryBtnSub:  { fontSize: 11, color: "rgba(255,255,255,0.75)", marginTop: 3 },

  secondaryRow: { flexDirection: "row", gap: 12 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E9EDF2",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  secondaryIcon:  { fontSize: 24, marginBottom: 6 },
  secondaryLabel: { fontSize: 11, fontWeight: "700", color: "#374151", textAlign: "center", lineHeight: 16 },

  viewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  viewerCard: { width: "100%", backgroundColor: "#fff", borderRadius: 20, overflow: "hidden" },
  viewerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  viewerTitle:     { fontSize: 15, fontWeight: "800", color: "#111827" },
  viewerClose:     { width: 32, height: 32, borderRadius: 16, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  viewerCloseText: { fontSize: 14, fontWeight: "700", color: "#374151" },
  viewerImage:     { width: "100%", height: 340 },
});
