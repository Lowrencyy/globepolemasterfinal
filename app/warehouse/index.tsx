/**
 * Warehouse — Staging management for teardown deliveries.
 *
 * Warehouse in-charge can:
 *  • See all pending/active deliveries with their tokens
 *  • Advance each delivery to the next stage
 *  • Mark as SOLD or PULL OUT
 *  • View blockchain-style movement history per delivery
 *  • See cumulative stocks from all approved deliveries
 */
import { useAuth } from "@/context/auth-context";
import { cacheGet, cacheSet } from "@/lib/cache";
import {
  DELIVERY_DISPLAY,
  MOCK_COLLECTED_TOTALS,
  MOCK_DELIVERIES,
  MOCK_TOTAL_STOCKS,
  MOCK_WAREHOUSE_STOCKS,
  type MockDelivery,
  type MockWarehouseStock,
} from "@/lib/mock-deliveries";
import {
  getBackendDeliveries,
  getPickupRequests,
  getTeardownLogs,
  getWarehouses,
  getWarehouseStocks,
  stocksToTotals,
  sumTeardownLogs,
  type BackendDelivery,
  type CollectedTotals,
  type PickupRequest,
} from "@/services/skycable";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import {
  Award, ChevronLeft, Package, PackageCheck,
  RefreshCw, Truck, Warehouse as WIcon,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator, FlatList,
  RefreshControl, StyleSheet,
  Text, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G = "#0B7A5A";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";
const WHITE = "#FFFFFF";

function fmtDT(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  const h = d.getUTCHours(), mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${h % 12 || 12}:${mi}${h >= 12 ? "PM" : "AM"}`;
}

// ── Delivery row card (unified mock + backend) ────────────────────────────────
function DeliveryCard({ item }: { item: MockDelivery }) {
  const display = DELIVERY_DISPLAY[item.status] ?? { label: item.status, color: "#64748b" };
  const { color, label } = display;
  const isDone = item.status === "accepted";

  return (
    <View style={[dw.card, !isDone && { opacity: 0.92 }]}>
      <View style={[dw.accent, { backgroundColor: color }]} />
      <View style={dw.inner}>
        <View style={dw.topRow}>
          <Text style={dw.token}>{item.token}</Text>
          <Text style={dw.date}>{item.date}</Text>
        </View>
        <View style={[dw.badge, { backgroundColor: color + "18" }]}>
          <View style={[dw.dot, { backgroundColor: color }]} />
          <Text style={[dw.badgeTxt, { color }]}>{label}</Text>
        </View>
        <Text style={dw.org} numberOfLines={1}>🏢 {item.organization}</Text>
        <View style={dw.grid}>
          {[
            { l: "Cable", v: item.total_cable, u: "m"  },
            { l: "Node",  v: item.total_node,  u: ""   },
            { l: "Amp",   v: item.total_amplifier, u: ""},
            { l: "TSC",   v: item.total_tsc,   u: ""   },
          ].map(x => (
            <Text key={x.l} style={dw.gridItem}>
              <Text style={dw.gridLbl}>{x.l} </Text>
              <Text style={dw.gridVal}>{x.v > 0 ? `${x.v}${x.u}` : "—"}</Text>
            </Text>
          ))}
        </View>
        <Text style={dw.person}>
          👤 {item.delivered_by}{isDone && item.approved_by !== "—" ? `  ✅ ${item.approved_by}` : ""}
        </Text>
      </View>
    </View>
  );
}

const CACHE_TOTALS   = "wh_collected_totals_v1";
const CACHE_STOCKS   = "wh_warehouse_stocks_v1";
const CACHE_DELIVERY = "wh_backend_deliveries_v1";
const CACHE_PICKUP   = "wh_pickup_requests_v1";

// ── Main ──────────────────────────────────────────────────────────────────────
export default function WarehouseScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [totals,      setTotals]      = useState<CollectedTotals>(MOCK_COLLECTED_TOTALS);
  const [stocks,      setStocks]      = useState<CollectedTotals>(MOCK_TOTAL_STOCKS);
  const [whStocks,    setWhStocks]    = useState<MockWarehouseStock[]>(MOCK_WAREHOUSE_STOCKS);
  const [mockDeliveries, setMockDeliveries] = useState<MockDelivery[]>(MOCK_DELIVERIES);
  const [deliveries,  setDeliveries]  = useState<BackendDelivery[]>([]);
  const [pickups,     setPickups]     = useState<PickupRequest[]>([]);
  const [loading,     setLoading]     = useState(false); // mock data loads instantly
  const [refreshing,  setRefreshing]  = useState(false);
  const [tab,         setTab]         = useState<"active" | "done">("active");

  const load = useCallback(async (silent = false) => {
    if (!token) { setLoading(false); return; }

    if (!silent) {
      const [ct, cs, cd, cp] = await Promise.all([
        cacheGet<CollectedTotals>(CACHE_TOTALS),
        cacheGet<CollectedTotals>(CACHE_STOCKS),
        cacheGet<BackendDelivery[]>(CACHE_DELIVERY),
        cacheGet<PickupRequest[]>(CACHE_PICKUP),
      ]);
      if (ct) setTotals(ct);
      if (cs) setStocks(cs);
      if (cd) setDeliveries(cd);
      if (cp) setPickups(cp);
    }

    try {
      const [logs, delivs, reqs, warehouses] = await Promise.allSettled([
        getTeardownLogs(token),
        getBackendDeliveries(token),
        getPickupRequests(token),
        getWarehouses(token),
      ]);

      // Collected totals from approved teardowns (fall back to mock totals)
      if (logs.status === "fulfilled" && logs.value.length > 0) {
        const approved = logs.value.filter(l => l.status === "backend_approved");
        const t = sumTeardownLogs(approved);
        setTotals(t);
        cacheSet(CACHE_TOTALS, t).catch(() => {});
      }

      // Backend deliveries (merge with mock if API returns empty)
      if (delivs.status === "fulfilled") {
        const d = delivs.value.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
        setDeliveries(d);
        cacheSet(CACHE_DELIVERY, d).catch(() => {});
      }

      if (reqs.status === "fulfilled") {
        setPickups(reqs.value);
        cacheSet(CACHE_PICKUP, reqs.value).catch(() => {});
      }

      // Warehouse stocks from API, fall back to mock-computed stocks
      if (warehouses.status === "fulfilled" && warehouses.value.length > 0) {
        const wh = warehouses.value[0];
        const apiStocks = await getWarehouseStocks(token, wh.id);
        if (apiStocks.length > 0) {
          const s = stocksToTotals(apiStocks);
          setStocks(s);
          cacheSet(CACHE_STOCKS, s).catch(() => {});
        }
      }
    } catch {}
    finally { setRefreshing(false); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Use mock deliveries when backend returns nothing
  const displayDeliveries: MockDelivery[] = deliveries.length > 0
    ? deliveries.map(d => ({
        id: d.id, token: `#${d.id}`, date: d.dispatched_at?.slice(0,10) ?? new Date().toISOString().slice(0,10),
        status: d.status, organization: "Backend Delivery", delivered_by: "—", approved_by: "—",
        received_at: d.accepted_at ?? d.dispatched_at ?? "", current_location: "", received_image_uri: null,
        total_cable: 0, total_node: 0, total_amplifier: 0, total_extender: 0,
        total_tsc: 0, total_psu: 0, total_psu_case: 0, teardown_count: 0, movements: [],
      }))
    : mockDeliveries;

  const pending  = displayDeliveries.filter(d => d.status === "submitted" || d.status === "pending_pickup");
  const transit  = displayDeliveries.filter(d => d.status === "in_transit");
  const done     = displayDeliveries.filter(d => d.status === "accepted");
  const shown    = tab === "active" ? [...pending, ...transit] : done;

  const acceptedCount = done.length;
  const pullOutCount  = pickups.filter(p => p.status === "pending").length || pending.length;
  const receivedCount = pickups.filter(p => p.status === "approved").length || done.length;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>
          <View style={s.headerText}>
            <Text style={s.title}>Warehouse</Text>
            <Text style={s.subtitle}>Staging & inventory management</Text>
          </View>
          <TouchableOpacity onPress={() => { setRefreshing(true); load(true); }} style={s.iconBtn}>
            <RefreshCw size={18} color={G} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={G} /></View>
        ) : (
          <FlatList
            data={shown}
            keyExtractor={d => String(d.id)}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} colors={[G]} />}
            ListHeaderComponent={
              <>
                {/* ── Collected Items stats ── */}
                <View style={s.statsSection}>
                  <Text style={s.statsEyebrow}>RUNNING TOTALS · BACKEND APPROVED</Text>
                  <Text style={s.statsTitle}>Collected Items</Text>

                  <View style={s.statsGrid}>
                    {[
                      { label: "Cable",     value: totals.cable,     unit: "m", color: "#059669", bg: "#ECFDF5" },
                      { label: "Node",      value: totals.node,      unit: "",  color: "#2563EB", bg: "#EFF6FF" },
                      { label: "Amplifier", value: totals.amplifier, unit: "",  color: "#7C3AED", bg: "#F5F3FF" },
                      { label: "Extender",  value: totals.extender,  unit: "",  color: "#0891B2", bg: "#ECFEFF" },
                      { label: "TSC",       value: totals.tsc,       unit: "",  color: "#D97706", bg: "#FFFBEB" },
                      { label: "PSU",       value: totals.psu,       unit: "",  color: "#DC2626", bg: "#FEF2F2" },
                      { label: "PSU Case",  value: totals.psuCase,   unit: "",  color: "#475569", bg: "#F8FAFC" },
                    ].map(item => (
                      <View key={item.label} style={[s.statsGridItem, { borderColor: item.color + "22" }]}>
                        <View style={[s.statsGridBar, { backgroundColor: item.bg }]}>
                          <View style={[s.statsGridDot, { backgroundColor: item.color }]} />
                        </View>
                        <Text style={[s.statsGridVal, { color: item.color }]}>
                          {`${item.value}${item.unit}`}
                        </Text>
                        <Text style={s.statsGridLbl}>{item.label}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Delivery / pickup status row */}
                  <View style={s.deliveryRow}>
                    {[
                      { icon: <PackageCheck size={18} color="#059669" />, bg: "#ECFDF5", border: "#059669", value: acceptedCount, label: "Delivery\nAccepted",  color: "#059669" },
                      { icon: <Truck        size={18} color="#EF4444" />, bg: "#FEF2F2", border: "#EF4444", value: pullOutCount,  label: "Request\nPull Out",   color: "#EF4444" },
                      { icon: <Award        size={18} color="#2563EB" />, bg: "#EFF6FF", border: "#2563EB", value: receivedCount, label: "Request\nReceived",   color: "#2563EB" },
                    ].map(item => (
                      <View key={item.label} style={[s.deliveryBox, { borderColor: item.border + "30" }]}>
                        <View style={[s.deliveryIconWrap, { backgroundColor: item.bg }]}>{item.icon}</View>
                        <Text style={[s.deliveryVal, { color: item.color }]}>{item.value}</Text>
                        <Text style={s.deliveryLbl}>{item.label}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Per-warehouse stock breakdown */}
                  {whStocks.length > 0 && (
                    <View style={s.whBreakdown}>
                      <Text style={s.whBreakdownTitle}>WAREHOUSE BREAKDOWN</Text>
                      {whStocks.map(wh => (
                        <View key={wh.warehouse} style={s.whRow}>
                          <View style={s.whRowLeft}>
                            <WIcon size={12} color={G} />
                            <Text style={s.whName} numberOfLines={1}>{wh.warehouse}</Text>
                          </View>
                          <Text style={s.whItems}>
                            {wh.cable}m · {wh.node} nodes · {wh.amplifier} amp · {wh.psu} PSU
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Tab bar */}
                <View style={s.tabs}>
                  {(["active", "done"] as const).map(t => (
                    <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
                      <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>
                        {t === "active"
                          ? `Pending / Transit (${pending.length + transit.length})`
                          : `Completed (${done.length})`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            }
            renderItem={({ item }) => (
              <DeliveryCard item={item} />
            )}
            ListEmptyComponent={
              <View style={s.empty}>
                <Package size={44} color="#CBD5E1" />
                <Text style={s.emptyTxt}>
                  {tab === "active" ? "No pending or in-transit deliveries" : "No completed deliveries yet"}
                </Text>
              </View>
            }
          />
        )}

      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  header:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  backBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#F0FDF4" },
  headerText: { flex: 1 },
  title:     { fontSize: 20, fontWeight: "900", color: SLATE },
  subtitle:  { fontSize: 12, color: MUTED, fontWeight: "600" },
  center:    { flex: 1, alignItems: "center", justifyContent: "center" },
  list:      { padding: 16, gap: 10, paddingBottom: 48 },
  statsSection:   { marginBottom: 16 },
  statsEyebrow:   { fontSize: 11, fontWeight: "800", color: "#2563EB", letterSpacing: 0.5, marginBottom: 2 },
  statsTitle:     { fontSize: 22, fontWeight: "900", color: SLATE, marginBottom: 14 },
  statsGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  statsGridItem:  { flex: 1, minWidth: 80, backgroundColor: WHITE, borderRadius: 16, borderWidth: 1.5, overflow: "hidden", shadowColor: "#0F172A", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  statsGridBar:   { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4, flexDirection: "row", alignItems: "center" },
  statsGridDot:   { width: 7, height: 7, borderRadius: 4 },
  statsGridVal:   { fontSize: 20, fontWeight: "900", paddingHorizontal: 10, paddingTop: 2 },
  statsGridLbl:   { fontSize: 9, fontWeight: "800", color: "#94A3B8", paddingHorizontal: 10, paddingBottom: 10, textTransform: "uppercase" as any, letterSpacing: 0.4, marginTop: 2 },
  deliveryRow:    { flexDirection: "row", gap: 10, marginBottom: 4 },
  deliveryBox:    { flex: 1, backgroundColor: WHITE, borderRadius: 18, borderWidth: 1.5, padding: 14, alignItems: "center", shadowColor: "#0F172A", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2, gap: 6 },
  deliveryIconWrap:{ width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  deliveryVal:    { fontSize: 24, fontWeight: "900" },
  deliveryLbl:    { fontSize: 10, fontWeight: "700", color: "#94A3B8", textAlign: "center", textTransform: "uppercase" as any, letterSpacing: 0.3, lineHeight: 14 },
  stockSub:       { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#ECFDF5", borderRadius: 10, padding: 10, marginTop: 4 },
  stockSubTxt:    { fontSize: 11, fontWeight: "700", color: G, flex: 1 },
  whBreakdown:    { marginTop: 12, backgroundColor: "#F8FAFC", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: BORDER, gap: 8 },
  whBreakdownTitle: { fontSize: 9, fontWeight: "900", color: MUTED, letterSpacing: 1, marginBottom: 4 },
  whRow:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  whRowLeft:      { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  whName:         { fontSize: 12, fontWeight: "800", color: SLATE, flex: 1 },
  whItems:        { fontSize: 11, fontWeight: "600", color: MUTED },
  tabs:      { flexDirection: "row", backgroundColor: "#F1F5F9", borderRadius: 14, padding: 4, marginBottom: 14 },
  tab:       { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center" },
  tabActive: { backgroundColor: WHITE, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  tabTxt:    { fontSize: 12, fontWeight: "700", color: MUTED },
  tabTxtActive: { color: SLATE, fontWeight: "900" },
  empty:     { alignItems: "center", paddingTop: 40, gap: 10 },
  emptyTxt:  { fontSize: 15, fontWeight: "700", color: MUTED },
});

const dw = StyleSheet.create({
  card:     { flexDirection: "row", alignItems: "center", backgroundColor: WHITE, borderRadius: 18, paddingLeft: 0, paddingRight: 12, paddingVertical: 12, borderWidth: 1, borderColor: BORDER, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  accent:   { width: 4, alignSelf: "stretch", borderTopLeftRadius: 18, borderBottomLeftRadius: 18, marginRight: 12 },
  inner:    { flex: 1, gap: 6 },
  topRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tokenWrap: { flexDirection: "row", alignItems: "center", gap: 3 },
  token:    { fontSize: 13, fontWeight: "900", color: SLATE },
  date:     { fontSize: 10, color: MUTED, fontWeight: "600" },
  badge:    { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
  dot:      { width: 5, height: 5, borderRadius: 3 },
  badgeTxt: { fontSize: 10, fontWeight: "800" },
  loc:      { fontSize: 10, color: MUTED, fontWeight: "600" },
  org:      { fontSize: 11, color: "#2563EB", fontWeight: "700", marginBottom: 4 },
  grid:     { flexDirection: "row", gap: 10, flexWrap: "wrap", marginBottom: 4 },
  gridItem: { fontSize: 11, color: SLATE },
  gridLbl:  { color: MUTED },
  gridVal:  { fontWeight: "900" },
  person:   { fontSize: 11, color: MUTED, fontWeight: "600" },
});

