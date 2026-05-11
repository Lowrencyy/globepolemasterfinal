import React, { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  TouchableOpacity, ActivityIndicator, Modal, Pressable, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Cable, Box, User, X, AlertCircle, RefreshCw } from "lucide-react-native";
import api from "@/lib/api";

const GREEN  = "#0A5C3B";
const INDIGO = "#6366F1";
const SLATE  = "#0F172A";
const MUTED  = "#64748B";
const BORDER = "#F1F5F9";

type TeardownLog = {
  id: number;
  status: string;
  actual_cable: number | null;
  expected_cable: number | null;
  nodes_collected: number;
  amplifiers_collected: number;
  extenders_collected: number;
  tsc_collected: number;
  powersupply_collected: number;
  ps_housing_collected: number;
  start_time: string;
  end_time: string | null;
  captured_lat: number | string | null;
  captured_lng: number | string | null;
  span: {
    id: number;
    fromPole?: { pole?: { pole_code: string } };
    toPole?:   { pole?: { pole_code: string } };
    node?: { name: string };
  } | null;
  team: { name: string } | null;
  lineman: { id: number; name?: string; first_name?: string; last_name?: string } | null;
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function fmtDay(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-PH", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

function fromCode(log: TeardownLog) { return log.span?.fromPole?.pole?.pole_code ?? "—"; }
function toCode(log: TeardownLog)   { return log.span?.toPole?.pole?.pole_code   ?? "—"; }
function linemanName(log: TeardownLog) {
  if (!log.lineman) return "—";
  const full = `${log.lineman.first_name ?? ""} ${log.lineman.last_name ?? ""}`.trim();
  return log.lineman.name ?? (full || "—");
}

const STATUS_COLOR: Record<string, string> = {
  submitted: "#3B82F6", subcon_approved: "#10B981",
  backend_approved: "#16A34A", rejected: "#EF4444", pending: "#F59E0B",
};
const STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted", subcon_approved: "Sub-con Approved",
  backend_approved: "Approved", rejected: "Rejected", pending: "Pending",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#94A3B8";
  return (
    <View style={[sb.badge, { backgroundColor: color + "18", borderColor: color + "40" }]}>
      <View style={[sb.dot, { backgroundColor: color }]} />
      <Text style={[sb.lbl, { color }]}>{STATUS_LABEL[status] ?? status}</Text>
    </View>
  );
}
const sb = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, borderWidth: 1 },
  dot:   { width: 5, height: 5, borderRadius: 3, marginRight: 5 },
  lbl:   { fontSize: 11, fontWeight: "700" },
});

// ── Detail Modal ─────────────────────────────────────────────────────────

function DetailModal({ log, visible, onClose }: { log: TeardownLog | null; visible: boolean; onClose: () => void }) {
  if (!log) return null;
  const components = [
    { label: "Nodes",        count: log.nodes_collected },
    { label: "Amplifiers",   count: log.amplifiers_collected },
    { label: "Extenders",    count: log.extenders_collected },
    { label: "TSC",          count: log.tsc_collected },
    { label: "Power Supply", count: log.powersupply_collected },
    { label: "PS Housing",   count: log.ps_housing_collected },
  ].filter(c => (c.count ?? 0) > 0);

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={dm.overlay}>
        <View style={dm.sheet}>
          <View style={dm.handle} />
          <View style={dm.headerRow}>
            <View>
              <Text style={dm.codes}>
                <Text style={{ color: GREEN }}>{fromCode(log)}</Text>
                <Text style={{ color: MUTED }}> → </Text>
                <Text style={{ color: INDIGO }}>{toCode(log)}</Text>
              </Text>
              <Text style={dm.sub}>{log.span?.node?.name ?? "—"}</Text>
            </View>
            <Pressable style={dm.closeBtn} onPress={onClose}>
              <X size={20} color={MUTED} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={dm.body} showsVerticalScrollIndicator={false}>
            <View style={{ marginBottom: 16 }}><StatusBadge status={log.status} /></View>
            <View style={dm.card}>
              <Text style={dm.cardTitle}>CABLE</Text>
              <View style={{ flexDirection: "row", gap: 16 }}>
                <View><Text style={dm.kvLabel}>Collected</Text><Text style={[dm.kvVal, { color: GREEN }]}>{log.actual_cable ?? 0}m</Text></View>
                <View><Text style={dm.kvLabel}>Expected</Text><Text style={dm.kvVal}>{log.expected_cable ?? 0}m</Text></View>
              </View>
            </View>
            {components.length > 0 && (
              <View style={dm.card}>
                <Text style={dm.cardTitle}>COMPONENTS</Text>
                <View style={dm.compGrid}>
                  {components.map(c => (
                    <View key={c.label} style={dm.compChip}>
                      <Text style={dm.compNum}>{c.count}</Text>
                      <Text style={dm.compLbl}>{c.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            <View style={dm.card}>
              <Text style={dm.cardTitle}>TIMELINE</Text>
              <View><Text style={dm.kvLabel}>Started</Text><Text style={dm.kvVal}>{fmtDate(log.start_time)}</Text></View>
              {log.end_time && <View style={{ marginTop: 8 }}><Text style={dm.kvLabel}>Completed</Text><Text style={dm.kvVal}>{fmtDate(log.end_time)}</Text></View>}
            </View>
            <View style={dm.card}>
              <Text style={dm.cardTitle}>SUBMITTED BY</Text>
              <Text style={dm.bigName}>{linemanName(log)}</Text>
              {log.team && <Text style={dm.teamLbl}>{log.team.name}</Text>}
            </View>
            {log.captured_lat && log.captured_lng && (
              <View style={dm.card}>
                <Text style={dm.cardTitle}>GPS LOCATION</Text>
                <Text style={dm.kvVal}>{Number(log.captured_lat).toFixed(6)}, {Number(log.captured_lng).toFixed(6)}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const dm = StyleSheet.create({
  overlay:   { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.55)" },
  sheet:     { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 12, maxHeight: "85%" },
  handle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E2E8F0", alignSelf: "center", marginBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 4 },
  codes:     { fontSize: 20, fontWeight: "900" },
  sub:       { fontSize: 13, color: MUTED, fontWeight: "500", marginTop: 4 },
  closeBtn:  { padding: 4 },
  body:      { padding: 20, paddingBottom: 40 },
  card:      { backgroundColor: "#F8FAFC", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 12 },
  cardTitle: { fontSize: 10, fontWeight: "800", color: MUTED, letterSpacing: 1, marginBottom: 12, textTransform: "uppercase" },
  kvLabel:   { fontSize: 11, color: MUTED, fontWeight: "600", marginBottom: 2 },
  kvVal:     { fontSize: 15, fontWeight: "800", color: SLATE },
  compGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  compChip:  { backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: BORDER, alignItems: "center" },
  compNum:   { fontSize: 18, fontWeight: "900", color: INDIGO },
  compLbl:   { fontSize: 10, fontWeight: "600", color: MUTED, marginTop: 2 },
  bigName:   { fontSize: 18, fontWeight: "800", color: SLATE },
  teamLbl:   { fontSize: 13, color: MUTED, fontWeight: "500", marginTop: 4 },
});

// ── Log Card ──────────────────────────────────────────────────────────────

function LogCard({ log, onPress }: { log: TeardownLog; onPress: () => void }) {
  const cable = log.actual_cable ?? 0;
  const totalComponents = (log.nodes_collected ?? 0) + (log.amplifiers_collected ?? 0) +
    (log.extenders_collected ?? 0) + (log.tsc_collected ?? 0) +
    (log.powersupply_collected ?? 0) + (log.ps_housing_collected ?? 0);

  return (
    <TouchableOpacity style={lc.card} activeOpacity={0.75} onPress={onPress}>
      <View style={lc.topRow}>
        <View style={lc.timeBox}>
          <Text style={lc.time}>{log.end_time ? fmtTime(log.end_time) : fmtTime(log.start_time)}</Text>
        </View>
        <View style={lc.codes}>
          <Text style={lc.fromCode}>{fromCode(log)}</Text>
          <Text style={lc.arrow}> → </Text>
          <Text style={lc.toCode}>{toCode(log)}</Text>
        </View>
        <StatusBadge status={log.status} />
      </View>
      {log.span?.node?.name && <Text style={lc.node}>{log.span.node.name}</Text>}
      <View style={lc.statsRow}>
        <View style={lc.stat}><Cable size={12} color={GREEN} /><Text style={lc.statVal}>{cable}m</Text></View>
        {totalComponents > 0 && <View style={lc.stat}><Box size={12} color={INDIGO} /><Text style={[lc.statVal, { color: INDIGO }]}>{totalComponents} items</Text></View>}
        <View style={lc.stat}><User size={12} color={MUTED} /><Text style={lc.statMuted} numberOfLines={1}>{linemanName(log)}</Text></View>
      </View>
    </TouchableOpacity>
  );
}

const lc = StyleSheet.create({
  card:     { backgroundColor: "#fff", borderRadius: 18, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: BORDER, shadowColor: SLATE, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  topRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  timeBox:  { backgroundColor: "#F8FAFC", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: BORDER },
  time:     { fontSize: 11, fontWeight: "700", color: MUTED },
  codes:    { flex: 1, flexDirection: "row", alignItems: "center" },
  fromCode: { fontSize: 14, fontWeight: "800", color: GREEN },
  arrow:    { fontSize: 12, color: MUTED },
  toCode:   { fontSize: 14, fontWeight: "800", color: INDIGO },
  node:     { fontSize: 12, color: MUTED, fontWeight: "500", marginBottom: 8 },
  statsRow: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  stat:     { flexDirection: "row", alignItems: "center", gap: 4 },
  statVal:  { fontSize: 12, fontWeight: "700", color: SLATE },
  statMuted:{ fontSize: 12, color: MUTED, fontWeight: "500" },
});

// ── Main Screen ───────────────────────────────────────────────────────────

export default function DailyLogsScreen() {
  const router = useRouter();
  const { date } = useLocalSearchParams<{ date: string }>();

  const [allLogs,    setAllLogs]    = useState<TeardownLog[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [selected,   setSelected]   = useState<TeardownLog | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setError(null);
      const { data } = await api.get(`/skycable/teardowns?per_page=500&date=${date}`);
      setAllLogs(data?.data ?? data ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchLogs();
  }, [fetchLogs]));

  // Filter client-side by date as well (backend might not support date filter)
  const logs = useMemo(() =>
    allLogs.filter(l => (l.end_time ?? l.start_time).slice(0, 10) === date),
    [allLogs, date]);

  const totalCable = logs.reduce((s, l) => s + (l.actual_cable ?? 0), 0);
  const totalComponents = logs.reduce((s, l) =>
    s + (l.nodes_collected ?? 0) + (l.amplifiers_collected ?? 0) +
    (l.extenders_collected ?? 0) + (l.tsc_collected ?? 0) +
    (l.powersupply_collected ?? 0) + (l.ps_housing_collected ?? 0), 0);

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <DetailModal log={selected} visible={!!selected} onClose={() => setSelected(null)} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={22} color={SLATE} />
        </TouchableOpacity>
        <View style={s.headerMid}>
          <Text style={s.title} numberOfLines={1}>{date ? fmtDay(date) : "Daily Logs"}</Text>
          <Text style={s.sub}>{logs.length} teardown{logs.length !== 1 ? "s" : ""}</Text>
        </View>
      </View>

      {/* Summary strip */}
      {!loading && logs.length > 0 && (
        <View style={s.strip}>
          <View style={s.stripStat}>
            <Text style={[s.stripNum, { color: GREEN }]}>{totalCable}m</Text>
            <Text style={s.stripLbl}>Cable</Text>
          </View>
          <View style={s.stripDiv} />
          <View style={s.stripStat}>
            <Text style={[s.stripNum, { color: INDIGO }]}>{totalComponents}</Text>
            <Text style={s.stripLbl}>Components</Text>
          </View>
          <View style={s.stripDiv} />
          <View style={s.stripStat}>
            <Text style={s.stripNum}>{logs.filter(l => l.status === "backend_approved").length}</Text>
            <Text style={s.stripLbl}>Approved</Text>
          </View>
        </View>
      )}

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator color={GREEN} size="large" />
          <Text style={s.loadTxt}>Loading logs…</Text>
        </View>
      ) : error ? (
        <View style={s.centered}>
          <AlertCircle size={40} color="#EF4444" />
          <Text style={s.errTxt}>{error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); fetchLogs(); }}>
            <RefreshCw size={14} color={GREEN} />
            <Text style={s.retryTxt}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLogs(); }} colors={[GREEN]} />}
          ListEmptyComponent={
            <View style={s.centered}>
              <Text style={s.errTxt}>No teardowns found for this date.</Text>
            </View>
          }
          renderItem={({ item }) => <LogCard log={item} onPress={() => setSelected(item)} />}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: "#F8FAFC" },
  header:  { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff", borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center" },
  headerMid: { flex: 1 },
  title:   { fontSize: 18, fontWeight: "900", color: SLATE },
  sub:     { fontSize: 13, color: MUTED, fontWeight: "500", marginTop: 2 },

  strip:    { flexDirection: "row", backgroundColor: "#fff", marginHorizontal: 16, borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: BORDER, shadowColor: SLATE, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  stripStat:{ flex: 1, alignItems: "center" },
  stripNum: { fontSize: 20, fontWeight: "900", color: SLATE },
  stripLbl: { fontSize: 10, fontWeight: "600", color: MUTED, marginTop: 2 },
  stripDiv: { width: 1, backgroundColor: BORDER, marginHorizontal: 4 },

  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  loadTxt:  { fontSize: 14, color: MUTED, marginTop: 12, fontWeight: "500" },
  errTxt:   { fontSize: 14, color: "#DC2626", textAlign: "center", marginTop: 12, fontWeight: "600" },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 16, backgroundColor: "#F0FDF4", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  retryTxt: { fontSize: 14, fontWeight: "700", color: GREEN },

  content:  { paddingHorizontal: 16, paddingBottom: 100, paddingTop: 4 },
});
