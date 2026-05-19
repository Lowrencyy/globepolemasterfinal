/**
 * Warehouse — Staging management for teardown deliveries.
 *
 * Warehouse in-charge can:
 *  • See all pending/active deliveries with their tokens
 *  • Advance each delivery to the next stage
 *  • Mark as SOLD or PULL OUT
 *  • View blockchain-style movement history per delivery
 *  • See cumulative stocks from all approved deliveries
 */
import { useAuth } from "@/context/auth-context";
import {
  approveDelivery,
  DELIVERY_STATUS_COLORS,
  DELIVERY_STATUS_LABELS,
  getDeliveries,
  markDeliveryPullout,
  markDeliverySold,
  moveDelivery,
  type DeliveryStatus,
  type TeardownDelivery,
} from "@/services/skycable";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import {
  ArrowRight, CheckCircle2, ChevronLeft,
  Clock, Hash, Package, RefreshCw,
  ShieldCheck, Warehouse as WIcon, X,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal,
  RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G = "#0B7A5A";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";
const WHITE = "#FFFFFF";

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]} ${day}, ${y}`;
}
function fmtDT(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  const h = d.getUTCHours(), mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${h % 12 || 12}:${mi}${h >= 12 ? "PM" : "AM"}`;
}

// Stage progression
const STAGE_FLOW: DeliveryStatus[] = [
  "submitted",
  "at_subcon_warehouse",
  "in_transit",
  "at_warehouse",
  "processing",
  "final_warehouse",
];

function nextStage(current: DeliveryStatus): DeliveryStatus | null {
  const idx = STAGE_FLOW.indexOf(current);
  if (idx === -1 || idx >= STAGE_FLOW.length - 1) return null;
  return STAGE_FLOW[idx + 1];
}

// ── Movement timeline ─────────────────────────────────────────────────────────
function Timeline({ delivery }: { delivery: TeardownDelivery }) {
  const moves = delivery.movements ?? [];
  if (!moves.length) return null;
  return (
    <View style={tl.wrap}>
      <Text style={tl.title}>CHAIN OF CUSTODY</Text>
      {moves.map((m, i) => (
        <View key={m.id ?? i} style={tl.row}>
          <View style={tl.dotWrap}>
            <View style={[tl.dot, { backgroundColor: DELIVERY_STATUS_COLORS[m.to_stage as DeliveryStatus] ?? G }]} />
            {i < moves.length - 1 && <View style={tl.line} />}
          </View>
          <View style={tl.info}>
            <Text style={tl.stage}>{DELIVERY_STATUS_LABELS[m.to_stage as DeliveryStatus] ?? m.to_stage}</Text>
            <Text style={tl.loc}>{m.location_name}</Text>
            {m.notes ? <Text style={tl.note}>📝 {m.notes}</Text> : null}
            {m.moved_by && <Text style={tl.by}>by {m.moved_by.name} · {fmtDT(m.timestamp)}</Text>}
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Move/Action modal ─────────────────────────────────────────────────────────
function ActionModal({
  delivery,
  onClose,
  onRefresh,
  token,
}: {
  delivery: TeardownDelivery;
  onClose: () => void;
  onRefresh: () => void;
  token: string | null;
}) {
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [location, setLocation] = useState("");

  const next = nextStage(delivery.status);
  const canSell = delivery.status === "final_warehouse";
  const canPullout = !["sold", "pulled_out"].includes(delivery.status);
  const canAdvance = !!next;

  async function doMove() {
    if (!next || !token) return;
    if (!location.trim()) { Alert.alert("Required", "Enter a location name."); return; }
    setSaving(true);
    try {
      await moveDelivery(token, delivery.id, {
        to_stage: next,
        location_name: location.trim(),
        notes: note.trim() || null,
      });
      onRefresh(); onClose();
    } catch (e: any) { Alert.alert("Error", e?.message ?? "Move failed."); }
    finally { setSaving(false); }
  }

  async function doApprove() {
    if (!token) return;
    setSaving(true);
    try {
      await approveDelivery(token, delivery.id);
      onRefresh(); onClose();
    } catch (e: any) { Alert.alert("Error", e?.message ?? "Approval failed."); }
    finally { setSaving(false); }
  }

  async function doSell() {
    if (!token) return;
    Alert.alert("Mark as SOLD?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Mark SOLD", onPress: async () => {
        setSaving(true);
        try { await markDeliverySold(token, delivery.id, note.trim()); onRefresh(); onClose(); }
        catch (e: any) { Alert.alert("Error", e?.message ?? "Failed."); }
        finally { setSaving(false); }
      }},
    ]);
  }

  async function doPullout() {
    if (!token) return;
    Alert.alert("Pull Out?", "Mark this batch as returned/recalled?", [
      { text: "Cancel", style: "cancel" },
      { text: "Pull Out", style: "destructive", onPress: async () => {
        setSaving(true);
        try { await markDeliveryPullout(token, delivery.id, note.trim()); onRefresh(); onClose(); }
        catch (e: any) { Alert.alert("Error", e?.message ?? "Failed."); }
        finally { setSaving(false); }
      }},
    ]);
  }

  const color = DELIVERY_STATUS_COLORS[delivery.status] ?? "#64748b";

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={am.overlay}>
        <View style={am.sheet}>
          <View style={am.handle} />

          {/* Token header */}
          <View style={am.tokenRow}>
            <Hash size={16} color={G} />
            <Text style={am.token}>{delivery.token}</Text>
            <TouchableOpacity onPress={onClose} style={am.closeBtn}>
              <X size={18} color={MUTED} />
            </TouchableOpacity>
          </View>
          <View style={[am.badge, { backgroundColor: color + "18" }]}>
            <View style={[am.dot, { backgroundColor: color }]} />
            <Text style={[am.badgeTxt, { color }]}>{DELIVERY_STATUS_LABELS[delivery.status]}</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 400 }}>
            {/* Movement history */}
            <Timeline delivery={delivery} />

            {/* Actions */}
            <View style={am.section}>
              <Text style={am.sectionTitle}>ACTIONS</Text>

              {delivery.status === "submitted" && (
                <>
                  <TextInput style={am.input} placeholder="Location name (e.g. Subcon Warehouse A)…" placeholderTextColor="#94A3B8" value={location} onChangeText={setLocation} />
                  <TouchableOpacity style={[am.btn, { backgroundColor: "#0b6cff" }]} onPress={doApprove} disabled={saving}>
                    {saving ? <ActivityIndicator size="small" color={WHITE} /> : <ShieldCheck size={16} color={WHITE} />}
                    <Text style={am.btnTxt}>Receive at Subcon Warehouse</Text>
                  </TouchableOpacity>
                </>
              )}

              {canAdvance && delivery.status !== "submitted" && (
                <>
                  <TextInput style={am.input} placeholder="Destination location name…" placeholderTextColor="#94A3B8" value={location} onChangeText={setLocation} />
                  <TextInput style={[am.input, { minHeight: 48 }]} placeholder="Notes (optional)…" placeholderTextColor="#94A3B8" value={note} onChangeText={setNote} multiline />
                  <TouchableOpacity style={[am.btn, { backgroundColor: G }]} onPress={doMove} disabled={saving}>
                    {saving ? <ActivityIndicator size="small" color={WHITE} /> : <ArrowRight size={16} color={WHITE} />}
                    <Text style={am.btnTxt}>Move → {DELIVERY_STATUS_LABELS[next!]}</Text>
                  </TouchableOpacity>
                </>
              )}

              {canSell && (
                <TouchableOpacity style={[am.btn, { backgroundColor: "#10b981", marginTop: 8 }]} onPress={doSell} disabled={saving}>
                  <CheckCircle2 size={16} color={WHITE} />
                  <Text style={am.btnTxt}>Mark as SOLD</Text>
                </TouchableOpacity>
              )}

              {canPullout && (
                <TouchableOpacity style={[am.btn, { backgroundColor: "#ef4444", marginTop: 8 }]} onPress={doPullout} disabled={saving}>
                  <X size={16} color={WHITE} />
                  <Text style={am.btnTxt}>Pull Out (Return)</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Delivery row card ─────────────────────────────────────────────────────────
function DeliveryRow({ item, onAction }: { item: TeardownDelivery; onAction: () => void }) {
  const color = DELIVERY_STATUS_COLORS[item.status] ?? "#64748b";
  const isDone = ["sold", "pulled_out"].includes(item.status);
  return (
    <TouchableOpacity style={[dw.card, isDone && { opacity: 0.7 }]} onPress={onAction} activeOpacity={0.8}>
      <View style={[dw.accent, { backgroundColor: color }]} />
      <View style={dw.inner}>
        <View style={dw.topRow}>
          <View style={dw.tokenWrap}>
            <Hash size={11} color={G} />
            <Text style={dw.token}>{item.token}</Text>
          </View>
          <Text style={dw.date}>{fmtDate(item.date)}</Text>
        </View>
        <View style={[dw.badge, { backgroundColor: color + "14" }]}>
          <View style={[dw.dot, { backgroundColor: color }]} />
          <Text style={[dw.badgeTxt, { color }]}>{DELIVERY_STATUS_LABELS[item.status]}</Text>
          {item.current_location && <Text style={dw.loc}>· {item.current_location}</Text>}
        </View>
        <View style={dw.grid}>
          {[
            { l: "Cable", v: item.total_cable, u: "m" },
            { l: "Node",  v: item.total_node,  u: "" },
            { l: "Amp",   v: item.total_amplifier, u: "" },
            { l: "TSC",   v: item.total_tsc,   u: "" },
          ].map(x => (
            <Text key={x.l} style={dw.gridItem}>
              <Text style={dw.gridLbl}>{x.l} </Text>
              <Text style={dw.gridVal}>{x.v > 0 ? `${x.v}${x.u}` : "—"}</Text>
            </Text>
          ))}
        </View>
      </View>
      <ArrowRight size={16} color="#CBD5E1" style={{ marginRight: 4 }} />
    </TouchableOpacity>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function WarehouseScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [deliveries, setDeliveries] = useState<TeardownDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionDel, setActionDel] = useState<TeardownDelivery | null>(null);
  const [tab, setTab] = useState<"active" | "done">("active");

  const load = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    try {
      const data = await getDeliveries(token);
      data.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      setDeliveries(data);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const active = deliveries.filter(d => !["sold", "pulled_out"].includes(d.status));
  const done   = deliveries.filter(d =>  ["sold", "pulled_out"].includes(d.status));
  const shown  = tab === "active" ? active : done;

  // Cumulative stocks from final_warehouse + sold
  const stocks = deliveries
    .filter(d => ["final_warehouse", "sold"].includes(d.status))
    .reduce((acc, d) => {
      acc.cable    += d.total_cable;
      acc.node     += d.total_node;
      acc.amp      += d.total_amplifier;
      acc.ext      += d.total_extender;
      acc.tsc      += d.total_tsc;
      acc.psu      += d.total_psu;
      acc.psuCase  += d.total_psu_case;
      return acc;
    }, { cable: 0, node: 0, amp: 0, ext: 0, tsc: 0, psu: 0, psuCase: 0 });

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>
          <View style={s.headerText}>
            <Text style={s.title}>Warehouse</Text>
            <Text style={s.subtitle}>Staging & inventory management</Text>
          </View>
          <TouchableOpacity onPress={() => { setRefreshing(true); load(true); }} style={s.iconBtn}>
            <RefreshCw size={18} color={G} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={G} /></View>
        ) : (
          <FlatList
            data={shown}
            keyExtractor={d => String(d.id) + d.token}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} colors={[G]} />}
            ListHeaderComponent={
              <>
                {/* Stocks card */}
                {deliveries.length > 0 && (
                  <View style={s.stockCard}>
                    <View style={s.stockHeader}>
                      <WIcon size={18} color={G} />
                      <Text style={s.stockTitle}>Warehouse Stocks</Text>
                      <Text style={s.stockSub}>{deliveries.filter(d => d.status === "final_warehouse" || d.status === "sold").length} batches</Text>
                    </View>
                    <View style={s.stockGrid}>
                      {[
                        { l: "Cable",   v: stocks.cable,   u: "m", c: "#059669" },
                        { l: "Node",    v: stocks.node,    u: "",  c: "#0b6cff" },
                        { l: "Amp",     v: stocks.amp,     u: "",  c: "#8b5cf6" },
                        { l: "Ext",     v: stocks.ext,     u: "",  c: "#10b981" },
                        { l: "TSC",     v: stocks.tsc,     u: "",  c: "#f59e0b" },
                        { l: "PSU",     v: stocks.psu,     u: "",  c: "#ef4444" },
                        { l: "PSU Case",v: stocks.psuCase, u: "",  c: "#64748b" },
                      ].map(x => (
                        <View key={x.l} style={s.stockItem}>
                          <Text style={[s.stockVal, { color: x.c }]}>{x.v > 0 ? `${x.v}${x.u}` : "—"}</Text>
                          <Text style={s.stockLbl}>{x.l}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Tab bar */}
                <View style={s.tabs}>
                  {(["active", "done"] as const).map(t => (
                    <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
                      <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>
                        {t === "active" ? `Active (${active.length})` : `Completed (${done.length})`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            }
            renderItem={({ item }) => (
              <DeliveryRow item={item} onAction={() => setActionDel(item)} />
            )}
            ListEmptyComponent={
              <View style={s.empty}>
                <Package size={44} color="#CBD5E1" />
                <Text style={s.emptyTxt}>{tab === "active" ? "No active deliveries" : "No completed batches"}</Text>
              </View>
            }
          />
        )}

        {actionDel && (
          <ActionModal
            delivery={actionDel}
            token={token}
            onClose={() => setActionDel(null)}
            onRefresh={() => { load(true); setActionDel(null); }}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  header:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  backBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#F0FDF4" },
  headerText: { flex: 1 },
  title:     { fontSize: 20, fontWeight: "900", color: SLATE },
  subtitle:  { fontSize: 12, color: MUTED, fontWeight: "600" },
  center:    { flex: 1, alignItems: "center", justifyContent: "center" },
  list:      { padding: 16, gap: 10, paddingBottom: 48 },
  stockCard: { backgroundColor: WHITE, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: "#D1FAE5", marginBottom: 14, shadowColor: G, shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  stockHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  stockTitle:  { fontSize: 14, fontWeight: "900", color: SLATE, flex: 1 },
  stockSub:    { fontSize: 11, color: MUTED, fontWeight: "600" },
  stockGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  stockItem:  { flex: 1, minWidth: 68, backgroundColor: "#F8FAFC", borderRadius: 12, padding: 8, alignItems: "center", borderWidth: 1, borderColor: BORDER },
  stockVal:   { fontSize: 15, fontWeight: "900" },
  stockLbl:   { fontSize: 9, fontWeight: "800", color: MUTED, marginTop: 2, textTransform: "uppercase" as any },
  tabs:      { flexDirection: "row", backgroundColor: "#F1F5F9", borderRadius: 14, padding: 4, marginBottom: 14 },
  tab:       { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center" },
  tabActive: { backgroundColor: WHITE, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  tabTxt:    { fontSize: 12, fontWeight: "700", color: MUTED },
  tabTxtActive: { color: SLATE, fontWeight: "900" },
  empty:     { alignItems: "center", paddingTop: 40, gap: 10 },
  emptyTxt:  { fontSize: 15, fontWeight: "700", color: MUTED },
});

const dw = StyleSheet.create({
  card:     { flexDirection: "row", alignItems: "center", backgroundColor: WHITE, borderRadius: 18, paddingLeft: 0, paddingRight: 12, paddingVertical: 12, borderWidth: 1, borderColor: BORDER, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  accent:   { width: 4, alignSelf: "stretch", borderTopLeftRadius: 18, borderBottomLeftRadius: 18, marginRight: 12 },
  inner:    { flex: 1, gap: 6 },
  topRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tokenWrap: { flexDirection: "row", alignItems: "center", gap: 3 },
  token:    { fontSize: 13, fontWeight: "900", color: SLATE },
  date:     { fontSize: 10, color: MUTED, fontWeight: "600" },
  badge:    { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
  dot:      { width: 5, height: 5, borderRadius: 3 },
  badgeTxt: { fontSize: 10, fontWeight: "800" },
  loc:      { fontSize: 10, color: MUTED, fontWeight: "600" },
  grid:     { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  gridItem: { fontSize: 11, color: SLATE },
  gridLbl:  { color: MUTED },
  gridVal:  { fontWeight: "900" },
});

const tl = StyleSheet.create({
  wrap:  { marginBottom: 16 },
  title: { fontSize: 9, fontWeight: "900", color: MUTED, letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" as any },
  row:   { flexDirection: "row", gap: 10 },
  dotWrap: { alignItems: "center", width: 20 },
  dot:   { width: 12, height: 12, borderRadius: 6, backgroundColor: G },
  line:  { width: 2, flex: 1, backgroundColor: BORDER, marginTop: 4 },
  info:  { flex: 1, paddingBottom: 14 },
  stage: { fontSize: 13, fontWeight: "800", color: SLATE },
  loc:   { fontSize: 11, color: MUTED, fontWeight: "600" },
  note:  { fontSize: 11, color: MUTED, fontStyle: "italic" as any, marginTop: 2 },
  by:    { fontSize: 10, color: "#94A3B8", marginTop: 2 },
});

const am = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  sheet:    { backgroundColor: WHITE, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40, maxHeight: "85%" },
  handle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: "center", marginBottom: 16 },
  tokenRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  token:    { fontSize: 16, fontWeight: "900", color: SLATE, flex: 1 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  badge:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, alignSelf: "flex-start", marginBottom: 16 },
  dot:      { width: 7, height: 7, borderRadius: 4 },
  badgeTxt: { fontSize: 12, fontWeight: "800" },
  section:  { gap: 8 },
  sectionTitle: { fontSize: 9, fontWeight: "900", color: MUTED, letterSpacing: 1, textTransform: "uppercase" as any, marginBottom: 4 },
  input:    { backgroundColor: "#F8FAFC", borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14, paddingVertical: 10, fontSize: 13, color: SLATE },
  btn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14 },
  btnTxt:   { fontSize: 14, fontWeight: "900", color: WHITE },
});
