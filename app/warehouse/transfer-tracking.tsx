import { useAuth } from "@/context/auth-context";
import { getBridgeToken } from "@/lib/token-bridge";
import {
  getDeliveryTracking,
  getPullOutDelivery,
  getPullOutRequests,
  type DeliveryTracking,
  type PullOutRequest,
} from "@/services/skycable";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  CheckCircle2, ChevronLeft, Clock, MapPin,
  Package, RefreshCw, Truck,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

const G      = "#006241";
const G_LIGHT= "#ECFDF5";
const SLATE  = "#111827";
const MUTED  = "#667085";
const BORDER = "#E7ECF2";
const WHITE  = "#FFFFFF";
const BG     = "#F8FAFC";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDT(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  const h = d.getUTCHours(), mi = String(d.getUTCMinutes()).padStart(2, "0");
  const mo = MONTHS[d.getUTCMonth()], dy = d.getUTCDate();
  return `${mo} ${dy} · ${h % 12 || 12}:${mi} ${h >= 12 ? "PM" : "AM"}`;
}

// ── Status steps ──────────────────────────────────────────────────────────────
const STEPS = [
  { key: "pending",    label: "Request Submitted",    sub: "Waiting for TelcoVantage approval" },
  { key: "approved",   label: "Approved",             sub: "Driver being assigned" },
  { key: "dispatched", label: "Picked Up · In Transit", sub: "Driver is on the way" },
  { key: "delivered",  label: "Delivered",            sub: "Stock received at TelcoVantage" },
];

const STATUS_ORDER = ["pending", "approved", "dispatched", "delivered"];

function stepIndex(status: string) {
  const idx = STATUS_ORDER.indexOf(status);
  return idx === -1 ? 0 : idx;
}

// ── Driver map (Leaflet) ──────────────────────────────────────────────────────
function DriverMap({ lat, lng, toName }: { lat: number; lng: number; toName: string }) {
  const html = `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>html,body,#map{margin:0;padding:0;height:100%;width:100%;}</style>
  </head><body><div id="map"></div><script>
  var map = L.map('map',{zoomControl:true,attributionControl:false}).setView([${lat},${lng}],15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  var icon = L.divIcon({
    html:'<div style="background:#006241;width:36px;height:36px;border-radius:50%;border:3px solid white;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:18px;">🚚</div>',
    iconSize:[36,36],iconAnchor:[18,18],className:''
  });
  L.marker([${lat},${lng}],{icon}).addTo(map).bindPopup('Driver is here').openPopup();
  </script></body></html>`;

  return (
    <View style={dm.container}>
      <WebView
        source={{ html }}
        style={dm.map}
        scrollEnabled={false}
        javaScriptEnabled
      />
      <View style={dm.overlay}>
        <Truck size={12} color={G} />
        <Text style={dm.overlayTxt}>Driver live location</Text>
        <View style={dm.liveDot} />
      </View>
    </View>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function TransferTrackingScreen() {
  const router  = useRouter();
  const { token } = useAuth();
  const { pullOutId } = useLocalSearchParams<{ pullOutId: string }>();

  const [pullOut,   setPullOut]   = useState<PullOutRequest | null>(null);
  const [tracking,  setTracking]  = useState<DeliveryTracking | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const authToken = getBridgeToken() ?? token ?? "";
    try {
      // Get the pull-out request
      const requests = await getPullOutRequests(authToken);
      const req = requests.find(r => r.id === Number(pullOutId)) ?? null;
      setPullOut(req);

      // Get linked delivery + driver location
      if (req) {
        const delivery = await getPullOutDelivery(authToken, req.id);
        if (delivery?.id) {
          const t = await getDeliveryTracking(authToken, delivery.id);
          setTracking(t);
        }
      }
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, pullOutId]);

  useEffect(() => {
    load();
    // Poll every 20s when in transit
    pollRef.current = setInterval(() => load(), 20_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const currentStep = stepIndex(pullOut?.status ?? "pending");
  const isRejected  = pullOut?.status === "rejected";
  const driverLoc   = tracking?.driver_location;
  const delivery    = tracking?.delivery;

  if (loading) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color={G} />
        <Text style={s.loadingTxt}>Loading tracking info…</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={s.container}>

        {/* ── Header ── */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Transfer Tracking</Text>
            <Text style={s.subtitle}>
              {pullOut?.warehouse?.name ?? `Request #${pullOutId}`}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => { setRefreshing(true); load(); }}
            style={s.refreshBtn}
          >
            <RefreshCw size={16} color={G} style={refreshing ? { opacity: 0.4 } : undefined} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* ── Live driver map ── */}
          {driverLoc ? (
            <DriverMap
              lat={driverLoc.latitude}
              lng={driverLoc.longitude}
              toName={pullOut?.toWarehouse?.name ?? "Main Warehouse"}
            />
          ) : (
            <View style={s.noMap}>
              <Truck size={32} color="#CBD5E1" />
              <Text style={s.noMapTxt}>
                {pullOut?.status === "dispatched"
                  ? "Waiting for driver GPS signal…"
                  : "Map available once driver is dispatched"}
              </Text>
            </View>
          )}

          {/* ── Status timeline ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Delivery Status</Text>

            {isRejected ? (
              <View style={s.rejectedBox}>
                <Text style={s.rejectedTxt}>Request Rejected</Text>
                <Text style={s.rejectedSub}>TelcoVantage declined this transfer request.</Text>
              </View>
            ) : (
              STEPS.map((step, idx) => {
                const done    = idx < currentStep;
                const active  = idx === currentStep;
                const pending = idx > currentStep;
                const color   = done || active ? G : "#CBD5E1";

                return (
                  <View key={step.key} style={s.stepRow}>
                    {/* Line */}
                    <View style={s.stepLeft}>
                      <View style={[s.stepDot, { backgroundColor: done ? G : active ? G : "#E2E8F0", borderColor: done || active ? G : "#CBD5E1" }]}>
                        {done
                          ? <CheckCircle2 size={14} color={WHITE} />
                          : active
                            ? <View style={s.stepDotInner} />
                            : null}
                      </View>
                      {idx < STEPS.length - 1 && (
                        <View style={[s.stepLine, { backgroundColor: done ? G : "#E2E8F0" }]} />
                      )}
                    </View>
                    {/* Text */}
                    <View style={s.stepContent}>
                      <Text style={[s.stepLabel, { color: pending ? MUTED : SLATE }]}>{step.label}</Text>
                      {active && <Text style={s.stepSub}>{step.sub}</Text>}
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* ── Driver info ── */}
          {delivery?.driver && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Driver</Text>
              <View style={s.driverRow}>
                <View style={s.driverAvatar}>
                  <Truck size={20} color={G} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.driverName}>{delivery.driver.name}</Text>
                  {driverLoc?.pinged_at && (
                    <Text style={s.driverLastSeen}>
                      Last seen: {fmtDT(driverLoc.pinged_at)}
                    </Text>
                  )}
                </View>
                {driverLoc && (
                  <View style={s.liveBadge}>
                    <View style={s.liveDot} />
                    <Text style={s.liveTxt}>Live</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* ── Items ── */}
          {pullOut?.items && pullOut.items.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Items</Text>
              {pullOut.items.map((it, i) => (
                <View key={i} style={[s.itemRow, i < pullOut.items!.length - 1 && s.itemBorder]}>
                  <Package size={14} color={MUTED} />
                  <Text style={s.itemTxt}>{it.item_type}</Text>
                  <Text style={s.itemQty}>{parseFloat(String(it.quantity))}{it.item_type === "cable" ? " m" : " pcs"}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Meta ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Request Info</Text>
            <View style={s.metaRow}>
              <Text style={s.metaKey}>Submitted</Text>
              <Text style={s.metaVal}>{pullOut?.created_at ? fmtDT(pullOut.created_at) : "—"}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaKey}>From</Text>
              <Text style={s.metaVal}>{pullOut?.warehouse?.name ?? "—"}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaKey}>To</Text>
              <Text style={s.metaVal}>{pullOut?.toWarehouse?.name ?? "Main Warehouse"}</Text>
            </View>
            {pullOut?.notes && (
              <View style={s.metaRow}>
                <Text style={s.metaKey}>Notes</Text>
                <Text style={s.metaVal}>{pullOut.notes}</Text>
              </View>
            )}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: BG },
  center:      { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: BG, gap: 12 },
  loadingTxt:  { fontSize: 13, color: MUTED, fontWeight: "600" },

  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  backBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  refreshBtn:  { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: G_LIGHT },
  title:       { fontSize: 20, fontWeight: "900", color: SLATE },
  subtitle:    { fontSize: 12, color: MUTED, fontWeight: "600" },

  scroll:      { padding: 16, gap: 14 },

  noMap:       { height: 160, backgroundColor: WHITE, borderRadius: 18, borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center", gap: 10 },
  noMapTxt:    { fontSize: 13, color: MUTED, fontWeight: "600", textAlign: "center", paddingHorizontal: 24 },

  card:        { backgroundColor: WHITE, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: BORDER, gap: 12 },
  cardTitle:   { fontSize: 11, fontWeight: "900", color: MUTED, textTransform: "uppercase", letterSpacing: 1 },

  // Timeline
  stepRow:     { flexDirection: "row", gap: 12, minHeight: 48 },
  stepLeft:    { alignItems: "center", width: 24 },
  stepDot:     { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  stepDotInner:{ width: 8, height: 8, borderRadius: 4, backgroundColor: G },
  stepLine:    { flex: 1, width: 2, marginVertical: 3 },
  stepContent: { flex: 1, paddingTop: 2, paddingBottom: 10 },
  stepLabel:   { fontSize: 14, fontWeight: "800" },
  stepSub:     { fontSize: 12, color: MUTED, fontWeight: "500", marginTop: 2 },

  rejectedBox: { backgroundColor: "#FEF2F2", borderRadius: 12, padding: 14, gap: 4 },
  rejectedTxt: { fontSize: 14, fontWeight: "900", color: "#ef4444" },
  rejectedSub: { fontSize: 12, color: "#ef4444", fontWeight: "500" },

  // Driver
  driverRow:   { flexDirection: "row", alignItems: "center", gap: 12 },
  driverAvatar:{ width: 44, height: 44, borderRadius: 22, backgroundColor: G_LIGHT, alignItems: "center", justifyContent: "center" },
  driverName:  { fontSize: 15, fontWeight: "800", color: SLATE },
  driverLastSeen:{ fontSize: 11, color: MUTED, fontWeight: "500", marginTop: 2 },
  liveBadge:   { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#ECFDF5", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  liveDot:     { width: 7, height: 7, borderRadius: 4, backgroundColor: G },
  liveTxt:     { fontSize: 11, fontWeight: "900", color: G },

  // Items
  itemRow:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  itemBorder:  { borderBottomWidth: 1, borderBottomColor: BORDER },
  itemTxt:     { flex: 1, fontSize: 13, fontWeight: "700", color: SLATE, textTransform: "capitalize" },
  itemQty:     { fontSize: 13, fontWeight: "800", color: G },

  // Meta
  metaRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 4 },
  metaKey:     { fontSize: 12, fontWeight: "700", color: MUTED, width: 80 },
  metaVal:     { flex: 1, fontSize: 12, fontWeight: "600", color: SLATE, textAlign: "right" },
});

const dm = StyleSheet.create({
  container: { height: 220, borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: BORDER },
  map:       { flex: 1 },
  overlay:   { position: "absolute", top: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: WHITE + "EE", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  overlayTxt:{ fontSize: 11, fontWeight: "700", color: SLATE },
  liveDot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: G },
});
