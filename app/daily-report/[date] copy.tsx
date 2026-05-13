import api from "@/lib/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import {
  AlertCircle,
  Box,
  Cable,
  ChevronLeft,
  Clock,
  MapPin,
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

const GREEN = "#0B7A5A";
const GREEN_L = "#ECFDF3";
const INDIGO = "#6366F1";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";
const RED = "#EF4444";
const CACHE_PREFIX = "daily_report_detail_cache_v2_";

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
    toPole?: { pole?: { pole_code: string } };
    node?: { name: string };
  } | null;
  team: { name: string } | null;
  lineman: {
    id: number;
    name?: string;
    first_name?: string;
    last_name?: string;
  } | null;
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

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

function fmtDay(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
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
  const full = `${log.lineman.first_name ?? ""} ${
    log.lineman.last_name ?? ""
  }`.trim();
  return log.lineman.name ?? full ?? "—";
}

function componentTotal(log: TeardownLog) {
  return (
    (log.nodes_collected ?? 0) +
    (log.amplifiers_collected ?? 0) +
    (log.extenders_collected ?? 0) +
    (log.tsc_collected ?? 0) +
    (log.powersupply_collected ?? 0) +
    (log.ps_housing_collected ?? 0)
  );
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
    <View style={[s.statusBadge, { backgroundColor: color + "18" }]}>
      <View style={[s.statusDot, { backgroundColor: color }]} />
      <Text style={[s.statusText, { color }]}>
        {STATUS_LABEL[status] ?? status}
      </Text>
    </View>
  );
}

function SummaryBox({
  label,
  value,
  color = SLATE,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <View style={s.summaryBox}>
      <Text style={[s.summaryValue, { color }]}>{value}</Text>
      <Text style={s.summaryLabel}>{label}</Text>
    </View>
  );
}

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
    <Modal visible={visible} animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <View style={s.modalSheet}>
          <View style={s.modalHandle} />

          <View style={s.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.modalKicker}>TEARDOWN LOG</Text>
              <Text style={s.modalCodes}>
                <Text style={{ color: GREEN }}>{fromCode(log)}</Text>
                <Text style={{ color: MUTED }}> → </Text>
                <Text style={{ color: INDIGO }}>{toCode(log)}</Text>
              </Text>
              <Text style={s.modalSub}>{log.span?.node?.name ?? "—"}</Text>
            </View>

            <Pressable onPress={onClose} style={s.modalClose}>
              <X size={20} color={MUTED} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={s.modalBody}
            showsVerticalScrollIndicator={false}
          >
            <StatusBadge status={log.status} />

            <View style={s.modalCard}>
              <Text style={s.modalCardTitle}>Cable</Text>
              <View style={s.modalRow}>
                <View style={s.modalMetric}>
                  <Text style={s.modalMetricLabel}>Collected</Text>
                  <Text style={[s.modalMetricValue, { color: GREEN }]}>
                    {log.actual_cable ?? 0}m
                  </Text>
                </View>

                <View style={s.modalMetric}>
                  <Text style={s.modalMetricLabel}>Expected</Text>
                  <Text style={s.modalMetricValue}>
                    {log.expected_cable ?? 0}m
                  </Text>
                </View>
              </View>
            </View>

            {components.length > 0 ? (
              <View style={s.modalCard}>
                <Text style={s.modalCardTitle}>Components</Text>
                <View style={s.componentGrid}>
                  {components.map((c) => (
                    <View key={c.label} style={s.componentChip}>
                      <Text style={s.componentNum}>{c.count}</Text>
                      <Text style={s.componentLabel}>{c.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={s.modalCard}>
              <Text style={s.modalCardTitle}>Timeline</Text>

              <View style={s.timelineItem}>
                <Clock size={14} color={MUTED} />
                <View>
                  <Text style={s.modalMetricLabel}>Started</Text>
                  <Text style={s.modalMetricValue}>
                    {fmtDate(log.start_time)}
                  </Text>
                </View>
              </View>

              {log.end_time ? (
                <View style={[s.timelineItem, { marginTop: 12 }]}>
                  <Clock size={14} color={GREEN} />
                  <View>
                    <Text style={s.modalMetricLabel}>Completed</Text>
                    <Text style={s.modalMetricValue}>
                      {fmtDate(log.end_time)}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={s.modalCard}>
              <Text style={s.modalCardTitle}>Submitted By</Text>
              <Text style={s.bigName}>{linemanName(log)}</Text>
              {log.team ? (
                <Text style={s.teamText}>{log.team.name}</Text>
              ) : null}
            </View>

            {log.captured_lat && log.captured_lng ? (
              <View style={s.modalCard}>
                <Text style={s.modalCardTitle}>GPS Location</Text>
                <View style={s.timelineItem}>
                  <MapPin size={14} color={GREEN} />
                  <Text style={s.modalMetricValue}>
                    {Number(log.captured_lat).toFixed(6)},{" "}
                    {Number(log.captured_lng).toFixed(6)}
                  </Text>
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function LogRow({
  log,
  index,
  onPress,
}: {
  log: TeardownLog;
  index: number;
  onPress: () => void;
}) {
  const cable = log.actual_cable ?? 0;
  const comps = componentTotal(log);

  return (
    <TouchableOpacity style={s.logRow} activeOpacity={0.78} onPress={onPress}>
      <View style={s.logIndex}>
        <Text style={s.logIndexText}>{index + 1}</Text>
      </View>

      <View style={s.logMain}>
        <View style={s.logTop}>
          <Text style={s.logTime}>
            {log.end_time ? fmtTime(log.end_time) : fmtTime(log.start_time)}
          </Text>
          <StatusBadge status={log.status} />
        </View>

        <Text style={s.logCodes} numberOfLines={1}>
          <Text style={{ color: GREEN }}>{fromCode(log)}</Text>
          <Text style={{ color: MUTED }}> → </Text>
          <Text style={{ color: INDIGO }}>{toCode(log)}</Text>
        </Text>

        <Text style={s.logNode} numberOfLines={1}>
          {log.span?.node?.name ?? "No node"}
        </Text>

        <View style={s.logStats}>
          <View style={s.logStat}>
            <Cable size={12} color={GREEN} />
            <Text style={s.logStatText}>{cable}m</Text>
          </View>

          <View style={s.logStat}>
            <Box size={12} color={INDIGO} />
            <Text style={[s.logStatText, { color: INDIGO }]}>{comps}</Text>
          </View>

          <View style={[s.logStat, { flex: 1 }]}>
            <User size={12} color={MUTED} />
            <Text style={s.logStatMuted} numberOfLines={1}>
              {linemanName(log)}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function DailyLogsScreen() {
  const router = useRouter();
  const { date } = useLocalSearchParams<{ date: string }>();

  const [allLogs, setAllLogs] = useState<TeardownLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TeardownLog | null>(null);

  const cacheKey = `${CACHE_PREFIX}${date}`;

  const saveCache = useCallback(
    async (items: TeardownLog[]) => {
      try {
        await AsyncStorage.setItem(cacheKey, JSON.stringify(items));
      } catch {}
    },
    [cacheKey],
  );

  const loadCache = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (!raw) return false;

      const items = JSON.parse(raw);
      if (!Array.isArray(items)) return false;

      setAllLogs(items);
      setLoading(false);
      return items.length > 0;
    } catch {
      return false;
    }
  }, [cacheKey]);

  const fetchLogs = useCallback(
    async (silent = false) => {
      if (!date) return;

      try {
        setError(null);
        if (silent) setBackgroundSyncing(true);

        const { data } = await api.get(
          `/skycable/teardowns?per_page=500&date=${date}`,
        );

        const items: TeardownLog[] = data?.data ?? data ?? [];
        setAllLogs(items);
        await saveCache(items);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load daily report.");
      } finally {
        setLoading(false);
        setRefreshing(false);
        setBackgroundSyncing(false);
      }
    },
    [date, saveCache],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const start = async () => {
        const hasCache = await loadCache();
        if (!active) return;
        await fetchLogs(hasCache);
      };

      start();

      return () => {
        active = false;
      };
    }, [fetchLogs, loadCache]),
  );

  const logs = useMemo(
    () =>
      allLogs.filter((l) => (l.end_time ?? l.start_time).slice(0, 10) === date),
    [allLogs, date],
  );

  const totalCable = logs.reduce((s, l) => s + (l.actual_cable ?? 0), 0);
  const totalComponents = logs.reduce((s, l) => s + componentTotal(l), 0);
  const approved = logs.filter((l) => l.status === "backend_approved").length;
  const submitted = logs.filter((l) => l.status === "submitted").length;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={s.root} edges={["top"]}>
        <DetailModal
          log={selected}
          visible={!!selected}
          onClose={() => setSelected(null)}
        />

        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>

          <View style={s.headerMid}>
            <Text style={s.title} numberOfLines={1}>
              Daily Report Preview
            </Text>
            <Text style={s.sub} numberOfLines={1}>
              {date ? fmtDay(date) : "Selected date"}
              {backgroundSyncing ? " · updating..." : ""}
            </Text>
          </View>
        </View>

        {loading && logs.length === 0 ? (
          <View style={s.centered}>
            <ActivityIndicator color={GREEN} size="large" />
            <Text style={s.centerTitle}>Loading daily report...</Text>
          </View>
        ) : error && logs.length === 0 ? (
          <View style={s.centered}>
            <AlertCircle size={42} color={RED} />
            <Text style={s.centerTitle}>Unable to load report</Text>
            <Text style={s.centerSub}>{error}</Text>

            <TouchableOpacity
              style={s.retryBtn}
              onPress={() => {
                setLoading(true);
                fetchLogs(false);
              }}
            >
              <RefreshCw size={14} color={GREEN} />
              <Text style={s.retryText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={logs}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={[
              s.content,
              logs.length === 0 && { flexGrow: 1 },
            ]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  fetchLogs(false);
                }}
                colors={[GREEN]}
              />
            }
            ListHeaderComponent={
              <View>
                <View style={s.reportTable}>
                  <View style={s.tableHeader}>
                    <Text style={s.tableTitle}>Daily Summary</Text>
                    <Text style={s.tableDate}>{date ? fmtDay(date) : "—"}</Text>
                  </View>

                  <View style={s.summaryGrid}>
                    <SummaryBox label="Teardowns" value={logs.length} />
                    <SummaryBox
                      label="Cable"
                      value={`${totalCable}m`}
                      color={GREEN}
                    />
                    <SummaryBox
                      label="Components"
                      value={totalComponents}
                      color={INDIGO}
                    />
                    <SummaryBox
                      label="Approved"
                      value={approved}
                      color="#16A34A"
                    />
                  </View>

                  <View style={s.miniTable}>
                    <View style={s.miniTableRow}>
                      <Text style={s.miniLabel}>Submitted</Text>
                      <Text style={s.miniValue}>{submitted}</Text>
                    </View>
                    <View style={s.miniTableRow}>
                      <Text style={s.miniLabel}>Pending / Others</Text>
                      <Text style={s.miniValue}>
                        {Math.max(logs.length - approved - submitted, 0)}
                      </Text>
                    </View>
                    <View style={s.miniTableRowLast}>
                      <Text style={s.miniLabel}>Total Items Recovered</Text>
                      <Text style={s.miniValue}>{totalComponents}</Text>
                    </View>
                  </View>
                </View>

                {logs.length > 0 ? (
                  <Text style={s.sectionTitle}>Teardown Logs</Text>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              <View style={s.emptyState}>
                <View style={s.emptyIcon}>
                  <Cable size={42} color="#C9D3E0" />
                </View>
                <Text style={s.emptyTitle}>No teardowns for this date</Text>
                <Text style={s.emptySub}>
                  Teardown submissions for this daily report will appear here.
                </Text>
              </View>
            }
            renderItem={({ item, index }) => (
              <LogRow
                log={item}
                index={index}
                onPress={() => setSelected(item)}
              />
            )}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F4F6F8" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
    backgroundColor: "#F4F6F8",
  },
  backBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#101828",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  headerMid: { flex: 1 },
  title: { fontSize: 22, fontWeight: "900", color: SLATE },
  sub: { fontSize: 12, color: MUTED, fontWeight: "600", marginTop: 2 },

  content: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 120,
  },

  reportTable: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 18,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 4,
  },
  tableHeader: { marginBottom: 14 },
  tableTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: SLATE,
  },
  tableDate: {
    marginTop: 3,
    fontSize: 12,
    color: MUTED,
    fontWeight: "600",
  },

  summaryGrid: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 6,
    marginBottom: 14,
  },
  summaryBox: {
    flex: 1,
    minHeight: 82,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: "900",
    color: SLATE,
  },
  summaryLabel: {
    marginTop: 5,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "#98A2B3",
    textAlign: "center",
  },

  miniTable: {
    overflow: "hidden",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  miniTableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: "#FFFFFF",
  },
  miniTableRowLast: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
  },
  miniLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: MUTED,
  },
  miniValue: {
    fontSize: 12,
    fontWeight: "900",
    color: SLATE,
  },

  sectionTitle: {
    marginBottom: 10,
    fontSize: 13,
    fontWeight: "900",
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  logRow: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
    gap: 12,
  },
  logIndex: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: GREEN_L,
    alignItems: "center",
    justifyContent: "center",
  },
  logIndexText: {
    fontSize: 13,
    fontWeight: "900",
    color: GREEN,
  },
  logMain: { flex: 1, minWidth: 0 },
  logTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginBottom: 7,
  },
  logTime: {
    fontSize: 11,
    fontWeight: "800",
    color: MUTED,
  },
  logCodes: {
    fontSize: 15,
    fontWeight: "900",
  },
  logNode: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "600",
    color: MUTED,
  },
  logStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 10,
  },
  logStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  logStatText: {
    fontSize: 12,
    fontWeight: "800",
    color: SLATE,
  },
  logStatMuted: {
    fontSize: 12,
    fontWeight: "600",
    color: MUTED,
  },

  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginRight: 5,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "900",
  },

  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingBottom: 100,
  },
  centerTitle: {
    marginTop: 14,
    fontSize: 18,
    fontWeight: "900",
    color: SLATE,
    textAlign: "center",
  },
  centerSub: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: "500",
    color: MUTED,
    textAlign: "center",
    lineHeight: 22,
  },
  retryBtn: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: GREEN_L,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
  },
  retryText: {
    fontSize: 14,
    fontWeight: "800",
    color: GREEN,
  },

  emptyState: {
    minHeight: 360,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  emptyIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: SLATE,
    textAlign: "center",
  },
  emptySub: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 22,
    color: MUTED,
    textAlign: "center",
    fontWeight: "500",
  },

  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15,23,42,0.55)",
  },
  modalSheet: {
    maxHeight: "88%",
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingTop: 10,
  },
  modalHandle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#E2E8F0",
    alignSelf: "center",
    marginBottom: 14,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  modalKicker: {
    fontSize: 10,
    fontWeight: "900",
    color: "#98A2B3",
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  modalCodes: {
    fontSize: 21,
    fontWeight: "900",
  },
  modalSub: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "600",
    color: MUTED,
  },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#F4F6F8",
    alignItems: "center",
    justifyContent: "center",
  },
  modalBody: {
    padding: 20,
    paddingBottom: 40,
    gap: 12,
  },
  modalCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
  },
  modalCardTitle: {
    fontSize: 10,
    fontWeight: "900",
    color: MUTED,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  modalRow: {
    flexDirection: "row",
    gap: 20,
  },
  modalMetric: {},
  modalMetricLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED,
    marginBottom: 3,
  },
  modalMetricValue: {
    fontSize: 15,
    fontWeight: "900",
    color: SLATE,
  },
  componentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  componentChip: {
    minWidth: "30%",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 9,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  componentNum: {
    fontSize: 18,
    fontWeight: "900",
    color: INDIGO,
  },
  componentLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "700",
    color: MUTED,
    textAlign: "center",
  },
  timelineItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  bigName: {
    fontSize: 18,
    fontWeight: "900",
    color: SLATE,
  },
  teamText: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "600",
    color: MUTED,
  },
});
