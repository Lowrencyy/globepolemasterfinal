/**
 * Collected Inventory — aggregates teardown logs across ALL nodes.
 *
 * Three states per node×date:
 *   1. PENDING DELIVERY   — logs exist but no receipt submitted yet
 *   2. PENDING APPROVAL   — receipt submitted, warehouse hasn't approved yet
 *   3. APPROVED / IN STOCK — receipt approved → items in warehouse stock
 *
 * Approve button on "Pending Approval" cards calls
 *   PUT /skycable/warehouse-receipts/{id}/approve
 * which increments warehouse_stocks automatically.
 */
import api from "@/lib/api";
import { getBridgeToken } from "@/lib/token-bridge";
import {
  approveWarehouseReceipt,
  calcDeliveryTotals,
  createWarehouseReceipt,
  getWarehouses,
  getWarehouseReceipts,
  totalsToReceiptItems,
  type CollectedTotals,
  type TeardownLog,
  type Warehouse,
  type WarehouseReceipt,
} from "@/services/skycable";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import {
  Archive,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Layers,
  RefreshCw,
  Send,
  Truck,
} from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G = "#006241";
const G_LIGHT = "#ECFDF5";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";
const WHITE = "#FFFFFF";
const BG = "#F4F8F5";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function todayPHT() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function yesterdayPHT() {
  return new Date(Date.now() + 8 * 3600 * 1000 - 86400_000).toISOString().slice(0, 10);
}
function phtDate(iso: string) {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function fmtDate(d: string) {
  const [, m, day] = d.split("-").map(Number);
  return `${MONTHS[m - 1]} ${day}`;
}

// ── Totals mini-row ───────────────────────────────────────────────────────────
function TotalsRow({ t }: { t: CollectedTotals }) {
  const chips = [
    { l: "Cable", v: t.cable,     u: "m", c: "#059669" },
    { l: "Node",  v: t.node,      u: "",  c: "#0b6cff" },
    { l: "Amp",   v: t.amplifier, u: "",  c: "#8b5cf6" },
    { l: "Ext",   v: t.extender,  u: "",  c: "#10b981" },
    { l: "TSC",   v: t.tsc,       u: "",  c: "#f59e0b" },
    { l: "PSU",   v: t.psu,       u: "",  c: "#ef4444" },
  ].filter(x => x.v > 0);

  if (chips.length === 0) return <Text style={tr.none}>No items recorded</Text>;

  return (
    <View style={tr.row}>
      {chips.map(x => (
        <View key={x.l} style={[tr.chip, { borderColor: x.c + "30" }]}>
          <Text style={[tr.val, { color: x.c }]}>{x.v}{x.u}</Text>
          <Text style={tr.lbl}>{x.l}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Node inventory card ───────────────────────────────────────────────────────
type CardState = "pending_delivery" | "pending_approval" | "approved";

interface NodeInventoryItem {
  key: string;
  nodeId: number;
  nodeName: string;
  date: string;
  state: CardState;
  totals: CollectedTotals;
  spanCount: number;
  receipt: WarehouseReceipt | null;
  logs: TeardownLog[];
  warehouseId: number | null;
}

function NodeInventoryCard({
  item,
  onSubmit,
  onApprove,
  onPress,
  submitting,
  approving,
}: {
  item: NodeInventoryItem;
  onSubmit: (item: NodeInventoryItem) => void;
  onApprove: (item: NodeInventoryItem, action: "approve" | "reject") => void;
  onPress: (item: NodeInventoryItem) => void;
  submitting: string | null;
  approving: number | null;
}) {
  const isToday     = item.date === todayPHT();
  const isYesterday = item.date === yesterdayPHT();
  const dateLabel   = isToday ? "Today" : isYesterday ? "Yesterday" : fmtDate(item.date);

  const state = item.state;
  const accentColor =
    state === "approved"         ? "#059669" :
    state === "pending_approval" ? "#f59e0b" : "#175CD3";

  const isSubmitting = submitting === item.key;
  const isApproving  = approving === item.receipt?.id;

  return (
    <TouchableOpacity
      style={[nc.card, { borderLeftColor: accentColor }]}
      onPress={() => onPress(item)}
      activeOpacity={0.88}
    >
      {/* Top row */}
      <View style={nc.topRow}>
        <View style={nc.nodeInfo}>
          <View style={nc.iconWrap}>
            <Layers size={14} color={G} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={nc.nodeName} numberOfLines={1}>{item.nodeName}</Text>
            <View style={nc.dateRow}>
              <View style={[nc.dateBadge, isToday && { backgroundColor: G + "18" }]}>
                <Text style={[nc.dateTxt, isToday && { color: G }]}>{dateLabel}</Text>
              </View>
              <Text style={nc.spanCount}>{item.spanCount} span{item.spanCount !== 1 ? "s" : ""}</Text>
            </View>
          </View>
        </View>

        {/* State badge */}
        {state === "approved" && (
          <View style={[nc.stateBadge, { backgroundColor: "#05996915" }]}>
            <CheckCircle2 size={11} color="#059669" />
            <Text style={[nc.stateTxt, { color: "#059669" }]}>In Stock</Text>
          </View>
        )}
        {state === "pending_approval" && (
          <View style={[nc.stateBadge, { backgroundColor: "#f59e0b15" }]}>
            <Clock size={11} color="#f59e0b" />
            <Text style={[nc.stateTxt, { color: "#f59e0b" }]}>Awaiting</Text>
          </View>
        )}
        {state === "pending_delivery" && (
          <View style={[nc.stateBadge, { backgroundColor: "#175CD315" }]}>
            <Truck size={11} color="#175CD3" />
            <Text style={[nc.stateTxt, { color: "#175CD3" }]}>Unsubmitted</Text>
          </View>
        )}
      </View>

      {/* Collected totals */}
      <TotalsRow t={item.totals} />

      {/* Approved by */}
      {state === "approved" && item.receipt?.approvedBy && (
        <View style={nc.approvedRow}>
          <CheckCircle2 size={11} color="#059669" />
          <Text style={nc.approvedTxt}>Approved by {item.receipt.approvedBy.name}</Text>
        </View>
      )}

      {/* Submitted by */}
      {state === "pending_approval" && item.receipt?.receivedBy && (
        <View style={nc.approvedRow}>
          <Send size={11} color="#f59e0b" />
          <Text style={[nc.approvedTxt, { color: "#f59e0b" }]}>
            Submitted by {item.receipt.receivedBy.name}
          </Text>
        </View>
      )}

      {/* Action buttons */}
      {state === "pending_delivery" && item.warehouseId && (
        <TouchableOpacity
          style={[nc.submitBtn, isSubmitting && { opacity: 0.6 }]}
          onPress={() => onSubmit(item)}
          disabled={isSubmitting}
          activeOpacity={0.85}
        >
          {isSubmitting
            ? <ActivityIndicator size="small" color={WHITE} />
            : <Send size={13} color={WHITE} />}
          <Text style={nc.submitTxt}>{isSubmitting ? "Submitting…" : "Submit to Warehouse"}</Text>
        </TouchableOpacity>
      )}

      {state === "pending_approval" && (
        <View style={nc.approveRow}>
          <TouchableOpacity
            style={[nc.approveBtn, isApproving && { opacity: 0.6 }]}
            onPress={() => onApprove(item, "approve")}
            disabled={approving !== null}
            activeOpacity={0.85}
          >
            {isApproving
              ? <ActivityIndicator size="small" color={WHITE} />
              : <Text style={nc.approveTxt}>Approve → Add to Stock</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[nc.rejectBtn, isApproving && { opacity: 0.6 }]}
            onPress={() => onApprove(item, "reject")}
            disabled={approving !== null}
            activeOpacity={0.85}
          >
            <Text style={nc.rejectTxt}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function InventoryScreen() {
  const router = useRouter();

  const [logs,       setLogs]       = useState<TeardownLog[]>([]);
  const [receipts,   setReceipts]   = useState<WarehouseReceipt[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [approving,  setApproving]  = useState<number | null>(null);
  const [tab,        setTab]        = useState<"all" | "pending_delivery" | "pending_approval" | "approved">("all");
  const lastFetchRef = useRef(0);

  const load = useCallback(async () => {
    const token = getBridgeToken() ?? "";
    try {
      const [tr, whs] = await Promise.allSettled([
        api.get("/skycable/teardowns?per_page=500"),
        getWarehouses(token),
      ]);

      let allLogs: TeardownLog[] = [];
      if (tr.status === "fulfilled") {
        const raw = tr.value?.data;
        allLogs = Array.isArray(raw) ? raw : (raw?.data ?? []);
        setLogs(allLogs);
      }

      let allWarehouses: Warehouse[] = [];
      if (whs.status === "fulfilled") {
        allWarehouses = whs.value;
        setWarehouses(allWarehouses);
      }

      if (token && allWarehouses.length > 0) {
        const allReceipts: WarehouseReceipt[] = [];
        await Promise.allSettled(
          allWarehouses.map(async (wh) => {
            const recs = await getWarehouseReceipts(token, wh.id);
            allReceipts.push(...recs);
          })
        );
        setReceipts(allReceipts);
      }

      lastFetchRef.current = Date.now();
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    if (Date.now() - lastFetchRef.current < 30_000) return;
    load();
  }, [load]));

  // Build node×date inventory items
  const items = useMemo<NodeInventoryItem[]>(() => {
    // Group logs by nodeId × date
    const nodeMap: Record<string, { nodeId: number; nodeName: string; date: string; logs: TeardownLog[] }> = {};
    for (const log of logs) {
      const ts = log.end_time || log.start_time || (log as any).created_at;
      if (!ts) continue;
      const date = phtDate(ts);
      const nodeId = (log.span as any)?.node?.id;
      const nodeName = (log.span as any)?.node?.name ?? `Node #${nodeId}`;
      if (!nodeId) continue;
      const key = `${nodeId}_${date}`;
      if (!nodeMap[key]) nodeMap[key] = { nodeId, nodeName, date, logs: [] };
      nodeMap[key].logs.push(log);
    }

    // Build receipt lookup by nodeId × date
    const receiptMap: Record<string, WarehouseReceipt> = {};
    for (const r of receipts) {
      if (r.node_id && r.receipt_date) {
        const key = `${r.node_id}_${r.receipt_date}`;
        if (!receiptMap[key]) receiptMap[key] = r;
      }
    }

    // Default warehouse (first one)
    const defaultWh = warehouses[0] ?? null;

    return Object.entries(nodeMap)
      .map(([key, { nodeId, nodeName, date, logs: dateLogs }]): NodeInventoryItem => {
        const totals  = calcDeliveryTotals(dateLogs);
        const receipt = receiptMap[key] ?? null;
        const state: CardState =
          receipt?.status === "approved"         ? "approved" :
          receipt?.status === "pending"          ? "pending_approval" : "pending_delivery";

        return {
          key, nodeId, nodeName, date, state, totals,
          spanCount: dateLogs.length,
          receipt,
          logs: dateLogs,
          warehouseId: defaultWh?.id ?? null,
        };
      })
      // Sort: newest date first, then pending_delivery → pending_approval → approved
      .sort((a, b) => {
        if (b.date !== a.date) return b.date.localeCompare(a.date);
        const order: Record<CardState, number> = { pending_delivery: 0, pending_approval: 1, approved: 2 };
        return order[a.state] - order[b.state];
      });
  }, [logs, receipts, warehouses]);

  const filtered = tab === "all" ? items : items.filter(i => i.state === tab);

  const pendingDeliveryCount  = items.filter(i => i.state === "pending_delivery").length;
  const pendingApprovalCount  = items.filter(i => i.state === "pending_approval").length;
  const approvedCount         = items.filter(i => i.state === "approved").length;

  async function handleSubmit(item: NodeInventoryItem) {
    if (!item.warehouseId) {
      Alert.alert("No Warehouse", "No warehouse configured. Ask your admin.");
      return;
    }
    setSubmitting(item.key);
    try {
      const token = getBridgeToken() ?? "";
      const rItems = totalsToReceiptItems(item.totals);
      if (rItems.length === 0) {
        Alert.alert("Nothing to Submit", "No collected quantities for this date.");
        return;
      }
      const rec = await createWarehouseReceipt(token, {
        warehouse_id: item.warehouseId,
        node_id:      item.nodeId,
        receipt_date: item.date,
        items:        rItems,
      });
      setReceipts(prev => [rec, ...prev]);
      Alert.alert("✅ Submitted!", "Receipt sent to warehouse for approval.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Submit failed.");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleApprove(item: NodeInventoryItem, action: "approve" | "reject") {
    if (!item.receipt) return;
    setApproving(item.receipt.id);
    try {
      const token = getBridgeToken() ?? "";
      const updated = await approveWarehouseReceipt(token, item.receipt.id, action);
      setReceipts(prev => prev.map(r => r.id === item.receipt!.id ? { ...r, ...updated } : r));
      if (action === "approve") {
        Alert.alert("✅ Approved!", "Items have been added to warehouse stock.");
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Approval failed.");
    } finally {
      setApproving(null);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={s.container}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>
          <View style={s.headerText}>
            <Text style={s.title}>Collected Inventory</Text>
            <Text style={s.subtitle}>Teardown items by node & date</Text>
          </View>
          <TouchableOpacity
            style={s.iconBtn}
            onPress={() => { setRefreshing(true); load(); }}
          >
            <RefreshCw size={17} color={G} style={refreshing ? { opacity: 0.4 } : undefined} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={G} /></View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={i => i.key}
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
                {/* Status summary pills */}
                <View style={s.pillRow}>
                  <View style={[s.pill, { borderColor: "#175CD330" }]}>
                    <Truck size={13} color="#175CD3" />
                    <Text style={[s.pillVal, { color: "#175CD3" }]}>{pendingDeliveryCount}</Text>
                    <Text style={s.pillLbl}>Unsubmitted</Text>
                  </View>
                  <View style={[s.pill, { borderColor: "#f59e0b30" }]}>
                    <Clock size={13} color="#f59e0b" />
                    <Text style={[s.pillVal, { color: "#f59e0b" }]}>{pendingApprovalCount}</Text>
                    <Text style={s.pillLbl}>Awaiting</Text>
                  </View>
                  <View style={[s.pill, { borderColor: "#05996930" }]}>
                    <Archive size={13} color="#059669" />
                    <Text style={[s.pillVal, { color: "#059669" }]}>{approvedCount}</Text>
                    <Text style={s.pillLbl}>In Stock</Text>
                  </View>
                </View>

                {/* Filter tabs */}
                <View style={s.tabWrap}>
                  {([
                    { key: "all",              label: `All (${items.length})` },
                    { key: "pending_delivery", label: `Unsubmitted (${pendingDeliveryCount})` },
                    { key: "pending_approval", label: `Awaiting (${pendingApprovalCount})` },
                    { key: "approved",         label: `In Stock (${approvedCount})` },
                  ] as const).map(t => (
                    <TouchableOpacity
                      key={t.key}
                      style={[s.tabBtn, tab === t.key && s.tabBtnActive]}
                      onPress={() => setTab(t.key)}
                    >
                      <Text style={[s.tabTxt, tab === t.key && s.tabTxtActive]}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            }
            renderItem={({ item }) => (
              <NodeInventoryCard
                item={item}
                onSubmit={handleSubmit}
                onApprove={handleApprove}
                onPress={(i) =>
                  router.push({
                    pathname: "/delivery/inventory-detail" as any,
                    params: {
                      nodeId:   String(i.nodeId),
                      date:     i.date,
                      nodeName: encodeURIComponent(i.nodeName),
                    },
                  })
                }
                submitting={submitting}
                approving={approving}
              />
            )}
            ListEmptyComponent={
              <View style={s.empty}>
                <Archive size={44} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No inventory data</Text>
                <Text style={s.emptySub}>
                  {tab === "all"
                    ? "Teardown logs will appear here once spans are completed."
                    : "No items in this category."}
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
  container:   { flex: 1, backgroundColor: BG },
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  backBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: G_LIGHT },
  headerText:  { flex: 1 },
  title:       { fontSize: 18, fontWeight: "900", color: SLATE },
  subtitle:    { fontSize: 11, color: MUTED, fontWeight: "600" },
  center:      { flex: 1, alignItems: "center", justifyContent: "center" },
  list:        { padding: 16, paddingBottom: 56, gap: 10 },
  pillRow:     { flexDirection: "row", gap: 8, marginBottom: 14 },
  pill:        { flex: 1, backgroundColor: WHITE, borderRadius: 14, borderWidth: 1.5, padding: 10, alignItems: "center", gap: 3 },
  pillVal:     { fontSize: 18, fontWeight: "900" },
  pillLbl:     { fontSize: 9, fontWeight: "700", color: MUTED, textTransform: "uppercase", textAlign: "center" },
  tabWrap:     { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 },
  tabBtn:      { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER },
  tabBtnActive:{ backgroundColor: G, borderColor: G },
  tabTxt:      { fontSize: 11, fontWeight: "700", color: MUTED },
  tabTxtActive:{ color: WHITE, fontWeight: "900" },
  empty:       { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTitle:  { fontSize: 16, fontWeight: "800", color: SLATE },
  emptySub:    { fontSize: 12, color: MUTED, fontWeight: "500", textAlign: "center", paddingHorizontal: 32 },
});

const nc = StyleSheet.create({
  card:        { backgroundColor: WHITE, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: BORDER, borderLeftWidth: 4, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  topRow:      { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 },
  nodeInfo:    { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  iconWrap:    { width: 34, height: 34, borderRadius: 9, backgroundColor: G_LIGHT, alignItems: "center", justifyContent: "center" },
  nodeName:    { fontSize: 14, fontWeight: "900", color: SLATE },
  dateRow:     { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  dateBadge:   { backgroundColor: "#F1F5F9", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  dateTxt:     { fontSize: 10, fontWeight: "700", color: MUTED },
  spanCount:   { fontSize: 10, fontWeight: "600", color: MUTED },
  stateBadge:  { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  stateTxt:    { fontSize: 9, fontWeight: "800" },
  approvedRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 },
  approvedTxt: { fontSize: 10, fontWeight: "700", color: "#059669" },
  submitBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: "#175CD3", borderRadius: 12, marginTop: 10, paddingVertical: 10 },
  submitTxt:   { fontSize: 13, fontWeight: "900", color: WHITE },
  approveRow:  { flexDirection: "row", gap: 8, marginTop: 10 },
  approveBtn:  { flex: 1, backgroundColor: G, borderRadius: 12, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
  approveTxt:  { fontSize: 12, fontWeight: "900", color: WHITE },
  rejectBtn:   { backgroundColor: "#FEF2F2", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#ef444430" },
  rejectTxt:   { fontSize: 12, fontWeight: "800", color: "#ef4444" },
});

const tr = StyleSheet.create({
  row:  { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: "#F8FAFC", borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4, alignItems: "center", borderWidth: 1, minWidth: 48 },
  val:  { fontSize: 13, fontWeight: "900" },
  lbl:  { fontSize: 7, fontWeight: "700", color: MUTED, textTransform: "uppercase" },
  none: { fontSize: 11, color: MUTED, fontWeight: "600", fontStyle: "italic" },
});
