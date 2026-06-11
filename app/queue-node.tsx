import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  imageQueueReadAll,
  queueReadAll,
} from "@/lib/sync-queue";
import { flushAllQueues, isOnline } from "@/lib/net-sync";
import { useAuth } from "@/context/auth-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Palette — same as queue.tsx ───────────────────────────────────────────────
const G = {
  green:    "#1A7C4E",
  greenBg:  "#F0FAF4",
  greenMid: "#2E8B5A",
  red:      "#DC2626",
  redBg:    "#FEF2F2",
  ink:      "#0F172A",
  muted:    "#64748B",
  soft:     "#94A3B8",
  border:   "#E8EDF2",
  card:     "#FFFFFF",
  bg:       "#F5F7FA",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-PH", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function QueueNodeScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const { nodeId, nodeName, type } = useLocalSearchParams<{
    nodeId: string; nodeName: string; type: "teardown" | "captured";
  }>();

  const [spans,        setSpans]        = useState<any[]>([]);
  const [photos,       setPhotos]       = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [submitting,   setSubmitting]   = useState(false);
  const [uploaded,     setUploaded]     = useState(0);
  const [uploadedToday,setUploadedToday]= useState(0);
  const [online,       setOnline]       = useState(true);
  const [successCount, setSuccessCount] = useState(0);
  const [showSuccess,  setShowSuccess]  = useState(false);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapRef   = useRef(0);

  const isCaptured = type === "captured";
  const accent     = isCaptured ? G.red : G.green;

  const load = async () => {
    const [tds, imgs, net] = await Promise.all([
      queueReadAll().catch(() => []),
      imageQueueReadAll().catch(() => []),
      isOnline().catch(() => false),
    ]);
    setOnline(net as boolean);

    if (isCaptured) {
      setSpans([]);
      setPhotos(imgs.filter(i =>
        i.status !== "synced" && i.meta?.node_id === nodeId &&
        (i.reportLocalId?.startsWith("batch_before_") || i.meta?.lock === "1")
      ));
    } else {
      setSpans(tds.filter(i =>
        i.status !== "synced" &&
        (i.fields?.node_id === nodeId || i.nodeId === nodeId)
      ));
      setPhotos(imgs.filter(i =>
        i.status !== "synced" && i.meta?.node_id === nodeId &&
        !i.reportLocalId?.startsWith("batch_before_") && i.meta?.lock !== "1"
      ));
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // Load today's synced count (same key as queue.tsx — PHT date)
    const todayKey = `synced_today_${new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)}`;
    AsyncStorage.getItem(todayKey).then(v => { if (v) setUploadedToday(Number(v)); }).catch(() => {});
  }, [nodeId, type]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const totalCount = spans.length + photos.length;

  const syncAll = async () => {
    if (!online) { Alert.alert("Offline", "Connect to the internet first."); return; }
    snapRef.current = totalCount;
    setUploaded(0);
    setSubmitting(true);

    pollRef.current = setInterval(async () => {
      const [td, imgs] = await Promise.all([queueReadAll(), imageQueueReadAll()]);
      const remaining = td.filter(i => i.status !== "synced" && (i.fields?.node_id === nodeId || i.nodeId === nodeId)).length
        + imgs.filter(i => i.status !== "synced" && i.meta?.node_id === nodeId).length;
      setUploaded(Math.max(0, snapRef.current - remaining));
    }, 600);

    try {
      await Promise.allSettled([
        flushAllQueues(),
        token ? import("@/services/offline").then(m => m.syncQueue(token)) : Promise.resolve(),
      ]);
      clearInterval(pollRef.current!); pollRef.current = null;
      const [tdAfter, imgsAfter] = await Promise.all([queueReadAll(), imageQueueReadAll()]);
      const remaining = tdAfter.filter(i => i.status !== "synced" && (i.fields?.node_id === nodeId || i.nodeId === nodeId)).length
        + imgsAfter.filter(i => i.status !== "synced" && i.meta?.node_id === nodeId).length;
      const synced = Math.max(0, snapRef.current - remaining);
      setUploaded(synced);
      const todayKey = `synced_today_${new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)}`;
      const prev = Number(await AsyncStorage.getItem(todayKey).catch(() => "0") ?? "0");
      const next = prev + synced;
      await AsyncStorage.setItem(todayKey, String(next)).catch(() => {});
      setUploadedToday(next);
      await load();
      setSuccessCount(synced);
      setShowSuccess(true);
    } catch (e: any) {
      clearInterval(pollRef.current!); pollRef.current = null;
      Alert.alert("Sync Failed", e?.message ?? "Unknown error.");
    }
    setSubmitting(false);
  };

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Header — white concept, same as queue.tsx ── */}
      <View style={s.header}>
        {/* Back + eyebrow + online */}
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
            <Text style={[s.backIcon, { color: accent }]}>←</Text>
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={[s.headerEye, { color: accent }]}>{isCaptured ? "CAPTURED PENDING" : "TEARDOWN PENDING"}</Text>
            <Text style={s.headerTitle} numberOfLines={1}>{nodeName || `Node #${nodeId}`}</Text>
            <Text style={s.headerSub}>Items waiting to be synchronized</Text>
          </View>
          <View style={[s.onlineBadge, { backgroundColor: online ? G.greenBg : "#FFF7ED" }]}>
            <View style={[s.onlineDot, { backgroundColor: online ? G.green : "#F97316" }]} />
            <Text style={[s.onlineText, { color: online ? G.green : "#EA580C" }]}>{online ? "Online" : "Offline"}</Text>
          </View>
        </View>

        {/* Stat cards — white on light bg */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <View style={s.statIconBox}><Text style={s.statIcon}>🕐</Text></View>
            <Text style={s.statLabel}>Pending Items</Text>
            <Text style={[s.statNum, { color: accent }]}>{totalCount}</Text>
            <Text style={s.statSub}>Awaiting sync</Text>
          </View>
          <View style={[s.statCard, { overflow: "hidden" }]}>
            <View style={s.statDecor} />
            <View style={s.statIconBox}><Text style={s.statIcon}>✅</Text></View>
            <Text style={s.statLabel}>Uploaded Today</Text>
            <Text style={[s.statNum, { color: G.green }]}>{uploadedToday}</Text>
            <Text style={s.statSub}>All items up to date</Text>
          </View>
        </View>

        {/* Sync All Now — green button */}
        <TouchableOpacity
          style={[s.syncBtn, { backgroundColor: accent }, (!online || submitting || totalCount === 0) && { opacity: 0.55 }]}
          onPress={syncAll}
          disabled={submitting || totalCount === 0}
          activeOpacity={0.85}
        >
          <View style={s.syncIconBox}>
            {submitting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.syncIconText}>↻</Text>
            }
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.syncTitle}>
              {submitting ? "Uploading…" : totalCount === 0 ? "All Synced ✓" : "Sync All Now"}
            </Text>
            <Text style={s.syncSub}>
              {submitting
                ? `${uploaded} of ${snapRef.current} uploaded`
                : totalCount === 0 ? "Nothing pending" : `Upload all ${totalCount} item${totalCount !== 1 ? "s" : ""}`}
            </Text>
          </View>
          {!submitting && totalCount > 0 && <Text style={s.syncArrow}>›</Text>}
        </TouchableOpacity>
      </View>

      {/* ── Body ── */}
      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={G.green} /></View>
      ) : totalCount === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyMark}>✓</Text>
          <Text style={s.emptyTitle}>All Synced</Text>
          <Text style={s.emptySub}>Nothing pending for this node.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[G.green]} tintColor={G.green} />}
        >
          {/* Teardown spans */}
          {spans.length > 0 && (
            <>
              <SectionLabel label={`Teardown Logs · ${spans.length}`} color={G.green} />
              {spans.map(item => {
                const f = item.fields ?? {};
                const from = f.from_pole_code ?? f.pole_code ?? "—";
                const to   = f.to_pole_code ?? "—";
                const comps = [
                  f.collected_cable     && `${f.collected_cable}m cable`,
                  f.collected_node      && `${f.collected_node} node`,
                  f.collected_amplifier && `${f.collected_amplifier} amp`,
                  f.collected_extender  && `${f.collected_extender} ext`,
                  f.collected_tsc       && `${f.collected_tsc} tsc`,
                  f.collected_powersupply && `${f.collected_powersupply} psu`,
                ].filter(Boolean);
                const photoKeys = Object.keys(item.photoPaths ?? {});

                return (
                  <TouchableOpacity key={item.id} style={[s.card, { borderLeftColor: G.green }]} activeOpacity={0.8} onPress={() => router.push({ pathname: "/queue-span", params: { entryId: item.id } } as any)}>
                    <View style={s.cardTop}>
                      <View style={s.statusBadge}>
                        <View style={[s.statusDot, { backgroundColor: G.green }]} />
                        <Text style={[s.statusText, { color: G.green }]}>PENDING</Text>
                      </View>
                      <Text style={s.cardArrow}>›</Text>
                    </View>
                    <Text style={s.spanTitle}>{from}   →   {to}</Text>
                    {comps.length > 0 && <Text style={s.cardSub} numberOfLines={1}>{comps.join("  ·  ")}</Text>}
                    {photoKeys.length > 0 && (
                      <View style={s.chipRow}>
                        {photoKeys.map(k => (
                          <View key={k} style={s.chip}>
                            <Text style={s.chipText}>{k.replace(/_/g, " ")}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {f.did_collect_all_cable === "0" && f.unrecovered_reason && (
                      <View style={s.reasonRow}>
                        <Text style={s.reasonText}>⚠️  {f.unrecovered_reason}</Text>
                      </View>
                    )}
                    <Text style={s.cardDate}>🕐  {fmtDate(item.queuedAt)}</Text>
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {/* Teardown photos (non-batch) */}
          {!isCaptured && photos.length > 0 && (
            <>
              <SectionLabel label={`Queued Photos · ${photos.length}`} color="#7C3AED" />
              {photos.map(img => (
                <View key={img.id} style={[s.card, { borderLeftColor: "#7C3AED" }]}>
                  <View style={s.cardTop}>
                    <View style={s.statusBadge}>
                      <View style={[s.statusDot, { backgroundColor: "#7C3AED" }]} />
                      <Text style={[s.statusText, { color: "#7C3AED" }]}>PENDING</Text>
                    </View>
                  </View>
                  <Text style={s.spanTitle}>📷  {img.meta?.pole_code ?? "—"}  ·  {img.fieldName?.replace(/_/g, " ") ?? "photo"}</Text>
                  <Text style={s.cardDate}>🕐  {fmtDate(img.queuedAt)}</Text>
                </View>
              ))}
            </>
          )}

          {/* Captured before photos */}
          {isCaptured && photos.length > 0 && (
            <>
              <SectionLabel label={`Before Photos · ${photos.length}`} color={G.red} />
              {photos.map(img => (
                <View key={img.id} style={[s.card, { borderLeftColor: G.red }]}>
                  <View style={s.cardTop}>
                    <View style={s.statusBadge}>
                      <View style={[s.statusDot, { backgroundColor: G.red }]} />
                      <Text style={[s.statusText, { color: G.red }]}>PENDING</Text>
                    </View>
                    <View style={s.lockedBadge}>
                      <Text style={s.lockedText}>🔒 Locked</Text>
                    </View>
                  </View>
                  <Text style={s.spanTitle}>📷  {img.meta?.pole_code ?? `Pole #${img.meta?.pole_id ?? "—"}`}</Text>
                  <Text style={s.cardDate}>🕐  {fmtDate(img.queuedAt)}</Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* ── Success modal ── */}
      <Modal visible={showSuccess} transparent animationType="fade">
        <View style={um.backdrop}>
          <View style={um.card}>
            <View style={[um.iconRing, { backgroundColor: G.greenBg }]}>
              <Text style={{ fontSize: 36 }}>✓</Text>
            </View>
            <Text style={um.title}>Synced!</Text>
            <Text style={um.sub}>All pending items uploaded successfully.</Text>
            <View style={um.counterRow}>
              <Text style={um.counterUploaded}>{successCount}</Text>
              <Text style={um.counterLabel}> item{successCount !== 1 ? "s" : ""} uploaded</Text>
            </View>
            <TouchableOpacity
              style={[um.doneBtn, { backgroundColor: accent }]}
              onPress={() => setShowSuccess(false)}
              activeOpacity={0.85}
            >
              <Text style={um.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Upload progress modal ── */}
      <Modal visible={submitting} transparent animationType="fade">
        <View style={um.backdrop}>
          <View style={um.card}>
            <View style={um.iconRing}>
              <ActivityIndicator size="large" color={G.green} />
            </View>
            <Text style={um.title}>Uploading…</Text>
            <Text style={um.sub}>Please keep the app open until sync completes.</Text>
            <View style={um.trackBg}>
              <View style={[um.trackFill, {
                width: snapRef.current > 0 ? `${Math.round((uploaded / snapRef.current) * 100)}%` as any : "0%",
              }]} />
            </View>
            <View style={um.counterRow}>
              <Text style={um.counterUploaded}>{uploaded}</Text>
              <Text style={um.counterSlash}> / </Text>
              <Text style={um.counterTotal}>{snapRef.current}</Text>
              <Text style={um.counterLabel}> items uploaded</Text>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────
function SectionLabel({ label, color = G.green }: { label: string; color?: string }) {
  return (
    <View style={sl.row}>
      <View style={[sl.bar, { backgroundColor: color }]} />
      <Text style={[sl.label, { color }]}>{label}</Text>
    </View>
  );
}
const sl = StyleSheet.create({
  row:   { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20, marginBottom: 12 },
  bar:   { width: 4, height: 20, borderRadius: 2 },
  label: { fontSize: 15, fontWeight: "900" },
});

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: G.bg },
  content: { padding: 16, paddingBottom: 120 },
  center:  { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 40 },

  // Header — white concept (matches queue.tsx bg)
  header:      { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, gap: 16, backgroundColor: G.bg },
  headerRow:   { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headerCenter:{ flex: 1, minWidth: 0 },
  headerEye:   { fontSize: 11, fontWeight: "900", letterSpacing: 1.8, marginBottom: 4 },
  headerTitle: { fontSize: 28, fontWeight: "900", color: G.ink, letterSpacing: -0.6 },
  headerSub:   { fontSize: 13, fontWeight: "500", color: G.muted, marginTop: 3 },
  backBtn:     { width: 40, height: 40, borderRadius: 20, backgroundColor: G.card, alignItems: "center", justifyContent: "center", marginTop: 2, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  backIcon:    { fontSize: 20, fontWeight: "900" },
  onlineBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, marginTop: 2 },
  onlineDot:   { width: 6, height: 6, borderRadius: 3 },
  onlineText:  { fontSize: 12, fontWeight: "800" },

  // Stat cards — white on light bg
  statsRow:    { flexDirection: "row", gap: 12 },
  statCard:    { flex: 1, backgroundColor: G.card, borderRadius: 18, padding: 14, gap: 3, position: "relative", shadowColor: "#0F172A", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  statDecor:   { position: "absolute", width: 60, height: 60, borderRadius: 30, right: -10, bottom: -10, backgroundColor: G.greenBg },
  statIconBox: { width: 34, height: 34, borderRadius: 10, backgroundColor: G.greenBg, alignItems: "center", justifyContent: "center", marginBottom: 3 },
  statIcon:    { fontSize: 16 },
  statLabel:   { fontSize: 11, fontWeight: "700", color: G.muted },
  statNum:     { fontSize: 26, fontWeight: "900", letterSpacing: -0.5 },
  statSub:     { fontSize: 10, fontWeight: "600", color: G.soft },

  // Sync All Now — green solid button (same as queue.tsx)
  syncBtn:     { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 14 },
  syncIconBox: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  syncIconText:{ fontSize: 22, fontWeight: "900", color: "#fff" },
  syncTitle:   { fontSize: 15, fontWeight: "900", color: "#fff" },
  syncSub:     { fontSize: 11, fontWeight: "600", color: "rgba(255,255,255,0.75)", marginTop: 1 },
  syncArrow:   { fontSize: 20, fontWeight: "900", color: "rgba(255,255,255,0.8)" },

  // Empty
  emptyMark:  { fontSize: 48, color: G.green },
  emptyTitle: { fontSize: 20, fontWeight: "900", color: G.ink },
  emptySub:   { fontSize: 13, fontWeight: "600", color: G.muted, textAlign: "center" },

  // Cards
  card: {
    backgroundColor: G.card, borderRadius: 18, marginBottom: 12,
    borderLeftWidth: 4, paddingHorizontal: 16, paddingVertical: 14, gap: 7,
    shadowColor: "#0F172A", shadowOpacity: 0.07, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  cardTop:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusBadge:{ flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot:  { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  cardArrow:  { fontSize: 18, color: G.soft },
  spanTitle:  { fontSize: 18, fontWeight: "900", color: G.ink, fontFamily: "monospace" },
  cardSub:    { fontSize: 12, fontWeight: "600", color: G.muted },
  cardDate:   { fontSize: 11, fontWeight: "600", color: G.soft },
  chipRow:    { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: "#BBF7D0", backgroundColor: "#F0FDF4" },
  chipText:   { fontSize: 10, fontWeight: "900", color: "#047857" },
  reasonRow:  { backgroundColor: "#FFFBEB", borderRadius: 10, padding: 10 },
  reasonText: { fontSize: 11, fontWeight: "700", color: "#92400E" },
  lockedBadge:{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#FEE2E2", borderWidth: 1, borderColor: "#FECACA" },
  lockedText: { fontSize: 10, fontWeight: "900", color: "#DC2626" },
});

// ── Upload progress modal ─────────────────────────────────────────────────────
const um = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: "rgba(15,23,42,0.65)", alignItems: "center", justifyContent: "center", padding: 32 },
  card:        { width: "100%", backgroundColor: G.card, borderRadius: 28, paddingHorizontal: 28, paddingVertical: 32, alignItems: "center", gap: 14, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  iconRing:    { width: 72, height: 72, borderRadius: 36, backgroundColor: G.greenBg, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title:       { fontSize: 22, fontWeight: "900", color: G.ink, letterSpacing: -0.4 },
  sub:         { fontSize: 13, fontWeight: "500", color: G.muted, textAlign: "center", lineHeight: 19 },
  trackBg:     { width: "100%", height: 8, backgroundColor: "#E8EDF2", borderRadius: 999, overflow: "hidden", marginTop: 4 },
  trackFill:   { height: "100%", backgroundColor: G.green, borderRadius: 999 },
  counterRow:  { flexDirection: "row", alignItems: "baseline", marginTop: 2 },
  counterUploaded: { fontSize: 28, fontWeight: "900", color: G.green, letterSpacing: -0.5 },
  counterSlash:    { fontSize: 20, fontWeight: "700", color: G.soft },
  counterTotal:    { fontSize: 20, fontWeight: "900", color: G.ink },
  counterLabel:    { fontSize: 13, fontWeight: "600", color: G.muted, marginLeft: 4 },
  doneBtn:         { width: "100%", paddingVertical: 16, borderRadius: 16, alignItems: "center", marginTop: 6 },
  doneBtnText:     { fontSize: 15, fontWeight: "900", color: "#fff" },
});

// ── Detail sheet ──────────────────────────────────────────────────────────────
