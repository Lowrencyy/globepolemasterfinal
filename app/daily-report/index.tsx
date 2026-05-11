import React, { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, BarChart3, AlertCircle, RefreshCw } from "lucide-react-native";
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
  span: { node?: { name: string } | null } | null;
  lineman: { id: number; name?: string; first_name?: string; last_name?: string } | null;
};

function dayKey(iso: string) { return iso.slice(0, 10); }

function fmtDay(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-PH", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

const STATUS_COLOR: Record<string, string> = {
  submitted: "#3B82F6", subcon_approved: "#10B981",
  backend_approved: "#16A34A", rejected: "#EF4444", pending: "#F59E0B",
};

export default function DailyReportScreen() {
  const router = useRouter();
  const [logs,       setLogs]       = useState<TeardownLog[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setError(null);
      const { data } = await api.get("/skycable/teardowns?per_page=500");
      setLogs(data?.data ?? data ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchLogs();
  }, [fetchLogs]));

  // Group by date descending
  const grouped = useMemo(() => {
    const map = new Map<string, TeardownLog[]>();
    for (const log of logs) {
      const key = dayKey(log.end_time ?? log.start_time);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [logs]);

  // Overall totals
  const totalCable = logs.reduce((s, l) => s + (l.actual_cable ?? 0), 0);
  const totalComponents = logs.reduce((s, l) =>
    s + (l.nodes_collected ?? 0) + (l.amplifiers_collected ?? 0) +
    (l.extenders_collected ?? 0) + (l.tsc_collected ?? 0) +
    (l.powersupply_collected ?? 0) + (l.ps_housing_collected ?? 0), 0);

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={22} color={SLATE} />
        </TouchableOpacity>
        <View style={s.headerMid}>
          <Text style={s.title}>Daily Report</Text>
          <Text style={s.sub}>{grouped.length} day{grouped.length !== 1 ? "s" : ""} with activity</Text>
        </View>
      </View>

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator color={GREEN} size="large" />
          <Text style={s.loadTxt}>Loading daily reports…</Text>
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
        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLogs(); }} colors={[GREEN]} />}
        >
          {/* Overall summary banner */}
          <View style={s.banner}>
            <View style={s.bannerStat}>
              <Text style={s.bannerNum}>{logs.length}</Text>
              <Text style={s.bannerLbl}>Total Spans</Text>
            </View>
            <View style={s.bannerDiv} />
            <View style={s.bannerStat}>
              <Text style={[s.bannerNum, { color: GREEN }]}>{totalCable}m</Text>
              <Text style={s.bannerLbl}>Cable Recovered</Text>
            </View>
            <View style={s.bannerDiv} />
            <View style={s.bannerStat}>
              <Text style={[s.bannerNum, { color: INDIGO }]}>{totalComponents}</Text>
              <Text style={s.bannerLbl}>Components</Text>
            </View>
            <View style={s.bannerDiv} />
            <View style={s.bannerStat}>
              <Text style={[s.bannerNum, { color: "#F59E0B" }]}>{grouped.length}</Text>
              <Text style={s.bannerLbl}>Days Active</Text>
            </View>
          </View>

          {grouped.length === 0 ? (
            <View style={s.centered}>
              <BarChart3 size={48} color="#CBD5E1" />
              <Text style={s.emptyTxt}>No teardown activity yet</Text>
            </View>
          ) : grouped.map(([date, dayLogs]) => {
            const dayCable = dayLogs.reduce((s, l) => s + (l.actual_cable ?? 0), 0);
            const dayComponents = dayLogs.reduce((s, l) =>
              s + (l.nodes_collected ?? 0) + (l.amplifiers_collected ?? 0) +
              (l.extenders_collected ?? 0) + (l.tsc_collected ?? 0) +
              (l.powersupply_collected ?? 0) + (l.ps_housing_collected ?? 0), 0);
            const statusCounts = dayLogs.reduce((acc, l) => {
              acc[l.status] = (acc[l.status] ?? 0) + 1;
              return acc;
            }, {} as Record<string, number>);

            return (
              <TouchableOpacity
                key={date}
                style={s.dayCard}
                activeOpacity={0.75}
                onPress={() => router.push(`/daily-report/${date}` as any)}
              >
                {/* Left accent bar */}
                <View style={s.accentBar} />

                <View style={s.dayBody}>
                  {/* Date */}
                  <Text style={s.dayDate}>{fmtDay(date)}</Text>

                  {/* Stats row */}
                  <View style={s.statsRow}>
                    <View style={s.stat}>
                      <Text style={s.statNum}>{dayLogs.length}</Text>
                      <Text style={s.statLbl}>Spans</Text>
                    </View>
                    <View style={s.stat}>
                      <Text style={[s.statNum, { color: GREEN }]}>{dayCable}m</Text>
                      <Text style={s.statLbl}>Cable</Text>
                    </View>
                    {dayComponents > 0 && (
                      <View style={s.stat}>
                        <Text style={[s.statNum, { color: INDIGO }]}>{dayComponents}</Text>
                        <Text style={s.statLbl}>Components</Text>
                      </View>
                    )}
                  </View>

                  {/* Status dots */}
                  <View style={s.statusRow}>
                    {Object.entries(statusCounts).map(([st, count]) => (
                      <View key={st} style={[s.statusChip, { backgroundColor: (STATUS_COLOR[st] ?? "#94A3B8") + "18" }]}>
                        <View style={[s.statusDot, { backgroundColor: STATUS_COLOR[st] ?? "#94A3B8" }]} />
                        <Text style={[s.statusTxt, { color: STATUS_COLOR[st] ?? "#94A3B8" }]}>
                          {count} {st.replace(/_/g, " ")}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>

                <ChevronRight size={18} color="#CBD5E1" />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: "#F8FAFC" },
  header:  { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff", borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center" },
  headerMid: { flex: 1 },
  title:   { fontSize: 22, fontWeight: "900", color: SLATE },
  sub:     { fontSize: 13, color: MUTED, fontWeight: "500", marginTop: 2 },

  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  loadTxt:  { fontSize: 14, color: MUTED, marginTop: 12, fontWeight: "500" },
  errTxt:   { fontSize: 14, color: "#DC2626", textAlign: "center", marginTop: 12, fontWeight: "600" },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 16, backgroundColor: "#F0FDF4", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  retryTxt: { fontSize: 14, fontWeight: "700", color: GREEN },
  emptyTxt: { fontSize: 16, fontWeight: "700", color: MUTED, marginTop: 16 },

  content: { paddingHorizontal: 16, paddingBottom: 100 },

  banner: {
    flexDirection: "row", backgroundColor: "#fff", borderRadius: 18,
    borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 16,
    shadowColor: SLATE, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  bannerStat: { flex: 1, alignItems: "center" },
  bannerNum:  { fontSize: 20, fontWeight: "900", color: SLATE },
  bannerLbl:  { fontSize: 9, fontWeight: "600", color: MUTED, marginTop: 2, textAlign: "center" },
  bannerDiv:  { width: 1, backgroundColor: BORDER, marginHorizontal: 4 },

  dayCard: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff", borderRadius: 18, marginBottom: 12,
    borderWidth: 1, borderColor: BORDER,
    shadowColor: SLATE, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
    overflow: "hidden", paddingRight: 16,
  },
  accentBar: { width: 4, alignSelf: "stretch", backgroundColor: GREEN },
  dayBody:   { flex: 1, padding: 16 },
  dayDate:   { fontSize: 15, fontWeight: "800", color: SLATE, marginBottom: 10 },
  statsRow:  { flexDirection: "row", gap: 16, marginBottom: 10 },
  stat:      { alignItems: "center" },
  statNum:   { fontSize: 20, fontWeight: "900", color: SLATE },
  statLbl:   { fontSize: 10, fontWeight: "600", color: MUTED, marginTop: 2 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  statusChip:{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusTxt: { fontSize: 10, fontWeight: "700" },
});
