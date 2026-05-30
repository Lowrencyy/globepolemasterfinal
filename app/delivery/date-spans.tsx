import api from "@/lib/api";
import { calcDeliveryTotals, type TeardownLog } from "@/services/skycable";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronLeft,
  RefreshCw,
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
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

const G       = "#006241";
const G_LIGHT = "#ECFDF5";
const SLATE   = "#111827";
const MUTED   = "#667085";
const BORDER  = "#E7ECF2";
const WHITE   = "#FFFFFF";
const BG      = "#F4F8F5";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}

function fmtTime(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  const h = d.getUTCHours(), mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${mi} ${h >= 12 ? "PM" : "AM"}`;
}

// ── Stat chip ─────────────────────────────────────────────────────────────────
function StatChip({ label, value, unit, color }: {
  label: string; value: number; unit?: string; color: string;
}) {
  return (
    <View style={[sc.chip, { borderColor: color + "30" }]}>
      <Text
        style={[sc.val, { color }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {value}{unit ?? ""}
      </Text>
      <Text style={sc.lbl}>{label}</Text>
    </View>
  );
}

// ── Span card ─────────────────────────────────────────────────────────────────
function SpanCard({ log, index, onPress }: { log: TeardownLog; index: number; onPress: () => void }) {
  const span     = log.span as any;
  const fromCode = span?.fromPole?.pole?.pole_code?.trim();
  const toCode   = span?.toPole?.pole?.pole_code?.trim();
  const spanCode = span?.span_code ?? null;

  const linemanName  = log.lineman
    ? `${(log.lineman as any).first_name ?? ""} ${(log.lineman as any).last_name ?? ""}`.trim()
    : "Unknown";
  const subconName   = log.team?.subcontractor?.name ?? log.team?.name ?? null;

  const startStr = log.start_time ? fmtTime(log.start_time) : "—";
  const endStr   = log.end_time   ? fmtTime(log.end_time)   : "—";

  const chips = [
    { l: "Cable", v: Number(log.actual_cable ?? 0),          u: "m", c: "#059669" },
    { l: "Node",  v: Number(log.nodes_collected ?? 0),        u: "",  c: "#0b6cff" },
    { l: "Amp",   v: Number(log.amplifiers_collected ?? 0),   u: "",  c: "#8b5cf6" },
    { l: "Ext",   v: Number(log.extenders_collected ?? 0),    u: "",  c: "#10b981" },
    { l: "TSC",   v: Number(log.tsc_collected ?? 0),          u: "",  c: "#f59e0b" },
    { l: "PSU",   v: Number(log.powersupply_collected ?? 0),  u: "",  c: "#ef4444" },
    { l: "Case",  v: Number(log.ps_housing_collected ?? 0),   u: "",  c: "#64748b" },
  ];

  return (
    <TouchableOpacity style={sp.card} onPress={onPress} activeOpacity={0.75}>
      {/* Span badge + time range */}
      <View style={sp.topRow}>
        <View style={sp.badge}>
          <Text style={sp.badgeTxt}>SPAN {index + 1}</Text>
        </View>
        <Text style={sp.timeRange}>{startStr} – {endStr}</Text>
      </View>

      {/* FROM → TO */}
      <View style={sp.routeBox}>
        <View style={sp.endpoint}>
          <Text style={sp.endpointLabel}>FROM</Text>
          <Text style={sp.endpointCode} numberOfLines={2}>
            {fromCode || spanCode || "—"}
          </Text>
        </View>
        <Text style={sp.arrow}>→</Text>
        <View style={[sp.endpoint, { alignItems: "flex-end" }]}>
          <Text style={sp.endpointLabel}>TO</Text>
          <Text style={[sp.endpointCode, { textAlign: "right" }]} numberOfLines={2}>
            {toCode || spanCode || "—"}
          </Text>
        </View>
      </View>

      {/* Collected — 7 in one row */}
      <Text style={sp.collectedLabel}>COLLECTED</Text>
      <View style={sp.chips}>
        {chips.map(x => (
          <View key={x.l} style={[sp.chip, { borderColor: x.c + "28" }]}>
            <Text style={[sp.chipVal, { color: x.c }]}>{x.v}{x.u}</Text>
            <Text style={sp.chipLbl}>{x.l}</Text>
          </View>
        ))}
      </View>

      {/* Lineman + subcon */}
      <View style={sp.linemanRow}>
        <Text style={sp.linemanIcon}>👤</Text>
        <Text style={sp.linemanName} numberOfLines={1}>{linemanName}</Text>
        {subconName && (
          <Text style={sp.subconName} numberOfLines={1}>{subconName}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DateSpansPage() {
  const router = useRouter();
  const { nodeId, nodeName, date } = useLocalSearchParams<{
    nodeId: string;
    nodeName: string;
    date: string;
  }>();

  const decodedName = nodeName ? decodeURIComponent(nodeName) : `Node #${nodeId}`;

  const [logs,      setLogs]      = useState<TeardownLog[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await api.get(
        `/skycable/teardowns?node_id=${nodeId}&date=${date}&per_page=500`
      );
      const raw = res?.data;
      const all: TeardownLog[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
      // filter client-side to only this date (start_time or end_time)
      const filtered = all.filter(l => {
        const ts = l.end_time || l.start_time || (l as any).created_at;
        if (!ts) return false;
        const d = new Date(new Date(ts).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
        return d === date;
      });
      setLogs(filtered);
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [nodeId, date]);

  // load on mount
  useState(() => { loadData(); });

  const totals = useMemo(() => calcDeliveryTotals(logs), [logs]);

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
            <Text style={s.subtitle}>{fmtDate(date ?? "")} · {logs.length} span{logs.length !== 1 ? "s" : ""}</Text>
          </View>
          <TouchableOpacity style={s.iconBtn} onPress={() => { setRefreshing(true); loadData(); }}>
            <RefreshCw size={16} color={G} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={G} size="large" />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={s.scroll}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} colors={[G]} tintColor={G} />
            }
          >
            {/* Day totals summary card */}
            <View style={s.summaryCard}>
              <Text style={s.summaryTitle}>Total Collected · {fmtDate(date ?? "")}</Text>
              <View style={s.summaryGrid}>
                <StatChip label="Cable"  value={totals.cable}     unit="m" color="#059669" />
                <StatChip label="Node"   value={totals.node}           color="#0b6cff" />
                <StatChip label="Amp"    value={totals.amplifier}      color="#8b5cf6" />
                <StatChip label="Ext"    value={totals.extender}       color="#10b981" />
                <StatChip label="TSC"    value={totals.tsc}            color="#f59e0b" />
                <StatChip label="PSU"    value={totals.psu}            color="#ef4444" />
                <StatChip label="Case"   value={totals.psuCase}        color="#64748b" />
              </View>
            </View>

            {/* Span cards */}
            {logs.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyTitle}>No spans for this day</Text>
                <Text style={s.emptySub}>Pull down to refresh.</Text>
              </View>
            ) : (
              logs.map((l, i) => (
                <SpanCard
                  key={l.id}
                  log={l}
                  index={i}
                  onPress={() => router.push({
                    pathname: "/delivery/span-detail",
                    params: {
                      teardownId: String(l.id),
                      spanIndex:  String(i + 1),
                      nodeName:   encodeURIComponent(decodedName),
                    },
                  })}
                />
              ))
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: BG },
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: BG, gap: 8 },
  backBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: G_LIGHT },
  headerText:  { flex: 1 },
  title:       { fontSize: 17, fontWeight: "900", color: SLATE },
  subtitle:    { fontSize: 11, color: MUTED, fontWeight: "600" },
  center:      { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll:      { padding: 16, paddingBottom: 48, gap: 12 },
  summaryCard: { backgroundColor: WHITE, borderRadius: 18, borderWidth: 1.5, borderColor: G + "30", padding: 14, marginBottom: 4 },
  summaryTitle:{ fontSize: 12, fontWeight: "900", color: G, marginBottom: 10, letterSpacing: 0.3 },
  summaryGrid: { flexDirection: "row", gap: 4 },
  empty:       { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTitle:  { fontSize: 16, fontWeight: "800", color: SLATE },
  emptySub:    { fontSize: 12, color: MUTED },
});

const sc = StyleSheet.create({
  chip: { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 2, alignItems: "center", borderWidth: 1 },
  val:  { fontSize: 13, fontWeight: "900", width: "100%", textAlign: "center" },
  lbl:  { fontSize: 7, fontWeight: "700", color: MUTED, marginTop: 1, textTransform: "uppercase" },
});

const sp = StyleSheet.create({
  card:           { backgroundColor: WHITE, borderRadius: 16, borderWidth: 1.5, borderColor: BORDER, padding: 14, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  topRow:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  badge:          { backgroundColor: G + "18", borderRadius: 7, paddingHorizontal: 9, paddingVertical: 3 },
  badgeTxt:       { fontSize: 10, fontWeight: "900", color: G, letterSpacing: 0.8 },
  timeRange:      { fontSize: 11, color: MUTED, fontWeight: "600" },
  routeBox:       { flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10 },
  endpoint:       { flex: 1 },
  endpointLabel:  { fontSize: 9, fontWeight: "800", color: MUTED, letterSpacing: 1, textTransform: "uppercase" },
  endpointCode:   { fontSize: 13, fontWeight: "900", color: SLATE, marginTop: 2 },
  arrow:          { fontSize: 18, fontWeight: "900", color: G, marginHorizontal: 10 },
  collectedLabel: { fontSize: 9, fontWeight: "900", color: MUTED, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 },
  chips:          { flexDirection: "row", gap: 4, marginBottom: 10 },
  chip:           { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 8, paddingVertical: 5, paddingHorizontal: 2, alignItems: "center", borderWidth: 1 },
  chipVal:        { fontSize: 11, fontWeight: "900" },
  chipLbl:        { fontSize: 7, fontWeight: "700", color: MUTED, textTransform: "uppercase", marginTop: 1 },
  linemanRow:     { flexDirection: "row", alignItems: "center", gap: 5 },
  linemanIcon:    { fontSize: 11 },
  linemanName:    { fontSize: 11, color: MUTED, fontWeight: "700", flex: 1 },
  subconName:     { fontSize: 10, color: G, fontWeight: "800", textAlign: "right" },
});
