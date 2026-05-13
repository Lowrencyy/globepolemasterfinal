import { useAuth } from "@/context/auth-context";
import api from "@/lib/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import {
  AlertCircle,
  BarChart3,
  Box,
  Cable,
  ClipboardList,
  RefreshCw,
  User,
  X,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const GREEN = "#0A5C3B";
const GREEN_L = "#F0FDF4";
const INDIGO = "#6366F1";
const SLATE = "#0F172A";
const MUTED = "#64748B";
const BORDER = "#F1F5F9";
const CACHE_KEY = "teardown_logs_cache_v1";

type Photo = { photo_type: string; image_path: string };

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
    status: string;
    fromPole?: { pole?: { pole_code: string } };
    toPole?: { pole?: { pole_code: string } };
    node?: { name: string; id: number };
  } | null;
  team: { name: string } | null;
  lineman: {
    id: number;
    name: string;
    first_name?: string;
    last_name?: string;
  } | null;
  photos: Photo[];
};

type FilterMode = "all" | "mine";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function fromCode(log: TeardownLog) {
  return log.span?.fromPole?.pole?.pole_code ?? "—";
}

function toCode(log: TeardownLog) {
  return log.span?.toPole?.pole?.pole_code ?? "—";
}

function linemanName(log: TeardownLog) {
  if (!log.lineman) return "—";
  const full =
    `${log.lineman.first_name ?? ""} ${log.lineman.last_name ?? ""}`.trim();
  return log.lineman.name ?? (full || "—");
}

const STATUS_COLOR: Record<string, string> = {
  submitted: "#3B82F6",
  subcon_approved: "#10B981",
  backend_approved: "#16A34A",
  rejected: "#EF4444",
  pending: "#F59E0B",
};

const STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  subcon_approved: "Sub-con Approved",
  backend_approved: "Approved",
  rejected: "Rejected",
  pending: "Pending",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#94A3B8";

  return (
    <View
      style={[
        sb.badge,
        { backgroundColor: color + "18", borderColor: color + "40" },
      ]}
    >
      <View style={[sb.dot, { backgroundColor: color }]} />
      <Text style={[sb.label, { color }]}>
        {STATUS_LABEL[status] ?? status}
      </Text>
    </View>
  );
}

const sb = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    borderWidth: 1,
  },
  dot: { width: 5, height: 5, borderRadius: 3, marginRight: 5 },
  label: { fontSize: 11, fontWeight: "700" },
});

function LogCard({ log, onPress }: { log: TeardownLog; onPress: () => void }) {
  const cable = log.actual_cable ?? 0;
  const expected = log.expected_cable ?? 0;
  const totalComponents =
    (log.nodes_collected ?? 0) +
    (log.amplifiers_collected ?? 0) +
    (log.extenders_collected ?? 0) +
    (log.tsc_collected ?? 0) +
    (log.powersupply_collected ?? 0) +
    (log.ps_housing_collected ?? 0);

  return (
    <TouchableOpacity style={lc.card} activeOpacity={0.75} onPress={onPress}>
      <View style={lc.topRow}>
        <View style={lc.codesWrap}>
          <Text style={lc.fromCode}>{fromCode(log)}</Text>
          <Text style={lc.arrow}> → </Text>
          <Text style={lc.toCode}>{toCode(log)}</Text>
        </View>
        <StatusBadge status={log.status} />
      </View>

      {log.span?.node?.name ? (
        <Text style={lc.nodeName}>{log.span.node.name}</Text>
      ) : null}

      <View style={lc.statsRow}>
        <View style={lc.stat}>
          <Cable size={12} color={GREEN} />
          <Text style={lc.statVal}>{cable}m</Text>
          {expected > 0 ? (
            <Text style={lc.statMuted}>/ {expected}m</Text>
          ) : null}
        </View>

        {totalComponents > 0 ? (
          <View style={lc.stat}>
            <Box size={12} color={INDIGO} />
            <Text style={[lc.statVal, { color: INDIGO }]}>
              {totalComponents} items
            </Text>
          </View>
        ) : null}

        <View style={lc.stat}>
          <User size={12} color={MUTED} />
          <Text style={lc.statMuted} numberOfLines={1}>
            {linemanName(log)}
          </Text>
        </View>
      </View>

      <Text style={lc.date}>
        {log.end_time ? fmtDate(log.end_time) : fmtDate(log.start_time)}
      </Text>
    </TouchableOpacity>
  );
}

const lc = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: SLATE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  codesWrap: { flexDirection: "row", alignItems: "center" },
  fromCode: { fontSize: 15, fontWeight: "800", color: GREEN },
  arrow: { fontSize: 13, color: MUTED, fontWeight: "600" },
  toCode: { fontSize: 15, fontWeight: "800", color: INDIGO },
  nodeName: { fontSize: 12, color: MUTED, fontWeight: "500", marginBottom: 10 },
  statsRow: {
    flexDirection: "row",
    gap: 14,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statVal: { fontSize: 12, fontWeight: "700", color: SLATE },
  statMuted: { fontSize: 12, color: MUTED, fontWeight: "500" },
  date: { fontSize: 11, color: "#94A3B8", fontWeight: "500" },
});

function DetailModal({
  log,
  visible,
  onClose,
}: {
  log: TeardownLog | null;
  visible: boolean;
  onClose: () => void;
}) {
  if (!log) return null;

  const components = [
    { label: "Nodes", count: log.nodes_collected },
    { label: "Amplifiers", count: log.amplifiers_collected },
    { label: "Extenders", count: log.extenders_collected },
    { label: "TSC", count: log.tsc_collected },
    { label: "Power Supply", count: log.powersupply_collected },
    { label: "PS Housing", count: log.ps_housing_collected },
  ].filter((c) => (c.count ?? 0) > 0);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
    >
      <View style={dm.overlay}>
        <View style={dm.sheet}>
          <View style={dm.handle} />
          <View style={dm.headerRow}>
            <View>
              <Text style={dm.headerCodes}>
                <Text style={{ color: GREEN }}>{fromCode(log)}</Text>
                <Text style={{ color: MUTED }}> → </Text>
                <Text style={{ color: INDIGO }}>{toCode(log)}</Text>
              </Text>
              <Text style={dm.headerSub}>{log.span?.node?.name ?? "—"}</Text>
            </View>
            <Pressable style={dm.closeBtn} onPress={onClose}>
              <X size={20} color={MUTED} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={dm.body}
            showsVerticalScrollIndicator={false}
          >
            <View style={dm.section}>
              <StatusBadge status={log.status} />
            </View>

            <View style={dm.card}>
              <Text style={dm.cardTitle}>CABLE</Text>
              <View style={dm.row}>
                <View style={dm.kv}>
                  <Text style={dm.kvLabel}>Collected</Text>
                  <Text style={[dm.kvVal, { color: GREEN }]}>
                    {log.actual_cable ?? 0}m
                  </Text>
                </View>
                <View style={dm.kv}>
                  <Text style={dm.kvLabel}>Expected</Text>
                  <Text style={dm.kvVal}>{log.expected_cable ?? 0}m</Text>
                </View>
              </View>
            </View>

            {components.length > 0 ? (
              <View style={dm.card}>
                <Text style={dm.cardTitle}>COMPONENTS COLLECTED</Text>
                <View style={dm.compGrid}>
                  {components.map((c) => (
                    <View key={c.label} style={dm.compChip}>
                      <Text style={dm.compNum}>{c.count}</Text>
                      <Text style={dm.compLbl}>{c.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={dm.card}>
              <Text style={dm.cardTitle}>TIMELINE</Text>
              <View style={dm.kv}>
                <Text style={dm.kvLabel}>Started</Text>
                <Text style={dm.kvVal}>{fmtDate(log.start_time)}</Text>
              </View>
              {log.end_time ? (
                <View style={[dm.kv, { marginTop: 8 }]}>
                  <Text style={dm.kvLabel}>Completed</Text>
                  <Text style={dm.kvVal}>{fmtDate(log.end_time)}</Text>
                </View>
              ) : null}
            </View>

            <View style={dm.card}>
              <Text style={dm.cardTitle}>SUBMITTED BY</Text>
              <Text style={dm.bigName}>{linemanName(log)}</Text>
              {log.team ? (
                <Text style={dm.teamLabel}>{log.team.name}</Text>
              ) : null}
            </View>

            {log.captured_lat && log.captured_lng ? (
              <View style={dm.card}>
                <Text style={dm.cardTitle}>GPS LOCATION</Text>
                <Text style={dm.kvVal}>
                  {Number(log.captured_lat).toFixed(6)},{" "}
                  {Number(log.captured_lng).toFixed(6)}
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const dm = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15,23,42,0.55)",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    maxHeight: "85%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E2E8F0",
    alignSelf: "center",
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  headerCodes: { fontSize: 20, fontWeight: "900" },
  headerSub: { fontSize: 13, color: MUTED, fontWeight: "500", marginTop: 4 },
  closeBtn: { padding: 4 },
  body: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 16 },
  card: {
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 10,
    fontWeight: "800",
    color: MUTED,
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: "uppercase",
  },
  row: { flexDirection: "row", gap: 16 },
  kv: {},
  kvLabel: { fontSize: 11, color: MUTED, fontWeight: "600", marginBottom: 2 },
  kvVal: { fontSize: 15, fontWeight: "800", color: SLATE },
  compGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  compChip: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
  },
  compNum: { fontSize: 18, fontWeight: "900", color: INDIGO },
  compLbl: { fontSize: 10, fontWeight: "600", color: MUTED, marginTop: 2 },
  bigName: { fontSize: 18, fontWeight: "800", color: SLATE },
  teamLabel: { fontSize: 13, color: MUTED, fontWeight: "500", marginTop: 4 },
});

export default function LogsScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [logs, setLogs] = useState<TeardownLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<TeardownLog | null>(null);

  const saveLogsCache = useCallback(async (items: TeardownLog[]) => {
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(items));
    } catch {
      // Ignore cache write errors.
    }
  }, []);

  const loadLogsCache = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (!raw) return false;

      const items = JSON.parse(raw);
      if (!Array.isArray(items)) return false;

      setLogs(items);
      setLoading(false);
      return items.length > 0;
    } catch {
      return false;
    }
  }, []);

  const fetchLogs = useCallback(
    async (silent = false) => {
      try {
        setError(null);
        if (silent) setBackgroundSyncing(true);

        const { data } = await api.get("/skycable/teardowns?per_page=200");
        const items: TeardownLog[] = data?.data ?? data ?? [];

        setLogs(items);
        await saveLogsCache(items);
      } catch (e: any) {
        const msg = e?.message ?? "";
        const friendlyError =
          e?.name === "AbortError" || msg.toLowerCase().includes("abort")
            ? "Connection timed out. Server response is slow, please check internet or try again."
            : msg || "Failed to load teardown logs.";

        setError((current) => (logs.length > 0 ? current : friendlyError));
      } finally {
        setLoading(false);
        setRefreshing(false);
        setBackgroundSyncing(false);
      }
    },
    [logs.length, saveLogsCache],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const start = async () => {
        const hasCache = await loadLogsCache();
        if (!active) return;
        await fetchLogs(hasCache);
      };

      start();

      return () => {
        active = false;
      };
    }, [fetchLogs, loadLogsCache]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchLogs(false);
  };

  const filteredLogs = useMemo(() => {
    if (filterMode === "mine" && user) {
      return logs.filter((l) => l.lineman?.id === (user as any).id);
    }
    return logs;
  }, [logs, filterMode, user]);

  const hasAnyLogs = logs.length > 0;

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <DetailModal
        log={selectedLog}
        visible={!!selectedLog}
        onClose={() => setSelectedLog(null)}
      />

      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>Teardown Logs</Text>
          <Text style={s.headerSub}>
            {filteredLogs.length} report{filteredLogs.length !== 1 ? "s" : ""}
            {backgroundSyncing ? " · updating…" : ""}
          </Text>
        </View>
        <TouchableOpacity
          style={s.dailyBtn}
          onPress={() => router.push("/daily-report" as any)}
        >
          <BarChart3 size={15} color="#fff" />
          <Text style={s.dailyBtnText}>Daily Report</Text>
        </TouchableOpacity>
      </View>

      <View style={s.filterBar}>
        <TouchableOpacity
          style={[s.filterChip, filterMode === "all" && s.filterChipActive]}
          onPress={() => setFilterMode("all")}
        >
          <Text
            style={[
              s.filterChipText,
              filterMode === "all" && s.filterChipTextActive,
            ]}
          >
            All Logs
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.filterChip, filterMode === "mine" && s.filterChipActive]}
          onPress={() => setFilterMode("mine")}
        >
          <Text
            style={[
              s.filterChipText,
              filterMode === "mine" && s.filterChipTextActive,
            ]}
          >
            My Reports
          </Text>
        </TouchableOpacity>
      </View>

      {loading && !hasAnyLogs ? (
        <View style={s.centered}>
          <ActivityIndicator color={GREEN} size="large" />
          <Text style={s.loadingText}>Loading teardown logs…</Text>
        </View>
      ) : error && !hasAnyLogs ? (
        <View style={s.centered}>
          <AlertCircle size={40} color="#EF4444" />
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => {
              setLoading(true);
              fetchLogs(false);
            }}
          >
            <RefreshCw size={14} color={GREEN} />
            <Text style={s.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : filteredLogs.length === 0 ? (
        <ScrollView
          contentContainerStyle={s.emptyContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[GREEN]}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <ClipboardList size={48} color="#CBD5E1" />
          <Text style={s.emptyTitle}>No teardown logs</Text>
          <Text style={s.emptySub}>
            {filterMode === "mine"
              ? "You have not submitted any teardown reports yet."
              : "Submitted teardowns will appear here."}
          </Text>
        </ScrollView>
      ) : (
        <FlatList
          data={filteredLogs}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[GREEN]}
            />
          }
          renderItem={({ item }) => (
            <LogCard log={item} onPress={() => setSelectedLog(item)} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F8FAFC" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTitle: { fontSize: 24, fontWeight: "900", color: SLATE },
  headerSub: { fontSize: 13, color: MUTED, fontWeight: "500", marginTop: 2 },
  dailyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: SLATE,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
  },
  dailyBtnText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  filterBar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 100,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
  },
  filterChipActive: { backgroundColor: GREEN_L, borderColor: GREEN + "40" },
  filterChipText: { fontSize: 13, fontWeight: "600", color: MUTED },
  filterChipTextActive: { color: GREEN, fontWeight: "700" },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingBottom: 100,
  },
  emptyContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingBottom: 120,
  },
  loadingText: { fontSize: 14, color: MUTED, marginTop: 12, fontWeight: "500" },
  errorText: {
    fontSize: 14,
    color: "#DC2626",
    textAlign: "center",
    marginTop: 12,
    fontWeight: "600",
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
    backgroundColor: GREEN_L,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  retryBtnText: { fontSize: 14, fontWeight: "700", color: GREEN },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: SLATE, marginTop: 16 },
  emptySub: {
    fontSize: 13,
    color: MUTED,
    fontWeight: "500",
    marginTop: 6,
    textAlign: "center",
  },
});
