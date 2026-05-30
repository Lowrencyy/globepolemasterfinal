import { useAuth } from "@/context/auth-context";
import { getBridgeToken } from "@/lib/token-bridge";
import {
  getWarehouses,
  getWarehouseReceipts,
  getWarehouseStocks,
  stocksToTotals,
  type CollectedTotals,
  type Warehouse,
  type WarehouseReceipt,
} from "@/services/skycable";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import {
  ChevronLeft, CheckCircle2, Package,
  RefreshCw, Warehouse as WIcon, Clock, XCircle,
} from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList,
  RefreshControl, StyleSheet,
  Text, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G = "#006241";
const G_LIGHT = "#ECFDF5";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";
const WHITE = "#FFFFFF";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const ITEM_COLOR: Record<string, string> = {
  cable: "#059669", node: "#0b6cff", amplifier: "#8b5cf6",
  extender: "#10b981", tsc: "#f59e0b", powersupply: "#ef4444",
};
const ITEM_LABEL: Record<string, string> = {
  cable: "Cable", node: "Node", amplifier: "Amp",
  extender: "Ext", tsc: "TSC", powersupply: "PSU",
};

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}
function fmtDT(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  const h = d.getUTCHours(), mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${mi} ${h >= 12 ? "PM" : "AM"}`;
}

// ── Stock chip ────────────────────────────────────────────────────────────────
function StockChip({ label, value, unit, color, bg, big }: {
  label: string; value: number; unit?: string; color: string; bg: string; big?: boolean;
}) {
  return (
    <View style={[ch.chip, { borderColor: color + "30", backgroundColor: bg }, big && ch.chipBig]}>
      <Text style={[ch.val, { color }, big && ch.valBig]}>{value}{unit ?? ""}</Text>
      <Text style={ch.lbl}>{label}</Text>
    </View>
  );
}

// ── Receipt card ──────────────────────────────────────────────────────────────
function ReceiptCard({
  item, onVerify,
}: {
  item: WarehouseReceipt;
  onVerify: (item: WarehouseReceipt) => void;
}) {
  const isPending  = item.status === "pending";
  const isApproved = item.status === "approved";
  const color      = isPending ? "#f59e0b" : isApproved ? "#059669" : "#ef4444";
  const ref        = `0x${item.id.toString(16).toUpperCase().padStart(8, "0")}`;
  const itemCount  = item.items?.length ?? 0;

  return (
    <TouchableOpacity
      style={rc.card}
      onPress={() => onVerify(item)}
      activeOpacity={isPending ? 0.75 : 1}
    >
      {/* Top row */}
      <View style={rc.topRow}>
        <View style={{ flex: 1 }}>
          {item.node && <Text style={rc.nodeName}>{item.node.name}</Text>}
          <Text style={rc.date}>{fmtDate(item.receipt_date)}</Text>
          <Text style={rc.ref}>{ref}</Text>
        </View>
        <View style={rc.countBadge}>
          <Text style={rc.countTxt}>{itemCount} item{itemCount !== 1 ? "s" : ""}</Text>
        </View>
      </View>

      {/* Items */}
      {itemCount > 0 && (
        <View style={rc.itemsRow}>
          {item.items!.map((it, i) => (
            <View key={i} style={[rc.itemChip, { borderColor: (ITEM_COLOR[it.item_type] ?? MUTED) + "30" }]}>
              <Text style={[rc.itemVal, { color: ITEM_COLOR[it.item_type] ?? MUTED }]} numberOfLines={1} adjustsFontSizeToFit>
                {parseFloat(String(it.quantity))}{it.item_type === "cable" ? "m" : ""}
              </Text>
              <Text style={rc.itemLbl} numberOfLines={1}>{ITEM_LABEL[it.item_type] ?? it.item_type}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Approved/rejected by */}
      {(item.approvedBy || item.receivedBy) && (
        <View style={rc.peopleRow}>
          {item.receivedBy && <Text style={rc.person}>👤 {item.receivedBy.name}</Text>}
          {item.approvedBy && <Text style={rc.person}>✅ {item.approvedBy.name}</Text>}
          {item.created_at && <Text style={rc.time}>{fmtDT(item.created_at)}</Text>}
        </View>
      )}

      {/* Status pill */}
      <View style={[rc.statusPill, { borderColor: color + "50", backgroundColor: color + "10" }]}>
        <View style={[rc.statusDot, { backgroundColor: color }]} />
        <Text style={[rc.statusPillTxt, { color }]}>
          {isPending ? "Tap to Verify & Approve" : isApproved ? "Approved ✓" : "Declined"}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function WarehouseScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [warehouses,  setWarehouses]  = useState<Warehouse[]>([]);
  const [stocks,      setStocks]      = useState<CollectedTotals>({ cable: 0, node: 0, amplifier: 0, extender: 0, tsc: 0, psu: 0, psuCase: 0 });
  const [receipts,    setReceipts]    = useState<WarehouseReceipt[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [approvedCount, setApprovedCount] = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [tab,         setTab]         = useState<"pending" | "approved" | "declined">("pending");
  const [declinedCount, setDeclinedCount] = useState(0);
  const lastFetchRef = useRef(0);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    const authToken = getBridgeToken() ?? token;

    try {
      // 1. Get all warehouses
      const whs = await getWarehouses(authToken);
      setWarehouses(whs);

      // 2. Get stocks and receipts for all warehouses
      const allReceipts: WarehouseReceipt[] = [];
      const combinedStocks: CollectedTotals = { cable: 0, node: 0, amplifier: 0, extender: 0, tsc: 0, psu: 0, psuCase: 0 };

      await Promise.allSettled(
        whs.map(async (wh) => {
          const [stks, recs] = await Promise.all([
            getWarehouseStocks(authToken, wh.id),
            getWarehouseReceipts(authToken, wh.id),
          ]);
          const t = stocksToTotals(stks);
          combinedStocks.cable     += t.cable;
          combinedStocks.node      += t.node;
          combinedStocks.amplifier += t.amplifier;
          combinedStocks.extender  += t.extender;
          combinedStocks.tsc       += t.tsc;
          combinedStocks.psu       += t.psu;
          combinedStocks.psuCase   += t.psuCase;
          allReceipts.push(...recs);
        })
      );

      setStocks(combinedStocks);
      allReceipts.sort((a, b) => b.receipt_date.localeCompare(a.receipt_date));
      setReceipts(allReceipts);
      setPendingCount(allReceipts.filter(r => r.status === "pending").length);
      setApprovedCount(allReceipts.filter(r => r.status === "approved").length);
      setDeclinedCount(allReceipts.filter(r => r.status === "rejected").length);
      lastFetchRef.current = Date.now();
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  function handleVerify(receipt: WarehouseReceipt) {
    router.push({
      pathname: "/delivery/inventory-check",
      params: {
        receiptId: String(receipt.id),
        nodeId: String(receipt.node?.id ?? receipt.node_id ?? ""),
        nodeName: encodeURIComponent(receipt.node?.name ?? ""),
      },
    });
  }



  const shown = receipts.filter(r =>
    tab === "pending"  ? r.status === "pending"  :
    tab === "approved" ? r.status === "approved" :
                         r.status === "rejected"
  );

  const BIG_ITEMS  = [
    { label: "Cable", value: stocks.cable,     unit: "m", color: "#059669", bg: "#ECFDF5" },
    { label: "Node",  value: stocks.node,      unit: "",  color: "#0b6cff", bg: "#EFF6FF" },
  ];
  const SMALL_ITEMS = [
    { label: "Amp",   value: stocks.amplifier, unit: "",  color: "#8b5cf6", bg: "#F5F3FF" },
    { label: "Ext",   value: stocks.extender,  unit: "",  color: "#10b981", bg: "#ECFDF5" },
    { label: "TSC",   value: stocks.tsc,       unit: "",  color: "#f59e0b", bg: "#FFFBEB" },
    { label: "PSU",   value: stocks.psu,       unit: "",  color: "#ef4444", bg: "#FEF2F2" },
  ];

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
            <Text style={s.subtitle}>Inventory & receipt management</Text>
          </View>
          <TouchableOpacity onPress={() => { setRefreshing(true); load(); }} style={s.iconBtn}>
            <RefreshCw size={18} color={G} style={refreshing ? { opacity: 0.4 } : undefined} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={G} /></View>
        ) : (
          <FlatList
            data={shown}
            keyExtractor={r => String(r.id)}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); load(); }}
                colors={[G]} tintColor={G}
              />
            }
            ListHeaderComponent={
              <>
                {/* ── Current Warehouse Stocks ── */}
                <View style={s.section}>
                  <View style={s.sectionHeader}>
                    <WIcon size={14} color={G} />
                    <Text style={s.sectionTitle}>Current Inventory</Text>
                  </View>
                  <Text style={s.sectionSub}>
                    {warehouses.length} warehouse{warehouses.length !== 1 ? "s" : ""} · approved receipts only
                  </Text>
                  <View style={[s.stockGrid, { marginBottom: 8 }]}>
                    {BIG_ITEMS.map(item => (
                      <StockChip key={item.label} {...item} big />
                    ))}
                  </View>
                  <View style={s.stockGrid}>
                    {SMALL_ITEMS.map(item => (
                      <StockChip key={item.label} {...item} />
                    ))}
                  </View>
                </View>

                {/* ── Summary pills ── */}
                <View style={s.pillRow}>
                  <View style={[s.pill, { borderColor: "#f59e0b30" }]}>
                    <Clock size={14} color="#f59e0b" />
                    <Text style={[s.pillVal, { color: "#f59e0b" }]}>{pendingCount}</Text>
                    <Text style={s.pillLbl}>Pending</Text>
                  </View>
                  <View style={[s.pill, { borderColor: "#05996930" }]}>
                    <CheckCircle2 size={14} color="#059669" />
                    <Text style={[s.pillVal, { color: "#059669" }]}>{approvedCount}</Text>
                    <Text style={s.pillLbl}>Approved</Text>
                  </View>
                  <View style={[s.pill, { borderColor: "#ef444430" }]}>
                    <XCircle size={14} color="#ef4444" />
                    <Text style={[s.pillVal, { color: "#ef4444" }]}>{declinedCount}</Text>
                    <Text style={s.pillLbl}>Declined</Text>
                  </View>
                </View>

                {/* ── Tab bar ── */}
                <View style={s.tabs}>
                  {([
                    { key: "pending",  label: `Pending (${pendingCount})` },
                    { key: "approved", label: `Approved (${approvedCount})` },
                    { key: "declined", label: `Declined (${declinedCount})` },
                  ] as const).map(({ key, label }) => (
                    <TouchableOpacity
                      key={key}
                      style={[s.tab, tab === key && s.tabActive]}
                      onPress={() => setTab(key)}
                    >
                      <Text style={[s.tabTxt, tab === key && s.tabTxtActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            }
            renderItem={({ item }) => (
              <ReceiptCard
                item={item}
                onVerify={handleVerify}
              />
            )}
            ListEmptyComponent={
              <View style={s.empty}>
                <Package size={44} color="#CBD5E1" />
                <Text style={s.emptyTxt}>
                  {tab === "pending" ? "No pending receipts" : "No approved receipts yet"}
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
  container:   { flex: 1, backgroundColor: "#F8FAFC" },
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  backBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: G_LIGHT },
  headerText:  { flex: 1 },
  title:       { fontSize: 20, fontWeight: "900", color: SLATE },
  subtitle:    { fontSize: 12, color: MUTED, fontWeight: "600" },
  center:      { flex: 1, alignItems: "center", justifyContent: "center" },
  list:        { padding: 16, paddingBottom: 48, gap: 10 },
  section:     { backgroundColor: WHITE, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 14 },
  sectionHeader:{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  sectionTitle:{ fontSize: 16, fontWeight: "900", color: SLATE },
  sectionSub:  { fontSize: 11, color: MUTED, fontWeight: "600", marginBottom: 12 },
  stockGrid:   { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pillRow:     { flexDirection: "row", gap: 10, marginBottom: 14 },
  pill:        { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: WHITE, borderRadius: 16, padding: 12, borderWidth: 1.5 },
  pillVal:     { fontSize: 20, fontWeight: "900" },
  pillLbl:     { fontSize: 11, fontWeight: "700", color: MUTED },
  tabs:        { flexDirection: "row", backgroundColor: "#F1F5F9", borderRadius: 14, padding: 4, marginBottom: 6 },
  tab:         { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center" },
  tabActive:   { backgroundColor: WHITE, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  tabTxt:      { fontSize: 12, fontWeight: "700", color: MUTED },
  tabTxtActive:{ color: SLATE, fontWeight: "900" },
  empty:       { alignItems: "center", paddingTop: 40, gap: 10 },
  emptyTxt:    { fontSize: 15, fontWeight: "700", color: MUTED },
});

const ch = StyleSheet.create({
  chip:    { flex: 1, minWidth: 72, borderRadius: 14, padding: 10, alignItems: "center", borderWidth: 1 },
  chipBig: { borderRadius: 16, padding: 12 },
  val:     { fontSize: 18, fontWeight: "900" },
  valBig:  { fontSize: 22 },
  lbl:     { fontSize: 9, fontWeight: "800", color: MUTED, marginTop: 2, textTransform: "uppercase" },
});

const rc = StyleSheet.create({
  card:         { backgroundColor: WHITE, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: BORDER, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  topRow:       { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 },
  nodeName:     { fontSize: 16, fontWeight: "900", color: SLATE },
  date:         { fontSize: 12, fontWeight: "600", color: MUTED, marginTop: 1 },
  ref:          { fontSize: 11, color: MUTED, fontWeight: "500", marginTop: 1 },
  countBadge:   { backgroundColor: "#F1F5F9", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  countTxt:     { fontSize: 11, fontWeight: "700", color: MUTED },
  itemsRow:     { flexDirection: "row", gap: 4, marginBottom: 12 },
  itemChip:     { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 8, paddingHorizontal: 2, paddingVertical: 5, alignItems: "center", borderWidth: 1 },
  itemVal:      { fontSize: 11, fontWeight: "900" },
  itemLbl:      { fontSize: 7, fontWeight: "700", color: MUTED, textTransform: "uppercase" },
  peopleRow:    { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" },
  person:       { fontSize: 11, fontWeight: "600", color: MUTED },
  time:         { fontSize: 10, fontWeight: "600", color: MUTED, marginLeft: "auto" },
  actions:      { flexDirection: "row", gap: 8 },
  btn:          { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  btnApprove:   { backgroundColor: G },
  btnReject:    { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#ef444440" },
  btnTxt:       { fontSize: 13, fontWeight: "900", color: WHITE },
  statusPill:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, borderWidth: 1.5, paddingVertical: 10 },
  statusDot:    { width: 8, height: 8, borderRadius: 4 },
  statusPillTxt:{ fontSize: 14, fontWeight: "800" },
});
