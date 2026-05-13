import api from "@/lib/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import {
  AlertCircle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
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
const CACHE_KEY = "daily_reports_cache_v2";

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
};

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
      <Text style={[s.summaryValue, { color }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={s.summaryLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

export default function DailyReportScreen() {
  const router = useRouter();

  const [logs, setLogs] = useState<TeardownLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveCache = useCallback(async (items: TeardownLog[]) => {
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(items));
    } catch {}
  }, []);

  const loadCache = useCallback(async () => {
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

  const totalComponents = logs.reduce(
    (s, l) =>
      s +
      (l.nodes_collected ?? 0) +
      (l.amplifiers_collected ?? 0) +
      (l.extenders_collected ?? 0) +
      (l.tsc_collected ?? 0) +
      (l.powersupply_collected ?? 0) +
      (l.ps_housing_collected ?? 0),
    0,
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={s.container}>
        <View style={s.floatingHeader}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color="#111827" />
          </TouchableOpacity>

          <View style={s.headerText}>
            <Text style={s.headerTitle}>Daily Report</Text>
            <Text style={s.headerSub}>
              {grouped.length} day{grouped.length !== 1 ? "s" : ""} with
              activity
              {backgroundSyncing ? " · updating..." : ""}
            </Text>
          </View>
        </View>

        {loading && logs.length === 0 ? (
          <View style={s.empty}>
            <ActivityIndicator size="large" color={GREEN} />
            <Text style={s.emptyTitle}>Loading Reports...</Text>
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
            contentContainerStyle={[
              s.list,
              grouped.length === 0 && s.listEmpty,
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
              <View style={s.headerContent}>
                <View style={s.summaryGrid}>
                  <SummaryCard label="Total Spans" value={logs.length} />
                  <SummaryCard
                    label="Cable"
                    value={`${totalCable}m`}
                    color={GREEN}
                  />
                  <SummaryCard
                    label="Components"
                    value={totalComponents}
                    color={INDIGO}
                  />
                  <SummaryCard
                    label="Days"
                    value={grouped.length}
                    color="#F59E0B"
                  />
                </View>

                {grouped.length === 0 ? (
                  <View style={s.emptyDashboard}>
                    <View style={s.emptyIconWrap}>
                      <BarChart3 size={48} color="#C9D3E0" />
                    </View>

                    <Text style={s.dashboardTitle}>
                      No teardown activity yet
                    </Text>

                    <Text style={s.dashboardSub}>
                      Daily reports and recovery statistics will appear here
                      once teardown submissions are completed.
                    </Text>

                    <Text style={s.pullTxt}>Pull down to refresh</Text>
                  </View>
                ) : null}
              </View>
            }
            renderItem={({ item: [date, dayLogs] }) => {
              const dayCable = dayLogs.reduce(
                (s, l) => s + (l.actual_cable ?? 0),
                0,
              );

              const dayComponents = dayLogs.reduce(
                (s, l) =>
                  s +
                  (l.nodes_collected ?? 0) +
                  (l.amplifiers_collected ?? 0) +
                  (l.extenders_collected ?? 0) +
                  (l.tsc_collected ?? 0) +
                  (l.powersupply_collected ?? 0) +
                  (l.ps_housing_collected ?? 0),
                0,
              );

              return (
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={s.dayCard}
                  onPress={() => router.push(`/daily-report/${date}` as any)}
                >
                  <View style={s.cardAccent} />

                  <View style={s.dayBody}>
                    <Text style={s.dayDate}>{fmtDay(date)}</Text>

                    <View style={s.statsRow}>
                      <View style={s.stat}>
                        <Text style={s.statNum}>{dayLogs.length}</Text>
                        <Text style={s.statLbl}>Spans</Text>
                      </View>

                      <View style={s.stat}>
                        <Text style={[s.statNum, { color: GREEN }]}>
                          {dayCable}m
                        </Text>
                        <Text style={s.statLbl}>Cable</Text>
                      </View>

                      {dayComponents > 0 ? (
                        <View style={s.stat}>
                          <Text style={[s.statNum, { color: INDIGO }]}>
                            {dayComponents}
                          </Text>
                          <Text style={s.statLbl}>Components</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  <ChevronRight size={18} color="#CBD5E1" />
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
    fontSize: 28,
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
    flexGrow: 1,
    padding: 16,
    paddingTop: 6,
    paddingBottom: 120,
  },

  listEmpty: {
    justifyContent: "flex-start",
  },

  headerContent: {
    flexGrow: 1,
  },

  summaryGrid: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-between",
    gap: 6,
    marginBottom: 24,
  },

  summaryCard: {
    flex: 1,
    minHeight: 92,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    paddingHorizontal: 4,
    paddingVertical: 16,
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
    fontSize: 24,
    fontWeight: "900",
  },

  summaryLabel: {
    marginTop: 6,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "800",
    color: "#98A2B3",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    textAlign: "center",
  },

  emptyDashboard: {
    minHeight: 430,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 48,
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
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 14,
    elevation: 2,
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
    fontSize: 18,
    fontWeight: "900",
    color: SLATE,
    marginTop: 18,
  },

  emptySub: {
    marginTop: 10,
    fontSize: 14,
    color: "#98A2B3",
    textAlign: "center",
    lineHeight: 22,
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

  dayCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER,
    paddingRight: 16,
    marginBottom: 12,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 4,
  },

  cardAccent: {
    width: 5,
    alignSelf: "stretch",
    backgroundColor: GREEN,
  },

  dayBody: {
    flex: 1,
    padding: 18,
  },

  dayDate: {
    fontSize: 16,
    fontWeight: "900",
    color: SLATE,
    marginBottom: 14,
  },

  statsRow: {
    flexDirection: "row",
    gap: 18,
  },

  stat: {
    alignItems: "center",
  },

  statNum: {
    fontSize: 22,
    fontWeight: "900",
    color: SLATE,
  },

  statLbl: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: "800",
    color: "#98A2B3",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
