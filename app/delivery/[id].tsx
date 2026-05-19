import { useAuth } from "@/context/auth-context";
import { MOCK_DELIVERIES, type MockDelivery } from "@/lib/mock-deliveries";
import {
  acceptDelivery,
  getBackendDeliveries,
  type BackendDelivery,
} from "@/services/skycable";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  Award, Camera, CheckCircle2, ChevronLeft,
  Clock, Hash, Image as ImageIcon, MapPin,
  SendHorizonal, Truck, User,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G = "#0B7A5A", SLATE = "#111827", MUTED = "#667085", BORDER = "#E7ECF2", WHITE = "#FFFFFF";

// Roles that can approve deliveries and request pickups
const MANAGE_ROLES = ["project_manager", "project manager", "warehouse_in_charge", "warehouse_manager", "warehouse", "admin", "executive"];
function canManageDelivery(role?: string | null): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return MANAGE_ROLES.some(m => r.includes(m.split("_")[0]));
}

const STATUS_COLORS: Record<string, string> = {
  in_transit: "#f59e0b",
  accepted:   "#10b981",
};
const STATUS_LABELS: Record<string, string> = {
  in_transit: "In Transit",
  accepted:   "Accepted",
  // Mock delivery statuses
  submitted:             "Submitted",
  at_subcon_warehouse:   "At Subcon Warehouse",
  at_warehouse:          "At Warehouse",
  processing:            "Processing",
  final_warehouse:       "Final Warehouse",
  sold:                  "Sold",
  pulled_out:            "Pulled Out",
};

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]} ${day}, ${y}`;
}
function fmtDT(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600000);
  const h = d.getUTCHours(), mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} · ${h % 12 || 12}:${mi} ${h >= 12 ? "PM" : "AM"}`;
}

// Unified type for display (handles both backend and mock)
type AnyDelivery = MockDelivery | BackendDelivery;

// ── Received / confirmation photo ────────────────────────────────────────────
function ReceivedPhoto({ uri }: { uri?: string | null }) {
  const [err, setErr] = useState(false);
  if (!uri || err) {
    return (
      <View style={ph.placeholder}>
        <Text style={{ fontSize: 28 }}>📷</Text>
        <Text style={ph.placeholderTxt}>No received photo on file</Text>
      </View>
    );
  }
  return (
    <View style={ph.shell}>
      <Image source={{ uri }} style={ph.img} resizeMode="cover" onError={() => setErr(true)} />
      <View style={ph.badge}>
        <CheckCircle2 size={11} color={WHITE} />
        <Text style={ph.badgeTxt}>Received Confirmation</Text>
      </View>
    </View>
  );
}

// ── Approval section (role-gated) ─────────────────────────────────────────────
function ApprovalSection({
  deliveryId,
  onApproved,
}: {
  deliveryId: number;
  onApproved: () => void;
}) {
  const { token } = useAuth();
  const [photo, setPhoto]       = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);

  async function capturePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Allow camera access to capture the received photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setPhoto(result.assets[0].uri);
    }
  }

  async function approve() {
    if (!photo) {
      Alert.alert("Photo required", "Capture a received confirmation photo before approving.");
      return;
    }
    if (!token) return;

    Alert.alert(
      "Approve Delivery?",
      "This will mark the delivery as accepted and update warehouse stock.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve",
          onPress: async () => {
            setSaving(true);
            try {
              await acceptDelivery(token, deliveryId, photo);
              Alert.alert("✅ Approved!", "Delivery accepted. Warehouse stock updated.", [
                { text: "OK", onPress: onApproved },
              ]);
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "Approval failed. Please try again.");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={ap.card}>
      <Text style={ap.sectionLabel}>APPROVE & ACCEPT DELIVERY</Text>

      {/* Photo capture area */}
      <Text style={ap.photoHint}>
        📸 Capture a confirmation photo of the received items.{"\n"}
        <Text style={{ color: "#EF4444" }}>Required before approving.</Text>
      </Text>

      {photo ? (
        <View style={ap.photoPreview}>
          <Image source={{ uri: photo }} style={ap.photoImg} resizeMode="cover" />
          <TouchableOpacity style={ap.photoRetake} onPress={capturePhoto}>
            <Camera size={14} color={WHITE} />
            <Text style={ap.photoRetakeTxt}>Retake</Text>
          </TouchableOpacity>
          <View style={ap.photoBadge}>
            <CheckCircle2 size={11} color={WHITE} />
            <Text style={ap.photoBadgeTxt}>Photo captured</Text>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={ap.cameraBtn} onPress={capturePhoto} activeOpacity={0.85}>
          <Camera size={22} color={G} />
          <Text style={ap.cameraBtnTxt}>Tap to Capture Photo</Text>
        </TouchableOpacity>
      )}

      {/* Approve button */}
      <TouchableOpacity
        style={[ap.approveBtn, (!photo || saving) && ap.approveBtnDisabled]}
        onPress={approve}
        disabled={!photo || saving}
        activeOpacity={0.85}
      >
        {saving
          ? <ActivityIndicator size="small" color={WHITE} />
          : <CheckCircle2 size={18} color={WHITE} />}
        <Text style={ap.approveTxt}>
          {saving ? "Approving…" : photo ? "Approve & Accept Delivery" : "Capture Photo to Approve"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function DeliveryDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const [delivery, setDelivery] = useState<AnyDelivery | null>(null);
  const [loading,  setLoading]  = useState(true);

  const isManager = canManageDelivery(user?.role);

  function loadFromMock(): MockDelivery | null {
    return MOCK_DELIVERIES.find(d => String(d.id) === id) ?? null;
  }

  async function loadDelivery() {
    if (!id) { setLoading(false); return; }

    // Check mock first
    const mock = loadFromMock();
    if (mock) { setDelivery(mock); setLoading(false); return; }

    // Fetch from backend
    if (!token) { setLoading(false); return; }
    try {
      const list = await getBackendDeliveries(token);
      const found = list.find(d => String(d.id) === id) ?? null;
      setDelivery(found);
    } catch { setDelivery(null); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadDelivery(); }, [token, id]);

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <SafeAreaView style={s.container}>
          <View style={s.center}><ActivityIndicator size="large" color={G} /></View>
        </SafeAreaView>
      </>
    );
  }

  if (!delivery) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <SafeAreaView style={s.container}>
          <View style={s.header}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <ChevronLeft size={22} color={SLATE} />
            </TouchableOpacity>
            <Text style={s.title}>Delivery Not Found</Text>
          </View>
          <View style={s.center}>
            <Text style={{ fontSize: 40 }}>📦</Text>
            <Text style={{ fontSize: 15, fontWeight: "700", color: MUTED, marginTop: 12 }}>
              No delivery record for ID #{id}
            </Text>
          </View>
        </SafeAreaView>
      </>
    );
  }

  // Normalise fields between MockDelivery and BackendDelivery
  const isMock    = "token" in delivery;
  const status    = delivery.status;
  const color     = STATUS_COLORS[status] ?? "#64748b";
  const label     = STATUS_LABELS[status] ?? status;
  const canApprove = isManager && status === "in_transit";

  // MockDelivery fields
  const mock = isMock ? (delivery as MockDelivery) : null;
  // BackendDelivery fields
  const backend = !isMock ? (delivery as BackendDelivery) : null;

  const components = mock
    ? [
        { l: "Cable",       v: mock.total_cable,     u: "m", c: "#059669" },
        { l: "Node",        v: mock.total_node,       u: "",  c: "#0b6cff" },
        { l: "Amplifier",   v: mock.total_amplifier,  u: "",  c: "#8b5cf6" },
        { l: "Extender",    v: mock.total_extender,   u: "",  c: "#10b981" },
        { l: "TSC",         v: mock.total_tsc,        u: "",  c: "#f59e0b" },
        { l: "PSU",         v: mock.total_psu,        u: "",  c: "#ef4444" },
        { l: "PSU Case",    v: mock.total_psu_case,   u: "",  c: "#64748b" },
      ]
    : (backend?.items ?? []).map(x => ({
        l: x.item_type.charAt(0).toUpperCase() + x.item_type.slice(1),
        v: x.quantity,
        u: x.unit === "pcs" ? "" : x.unit,
        c: "#475569",
      }));

  const headerToken = mock?.token ?? `#${delivery.id}`;
  const headerDate  = mock
    ? fmtDate(mock.date)
    : backend?.dispatched_at ? fmtDT(backend.dispatched_at) : "—";

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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Hash size={14} color={G} />
              <Text style={s.title}>{headerToken}</Text>
            </View>
            <Text style={s.subtitle}>{headerDate}</Text>
          </View>
          {/* Request Pickup button for managers */}
          {isManager && (
            <TouchableOpacity
              style={s.pickupBtn}
              onPress={() => router.push("/delivery/pickup-request" as any)}
            >
              <Truck size={15} color={G} />
              <Text style={s.pickupBtnTxt}>Request Pickup</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* Status card */}
          <View style={[s.statusCard, { borderColor: color + "44" }]}>
            <View style={[s.badge, { backgroundColor: color + "18" }]}>
              <View style={[s.dot, { backgroundColor: color }]} />
              <Text style={[s.badgeTxt, { color }]}>{label}</Text>
            </View>
            {mock?.current_location && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 }}>
                <MapPin size={12} color={MUTED} />
                <Text style={s.loc}>{mock.current_location}</Text>
              </View>
            )}
            {backend?.accepted_at && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 }}>
                <Clock size={12} color={G} />
                <Text style={{ fontSize: 12, fontWeight: "700", color: G }}>
                  Accepted {fmtDT(backend.accepted_at)}
                </Text>
              </View>
            )}
          </View>

          {/* Received confirmation photo (mock only — backend adds later) */}
          {mock && (
            <>
              <Text style={s.sLabel}>RECEIVED CONFIRMATION PHOTO</Text>
              <ReceivedPhoto uri={mock.received_image_uri} />
            </>
          )}

          {/* Personnel (mock only) */}
          {mock && (mock.delivered_by || mock.approved_by) && (
            <>
              <Text style={s.sLabel}>PERSONNEL</Text>
              <View style={s.peopleRow}>
                {mock.delivered_by && (
                  <View style={s.personBlock}>
                    <View style={[s.personIcon, { backgroundColor: "#ECFDF5" }]}>
                      <User size={16} color={G} />
                    </View>
                    <View>
                      <Text style={s.personRole}>Delivered by</Text>
                      <Text style={s.personName}>{mock.delivered_by}</Text>
                    </View>
                  </View>
                )}
                {mock.delivered_by && mock.approved_by && <View style={s.personDiv} />}
                {mock.approved_by && (
                  <View style={s.personBlock}>
                    <View style={[s.personIcon, { backgroundColor: "#F5F3FF" }]}>
                      <Award size={16} color="#8b5cf6" />
                    </View>
                    <View>
                      <Text style={s.personRole}>Approved by</Text>
                      <Text style={[s.personName, { color: "#8b5cf6" }]}>{mock.approved_by}</Text>
                    </View>
                  </View>
                )}
              </View>
              {mock.received_at && (
                <View style={s.receivedRow}>
                  <Clock size={12} color={G} />
                  <Text style={s.receivedTxt}>Received on {fmtDT(mock.received_at)}</Text>
                </View>
              )}
            </>
          )}

          {/* Collected items */}
          {components.length > 0 && (
            <>
              <Text style={s.sLabel}>
                COLLECTED ITEMS{mock?.teardown_count ? ` — ${mock.teardown_count} TEARDOWNS` : ""}
              </Text>
              <View style={s.grid}>
                {components.map(x => (
                  <View key={x.l} style={s.gridItem}>
                    <Text style={[s.gridVal, { color: x.c }]}>{x.v}{x.u}</Text>
                    <Text style={s.gridLbl}>{x.l}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Chain of custody (mock only) */}
          {mock && mock.movements.length > 0 && (
            <>
              <Text style={s.sLabel}>
                CHAIN OF CUSTODY — {mock.movements.length} MOVEMENT{mock.movements.length !== 1 ? "S" : ""}
              </Text>
              {mock.movements.map((m, i) => {
                const mc = STATUS_COLORS[m.to_stage] ?? G;
                return (
                  <View key={m.id ?? i} style={s.tlRow}>
                    <View style={s.tlLeft}>
                      <View style={[s.tlDot, { backgroundColor: mc }]} />
                      {i < mock.movements.length - 1 && <View style={s.tlLine} />}
                    </View>
                    <View style={s.tlContent}>
                      <Text style={s.tlStage}>{STATUS_LABELS[m.to_stage] ?? m.to_stage}</Text>
                      <Text style={s.tlLoc}>{m.location_name}</Text>
                      {m.notes && <Text style={s.tlNote}>📝 {m.notes}</Text>}
                      <Text style={s.tlBy}>
                        {m.moved_by ? `by ${m.moved_by.name} · ` : ""}{fmtDT(m.timestamp)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </>
          )}

          {/* ── Approval section (role-gated, in_transit only) ── */}
          {canApprove && backend && (
            <ApprovalSection
              deliveryId={backend.id}
              onApproved={() => { router.back(); }}
            />
          )}

          {/* Not authorized notice for in_transit deliveries */}
          {!isManager && status === "in_transit" && (
            <View style={s.noticeBanner}>
              <ImageIcon size={14} color={MUTED} />
              <Text style={s.noticeText}>
                Approval is restricted to Project Managers and Warehouse In-Charge.
              </Text>
            </View>
          )}

          {/* Request Pickup for managers */}
          {isManager && (
            <TouchableOpacity
              style={s.reqPickupBanner}
              onPress={() => router.push("/delivery/pickup-request" as any)}
              activeOpacity={0.85}
            >
              <View style={s.reqPickupLeft}>
                <View style={s.reqPickupIcon}><Truck size={18} color={G} /></View>
                <View>
                  <Text style={s.reqPickupTitle}>Request Pickup Transfer</Text>
                  <Text style={s.reqPickupSub}>Move items to another warehouse</Text>
                </View>
              </View>
              <SendHorizonal size={16} color={G} />
            </TouchableOpacity>
          )}

        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#F8FAFC" },
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  backBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerText:  { flex: 1 },
  title:       { fontSize: 18, fontWeight: "900", color: SLATE },
  subtitle:    { fontSize: 12, color: MUTED, fontWeight: "600" },
  pickupBtn:   { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#ECFDF5", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: G + "30" },
  pickupBtnTxt:{ fontSize: 11, fontWeight: "800", color: G },
  center:      { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll:      { padding: 16, paddingBottom: 56, gap: 14 },
  statusCard:  { backgroundColor: WHITE, borderRadius: 18, padding: 14, borderWidth: 1.5, gap: 4 },
  badge:       { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, alignSelf: "flex-start" },
  dot:         { width: 7, height: 7, borderRadius: 4 },
  badgeTxt:    { fontSize: 13, fontWeight: "900" },
  loc:         { fontSize: 12, color: MUTED, fontWeight: "600" },
  sLabel:      { fontSize: 9, fontWeight: "900", color: MUTED, letterSpacing: 1, textTransform: "uppercase" },
  grid:        { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridItem:    { flex: 1, minWidth: 80, backgroundColor: WHITE, borderRadius: 14, padding: 12, alignItems: "center", borderWidth: 1, borderColor: BORDER },
  gridVal:     { fontSize: 18, fontWeight: "900" },
  gridLbl:     { fontSize: 10, fontWeight: "700", color: MUTED, marginTop: 2, textTransform: "uppercase" },
  peopleRow:   { flexDirection: "row", alignItems: "center", backgroundColor: WHITE, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: BORDER },
  personBlock: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  personIcon:  { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  personDiv:   { width: 1, height: 40, backgroundColor: BORDER, marginHorizontal: 8 },
  personRole:  { fontSize: 9, fontWeight: "700", color: MUTED, textTransform: "uppercase", letterSpacing: 0.4 },
  personName:  { fontSize: 13, fontWeight: "900", color: SLATE, marginTop: 2 },
  receivedRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -6 },
  receivedTxt: { fontSize: 12, fontWeight: "700", color: G },
  tlRow:       { flexDirection: "row", gap: 12 },
  tlLeft:      { alignItems: "center", width: 18 },
  tlDot:       { width: 14, height: 14, borderRadius: 7 },
  tlLine:      { width: 2, flex: 1, backgroundColor: BORDER, marginTop: 4 },
  tlContent:   { flex: 1, paddingBottom: 16 },
  tlStage:     { fontSize: 14, fontWeight: "900", color: SLATE },
  tlLoc:       { fontSize: 12, color: "#0b6cff", fontWeight: "700" },
  tlNote:      { fontSize: 11, color: MUTED, fontStyle: "italic", marginTop: 2 },
  tlBy:        { fontSize: 10, color: "#94A3B8", marginTop: 3 },
  noticeBanner:{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F8FAFC", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: BORDER },
  noticeText:  { fontSize: 12, color: MUTED, fontWeight: "600", flex: 1 },
  reqPickupBanner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: WHITE, borderRadius: 18, padding: 14, borderWidth: 1.5, borderColor: G + "30", shadowColor: G, shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  reqPickupLeft:   { flexDirection: "row", alignItems: "center", gap: 12 },
  reqPickupIcon:   { width: 44, height: 44, borderRadius: 12, backgroundColor: "#ECFDF5", alignItems: "center", justifyContent: "center" },
  reqPickupTitle:  { fontSize: 14, fontWeight: "900", color: SLATE },
  reqPickupSub:    { fontSize: 11, fontWeight: "600", color: MUTED, marginTop: 2 },
});

const ph = StyleSheet.create({
  shell:          { borderRadius: 16, overflow: "hidden", height: 180, position: "relative" },
  img:            { width: "100%", height: "100%" },
  badge:          { position: "absolute", bottom: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: G, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  badgeTxt:       { fontSize: 11, fontWeight: "800", color: WHITE },
  placeholder:    { height: 120, backgroundColor: "#F1F5F9", borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderColor: BORDER, borderStyle: "dashed" },
  placeholderTxt: { fontSize: 11, fontWeight: "600", color: "#CBD5E1" },
});

const ap = StyleSheet.create({
  card:            { backgroundColor: WHITE, borderRadius: 20, padding: 16, borderWidth: 2, borderColor: G + "30", shadowColor: G, shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3, gap: 12 },
  sectionLabel:    { fontSize: 10, fontWeight: "900", color: G, letterSpacing: 1, textTransform: "uppercase" },
  photoHint:       { fontSize: 13, color: MUTED, fontWeight: "600", lineHeight: 20 },
  cameraBtn:       { height: 100, backgroundColor: "#ECFDF5", borderRadius: 16, borderWidth: 2, borderColor: G + "40", borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 8 },
  cameraBtnTxt:    { fontSize: 14, fontWeight: "800", color: G },
  photoPreview:    { borderRadius: 16, overflow: "hidden", height: 160, position: "relative" },
  photoImg:        { width: "100%", height: "100%" },
  photoRetake:     { position: "absolute", top: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  photoRetakeTxt:  { fontSize: 11, fontWeight: "800", color: WHITE },
  photoBadge:      { position: "absolute", bottom: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: G, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  photoBadgeTxt:   { fontSize: 10, fontWeight: "800", color: WHITE },
  approveBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: G, borderRadius: 16, paddingVertical: 15, shadowColor: G, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  approveBtnDisabled: { backgroundColor: "#94A3B8", shadowOpacity: 0 },
  approveTxt:      { fontSize: 14, fontWeight: "900", color: WHITE },
});
