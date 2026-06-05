import { useAuth } from "@/context/auth-context";
import { getBridgeToken } from "@/lib/token-bridge";
import {
  createPullOutRequest,
  getDrivers,
  getPullOutRequests,
  getWarehouses,
  getWarehouseStocks,
  stocksToTotals,
  type CollectedTotals,
  type DriverUser,
  type PullOutRequest,
  type Warehouse,
} from "@/services/skycable";
import { Stack, useRouter } from "expo-router";
import {
  ArrowRight, ChevronLeft, ClipboardList, PackageCheck,
  PlusCircle, Send, Truck, Warehouse as WIcon,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G      = "#006241";
const GDARK  = "#004d30";
const G_LIGHT= "#ECFDF5";
const MUTED  = "#667085";
const BORDER = "#E7ECF2";
const WHITE  = "#FFFFFF";
const BG     = "#F8FAFC";
const SLATE  = "#111827";

const ITEM_META: Record<string, { label: string; color: string; bg: string; unit: string }> = {
  cable:       { label: "Cable",     color: "#059669", bg: "#ECFDF5", unit: "m"   },
  node:        { label: "Node",      color: "#0b6cff", bg: "#EFF6FF", unit: "pcs" },
  amplifier:   { label: "Amplifier", color: "#8b5cf6", bg: "#F5F3FF", unit: "pcs" },
  extender:    { label: "Extender",  color: "#10b981", bg: "#ECFDF5", unit: "pcs" },
  tsc:         { label: "TSC",       color: "#f59e0b", bg: "#FFFBEB", unit: "pcs" },
  powersupply: { label: "PSU",       color: "#ef4444", bg: "#FEF2F2", unit: "pcs" },
};
const ITEM_KEYS = Object.keys(ITEM_META);

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function emptyQuantities() {
  return {
    cable: "0",
    node: "0",
    amplifier: "0",
    extender: "0",
    tsc: "0",
    powersupply: "0",
  };
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: "Pending Approval", color: "#f59e0b", bg: "#FFFBEB" },
  approved:   { label: "Approved",         color: "#059669", bg: "#ECFDF5" },
  dispatched: { label: "In Transit",       color: "#0b6cff", bg: "#EFF6FF" },
  delivered:  { label: "Delivered",        color: "#059669", bg: "#ECFDF5" },
  rejected:   { label: "Rejected",         color: "#ef4444", bg: "#FEF2F2" },
};

// ── History card ──────────────────────────────────────────────────────────────
function RequestCard({ req, onTrack }: { req: PullOutRequest; onTrack: (r: PullOutRequest) => void }) {
  const sm = STATUS_META[req.status] ?? STATUS_META.pending;
  const canTrack = req.status === "dispatched" || req.status === "approved";

  return (
    <TouchableOpacity
      style={hc.card}
      onPress={() => canTrack && onTrack(req)}
      activeOpacity={canTrack ? 0.75 : 1}
    >
      <View style={hc.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={hc.from} numberOfLines={1}>
            {req.warehouse?.name ?? `WH #${req.warehouse_id}`}
          </Text>
          <View style={hc.routeRow}>
            <Text style={hc.routeLabel}>FROM</Text>
            <Text style={hc.routeValue} numberOfLines={1}>
              {req.warehouse?.name ?? `WH #${req.warehouse_id}`}
            </Text>
          </View>
          <View style={hc.routeRow}>
            <Text style={hc.routeLabel}>TO</Text>
            <Text style={hc.routeValue} numberOfLines={1}>
              {req.toWarehouse?.name ?? (req.to_warehouse_id ? `WH #${req.to_warehouse_id}` : "No destination")}
            </Text>
          </View>
          <Text style={hc.date}>{fmtDate(req.created_at)}</Text>
        </View>
        <View style={[hc.badge, { backgroundColor: sm.bg, borderColor: sm.color + "50" }]}>
          <View style={[hc.dot, { backgroundColor: sm.color }]} />
          <Text style={[hc.badgeTxt, { color: sm.color }]}>{sm.label}</Text>
        </View>
      </View>

      {/* Items summary */}
      {req.items && req.items.length > 0 && (
        <View style={hc.itemsRow}>
          {req.items.map((it, i) => {
            const meta = ITEM_META[it.item_type];
            return (
              <View key={i} style={[hc.itemChip, { borderColor: (meta?.color ?? MUTED) + "30" }]}>
                <Text style={[hc.itemVal, { color: meta?.color ?? MUTED }]}>
                  {parseFloat(String(it.quantity))}{it.item_type === "cable" ? "m" : ""}
                </Text>
                <Text style={hc.itemLbl}>{meta?.label ?? it.item_type}</Text>
              </View>
            );
          })}
        </View>
      )}

      {canTrack && (
        <View style={hc.trackBtn}>
          <Text style={hc.trackTxt}>Track Delivery →</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PullOutScreen() {
  const router    = useRouter();
  const { token } = useAuth();

  const [tab, setTab] = useState<"request" | "history">("request");

  // ─ Request form state ─
  const [warehouses,    setWarehouses]    = useState<Warehouse[]>([]);
  const [drivers,       setDrivers]       = useState<DriverUser[]>([]);
  const [fromWarehouse, setFromWarehouse] = useState<Warehouse | null>(null);
  const [toWarehouse,   setToWarehouse]   = useState<Warehouse | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);
  const [stocks,        setStocks]        = useState<CollectedTotals>({ cable: 0, node: 0, amplifier: 0, extender: 0, tsc: 0, psu: 0, psuCase: 0 });
  const [quantities,    setQuantities]    = useState<Record<string, string>>(emptyQuantities());
  const [notes,         setNotes]         = useState("");
  const [loading,       setLoading]       = useState(true);
  const [submitting,    setSubmitting]    = useState(false);

  // ─ History state ─
  const [requests,      setRequests]      = useState<PullOutRequest[]>([]);
  const [histLoading,   setHistLoading]   = useState(false);
  const [histRefreshing,setHistRefreshing]= useState(false);

  const loadStocks = useCallback(async (warehouseId: number) => {
    const authToken = getBridgeToken() ?? token ?? "";
    const stk = await getWarehouseStocks(authToken, warehouseId);
    const t = stocksToTotals(stk);
    setStocks(t);
    setQuantities({
      cable:       String(t.cable),
      node:        String(t.node),
      amplifier:   String(t.amplifier),
      extender:    String(t.extender),
      tsc:         String(t.tsc),
      powersupply: String(t.psu),
    });
  }, [token]);

  // Load warehouses on mount
  useEffect(() => {
    (async () => {
      const authToken = getBridgeToken() ?? token ?? "";
      try {
        const [whs, drvs] = await Promise.all([
          getWarehouses(authToken),
          getDrivers(authToken),
        ]);
        setWarehouses(whs);
        setDrivers(drvs);
        setSelectedDriverId(drvs[0]?.id ?? null);

        const nonMain = whs.filter(w => w.type !== "main");
        const source = nonMain[0] ?? whs[0] ?? null;
        const destination =
          whs.find(w => w.type === "main" && w.id !== source?.id)
          ?? whs.find(w => w.id !== source?.id)
          ?? null;

        setFromWarehouse(source);
        setToWarehouse(destination);

        if (source) {
          await loadStocks(source.id);
        }
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "Could not load stocks.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, loadStocks]);

  useEffect(() => {
    if (!fromWarehouse) {
      setStocks({ cable: 0, node: 0, amplifier: 0, extender: 0, tsc: 0, psu: 0, psuCase: 0 });
      setQuantities(emptyQuantities());
      return;
    }
    loadStocks(fromWarehouse.id).catch(() => {});
  }, [fromWarehouse?.id, loadStocks]);

  const loadHistory = useCallback(async () => {
    const authToken = getBridgeToken() ?? token ?? "";
    setHistLoading(true);
    try {
      const data = await getPullOutRequests(authToken);
      setRequests(data.sort((a, b) => b.id - a.id));
    } finally {
      setHistLoading(false);
      setHistRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab]);

  const stockMap: Record<string, number> = {
    cable: stocks.cable, node: stocks.node, amplifier: stocks.amplifier,
    extender: stocks.extender, tsc: stocks.tsc, powersupply: stocks.psu,
  };
  const sourceChoices = useMemo(
    () => warehouses.filter(w => w.id !== toWarehouse?.id),
    [warehouses, toWarehouse?.id]
  );
  const destinationChoices = useMemo(
    () => warehouses.filter(w => w.id !== fromWarehouse?.id),
    [warehouses, fromWarehouse?.id]
  );

  async function handleSubmit() {
    if (!fromWarehouse || !toWarehouse) {
      Alert.alert("Warehouse Required", "Select both source and destination warehouse.");
      return;
    }
    if (!selectedDriverId) {
      Alert.alert("Driver Required", "Select the driver who will handle this delivery before submitting.");
      return;
    }
    if (fromWarehouse.id === toWarehouse.id) {
      Alert.alert("Invalid Route", "Source and destination warehouse must be different.");
      return;
    }

    const items = ITEM_KEYS
      .map(k => ({ item_type: k, quantity: parseFloat(quantities[k] ?? "0") || 0, unit: ITEM_META[k]?.unit ?? "pcs" }))
      .filter(i => i.quantity > 0);

    if (items.length === 0) {
      Alert.alert("Nothing to Transfer", "Set at least one quantity above 0.");
      return;
    }
    const over = items.find(i => i.quantity > (stockMap[i.item_type] ?? 0));
    if (over) {
      Alert.alert("Exceeds Stock", `${ITEM_META[over.item_type]?.label} quantity exceeds available stock.`);
      return;
    }

    Alert.alert(
      "Confirm Transfer",
      `Send ${items.length} item type${items.length > 1 ? "s" : ""} from ${fromWarehouse.name} to ${toWarehouse.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          onPress: async () => {
            setSubmitting(true);
            try {
              const authToken = getBridgeToken() ?? token ?? "";
              await createPullOutRequest(authToken, {
                warehouse_id:    fromWarehouse.id,
                to_warehouse_id: toWarehouse.id,
                driver_id:       selectedDriverId,
                items,
                notes: notes.trim() || undefined,
              });
              setNotes("");
              Alert.alert(
                "Transfer Requested",
                "Your delivery request with assigned driver has been submitted and will appear in Delivery Logs.",
                [{
                  text: "View Logs",
                  onPress: () => setTab("history"),
                }]
              );
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "Submission failed.");
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  }

  function handleTrack(req: PullOutRequest) {
    router.push({
      pathname: "/warehouse/transfer-tracking",
      params: { pullOutId: String(req.id) },
    });
  }

  // ── Loading ──
  if (loading) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color={G} />
        <Text style={s.loadingTxt}>Loading stock…</Text>
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
            <Text style={s.title}>Transfer Stock</Text>
            <Text style={s.subtitle}>Pull-out to TelcoVantage</Text>
          </View>
        </View>

        {/* ── Tab bar ── */}
        <View style={s.tabBar}>
          <TouchableOpacity
            style={[s.tabBtn, tab === "request" && s.tabBtnActive]}
            onPress={() => setTab("request")}
          >
            <PlusCircle size={14} color={tab === "request" ? G : MUTED} />
            <Text style={[s.tabTxt, tab === "request" && s.tabTxtActive]}>New Request</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tabBtn, tab === "history" && s.tabBtnActive]}
            onPress={() => setTab("history")}
          >
            <ClipboardList size={14} color={tab === "history" ? G : MUTED} />
            <Text style={[s.tabTxt, tab === "history" && s.tabTxtActive]}>Delivery Logs</Text>
          </TouchableOpacity>
        </View>

        {/* ── New Request form ── */}
        {tab === "request" && (
          <ScrollView
            contentContainerStyle={s.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Route card */}
            <View style={s.routeCard}>
              <View style={s.routeBox}>
                <Text style={s.routeLabel}>FROM</Text>
                <View style={s.routeIconRow}>
                  <WIcon size={14} color={MUTED} />
                  <Text style={s.routeName} numberOfLines={2}>{fromWarehouse?.name ?? "Select source warehouse"}</Text>
                </View>
              </View>
              <View style={s.routeArrow}>
                <ArrowRight size={18} color={G} />
              </View>
              <View style={s.routeBox}>
                <Text style={[s.routeLabel, { color: G }]}>TO</Text>
                <View style={s.routeIconRow}>
                  <PackageCheck size={14} color={G} />
                  <Text style={[s.routeName, { color: G }]} numberOfLines={2}>{toWarehouse?.name ?? "Select destination warehouse"}</Text>
                </View>
              </View>
            </View>

            <View style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.cardTitle}>Select Warehouse Route</Text>
                <Text style={s.cardSub}>Choose where to load and where to drop the delivery</Text>
              </View>

              <Text style={s.selectorLabel}>Load From</Text>
              <View style={s.selectorWrap}>
                {sourceChoices.map(wh => (
                  <TouchableOpacity
                    key={`from-${wh.id}`}
                    style={[s.selectorChip, fromWarehouse?.id === wh.id && s.selectorChipActive]}
                    onPress={() => {
                      setFromWarehouse(wh);
                      if (toWarehouse?.id === wh.id) {
                        const nextTo = warehouses.find(w => w.id !== wh.id) ?? null;
                        setToWarehouse(nextTo);
                      }
                    }}
                  >
                    <Text style={[s.selectorChipTxt, fromWarehouse?.id === wh.id && s.selectorChipTxtActive]}>
                      {wh.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.selectorLabel}>Drop To</Text>
              <View style={s.selectorWrap}>
                {destinationChoices.map(wh => (
                  <TouchableOpacity
                    key={`to-${wh.id}`}
                    style={[s.selectorChip, toWarehouse?.id === wh.id && s.selectorChipActive]}
                    onPress={() => setToWarehouse(wh)}
                  >
                    <Text style={[s.selectorChipTxt, toWarehouse?.id === wh.id && s.selectorChipTxtActive]}>
                      {wh.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.cardTitle}>Assign Driver</Text>
                <Text style={s.cardSub}>Warehouse in charge selects the driver before sending the request</Text>
              </View>

              {drivers.length === 0 ? (
                <View style={s.noDrivers}>
                  <Truck size={18} color={MUTED} />
                  <Text style={s.noDriversTxt}>No driver role available yet. Ask admin to add a driver in Manage Roles.</Text>
                </View>
              ) : (
                <View style={s.selectorWrap}>
                  {drivers.map(driver => (
                    <TouchableOpacity
                      key={driver.id}
                      style={[s.selectorChip, selectedDriverId === driver.id && s.selectorChipActive]}
                      onPress={() => setSelectedDriverId(driver.id)}
                    >
                      <Text style={[s.selectorChipTxt, selectedDriverId === driver.id && s.selectorChipTxtActive]}>
                        {driver.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Items card */}
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.cardTitle}>Items to Transfer</Text>
                <Text style={s.cardSub}>Quantities are based on the selected source warehouse stock</Text>
              </View>

              {ITEM_KEYS.map((key, idx) => {
                const meta      = ITEM_META[key];
                const available = stockMap[key] ?? 0;
                const qty       = quantities[key] ?? "0";
                const qtyNum    = parseFloat(qty) || 0;
                const overLimit = qtyNum > available;
                const isLast    = idx === ITEM_KEYS.length - 1;

                return (
                  <View key={key} style={[s.itemRow, !isLast && s.itemRowBorder]}>
                    <View style={[s.itemDot, { backgroundColor: meta.bg, borderColor: meta.color + "50" }]}>
                      <Text style={[s.itemDotTxt, { color: meta.color }]}>{meta.label[0]}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemLabel}>{meta.label}</Text>
                      <Text style={[s.itemStock, overLimit && { color: "#ef4444" }]}>
                        {overLimit ? `Max: ${available}` : `Available: ${available}${meta.unit === "m" ? " m" : " pcs"}`}
                      </Text>
                    </View>
                    <View style={s.inputWrap}>
                      <TextInput
                        style={[s.qtyInput, overLimit && s.qtyInputError]}
                        value={qty}
                        onChangeText={v => setQuantities(p => ({ ...p, [key]: v }))}
                        keyboardType="decimal-pad"
                        selectTextOnFocus
                      />
                      <Text style={s.qtyUnit}>{meta.unit}</Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Notes */}
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.cardTitle}>Notes</Text>
                <Text style={s.cardSub}>Optional remarks</Text>
              </View>
              <TextInput
                style={s.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="Remarks about this transfer…"
                placeholderTextColor={MUTED}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {/* Submit */}
            <TouchableOpacity
              style={[s.submitBtn, submitting && { opacity: 0.5 }]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting
                ? <ActivityIndicator size="small" color={WHITE} />
                : <Send size={18} color={WHITE} />}
              <Text style={s.submitTxt}>
                {submitting ? "Submitting…" : "Submit Transfer Request"}
              </Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        )}

        {/* ── History tab ── */}
        {tab === "history" && (
          <ScrollView
            contentContainerStyle={s.scroll}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={histRefreshing}
                onRefresh={() => { setHistRefreshing(true); loadHistory(); }}
                colors={[G]} tintColor={G}
              />
            }
          >
            {histLoading && !histRefreshing ? (
              <View style={s.centerPad}>
                <ActivityIndicator color={G} />
              </View>
            ) : requests.length === 0 ? (
              <View style={s.centerPad}>
                <ClipboardList size={44} color="#CBD5E1" />
                <Text style={s.emptyTxt}>No delivery logs yet</Text>
              </View>
            ) : (
              requests.map(r => (
                <RequestCard key={r.id} req={r} onTrack={handleTrack} />
              ))
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: BG },
  center:       { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: BG, gap: 12 },
  centerPad:    { alignItems: "center", paddingTop: 60, gap: 12 },
  loadingTxt:   { fontSize: 13, color: MUTED, fontWeight: "600" },
  emptyTxt:     { fontSize: 14, fontWeight: "700", color: MUTED },

  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  backBtn:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title:        { fontSize: 20, fontWeight: "900", color: SLATE },
  subtitle:     { fontSize: 12, color: MUTED, fontWeight: "600" },

  tabBar:       { flexDirection: "row", backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, paddingHorizontal: 16, gap: 4 },
  tabBtn:       { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabBtnActive: { borderBottomColor: G },
  tabTxt:       { fontSize: 13, fontWeight: "700", color: MUTED },
  tabTxtActive: { color: G },

  scroll:       { padding: 16, gap: 14 },

  routeCard:    { backgroundColor: WHITE, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: BORDER, flexDirection: "row", alignItems: "center" },
  routeBox:     { flex: 1, gap: 6 },
  routeLabel:   { fontSize: 9, fontWeight: "900", color: MUTED, textTransform: "uppercase", letterSpacing: 1.5 },
  routeIconRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  routeName:    { fontSize: 13, fontWeight: "800", color: SLATE, flexShrink: 1 },
  routeArrow:   { width: 36, alignItems: "center" },
  selectorLabel:{ fontSize: 11, fontWeight: "800", color: MUTED, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 },
  selectorWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  selectorChip: { borderWidth: 1, borderColor: BORDER, backgroundColor: BG, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  selectorChipActive: { borderColor: G + "60", backgroundColor: G_LIGHT },
  selectorChipTxt: { fontSize: 12, fontWeight: "700", color: MUTED },
  selectorChipTxtActive: { color: GDARK },
  noDrivers:     { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: BG, borderRadius: 12, padding: 14 },
  noDriversTxt:  { flex: 1, fontSize: 12, color: MUTED, fontWeight: "500" },

  card:         { backgroundColor: WHITE, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: BORDER },
  cardHeader:   { marginBottom: 14 },
  cardTitle:    { fontSize: 14, fontWeight: "900", color: SLATE },
  cardSub:      { fontSize: 11, color: MUTED, fontWeight: "500", marginTop: 2 },

  itemRow:      { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  itemRowBorder:{ borderBottomWidth: 1, borderBottomColor: BORDER },
  itemDot:      { width: 38, height: 38, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  itemDotTxt:   { fontSize: 15, fontWeight: "900" },
  itemLabel:    { fontSize: 14, fontWeight: "700", color: SLATE },
  itemStock:    { fontSize: 11, color: MUTED, fontWeight: "500", marginTop: 2 },
  inputWrap:    { flexDirection: "row", alignItems: "center", gap: 6 },
  qtyInput:     { width: 76, height: 42, borderRadius: 12, borderWidth: 1.5, borderColor: G + "55", backgroundColor: G_LIGHT, textAlign: "center", fontSize: 16, fontWeight: "800", color: GDARK },
  qtyInputError:{ borderColor: "#ef4444", backgroundColor: "#FEF2F2" },
  qtyUnit:      { fontSize: 12, color: MUTED, fontWeight: "600", width: 26 },

  notesInput:   { borderWidth: 1.5, borderColor: BORDER, borderRadius: 12, backgroundColor: BG, padding: 12, fontSize: 13, color: SLATE, minHeight: 80 },

  submitBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: GDARK, borderRadius: 18, paddingVertical: 16, shadowColor: G, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
  submitTxt:    { fontSize: 15, fontWeight: "900", color: WHITE, letterSpacing: 0.3 },
});

const hc = StyleSheet.create({
  card:      { backgroundColor: WHITE, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 10, shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  topRow:    { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10, gap: 8 },
  from:      { fontSize: 14, fontWeight: "800", color: SLATE },
  routeRow:  { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  routeLabel:{ fontSize: 10, fontWeight: "900", color: MUTED, width: 34 },
  routeValue:{ flex: 1, fontSize: 11, fontWeight: "600", color: SLATE },
  date:      { fontSize: 11, color: MUTED, fontWeight: "500", marginTop: 2 },
  badge:     { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  dot:       { width: 6, height: 6, borderRadius: 3 },
  badgeTxt:  { fontSize: 11, fontWeight: "800" },
  itemsRow:  { flexDirection: "row", gap: 4, marginBottom: 10 },
  itemChip:  { flex: 1, backgroundColor: BG, borderRadius: 8, paddingVertical: 5, alignItems: "center", borderWidth: 1 },
  itemVal:   { fontSize: 11, fontWeight: "900" },
  itemLbl:   { fontSize: 7, fontWeight: "700", color: MUTED, textTransform: "uppercase", marginTop: 1 },
  trackBtn:  { backgroundColor: G_LIGHT, borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  trackTxt:  { fontSize: 12, fontWeight: "800", color: G },
});
