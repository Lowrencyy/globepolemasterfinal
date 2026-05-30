import api from "@/lib/api";
import { ASSET_BASE } from "@/lib/api";
import { type TeardownLog, type TeardownPhoto } from "@/services/skycable";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Image as ExpoImage } from "expo-image";
import { ChevronLeft, RefreshCw } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

const G       = "#006241";
const G_LIGHT = "#ECFDF5";
const SLATE   = "#111827";
const MUTED   = "#667085";
const BORDER  = "#E7ECF2";
const WHITE   = "#FFFFFF";
const BG      = "#F4F8F5";

// ── Leaflet WebView map ───────────────────────────────────────────────────────
function buildMapHtml(fromLat: number, fromLng: number, toLat: number, toLng: number, fromLabel: string, toLabel: string) {
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
.leaflet-control-attribution{display:none!important;}
.pin{display:flex;flex-direction:column;align-items:center;}
.pin-dot{width:14px;height:14px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);}
.pin-label{margin-top:3px;background:rgba(15,23,42,0.82);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap;}
</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('map',{zoomControl:true,scrollWheelZoom:false,doubleClickZoom:false,touchZoom:true}).setView([${midLat},${midLng}],15);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:20}).addTo(map);
var fromIcon=L.divIcon({className:'',html:'<div class="pin"><div class="pin-dot" style="background:#006241"></div><div class="pin-label">${fromLabel}</div></div>',iconAnchor:[7,7]});
var toIcon=L.divIcon({className:'',html:'<div class="pin"><div class="pin-dot" style="background:#6366F1"></div><div class="pin-label">${toLabel}</div></div>',iconAnchor:[7,7]});
L.marker([${fromLat},${fromLng}],{icon:fromIcon}).addTo(map);
L.marker([${toLat},${toLng}],{icon:toIcon}).addTo(map);
L.polyline([[${fromLat},${fromLng}],[${toLat},${toLng}]],{color:'#006241',weight:3,opacity:0.75,dashArray:'6,4'}).addTo(map);
var bounds=L.latLngBounds([[${fromLat},${fromLng}],[${toLat},${toLng}]]);
map.fitBounds(bounds,{padding:[52,52],maxZoom:19});
setTimeout(function(){map.invalidateSize();},120);
</script>
</body></html>`;
}

// ── Photo grid ────────────────────────────────────────────────────────────────
const PHOTO_LABELS: Record<string, string> = {
  from_before:   "FROM Before",
  from_after:    "FROM After",
  from_pole_tag: "FROM Pole Tag",
  to_before:     "TO Before",
  to_after:      "TO After",
  to_pole_tag:   "TO Pole Tag",
  bunching:      "Bunching",
  before:        "Before",
  after:         "After",
  pole_tag:      "Pole Tag",
  supporting:    "Supporting",
};

function PhotoThumb({ photo, onPress }: { photo: TeardownPhoto; onPress: () => void }) {
  const uri = `${ASSET_BASE}api/v1/files/${photo.image_path}`;
  return (
    <TouchableOpacity style={ph.thumb} onPress={onPress} activeOpacity={0.85}>
      <ExpoImage source={{ uri }} style={ph.img} contentFit="cover" />
      <Text style={ph.label}>{PHOTO_LABELS[photo.photo_type] ?? photo.photo_type}</Text>
    </TouchableOpacity>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SpanDetailPage() {
  const router = useRouter();
  const { teardownId, spanIndex, nodeName } = useLocalSearchParams<{
    teardownId: string;
    spanIndex: string;
    nodeName: string;
  }>();

  const decodedName = nodeName ? decodeURIComponent(nodeName) : "Node";

  const [log,        setLog]        = useState<TeardownLog | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lightbox,   setLightbox]   = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await api.get(`/skycable/teardowns/${teardownId}`);
      setLog(res?.data ?? res);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [teardownId]);

  React.useEffect(() => { loadData(); }, [loadData]);

  const span      = (log?.span as any) ?? null;
  const fromPole  = span?.fromPole?.pole ?? null;
  const toPole    = span?.toPole?.pole   ?? null;
  const fromCode  = fromPole?.pole_code?.trim() || span?.span_code || "—";
  const toCode    = toPole?.pole_code?.trim()   || span?.span_code || "—";
  const capturedLat = log?.captured_lat ? parseFloat(String(log.captured_lat)) : null;
  const capturedLng = log?.captured_lng ? parseFloat(String(log.captured_lng)) : null;

  const fromLat = fromPole?.lat ? parseFloat(String(fromPole.lat)) : capturedLat;
  const fromLng = fromPole?.lng ? parseFloat(String(fromPole.lng)) : capturedLng;
  const toLat   = toPole?.lat   ? parseFloat(String(toPole.lat))   : null;
  const toLng   = toPole?.lng   ? parseFloat(String(toPole.lng))   : null;

  // resolve map markers: TO falls back to a small offset from FROM if no coords
  const mapFromLat = fromLat;
  const mapFromLng = fromLng;
  const mapToLat   = toLat ?? (fromLat ? fromLat + 0.0003 : null);
  const mapToLng   = toLng ?? (fromLng ? fromLng + 0.0003 : null);
  const hasMap     = !!(mapFromLat && mapFromLng && mapToLat && mapToLng);

  const lineman   = log?.lineman
    ? `${log.lineman.first_name ?? ""} ${log.lineman.last_name ?? ""}`.trim()
    : "—";

  function fmtTime(iso: string) {
    const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
    const h = d.getUTCHours(), mi = String(d.getUTCMinutes()).padStart(2, "0");
    return `${h % 12 || 12}:${mi} ${h >= 12 ? "PM" : "AM"}`;
  }

  const timeRange = log
    ? `${log.start_time ? fmtTime(log.start_time) : "—"} – ${log.end_time ? fmtTime(log.end_time) : "ongoing"}`
    : "—";

  const components = log ? [
    { label: "Cable",  value: Number(log.actual_cable ?? 0),         unit: "m",  color: "#059669" },
    { label: "Node",   value: Number(log.nodes_collected ?? 0),       unit: "pc", color: "#0b6cff" },
    { label: "Amp",    value: Number(log.amplifiers_collected ?? 0),  unit: "pc", color: "#8b5cf6" },
    { label: "Ext",    value: Number(log.extenders_collected ?? 0),   unit: "pc", color: "#10b981" },
    { label: "TSC",    value: Number(log.tsc_collected ?? 0),         unit: "pc", color: "#f59e0b" },
    { label: "PSU",    value: Number(log.powersupply_collected ?? 0), unit: "pc", color: "#ef4444" },
  ] : [];

  const photos = log?.photos ?? [];

  const STATUS_COLOR: Record<string, string> = {
    pending:          "#94a3b8",
    submitted:        "#f59e0b",
    subcon_approved:  "#3b82f6",
    backend_approved: "#059669",
    rejected:         "#ef4444",
  };
  const statusColor = log ? (STATUS_COLOR[log.status] ?? MUTED) : MUTED;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={s.container}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>
          <View style={s.headerText}>
            <Text style={s.title}>{decodedName}</Text>
            <Text style={s.subtitle}>Span {spanIndex} · {span?.span_code ?? `#${teardownId}`}</Text>
          </View>
          <TouchableOpacity style={s.iconBtn} onPress={() => { setRefreshing(true); loadData(); }}>
            <RefreshCw size={16} color={G} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator color={G} size="large" /></View>
        ) : !log ? (
          <View style={s.center}><Text style={s.emptyTxt}>Could not load span details.</Text></View>
        ) : (
          <ScrollView
            contentContainerStyle={s.scroll}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} colors={[G]} tintColor={G} />}
          >
            {/* Status + time */}
            <View style={s.metaRow}>
              <View style={[s.statusBadge, { backgroundColor: statusColor + "18", borderColor: statusColor + "40" }]}>
                <View style={[s.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[s.statusTxt, { color: statusColor }]}>{log.status.replace("_", " ").toUpperCase()}</Text>
              </View>
              <Text style={s.timeRange}>{timeRange}</Text>
            </View>

            {/* ROUTE — horizontal flex */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>ROUTE</Text>
              <View style={s.routeCard}>
                {/* Labels row */}
                <View style={s.routeRow}>
                  <Text style={s.routeEndLabel}>FROM</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={s.routeEndLabel}>TO</Text>
                </View>
                {/* Codes row */}
                <View style={s.routeRow}>
                  <View style={[s.routeDot, { backgroundColor: G }]} />
                  <Text style={s.routeEndCode} numberOfLines={1}>{fromCode}</Text>
                  <Text style={s.routeArrow}>→</Text>
                  <Text style={[s.routeEndCode, { textAlign: "right" }]} numberOfLines={1}>{toCode}</Text>
                  <View style={[s.routeDot, { backgroundColor: "#6366F1" }]} />
                </View>
                {/* Coords row */}
                {(fromLat || toLat) && (
                  <View style={[s.routeRow, { marginTop: 4 }]}>
                    {fromLat && fromLng
                      ? <Text style={s.routeCoords}>{fromLat.toFixed(5)}, {fromLng.toFixed(5)}</Text>
                      : <View style={{ flex: 1 }} />}
                    <View style={{ flex: 1 }} />
                    {toLat && toLng
                      ? <Text style={[s.routeCoords, { textAlign: "right" }]}>{toLat.toFixed(5)}, {toLng.toFixed(5)}</Text>
                      : null}
                  </View>
                )}
              </View>
            </View>

            {/* Map — Leaflet WebView */}
            {hasMap && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>MAP</Text>
                <View style={s.mapWrap}>
                  <WebView
                    source={{ html: buildMapHtml(mapFromLat!, mapFromLng!, mapToLat!, mapToLng!, fromCode, toCode) }}
                    style={{ flex: 1 }}
                    scrollEnabled={false}
                    javaScriptEnabled
                  />
                </View>
              </View>
            )}

            {/* Components collected */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>COMPONENTS COLLECTED</Text>
              <View style={s.compCard}>
                <Text style={s.linemanTxt}>👤 {lineman}</Text>
                <View style={s.compGrid}>
                  {components.map(c => (
                    <View key={c.label} style={[s.compChip, { borderColor: c.color + "30" }]}>
                      <Text style={[s.compVal, { color: c.color }]}>{c.value}{c.unit}</Text>
                      <Text style={s.compLbl}>{c.label}</Text>
                    </View>
                  ))}
                </View>
                {log.notes ? <Text style={s.notes}>📝 {log.notes}</Text> : null}
              </View>
            </View>

            {/* Photos */}
            {photos.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>PHOTOS ({photos.length})</Text>
                {/* Group: FROM pole */}
                {["from_before","from_after","from_pole_tag"].some(t => photos.find(p => p.photo_type === t)) && (
                  <>
                    <Text style={s.photoGroupLabel}>FROM Pole</Text>
                    <View style={s.photoRow}>
                      {["from_before","from_after","from_pole_tag"].map(t => {
                        const p = photos.find(ph => ph.photo_type === t);
                        return p ? <PhotoThumb key={t} photo={p} onPress={() => setLightbox(`${ASSET_BASE}api/v1/files/${p.image_path}`)} /> : null;
                      })}
                    </View>
                  </>
                )}
                {/* Group: TO pole */}
                {["to_before","to_after","to_pole_tag"].some(t => photos.find(p => p.photo_type === t)) && (
                  <>
                    <Text style={s.photoGroupLabel}>TO Pole</Text>
                    <View style={s.photoRow}>
                      {["to_before","to_after","to_pole_tag"].map(t => {
                        const p = photos.find(ph => ph.photo_type === t);
                        return p ? <PhotoThumb key={t} photo={p} onPress={() => setLightbox(`${ASSET_BASE}api/v1/files/${p.image_path}`)} /> : null;
                      })}
                    </View>
                  </>
                )}
                {/* Bunching — full width */}
                {photos.filter(p => p.photo_type === "bunching").map(p => (
                  <React.Fragment key={p.id}>
                    <Text style={s.photoGroupLabel}>Bunching</Text>
                    <TouchableOpacity style={s.bunchingWrap} onPress={() => setLightbox(`${ASSET_BASE}api/v1/files/${p.image_path}`)} activeOpacity={0.85}>
                      <ExpoImage source={{ uri: `${ASSET_BASE}api/v1/files/${p.image_path}` }} style={s.bunchingImg} contentFit="cover" />
                      <Text style={s.bunchingLabel}>Tap to enlarge</Text>
                    </TouchableOpacity>
                  </React.Fragment>
                ))}
                {/* Other (supporting etc.) */}
                {photos.filter(p => !p.photo_type.startsWith("from_") && !p.photo_type.startsWith("to_") && p.photo_type !== "bunching").length > 0 && (
                  <>
                    <Text style={s.photoGroupLabel}>Other</Text>
                    <View style={s.photoRow}>
                      {photos.filter(p => !p.photo_type.startsWith("from_") && !p.photo_type.startsWith("to_") && p.photo_type !== "bunching").map(p => (
                        <PhotoThumb key={p.id} photo={p} onPress={() => setLightbox(`${ASSET_BASE}api/v1/files/${p.image_path}`)} />
                      ))}
                    </View>
                  </>
                )}
              </View>
            )}

            {photos.length === 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>PHOTOS</Text>
                <View style={s.emptyPhotos}>
                  <Text style={s.emptyPhotosTxt}>No photos uploaded for this span.</Text>
                </View>
              </View>
            )}
          </ScrollView>
        )}

        {/* Lightbox */}
        <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
          <TouchableOpacity style={lb.overlay} activeOpacity={1} onPress={() => setLightbox(null)}>
            <ExpoImage source={{ uri: lightbox ?? "" }} style={lb.img} contentFit="contain" />
            <Text style={lb.close}>✕ Tap to close</Text>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: BG },
  header:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: BG, gap: 8 },
  backBtn:        { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconBtn:        { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: G_LIGHT },
  headerText:     { flex: 1 },
  title:          { fontSize: 17, fontWeight: "900", color: SLATE },
  subtitle:       { fontSize: 11, color: MUTED, fontWeight: "600" },
  center:         { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyTxt:       { fontSize: 14, color: MUTED },
  scroll:         { padding: 16, paddingBottom: 56, gap: 16 },
  metaRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusBadge:    { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  statusDot:      { width: 7, height: 7, borderRadius: 4 },
  statusTxt:      { fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  timeRange:      { fontSize: 11, color: MUTED, fontWeight: "600" },
  section:        { gap: 8 },
  sectionTitle:   { fontSize: 10, fontWeight: "900", color: MUTED, letterSpacing: 1.2, textTransform: "uppercase" },
  routeCard:      { backgroundColor: WHITE, borderRadius: 16, borderWidth: 1.5, borderColor: BORDER, padding: 14, gap: 6 },
  routeRow:       { flexDirection: "row", alignItems: "center", gap: 6 },
  routeDot:       { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: WHITE, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 3, elevation: 2 },
  routeArrow:     { fontSize: 16, fontWeight: "900", color: G, marginHorizontal: 2 },
  routeEndLabel:  { fontSize: 9, fontWeight: "900", color: MUTED, letterSpacing: 1, textTransform: "uppercase", flex: 1 },
  routeEndCode:   { fontSize: 13, fontWeight: "900", color: SLATE, flex: 1 },
  routeCoords:    { fontSize: 9, color: MUTED, fontWeight: "600", flex: 1 },
  mapWrap:        { height: 220, borderRadius: 16, overflow: "hidden", borderWidth: 1.5, borderColor: BORDER },
  compCard:       { backgroundColor: WHITE, borderRadius: 16, borderWidth: 1.5, borderColor: BORDER, padding: 14, gap: 10 },
  linemanTxt:     { fontSize: 12, color: MUTED, fontWeight: "700" },
  compGrid:       { flexDirection: "row", gap: 6 },
  compChip:       { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 4, alignItems: "center", borderWidth: 1 },
  compVal:        { fontSize: 13, fontWeight: "900" },
  compLbl:        { fontSize: 7, fontWeight: "700", color: MUTED, marginTop: 2, textTransform: "uppercase" },
  notes:          { fontSize: 11, color: MUTED, fontWeight: "600", marginTop: 2 },
  photoGroupLabel:{ fontSize: 10, fontWeight: "800", color: SLATE, marginTop: 4 },
  photoRow:       { flexDirection: "row", gap: 8 },
  bunchingWrap:   { borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: BORDER },
  bunchingImg:    { width: "100%", aspectRatio: 16 / 9 },
  bunchingLabel:  { fontSize: 9, fontWeight: "700", color: MUTED, textAlign: "center", paddingVertical: 5, backgroundColor: WHITE },
  emptyPhotos:    { backgroundColor: WHITE, borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 20, alignItems: "center" },
  emptyPhotosTxt: { fontSize: 12, color: MUTED, fontWeight: "600" },
});

const ph = StyleSheet.create({
  thumb: { flex: 1, maxWidth: "33%", borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: BORDER },
  img:   { width: "100%", aspectRatio: 1 },
  label: { fontSize: 8, fontWeight: "700", color: MUTED, textAlign: "center", paddingVertical: 4, backgroundColor: WHITE },
});

const lb = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  img:     { width: "100%", height: "80%" },
  close:   { color: WHITE, fontSize: 13, fontWeight: "700", marginTop: 16, opacity: 0.7 },
});
