import { getBridgeToken } from "@/lib/token-bridge";
import {
  getWarehouses,
  getWarehouseReceipts,
  type Warehouse,
  type WarehouseReceipt,
} from "@/services/skycable";
import { Stack, useRouter } from "expo-router";
import {
  Award, CheckCircle2, ChevronLeft,
  ClipboardList, Package, RefreshCw, User, Warehouse as WIcon,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
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

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const STATUS_COLOR: Record<string, string> = {
  pending:  "#f59e0b",
  approved: "#059669",
  rejected: "#ef4444",
};
const STATUS_LABEL: Record<string, string> = {
  pending:  "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
};

const ITEM_COLOR: Record<string, string> = {
  cable:       "#059669",
  node:        "#0b6cff",
  amplifier:   "#8b5cf6",
  extender:    "#10b981",
  tsc:         "#f59e0b",
  powersupply: "#ef4444",
};
const ITEM_LABEL: Record<string, string> = {
  cable:       "Cable",
  node:        "Node",
  amplifier:   "Amp",
  extender:    "Ext",
  tsc:         "TSC",
  powersupply: "PSU",
};
const ITEM_UNIT: Record<string, string> = {
  cable: "m",
};

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}

function fmtDT(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  const h = d.getUTCHours(), mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} · ${h % 12 || 12}:${mi} ${h >= 12 ? "PM" : "AM"}`;
}

// ── Receipt card ──────────────────────────────────────────────────────────────
function ReceiptCard({ item, warehouseName }: { item: WarehouseReceipt; warehouseName?: string }) {
  const color = STATUS_COLOR[item.status] ?? "#64748b";
  const label = STATUS_LABEL[item.status] ?? item.status;
  const submitter = item.receivedBy?.name ?? "—";
  const approver  = item.approvedBy?.name ?? null;

  return (
    <View style={lc.card}>
      <View style={[lc.bar, { backgroundColor: color }]} />

      {/* Status + warehouse */}
      <View style={lc.topRow}>
        <View style={[lc.statusBadge, { backgroundColor: color + "18" }]}>
          <View style={[lc.dot, { backgroundColor: color }]} />
          <Text style={[lc.statusTxt, { color }]}>{label}</Text>
        </View>
        <Text style={lc.date}>{fmtDate(item.receipt_date)}</Text>
      </View>

      {/* Node + warehouse */}
      {item.node && (
        <Text style={lc.nodeTxt} numberOfLines={1}>📍 {item.node.name}</Text>
      )}
      {warehouseName && (
        <View style={lc.whRow}>
          <WIcon size={11} color={G} />
          <Text style={lc.whTxt} numberOfLines={1}>{warehouseName}</Text>
        </View>
      )}

      {/* Items grid */}
      {item.items && item.items.length > 0 && (
        <>
          <Text style={lc.sectionLabel}>COLLECTED ITEMS</Text>
          <View style={lc.grid}>
            {item.items.map((it, i) => (
              <View key={i} style={lc.gridItem}>
                <Text style={[lc.gridVal, { color: ITEM_COLOR[it.item_type] ?? MUTED }]}>
                  {it.quantity}{ITEM_UNIT[it.item_type] ?? ""}
                </Text>
                <Text style={lc.gridLbl}>{ITEM_LABEL[it.item_type] ?? it.item_type}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* People row */}
      <View style={lc.peopleRow}>
        <View style={lc.personBlock}>
          <User size={13} color={G} />
          <View>
            <Text style={lc.personRole}>Submitted by</Text>
            <Text style={lc.personName}>{submitter}</Text>
          </View>
        </View>
        {approver && (
          <>
            <View style={lc.personDivider} />
            <View style={lc.personBlock}>
              <Award size={13} color="#8b5cf6" />
              <View>
                <Text style={lc.personRole}>Approved by</Text>
                <Text style={[lc.personName, { color: "#8b5cf6" }]}>{approver}</Text>
              </View>
            </View>
          </>
        )}
      </View>

      {/* Submitted at */}
      {item.created_at && (
        <View style={lc.receivedRow}>
          <CheckCircle2 size={12} color={G} />
          <Text style={lc.receivedTxt}>Submitted {fmtDT(item.created_at)}</Text>
        </View>
      )}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function DeliveryListScreen() {
  const router = useRouter();
  const [receipts,   setReceipts]   = useState<WarehouseReceipt[]>([]);
  const [warehouseMap, setWarehouseMap] = useState<Record<number, string>>({});
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastFetchRef = useRef(0);

  const load = useCallback(async (force = false) => {
    if (!force && Date.now() - lastFetchRef.current < 60_000 && receipts.length > 0) {
      setRefreshing(false);
      return;
    }
    try {
      const token = getBridgeToken() ?? "";
      if (!token) { setLoading(false); setRefreshing(false); return; }

      const whs = await getWarehouses(token);
      const whMap: Record<number, string> = {};
      whs.forEach(w => { whMap[w.id] = w.name; });
      setWarehouseMap(whMap);

      const all: WarehouseReceipt[] = [];
      await Promise.allSettled(
        whs.map(async (wh) => {
          const recs = await getWarehouseReceipts(token, wh.id);
          all.push(...recs);
        })
      );

      // Sort newest first
      all.sort((a, b) => b.receipt_date.localeCompare(a.receipt_date));
      setReceipts(all);
      lastFetchRef.current = Date.now();
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [receipts.length]);

  useEffect(() => { load(); }, []);

  // Group by receipt_date, newest first
  const groups: Record<string, WarehouseReceipt[]> = {};
  for (const r of receipts) {
    if (!groups[r.receipt_date]) groups[r.receipt_date] = [];
    groups[r.receipt_date].push(r);
  }
  const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  const pendingCount  = receipts.filter(r => r.status === "pending").length;
  const approvedCount = receipts.filter(r => r.status === "approved").length;

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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <ClipboardList size={18} color={G} />
              <Text style={s.title}>Delivery Reports</Text>
            </View>
            <Text style={s.subtitle}>
              {loading ? "Loading…" : `${receipts.length} receipts · ${pendingCount} pending · ${approvedCount} approved`}
            </Text>
          </View>
          <TouchableOpacity
            style={s.iconBtn}
            onPress={() => { setRefreshing(true); load(true); }}
          >
            <RefreshCw size={17} color={G} style={refreshing ? { opacity: 0.4 } : undefined} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={G} /></View>
        ) : (
          <ScrollView
            contentContainerStyle={s.scroll}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); load(true); }}
                colors={[G]} tintColor={G}
              />
            }
          >
            {sortedDates.map(date => (
              <View key={date}>
                <View style={s.dateHeader}>
                  <View style={s.dateLine} />
                  <Text style={s.dateLabelTxt}>{fmtDate(date)}</Text>
                  <View style={s.dateLine} />
                </View>
                {groups[date].map(item => (
                  <ReceiptCard
                    key={item.id}
                    item={item}
                    warehouseName={warehouseMap[item.warehouse_id]}
                  />
                ))}
              </View>
            ))}

            {receipts.length === 0 && (
              <View style={s.empty}>
                <Package size={52} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No delivery reports yet</Text>
                <Text style={s.emptySub}>Receipts appear here once submitted from a node.</Text>
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#F8FAFC" },
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 10 },
  backBtn:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconBtn:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: G_LIGHT },
  headerText:   { flex: 1 },
  title:        { fontSize: 19, fontWeight: "900", color: SLATE },
  subtitle:     { fontSize: 12, color: MUTED, fontWeight: "600", marginTop: 1 },
  center:       { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll:       { padding: 16, paddingBottom: 56, gap: 4 },
  dateHeader:   { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 14 },
  dateLine:     { flex: 1, height: 1, backgroundColor: BORDER },
  dateLabelTxt: { fontSize: 11, fontWeight: "800", color: MUTED, letterSpacing: 0.5, textTransform: "uppercase" },
  empty:        { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTitle:   { fontSize: 17, fontWeight: "800", color: SLATE },
  emptySub:     { fontSize: 13, color: MUTED, fontWeight: "500", textAlign: "center", paddingHorizontal: 32 },
});

const lc = StyleSheet.create({
  card:          { backgroundColor: WHITE, borderRadius: 20, padding: 16, paddingLeft: 20, borderWidth: 1, borderColor: BORDER, marginBottom: 14, shadowColor: "#0F172A", shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3, overflow: "hidden" },
  bar:           { position: "absolute", left: 0, top: 0, bottom: 0, width: 5, borderTopLeftRadius: 20, borderBottomLeftRadius: 20 },
  topRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  statusBadge:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  dot:           { width: 6, height: 6, borderRadius: 3 },
  statusTxt:     { fontSize: 10, fontWeight: "800" },
  date:          { fontSize: 11, fontWeight: "700", color: MUTED },
  nodeTxt:       { fontSize: 12, fontWeight: "800", color: SLATE, marginBottom: 2 },
  whRow:         { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 10 },
  whTxt:         { fontSize: 11, color: G, fontWeight: "700", flex: 1 },
  sectionLabel:  { fontSize: 9, fontWeight: "800", color: MUTED, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 },
  grid:          { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  gridItem:      { flex: 1, minWidth: 56, backgroundColor: "#F8FAFC", borderRadius: 12, padding: 8, alignItems: "center", borderWidth: 1, borderColor: BORDER },
  gridVal:       { fontSize: 14, fontWeight: "900" },
  gridLbl:       { fontSize: 8, fontWeight: "700", color: MUTED, marginTop: 2, textTransform: "uppercase" },
  peopleRow:     { flexDirection: "row", alignItems: "stretch", backgroundColor: "#F8FAFC", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: BORDER, marginBottom: 10 },
  personBlock:   { flex: 1, flexDirection: "row", alignItems: "center", gap: 7 },
  personDivider: { width: 1, backgroundColor: BORDER, marginHorizontal: 10 },
  personRole:    { fontSize: 9, fontWeight: "700", color: MUTED, textTransform: "uppercase", letterSpacing: 0.4 },
  personName:    { fontSize: 13, fontWeight: "800", color: SLATE, marginTop: 1 },
  receivedRow:   { flexDirection: "row", alignItems: "center", gap: 5 },
  receivedTxt:   { fontSize: 11, fontWeight: "700", color: G },
});
