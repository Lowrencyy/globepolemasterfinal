/**
 * Daily Delivery — Card view with date filter, tracking token, staging status.
 *
 * Chain of custody:
 *   Teardown completed → Token generated → Subcon Warehouse → Staging/Transit
 *   → Next Warehouse / Processing → Final Warehouse → SOLD or PULL OUT
 */
import api from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/cache";
import { simpleQueuePush } from "@/lib/simple-queue";
import {
  calcDeliveryTotals,
  DELIVERY_STATUS_COLORS,
  DELIVERY_STATUS_LABELS,
  filterLogsByDate,
  generateDeliveryToken,
  submitDelivery,
  type DeliveryTotals,
  type TeardownDelivery,
  type TeardownLog,
} from "@/services/skycable";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import {
  AlertCircle, Box, Cable, ChevronLeft,
  ChevronRight, Clock, Hash, Package,
  RefreshCw, Send,
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, RefreshControl,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G = "#0B7A5A";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";
const WHITE = "#FFFFFF";
const CACHE_LOGS = "delivery_logs_v2";
const CACHE_RECS = "delivery_records_v2";

function todayPHT() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]} ${day}, ${y}`;
}

function fmtDT(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  const h = d.getUTCHours(), mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${h % 12 || 12}:${mi}${h >= 12 ? "PM" : "AM"}`;
}

// ── Delivery card ─────────────────────────────────────────────────────────────
function DeliveryCard({ item, onPress }: { item: TeardownDelivery; onPress: () => void }) {
  const color = DELIVERY_STATUS_COLORS[item.status] ?? "#64748b";
  const label = DELIVERY_STATUS_LABELS[item.status] ?? item.status;

  return (
    <TouchableOpacity style={dc.card} onPress={onPress} activeOpacity={0.8}>
      {/* Color accent bar */}
      <View style={[dc.accent, { backgroundColor: color }]} />

      {/* Token + date */}
      <View style={dc.topRow}>
        <View style={dc.tokenWrap}>
          <Hash size={12} color={G} />
          <Text style={dc.token}>{item.token}</Text>
        </View>
        <Text style={dc.date}>{fmtDate(item.date)}</Text>
      </View>

      {/* Status badge + location */}
      <View style={dc.statusRow}>
        <View style={[dc.badge, { backgroundColor: color + "18" }]}>
          <View style={[dc.dot, { backgroundColor: color }]} />
          <Text style={[dc.badgeText, { color }]}>{label}</Text>
        </View>
        {item.current_location && (
          <Text style={dc.location}>📍 {item.current_location}</Text>
        )}
      </View>

      {/* Totals mini-grid */}
      <View style={dc.grid}>
        {[
          { l: "Cable",  v: item.total_cable,     u: "m", c: "#059669" },
          { l: "Node",   v: item.total_node,       u: "",  c: "#0b6cff" },
          { l: "Amp",    v: item.total_amplifier,  u: "",  c: "#8b5cf6" },
          { l: "Ext",    v: item.total_extender,   u: "",  c: "#10b981" },
          { l: "TSC",    v: item.total_tsc,        u: "",  c: "#f59e0b" },
          { l: "PSU",    v: item.total_psu,        u: "",  c: "#ef4444" },
          { l: "Case",   v: item.total_psu_case,   u: "",  c: "#64748b" },
        ].map(x => (
          <View key={x.l} style={dc.gridItem}>
            <Text style={[dc.gridVal, { color: x.c }]}>
              {x.v > 0 ? `${x.v}${x.u}` : "—"}
            </Text>
            <Text style={dc.gridLbl}>{x.l}</Text>
          </View>
        ))}
      </View>

      {/* Movement count */}
      {item.movements && item.movements.length > 0 && (
        <View style={dc.movRow}>
          <Clock size={11} color={MUTED} />
          <Text style={dc.movText}>{item.movements.length} movement{item.movements.length !== 1 ? "s" : ""}</Text>
          <Text style={dc.movLast}>{fmtDT(item.movements[item.movements.length - 1].timestamp)}</Text>
        </View>
      )}

      <ChevronRight size={16} color="#CBD5E1" style={{ position: "absolute", right: 14, top: "50%" }} />
    </TouchableOpacity>
  );
}

// ── Today's collection summary (pending submission) ───────────────────────────
function TodaySummary({
  logs,
  totals,
  onSubmit,
  submitting,
}: {
  logs: TeardownLog[];
  totals: DeliveryTotals;
  onSubmit: (note: string) => void;
  submitting: boolean;
}) {
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  if (!logs.length) return null;

  return (
    <View style={ts.card}>
      <View style={ts.header}>
        <Package size={16} color={G} />
        <Text style={ts.title}>READY TO SUBMIT TODAY</Text>
        <View style={ts.count}>
          <Text style={ts.countTxt}>{logs.length} teardowns</Text>
        </View>
      </View>

      <View style={ts.grid}>
        {[
          { l: "Cable",  v: totals.cable,     u: "m", c: "#059669" },
          { l: "Node",   v: totals.node,       u: "",  c: "#0b6cff" },
          { l: "Amp",    v: totals.amplifier,  u: "",  c: "#8b5cf6" },
          { l: "Ext",    v: totals.extender,   u: "",  c: "#10b981" },
          { l: "TSC",    v: totals.tsc,        u: "",  c: "#f59e0b" },
          { l: "PSU",    v: totals.psu,        u: "",  c: "#ef4444" },
          { l: "Case",   v: totals.psuCase,    u: "",  c: "#64748b" },
        ].map(x => (
          <View key={x.l} style={ts.item}>
            <Text style={[ts.val, { color: x.c }]}>{x.v > 0 ? `${x.v}${x.u}` : "—"}</Text>
            <Text style={ts.lbl}>{x.l}</Text>
          </View>
        ))}
      </View>

      {showNote && (
        <TextInput
          style={ts.input}
          placeholder="Add a note…"
          placeholderTextColor="#94A3B8"
          value={note}
          onChangeText={setNote}
          multiline
          numberOfLines={2}
          textAlignVertical="top"
        />
      )}

      <View style={ts.actions}>
        <TouchableOpacity onPress={() => setShowNote(v => !v)}>
          <Text style={ts.noteLink}>{showNote ? "Remove note" : "+ Note"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[ts.btn, submitting && { opacity: 0.6 }]}
          onPress={() => onSubmit(note)}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? <ActivityIndicator size="small" color={WHITE} /> : <Send size={14} color={WHITE} />}
          <Text style={ts.btnTxt}>{submitting ? "Submitting…" : "Submit to Warehouse"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DeliveryScreen() {
  const router = useRouter();
  const today = todayPHT();

  const [selectedDate, setSelectedDate] = useState(today);
  const [allLogs, setAllLogs] = useState<TeardownLog[]>([]);
  const [allDeliveries, setAllDeliveries] = useState<TeardownDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) {
      const [cl, cr] = await Promise.all([
        cacheGet<TeardownLog[]>(CACHE_LOGS),
        cacheGet<TeardownDelivery[]>(CACHE_RECS),
      ]);
      if (cl) setAllLogs(cl);
      if (cr) setAllDeliveries(cr);
      if (cl || cr) setLoading(false);
    }

    try {
      const [lr, dr] = await Promise.allSettled([
        api.get("/skycable/teardowns?per_page=500"),
        api.get("/skycable/deliveries?per_page=200"),
      ]);
      if (lr.status === "fulfilled") {
        const data: TeardownLog[] = lr.value?.data?.data ?? lr.value?.data ?? [];
        setAllLogs(data);
        await cacheSet(CACHE_LOGS, data);
      }
      if (dr.status === "fulfilled") {
        const data: TeardownDelivery[] = dr.value?.data?.data ?? dr.value?.data ?? [];
        // Sort latest first
        data.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
        setAllDeliveries(data);
        await cacheSet(CACHE_RECS, data);
      }
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // Logs for selected date not yet in a delivery
  const todayLogs = useMemo(() => {
    const submittedLogIds = new Set(
      allDeliveries.flatMap(d => (d as any).teardown_log_ids ?? [])
    );
    return filterLogsByDate(allLogs, selectedDate).filter(l => !submittedLogIds.has(l.id));
  }, [allLogs, allDeliveries, selectedDate]);

  const todayTotals = calcDeliveryTotals(todayLogs);

  // Deliveries for selected date (latest first)
  const filtered = useMemo(() =>
    allDeliveries.filter(d => d.date === selectedDate),
    [allDeliveries, selectedDate]
  );

  async function handleSubmit(note: string) {
    if (!todayLogs.length) return;
    setSubmitting(true);
    try {
      const token = generateDeliveryToken(selectedDate);
      const payload = {
        token,
        date: selectedDate,
        teardown_log_ids: todayLogs.map(l => l.id),
        totals: todayTotals,
        notes: note.trim() || null,
      };

      try {
        const { token: authToken } = await import("@/lib/token-bridge").then(m => ({ token: m.getBridgeToken() }));
        const rec = await submitDelivery(authToken ?? "", payload);
        setAllDeliveries(prev => [rec, ...prev]);
        Alert.alert("✅ Submitted!", `Token: ${token}\nDelivery sent to warehouse.`);
      } catch (err: any) {
        if (!err?.response?.status) {
          await simpleQueuePush({ method: "post", url: "/skycable/deliveries", body: payload as any });
          const optimistic: TeardownDelivery = {
            id: 0, token, date: selectedDate, status: "submitted",
            total_cable: todayTotals.cable, total_node: todayTotals.node,
            total_amplifier: todayTotals.amplifier, total_extender: todayTotals.extender,
            total_tsc: todayTotals.tsc, total_psu: todayTotals.psu,
            total_psu_case: todayTotals.psuCase, teardown_count: todayLogs.length,
            notes: note.trim() || null, created_at: new Date().toISOString(),
          };
          setAllDeliveries(prev => [optimistic, ...prev]);
          Alert.alert("📶 Queued Offline", `Token: ${token}\nWill sync when back online.`);
        } else throw err;
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Submit failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const dates = useMemo(() => {
    const set = new Set<string>([today]);
    allDeliveries.forEach(d => set.add(d.date));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [allDeliveries, today]);

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
            <Text style={s.title}>Delivery Status</Text>
            <Text style={s.subtitle}>Teardown collection tracking</Text>
          </View>
          <TouchableOpacity onPress={() => { setRefreshing(true); loadData(true); }} style={s.iconBtn}>
            <RefreshCw size={18} color={G} />
          </TouchableOpacity>
        </View>

        {/* Date pill filter */}
        <View style={s.datePills}>
          <FlatList
            data={dates}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={d => d}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            renderItem={({ item: d }) => (
              <TouchableOpacity
                style={[s.datePill, selectedDate === d && s.datePillActive]}
                onPress={() => setSelectedDate(d)}
                activeOpacity={0.8}
              >
                <Text style={[s.datePillTxt, selectedDate === d && s.datePillTxtActive]}>
                  {d === today ? "Today" : fmtDate(d)}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={G} />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={item => String(item.id) + item.token}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(true); }} colors={[G]} />
            }
            ListHeaderComponent={
              <TodaySummary
                logs={todayLogs}
                totals={todayTotals}
                onSubmit={handleSubmit}
                submitting={submitting}
              />
            }
            renderItem={({ item }) => (
              <DeliveryCard
                item={item}
                onPress={() => router.push({ pathname: "/delivery/[id]", params: { id: String(item.id) } } as any)}
              />
            )}
            ListEmptyComponent={
              !todayLogs.length ? (
                <View style={s.empty}>
                  <Package size={48} color="#CBD5E1" />
                  <Text style={s.emptyTitle}>No deliveries for {fmtDate(selectedDate)}</Text>
                </View>
              ) : null
            }
          />
        )}
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: "#F8FAFC" },
  header:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  backBtn:        { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconBtn:        { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#F0FDF4" },
  headerText:     { flex: 1 },
  title:          { fontSize: 20, fontWeight: "900", color: SLATE },
  subtitle:       { fontSize: 12, color: MUTED, fontWeight: "600" },
  datePills:      { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: WHITE },
  datePill:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: "#F1F5F9", borderWidth: 1.5, borderColor: "transparent" },
  datePillActive: { backgroundColor: "#ECFDF5", borderColor: G },
  datePillTxt:    { fontSize: 12, fontWeight: "700", color: MUTED },
  datePillTxtActive: { color: G, fontWeight: "900" },
  center:         { flex: 1, alignItems: "center", justifyContent: "center" },
  list:           { padding: 16, gap: 12, paddingBottom: 48 },
  empty:          { alignItems: "center", paddingTop: 40, gap: 10 },
  emptyTitle:     { fontSize: 15, fontWeight: "700", color: MUTED },
});

const dc = StyleSheet.create({
  card:     { backgroundColor: WHITE, borderRadius: 20, padding: 14, paddingLeft: 18, borderWidth: 1, borderColor: BORDER, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  accent:   { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, borderTopLeftRadius: 20, borderBottomLeftRadius: 20 },
  topRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  tokenWrap: { flexDirection: "row", alignItems: "center", gap: 4 },
  token:    { fontSize: 13, fontWeight: "900", color: SLATE, fontVariant: ["tabular-nums"] as any },
  date:     { fontSize: 11, color: MUTED, fontWeight: "600" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  badge:    { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  dot:      { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: "800" },
  location: { fontSize: 10, color: MUTED, fontWeight: "600" },
  grid:     { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 8 },
  gridItem: { flex: 1, minWidth: 52, backgroundColor: "#F8FAFC", borderRadius: 10, padding: 6, alignItems: "center", borderWidth: 1, borderColor: "#F1F5F9" },
  gridVal:  { fontSize: 12, fontWeight: "900" },
  gridLbl:  { fontSize: 8, fontWeight: "700", color: MUTED, marginTop: 1, textTransform: "uppercase" as any },
  movRow:   { flexDirection: "row", alignItems: "center", gap: 5 },
  movText:  { fontSize: 10, color: MUTED, fontWeight: "600" },
  movLast:  { fontSize: 10, color: "#94A3B8", marginLeft: "auto" },
});

const ts = StyleSheet.create({
  card:    { backgroundColor: WHITE, borderRadius: 20, padding: 16, borderWidth: 1.5, borderColor: G + "40", shadowColor: G, shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  header:  { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  title:   { fontSize: 10, fontWeight: "900", color: MUTED, letterSpacing: 1, flex: 1, textTransform: "uppercase" as any },
  count:   { backgroundColor: "#ECFDF5", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  countTxt: { fontSize: 10, fontWeight: "800", color: G },
  grid:    { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  item:    { flex: 1, minWidth: 60, backgroundColor: "#F8FAFC", borderRadius: 12, padding: 8, alignItems: "center", borderWidth: 1, borderColor: BORDER },
  val:     { fontSize: 14, fontWeight: "900" },
  lbl:     { fontSize: 9, fontWeight: "700", color: MUTED, marginTop: 1, textTransform: "uppercase" as any },
  input:   { backgroundColor: "#F8FAFC", borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: SLATE, marginBottom: 10, minHeight: 60 },
  actions: { flexDirection: "row", alignItems: "center", gap: 10 },
  noteLink: { fontSize: 12, fontWeight: "700", color: MUTED, paddingHorizontal: 4 },
  btn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: G, borderRadius: 14, paddingVertical: 13, shadowColor: G, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  btnTxt:  { fontSize: 14, fontWeight: "900", color: WHITE },
});
