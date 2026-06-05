import { useAuth } from "@/context/auth-context";
import { getBridgeToken } from "@/lib/token-bridge";
import {
  approvePullOut,
  getPullOutRequests,
  type PullOutRequest,
} from "@/services/skycable";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import {
  CheckCircle2, ChevronLeft, ChevronRight,
  ClipboardList, RefreshCw, UserCheck, XCircle,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G      = "#006241";
const GDARK  = "#004d30";
const G_LIGHT= "#ECFDF5";
const SLATE  = "#111827";
const MUTED  = "#667085";
const BORDER = "#E7ECF2";
const WHITE  = "#FFFFFF";
const BG     = "#F8FAFC";
const RED    = "#ef4444";
const RED_BG = "#FEF2F2";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

const ITEM_META: Record<string, { label: string; color: string }> = {
  cable:       { label: "Cable",  color: "#059669" },
  node:        { label: "Node",   color: "#0b6cff" },
  amplifier:   { label: "Amp",    color: "#8b5cf6" },
  extender:    { label: "Ext",    color: "#10b981" },
  tsc:         { label: "TSC",    color: "#f59e0b" },
  powersupply: { label: "PSU",    color: "#ef4444" },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: "Pending",     color: "#f59e0b", bg: "#FFFBEB" },
  approved:   { label: "Approved",    color: "#059669", bg: "#ECFDF5" },
  dispatched: { label: "In Transit",  color: "#0b6cff", bg: "#EFF6FF" },
  delivered:  { label: "Delivered",   color: "#059669", bg: "#ECFDF5" },
  rejected:   { label: "Rejected",    color: RED,       bg: RED_BG   },
};

type TabKey = "pending" | "approved" | "history";

// ── Approval modal ────────────────────────────────────────────────────────────
function ApprovalModal({
  visible, request, onClose, onSubmit, submitting,
}: {
  visible: boolean;
  request: PullOutRequest | null;
  onClose: () => void;
  onSubmit: (action: "approve" | "reject", notes: string) => void;
  submitting: boolean;
}) {
  const [notes, setNotes] = useState("");
  const [action, setAction] = useState<"approve" | "reject" | null>(null);

  function reset() {
    setNotes("");
    setAction(null);
  }

  function handleClose() { reset(); onClose(); }

  function handleConfirm() {
    if (!action) return;
    onSubmit(action, notes);
    reset();
  }

  if (!request) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={m.overlay}>
        <View style={m.sheet}>
          {/* Handle */}
          <View style={m.handle} />

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Request summary */}
            <Text style={m.title}>Review Request</Text>
            <View style={m.infoCard}>
              <Text style={m.infoLabel}>From Warehouse</Text>
              <Text style={m.infoVal}>{request.warehouse?.name ?? `WH #${request.warehouse_id}`}</Text>
            </View>
            <View style={m.infoCard}>
              <Text style={m.infoLabel}>Items</Text>
              <View style={m.itemsRow}>
                {request.items?.map((it, i) => {
                  const meta = ITEM_META[it.item_type];
                  return (
                    <View key={i} style={[m.itemChip, { borderColor: (meta?.color ?? MUTED) + "30" }]}>
                      <Text style={[m.itemVal, { color: meta?.color ?? MUTED }]}>
                        {parseFloat(String(it.quantity))}{it.item_type === "cable" ? "m" : ""}
                      </Text>
                      <Text style={m.itemLbl}>{meta?.label ?? it.item_type}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
            {request.notes && (
              <View style={m.infoCard}>
                <Text style={m.infoLabel}>Notes from Subcon</Text>
                <Text style={m.infoVal}>{request.notes}</Text>
              </View>
            )}
            <View style={m.infoCard}>
              <Text style={m.infoLabel}>Assigned Driver</Text>
              <Text style={m.infoVal}>{request.driver?.name ?? "Selected by warehouse request"}</Text>
            </View>

            {/* Action toggle */}
            <Text style={m.sectionLabel}>Decision</Text>
            <View style={m.actionRow}>
              <TouchableOpacity
                style={[m.actionBtn, action === "approve" && m.actionApprove]}
                onPress={() => setAction("approve")}
              >
                <CheckCircle2 size={16} color={action === "approve" ? WHITE : G} />
                <Text style={[m.actionTxt, action === "approve" && { color: WHITE }]}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[m.actionBtn, action === "reject" && m.actionReject]}
                onPress={() => setAction("reject")}
              >
                <XCircle size={16} color={action === "reject" ? WHITE : RED} />
                <Text style={[m.actionTxt, action === "reject" && { color: WHITE }]}>Reject</Text>
              </TouchableOpacity>
            </View>

            {/* Notes */}
            <Text style={m.sectionLabel}>
              {action === "reject" ? "Reason for Rejection" : "Admin Notes"}
              <Text style={{ fontWeight: "500", color: MUTED }}> (optional)</Text>
            </Text>
            <TextInput
              style={m.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder={action === "reject" ? "Explain why this is rejected…" : "Add remarks…"}
              placeholderTextColor={MUTED}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {/* Buttons */}
            <View style={m.footer}>
              <TouchableOpacity style={m.cancelBtn} onPress={handleClose}>
                <Text style={m.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  m.confirmBtn,
                  !action && m.confirmDisabled,
                  action === "approve" && { backgroundColor: GDARK },
                  action === "reject"  && { backgroundColor: RED },
                  submitting && { opacity: 0.5 },
                ]}
                onPress={handleConfirm}
                disabled={!action || submitting}
              >
                {submitting
                  ? <ActivityIndicator size="small" color={WHITE} />
                  : action === "approve"
                    ? <CheckCircle2 size={16} color={WHITE} />
                    : <XCircle size={16} color={action ? WHITE : MUTED} />}
                <Text style={[m.confirmTxt, !action && { color: MUTED }]}>
                  {submitting ? "Processing…" : action === "approve" ? "Confirm Approval" : action === "reject" ? "Confirm Rejection" : "Select Action"}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Request card ──────────────────────────────────────────────────────────────
function RequestCard({ req, onPress }: { req: PullOutRequest; onPress: () => void }) {
  const sm = STATUS_META[req.status] ?? STATUS_META.pending;
  const isPending = req.status === "pending";

  return (
    <TouchableOpacity style={[rc.card, isPending && rc.cardPending]} onPress={onPress} activeOpacity={0.75}>
      {isPending && <View style={rc.pendingStripe} />}
      <View style={rc.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={rc.warehouseName} numberOfLines={1}>
            {req.warehouse?.name ?? `WH #${req.warehouse_id}`}
          </Text>
          <Text style={rc.date}>{fmtDate(req.created_at)}</Text>
          {req.declaredBy && <Text style={rc.declaredBy}>by {req.declaredBy.name}</Text>}
        </View>
        <View style={[rc.badge, { backgroundColor: sm.bg, borderColor: sm.color + "40" }]}>
          <View style={[rc.dot, { backgroundColor: sm.color }]} />
          <Text style={[rc.badgeTxt, { color: sm.color }]}>{sm.label}</Text>
        </View>
      </View>

      {req.items && req.items.length > 0 && (
        <View style={rc.itemsRow}>
          {req.items.map((it, i) => {
            const meta = ITEM_META[it.item_type];
            return (
              <View key={i} style={[rc.itemChip, { borderColor: (meta?.color ?? MUTED) + "25" }]}>
                <Text style={[rc.itemVal, { color: meta?.color ?? MUTED }]}>
                  {parseFloat(String(it.quantity))}{it.item_type === "cable" ? "m" : ""}
                </Text>
                <Text style={rc.itemLbl}>{meta?.label ?? it.item_type}</Text>
              </View>
            );
          })}
        </View>
      )}

      {isPending && (
        <View style={rc.reviewRow}>
          <Text style={rc.reviewTxt}>Tap to review →</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AdminPullOutScreen() {
  const router        = useRouter();
  const { token, user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const allowed = !!(user.is_admin || user.is_executive || user.role === "admin");
    if (!allowed) router.replace("/" as any);
  }, [user]);

  const [requests,   setRequests]   = useState<PullOutRequest[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab,        setTab]        = useState<TabKey>("pending");
  const [modal,      setModal]      = useState(false);
  const [selected,   setSelected]   = useState<PullOutRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const authToken = getBridgeToken() ?? token ?? "";
    try {
      const reqs = await getPullOutRequests(authToken);
      setRequests(reqs.sort((a, b) => b.id - a.id));
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openModal(req: PullOutRequest) {
    setSelected(req);
    setModal(true);
  }

  async function handleDecision(
    action: "approve" | "reject",
    notes: string
  ) {
    if (!selected) return;
    setSubmitting(true);
    try {
      const authToken = getBridgeToken() ?? token ?? "";
      await approvePullOut(authToken, selected.id, action, undefined, notes || undefined);
      setModal(false);
      setSelected(null);
      await load();
      Alert.alert(
        action === "approve" ? "Approved ✓" : "Rejected",
        action === "approve"
          ? "Pull-out approved. The warehouse-selected driver can now start the delivery."
          : "Pull-out request has been rejected."
      );
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Action failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const pendingList   = requests.filter(r => r.status === "pending");
  const approvedList  = requests.filter(r => r.status === "approved" || r.status === "dispatched");
  const historyList   = requests.filter(r => r.status === "delivered" || r.status === "rejected");

  const shown =
    tab === "pending"  ? pendingList :
    tab === "approved" ? approvedList : historyList;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={s.container}>

        {/* ── Header ── */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Pull-Out Requests</Text>
            <Text style={s.subtitle}>TelcoVantage admin approval</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push("/admin/manage-roles" as any)}
            style={s.rolesBtn}
          >
            <UserCheck size={16} color={G} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setRefreshing(true); load(); }}
            style={s.iconBtn}
          >
            <RefreshCw size={16} color={G} style={refreshing ? { opacity: 0.4 } : undefined} />
          </TouchableOpacity>
        </View>

        {/* ── Tab bar ── */}
        <View style={s.tabBar}>
          {([
            { key: "pending",  label: "Pending",  count: pendingList.length },
            { key: "approved", label: "Ongoing",  count: approvedList.length },
            { key: "history",  label: "History",  count: historyList.length },
          ] as const).map(({ key, label, count }) => (
            <TouchableOpacity
              key={key}
              style={[s.tabBtn, tab === key && s.tabBtnActive]}
              onPress={() => setTab(key)}
            >
              <Text style={[s.tabTxt, tab === key && s.tabTxtActive]}>{label}</Text>
              {count > 0 && (
                <View style={[s.tabBadge, tab === key && s.tabBadgeActive]}>
                  <Text style={[s.tabBadgeTxt, tab === key && s.tabBadgeTxtActive]}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={G} /></View>
        ) : (
          <FlatList
            data={shown}
            keyExtractor={r => String(r.id)}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); load(); }}
                colors={[G]} tintColor={G}
              />
            }
            ListEmptyComponent={
              <View style={s.empty}>
                <ClipboardList size={44} color="#CBD5E1" />
                <Text style={s.emptyTxt}>
                  {tab === "pending" ? "No pending requests" :
                   tab === "approved" ? "No ongoing deliveries" : "No history yet"}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <RequestCard
                req={item}
                onPress={() => item.status === "pending" ? openModal(item) : null}
              />
            )}
          />
        )}

        <ApprovalModal
          visible={modal}
          request={selected}
          onClose={() => { setModal(false); setSelected(null); }}
          onSubmit={handleDecision}
          submitting={submitting}
        />
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  center:    { flex: 1, alignItems: "center", justifyContent: "center" },
  header:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  backBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: G_LIGHT },
  rolesBtn:  { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: G_LIGHT },
  title:     { fontSize: 20, fontWeight: "900", color: SLATE },
  subtitle:  { fontSize: 12, color: MUTED, fontWeight: "600" },

  tabBar:        { flexDirection: "row", backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, paddingHorizontal: 8 },
  tabBtn:        { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabBtnActive:  { borderBottomColor: G },
  tabTxt:        { fontSize: 13, fontWeight: "700", color: MUTED },
  tabTxtActive:  { color: G },
  tabBadge:      { backgroundColor: "#F1F5F9", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  tabBadgeActive:{ backgroundColor: G + "18" },
  tabBadgeTxt:   { fontSize: 10, fontWeight: "800", color: MUTED },
  tabBadgeTxtActive: { color: G },

  list:  { padding: 16, gap: 12, paddingBottom: 48 },
  empty: { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTxt: { fontSize: 14, fontWeight: "700", color: MUTED },
});

const rc = StyleSheet.create({
  card:           { backgroundColor: WHITE, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: BORDER, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  cardPending:    { borderColor: "#f59e0b50", borderWidth: 1.5 },
  pendingStripe:  { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: "#f59e0b" },
  topRow:         { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10, paddingLeft: 8 },
  warehouseName:  { fontSize: 15, fontWeight: "900", color: SLATE },
  date:           { fontSize: 11, color: MUTED, fontWeight: "500", marginTop: 2 },
  declaredBy:     { fontSize: 11, color: MUTED, fontWeight: "500", marginTop: 1 },
  badge:          { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  dot:            { width: 6, height: 6, borderRadius: 3 },
  badgeTxt:       { fontSize: 10, fontWeight: "800" },
  itemsRow:       { flexDirection: "row", gap: 4, marginBottom: 10, paddingLeft: 8 },
  itemChip:       { flex: 1, backgroundColor: BG, borderRadius: 8, paddingVertical: 5, alignItems: "center", borderWidth: 1 },
  itemVal:        { fontSize: 11, fontWeight: "900" },
  itemLbl:        { fontSize: 7, fontWeight: "700", color: MUTED, textTransform: "uppercase", marginTop: 1 },
  reviewRow:      { backgroundColor: "#FFFBEB", borderRadius: 10, paddingVertical: 8, alignItems: "center", marginLeft: 8 },
  reviewTxt:      { fontSize: 12, fontWeight: "800", color: "#f59e0b" },
});

const m = StyleSheet.create({
  overlay:       { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:         { backgroundColor: WHITE, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: "90%" },
  handle:        { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E2E8F0", alignSelf: "center", marginBottom: 16 },
  title:         { fontSize: 18, fontWeight: "900", color: SLATE, marginBottom: 16 },

  infoCard:      { backgroundColor: BG, borderRadius: 12, padding: 12, marginBottom: 10 },
  infoLabel:     { fontSize: 10, fontWeight: "800", color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  infoVal:       { fontSize: 14, fontWeight: "700", color: SLATE },
  itemsRow:      { flexDirection: "row", gap: 4, marginTop: 4 },
  itemChip:      { flex: 1, backgroundColor: WHITE, borderRadius: 8, paddingVertical: 5, alignItems: "center", borderWidth: 1 },
  itemVal:       { fontSize: 12, fontWeight: "900" },
  itemLbl:       { fontSize: 8, fontWeight: "700", color: MUTED, textTransform: "uppercase" },

  sectionLabel:  { fontSize: 11, fontWeight: "900", color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginTop: 16, marginBottom: 10 },
  actionRow:     { flexDirection: "row", gap: 10 },
  actionBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, borderWidth: 1.5, paddingVertical: 13, borderColor: BORDER, backgroundColor: BG },
  actionApprove: { backgroundColor: GDARK, borderColor: GDARK },
  actionReject:  { backgroundColor: RED, borderColor: RED },
  actionTxt:     { fontSize: 14, fontWeight: "800", color: SLATE },

  notesInput:    { borderWidth: 1.5, borderColor: BORDER, borderRadius: 12, backgroundColor: BG, padding: 12, fontSize: 13, color: SLATE, minHeight: 76, textAlignVertical: "top", marginBottom: 4 },

  footer:        { flexDirection: "row", gap: 10, marginTop: 20 },
  cancelBtn:     { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center", backgroundColor: BG, borderWidth: 1.5, borderColor: BORDER },
  cancelTxt:     { fontSize: 14, fontWeight: "800", color: MUTED },
  confirmBtn:    { flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: "#E2E8F0" },
  confirmDisabled:{ opacity: 0.5 },
  confirmTxt:    { fontSize: 14, fontWeight: "900", color: WHITE },
});
