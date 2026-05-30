import api from "@/lib/api";
import { getBridgeToken } from "@/lib/token-bridge";
import { getWarehouseReceipts, getWarehouses, type TeardownLog, type WarehouseReceipt } from "@/services/skycable";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  CheckCircle2,
  ChevronLeft,
  Clock,
  Layers,
  RefreshCw,
  Zap,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  const h = d.getUTCHours(), mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${mi} ${h >= 12 ? "PM" : "AM"}`;
}

function phtDate(iso: string) {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

const STATUS_COLOR: Record<string, string> = {
  pending:           "#f59e0b",
  submitted:         "#175CD3",
  subcon_approved:   "#8b5cf6",
  backend_approved:  "#059669",
  rejected:          "#ef4444",
};
const STATUS_LABEL: Record<string, string> = {
  pending:           "Pending",
  submitted:         "Submitted",
  subcon_approved:   "Subcon Approved",
  backend_approved:  "Approved",
  rejected:          "Rejected",
};

// ── Span log card ─────────────────────────────────────────────────────────────
function SpanLogCard({ log }: { log: TeardownLog }) {
  const fromCode = log.span?.fromPole?.pole?.pole_code ?? "—";
  const toCode   = log.span?.toPole?.pole?.pole_code   ?? "—";
  const spanCode = log.span?.span_code ?? null;
  const linemanName = log.lineman
    ? `${log.lineman.first_name} ${log.lineman.last_name}`
    : null;

  const statusColor = STATUS_COLOR[log.status] ?? MUTED;
  const statusLabel = STATUS_LABEL[log.status] ?? log.status;

  const items = [
    { l: "Cable",  v: log.actual_cable,          u: "m",  c: "#059669" },
    { l: "Node",   v: log.nodes_collected,        u: "",   c: "#0b6cff" },
    { l: "Amp",    v: log.amplifiers_collected,   u: "",   c: "#8b5cf6" },
    { l: "Ext",    v: log.extenders_collected,    u: "",   c: "#10b981" },
    { l: "TSC",    v: log.tsc_collected,          u: "",   c: "#f59e0b" },
    { l: "PSU",    v: log.powersupply_collected,  u: "",   c: "#ef4444" },
  ].filter(x => Number(x.v) > 0);

  return (
    <View style={lc.card}>
      {/* Accent bar */}
      <View style={[lc.accent, { backgroundColor: statusColor }]} />

      {/* Span route */}
      <View style={lc.spanRow}>
        <View style={lc.poleChip}>
          <Text style={lc.poleCode} numberOfLines={1}>{fromCode}</Text>
        </View>
        <View style={lc.arrow} />
        <View style={lc.poleChip}>
          <Text style={lc.poleCode} numberOfLines={1}>{toCode}</Text>
        </View>
        {spanCode && <Text style={lc.spanCode}>{spanCode}</Text>}
      </View>

      {/* Status + time */}
      <View style={lc.metaRow}>
        <View style={[lc.statusBadge, { backgroundColor: statusColor + "18" }]}>
          <View style={[lc.dot, { backgroundColor: statusColor }]} />
          <Text style={[lc.statusTxt, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        <View style={lc.timeRow}>
          <Clock size={10} color={MUTED} />
          <Text style={lc.timeTxt}>{fmtTime(log.start_time)} – {fmtTime(log.end_time)}</Text>
        </View>
      </View>

      {/* Collected items */}
      {items.length > 0 ? (
        <View style={lc.itemsRow}>
          {items.map(x => (
            <View key={x.l} style={[lc.itemChip, { borderColor: x.c + "30" }]}>
              <Text style={[lc.itemVal, { color: x.c }]}>{x.v}{x.u}</Text>
              <Text style={lc.itemLbl}>{x.l}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={lc.noItems}>No items recorded</Text>
      )}

      {/* Lineman */}
      {linemanName && (
        <View style={lc.linemanRow}>
          <Zap size={10} color={G} />
          <Text style={lc.linemanTxt}>{linemanName}</Text>
        </View>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function InventoryDetailScreen() {
  const router = useRouter();
  const { nodeId, date, nodeName } = useLocalSearchParams<{
    nodeId: string;
    date: string;
    nodeName: string;
  }>();

  const decodedName = nodeName ? decodeURIComponent(nodeName) : `Node #${nodeId}`;
  const nId = Number(nodeId);

  const [logs,      setLogs]      = useState<TeardownLog[]>([]);
  const [receipt,   setReceipt]   = useState<WarehouseReceipt | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const lastFetchRef = useRef(0);

  const load = useCallback(async (force = false) => {
    if (!force && Date.now() - lastFetchRef.current < 30_000 && logs.length > 0) {
      setRefreshing(false);
      return;
    }
    const token = getBridgeToken() ?? "";
    try {
      // Fetch all teardown logs (cached via lib/api ETag layer)
      const res = await api.get("/skycable/teardowns?per_page=500");
      const raw = res?.data;
      const all: TeardownLog[] = Array.isArray(raw) ? raw : (raw?.data ?? []);

      // Filter to this node + date
      const filtered = all.filter(l => {
        const spanNodeId = (l.span as any)?.node?.id;
        if (spanNodeId !== nId) return false;
        const ts = l.end_time || l.start_time || (l as any).created_at;
        if (!ts) return false;
        return phtDate(ts) === date;
      });
      setLogs(filtered);

      // Fetch receipt for this node + date
      const whs = await getWarehouses(token);
      for (const wh of whs) {
        const recs = await getWarehouseReceipts(token, wh.id);
        const found = recs.find(r => r.node_id === nId && r.receipt_date === date);
        if (found) { setReceipt(found); break; }
      }

      lastFetchRef.current = Date.now();
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [nId, date]);

  useEffect(() => { load(); }, [load]);

  // Totals summary
  const totals = logs.reduce(
    (acc, l) => ({
      cable:     acc.cable     + Number(l.actual_cable         ?? 0),
      node:      acc.node      + Number(l.nodes_collected      ?? 0),
      amplifier: acc.amplifier + Number(l.amplifiers_collected ?? 0),
      extender:  acc.extender  + Number(l.extenders_collected  ?? 0),
      tsc:       acc.tsc       + Number(l.tsc_collected        ?? 0),
      psu:       acc.psu       + Number(l.powersupply_collected?? 0),
    }),
    { cable: 0, node: 0, amplifier: 0, extender: 0, tsc: 0, psu: 0 }
  );

  const receiptStatusColor =
    receipt?.status === "approved" ? "#059669" :
    receipt?.status === "pending"  ? "#f59e0b" :
    receipt?.status === "rejected" ? "#ef4444" : null;
  const receiptStatusLabel =
    receipt?.status === "approved" ? "In Stock" :
    receipt?.status === "pending"  ? "Awaiting Approval" :
    receipt?.status === "rejected" ? "Rejected" : null;

  const totalChips = [
    { l: "Cable",  v: totals.cable,     u: "m", c: "#059669" },
    { l: "Node",   v: totals.node,      u: "",  c: "#0b6cff" },
    { l: "Amp",    v: totals.amplifier, u: "",  c: "#8b5cf6" },
    { l: "Ext",    v: totals.extender,  u: "",  c: "#10b981" },
    { l: "TSC",    v: totals.tsc,       u: "",  c: "#f59e0b" },
    { l: "PSU",    v: totals.psu,       u: "",  c: "#ef4444" },
  ].filter(x => x.v > 0);

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
              <Layers size={16} color={G} />
              <Text style={s.title} numberOfLines={1}>{decodedName}</Text>
            </View>
            <Text style={s.subtitle}>{date ? fmtDate(date) : ""} · {logs.length} span{logs.length !== 1 ? "s" : ""}</Text>
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
          <FlatList
            data={logs}
            keyExtractor={l => String(l.id)}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); load(true); }}
                colors={[G]} tintColor={G}
              />
            }
            ListHeaderComponent={
              <View style={s.summaryCard}>
                {/* Receipt status */}
                {receipt && receiptStatusColor && (
                  <View style={[s.receiptBadge, { backgroundColor: receiptStatusColor + "15", borderColor: receiptStatusColor + "40" }]}>
                    <CheckCircle2 size={13} color={receiptStatusColor} />
                    <Text style={[s.receiptTxt, { color: receiptStatusColor }]}>{receiptStatusLabel}</Text>
                    {receipt.approvedBy && (
                      <Text style={[s.receiptSub, { color: receiptStatusColor }]}>
                        · by {receipt.approvedBy.name}
                      </Text>
                    )}
                  </View>
                )}

                {/* Total collected */}
                <Text style={s.summaryLabel}>TOTAL COLLECTED</Text>
                {totalChips.length > 0 ? (
                  <View style={s.chipsRow}>
                    {totalChips.map(x => (
                      <View key={x.l} style={[s.chip, { borderColor: x.c + "30" }]}>
                        <Text style={[s.chipVal, { color: x.c }]}>{x.v}{x.u}</Text>
                        <Text style={s.chipLbl}>{x.l}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={s.noItems}>No items recorded for this date</Text>
                )}

                <Text style={[s.summaryLabel, { marginTop: 14 }]}>SPAN BREAKDOWN</Text>
              </View>
            }
            renderItem={({ item }) => <SpanLogCard log={item} />}
            ListEmptyComponent={
              <View style={s.empty}>
                <Layers size={40} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No teardown logs</Text>
                <Text style={s.emptySub}>No spans completed for this node on this date.</Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: BG },
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  backBtn:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconBtn:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: G_LIGHT },
  headerText:   { flex: 1 },
  title:        { fontSize: 17, fontWeight: "900", color: SLATE },
  subtitle:     { fontSize: 11, color: MUTED, fontWeight: "600", marginTop: 1 },
  center:       { flex: 1, alignItems: "center", justifyContent: "center" },
  list:         { paddingBottom: 56 },
  summaryCard:  { backgroundColor: WHITE, margin: 16, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 10 },
  receiptBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 14 },
  receiptTxt:   { fontSize: 12, fontWeight: "800" },
  receiptSub:   { fontSize: 11, fontWeight: "600" },
  summaryLabel: { fontSize: 9, fontWeight: "800", color: MUTED, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 },
  chipsRow:     { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip:         { backgroundColor: "#F8FAFC", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, alignItems: "center", borderWidth: 1, minWidth: 52 },
  chipVal:      { fontSize: 15, fontWeight: "900" },
  chipLbl:      { fontSize: 8, fontWeight: "700", color: MUTED, marginTop: 1, textTransform: "uppercase" },
  noItems:      { fontSize: 12, color: MUTED, fontStyle: "italic" },
  empty:        { alignItems: "center", paddingTop: 48, gap: 10 },
  emptyTitle:   { fontSize: 15, fontWeight: "800", color: SLATE },
  emptySub:     { fontSize: 12, color: MUTED, textAlign: "center", paddingHorizontal: 32 },
});

const lc = StyleSheet.create({
  card:        { backgroundColor: WHITE, marginHorizontal: 16, marginBottom: 10, borderRadius: 16, padding: 14, paddingLeft: 18, borderWidth: 1, borderColor: BORDER, overflow: "hidden", elevation: 1 },
  accent:      { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, borderTopLeftRadius: 16, borderBottomLeftRadius: 16 },
  spanRow:     { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  poleChip:    { backgroundColor: "#F1F5F9", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 110 },
  poleCode:    { fontSize: 11, fontWeight: "800", color: SLATE },
  arrow:       { width: 14, height: 1.5, backgroundColor: MUTED },
  spanCode:    { fontSize: 10, fontWeight: "700", color: MUTED, marginLeft: 4 },
  metaRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  dot:         { width: 5, height: 5, borderRadius: 3 },
  statusTxt:   { fontSize: 9, fontWeight: "800" },
  timeRow:     { flexDirection: "row", alignItems: "center", gap: 3 },
  timeTxt:     { fontSize: 10, fontWeight: "600", color: MUTED },
  itemsRow:    { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 8 },
  itemChip:    { backgroundColor: "#F8FAFC", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, alignItems: "center", borderWidth: 1, minWidth: 44 },
  itemVal:     { fontSize: 12, fontWeight: "900" },
  itemLbl:     { fontSize: 7, fontWeight: "700", color: MUTED, marginTop: 1, textTransform: "uppercase" },
  noItems:     { fontSize: 11, color: MUTED, fontStyle: "italic", marginBottom: 6 },
  linemanRow:  { flexDirection: "row", alignItems: "center", gap: 4 },
  linemanTxt:  { fontSize: 10, fontWeight: "700", color: G },
});
