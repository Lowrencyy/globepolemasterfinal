import api from "@/lib/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react-native";
import React, { useCallback, useMemo, useRef, useState } from "react";
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

const GREEN = "#0B7A5A";
const GREEN_L = "#ECFDF3";
const INDIGO = "#6366F1";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";
const ORANGE = "#F59E0B";
const CACHE_KEY = "daily_reports_cache_v3";

const USE_FAKE_DATA = false;

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
  team?: { name: string } | null;
};

const FAKE_LOGS: TeardownLog[] = [];

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function fmtDay(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function SummaryCard({
  label,
  value,
  color = SLATE,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <View style={s.summaryCard}>
      <Text style={[s.summaryValue, { color }]}>{value}</Text>
      <Text style={s.summaryLabel}>{label}</Text>
    </View>
  );
}

function ComponentBox({
  label,
  value,
  color,
  tone,
}: {
  label: string;
  value: number;
  color: string;
  tone: "blue" | "orange";
}) {
  return (
    <View style={s.componentBox}>
      <View
        style={tone === "blue" ? s.componentIconBlue : s.componentIconOrange}
      >
        <Text style={[s.componentIconText, { color }]}>
          {tone === "blue" ? "□" : "▭"}
        </Text>
      </View>

      <View>
        <Text style={s.componentTitle}>{label}</Text>
        <Text style={[s.componentValue, { color }]}>{value}</Text>
      </View>
    </View>
  );
}

export default function DailyReportScreen() {
  const router = useRouter();

  const lastFetchRef = useRef<number>(0);
  const [logs, setLogs] = useState<TeardownLog[]>(
    USE_FAKE_DATA ? FAKE_LOGS : [],
  );
  const [loading, setLoading] = useState(!USE_FAKE_DATA);
  const [refreshing, setRefreshing] = useState(false);
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveCache = useCallback(async (items: TeardownLog[]) => {
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(items));
    } catch {}
  }, []);

  const loadCache = useCallback(async () => {
    if (USE_FAKE_DATA) return true;

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
      if (USE_FAKE_DATA) {
        setLogs(FAKE_LOGS);
        setLoading(false);
        setRefreshing(false);
        setBackgroundSyncing(false);
        return;
      }

      try {
        setError(null);
        if (silent) setBackgroundSyncing(true);

        const { data } = await api.get("/skycable/teardowns?per_page=500");
        const items = data?.data ?? data ?? [];

        setLogs(items);
        await saveCache(items);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load reports.");
      } finally {
        setLoading(false);
        setRefreshing(false);
        setBackgroundSyncing(false);
      }
    },
    [saveCache],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const start = async () => {
        const now = Date.now();
        const hasCache = await loadCache();
        if (!active) return;
        if (now - lastFetchRef.current < 2 * 60 * 1000 && hasCache) return;
        lastFetchRef.current = now;
        await fetchLogs(hasCache);
      };

      start();

      return () => {
        active = false;
      };
    }, [fetchLogs, loadCache]),
  );

  const grouped = useMemo(() => {
    const map = new Map<string, TeardownLog[]>();

    for (const log of logs) {
      const key = dayKey(log.end_time ?? log.start_time);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }

    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [logs]);

  const totalCable = logs.reduce((s, l) => s + (l.actual_cable ?? 0), 0);
  const totalNodes = logs.reduce((s, l) => s + (l.nodes_collected ?? 0), 0);
  const totalAmplifiers = logs.reduce(
    (s, l) => s + (l.amplifiers_collected ?? 0),
    0,
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={s.container}>
        <View style={s.floatingHeader}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>

          <View style={s.headerText}>
            <Text style={s.headerTitle}>Daily Reports</Text>
            <Text style={s.headerSub}>
              {grouped.length} generated report{grouped.length !== 1 ? "s" : ""}
              {backgroundSyncing ? " · updating..." : ""}
            </Text>
          </View>
        </View>

        {loading && logs.length === 0 ? (
          <View style={s.empty}>
            <ActivityIndicator size="large" color={GREEN} />
            <Text style={s.emptyTitle}>Loading Daily Reports...</Text>
          </View>
        ) : error && logs.length === 0 ? (
          <View style={s.empty}>
            <AlertCircle size={42} color="#EF4444" />
            <Text style={s.emptyTitle}>Something went wrong</Text>
            <Text style={s.emptySub}>{error}</Text>

            <TouchableOpacity
              style={s.retryBtn}
              onPress={() => {
                setLoading(true);
                fetchLogs(false);
              }}
            >
              <RefreshCw size={14} color={GREEN} />
              <Text style={s.retryTxt}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={grouped}
            keyExtractor={([date]) => date}
            contentContainerStyle={s.list}
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
              <>
                <View style={s.summaryGrid}>
                  <SummaryCard label="Reports" value={grouped.length} />
                  <SummaryCard
                    label="Cable"
                    value={`${totalCable}m`}
                    color={GREEN}
                  />
                  <SummaryCard
                    label="Nodes"
                    value={totalNodes}
                    color={INDIGO}
                  />
                  <SummaryCard
                    label="Amplifier"
                    value={totalAmplifiers}
                    color={ORANGE}
                  />
                </View>

                {grouped.length === 0 ? (
                  <View style={s.emptyDashboard}>
                    <View style={s.emptyIconWrap}>
                      <BarChart3 size={48} color="#C9D3E0" />
                    </View>

                    <Text style={s.dashboardTitle}>No Daily Reports Yet</Text>
                    <Text style={s.dashboardSub}>
                      Daily teardown summaries will appear here automatically
                      once submissions are completed.
                    </Text>
                    <Text style={s.pullTxt}>Pull down to refresh</Text>
                  </View>
                ) : (
                  <Text style={s.sectionTitle}>GENERATED REPORTS</Text>
                )}
              </>
            }
            renderItem={({ item: [date, dayLogs] }) => {
              const totalSpans = dayLogs.length;
              const recoveredCable = dayLogs.reduce(
                (sum, log) => sum + (log.actual_cable ?? 0),
                0,
              );
              const nodes = dayLogs.reduce(
                (sum, log) => sum + (log.nodes_collected ?? 0),
                0,
              );
              const amplifiers = dayLogs.reduce(
                (sum, log) => sum + (log.amplifiers_collected ?? 0),
                0,
              );
              const tsc = dayLogs.reduce(
                (sum, log) => sum + (log.tsc_collected ?? 0),
                0,
              );
              const extenders = dayLogs.reduce(
                (sum, log) => sum + (log.extenders_collected ?? 0),
                0,
              );

              const teamNames = Array.from(
                new Set(dayLogs.map((log) => log.team?.name).filter(Boolean)),
              ).join(", ");

              return (
                <TouchableOpacity
                  activeOpacity={0.82}
                  style={s.reportCard}
                  onPress={() => router.push(`/daily-report/${date}` as any)}
                >
                  <View style={s.reportHeader}>
                    <View style={s.reportBadge}>
                      <CalendarDays size={16} color={GREEN} />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={s.reportTitle}>{fmtDay(date)}</Text>
                      <Text style={s.reportDate}>
                        {teamNames || "No team assigned"}
                      </Text>
                    </View>

                    <ChevronRight size={20} color="#98A2B3" />
                  </View>

                  <View style={s.table}>
                    <View style={s.tableRow}>
                      <Text style={s.tableLabel}>Total Spans</Text>
                      <Text style={s.tableValue}>{totalSpans}</Text>
                    </View>

                    <View style={s.tableRow}>
                      <Text style={s.tableLabel}>Cable</Text>
                      <Text style={[s.tableValue, { color: GREEN }]}>
                        {recoveredCable}m recovered
                      </Text>
                    </View>

                    <View style={s.componentRow}>
                      <ComponentBox
                        label="NODES"
                        value={nodes}
                        color={INDIGO}
                        tone="blue"
                      />
                      <ComponentBox
                        label="AMPLIFIER"
                        value={amplifiers}
                        color={ORANGE}
                        tone="orange"
                      />
                      <ComponentBox
                        label="TSC"
                        value={tsc}
                        color={INDIGO}
                        tone="blue"
                      />
                      <ComponentBox
                        label="EXTENDER"
                        value={extenders}
                        color={ORANGE}
                        tone="orange"
                      />
                    </View>
                  </View>

                  <View style={s.footer}>
                    <Text style={s.previewText}>View Full Preview</Text>
                    <ChevronRight size={18} color="#CBD5E1" />
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F6F8",
  },

  floatingHeader: {
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

  headerText: {
    flex: 1,
  },

  headerTitle: {
    fontSize: 30,
    fontWeight: "900",
    color: SLATE,
  },

  headerSub: {
    marginTop: 2,
    fontSize: 13,
    color: MUTED,
    fontWeight: "600",
  },

  list: {
    padding: 16,
    paddingTop: 8,
    paddingBottom: 120,
  },

  summaryGrid: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 24,
  },

  summaryCard: {
    flex: 1,
    minHeight: 88,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 3,
  },

  summaryValue: {
    fontSize: 22,
    fontWeight: "900",
  },

  summaryLabel: {
    marginTop: 6,
    fontSize: 9,
    fontWeight: "800",
    color: "#98A2B3",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  sectionTitle: {
    marginBottom: 12,
    fontSize: 11,
    fontWeight: "900",
    color: "#98A2B3",
    letterSpacing: 1,
  },

  reportCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 26,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 14,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 4,
  },

  reportHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },

  reportBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: GREEN_L,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },

  reportTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: SLATE,
  },

  reportDate: {
    marginTop: 4,
    fontSize: 13,
    color: MUTED,
    fontWeight: "600",
  },

  table: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#FFFFFF",
  },

  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  tableLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: MUTED,
  },

  tableValue: {
    fontSize: 14,
    fontWeight: "900",
    color: SLATE,
  },

  componentRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  componentBox: {
    flex: 1,
    minHeight: 88,
    paddingVertical: 13,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderRightColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },

  componentIconBlue: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },

  componentIconOrange: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#FFF7ED",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },

  componentIconText: {
    fontSize: 17,
    fontWeight: "900",
  },

  componentTitle: {
    fontSize: 9,
    fontWeight: "900",
    color: MUTED,
    letterSpacing: 0.4,
    textAlign: "center",
  },

  componentValue: {
    marginTop: 3,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },

  footer: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  previewText: {
    fontSize: 13,
    fontWeight: "800",
    color: GREEN,
  },

  emptyDashboard: {
    minHeight: 430,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },

  emptyIconWrap: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },

  dashboardTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: SLATE,
    textAlign: "center",
  },

  dashboardSub: {
    marginTop: 10,
    maxWidth: 320,
    fontSize: 15,
    lineHeight: 24,
    color: MUTED,
    textAlign: "center",
    fontWeight: "500",
  },

  pullTxt: {
    marginTop: 22,
    fontSize: 12,
    fontWeight: "800",
    color: "#98A2B3",
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingBottom: 100,
  },

  emptyTitle: {
    marginTop: 18,
    fontSize: 18,
    fontWeight: "900",
    color: SLATE,
  },

  emptySub: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 22,
    color: "#98A2B3",
    textAlign: "center",
  },

  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 18,
    backgroundColor: GREEN_L,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },

  retryTxt: {
    fontSize: 14,
    fontWeight: "800",
    color: GREEN,
  },
});
