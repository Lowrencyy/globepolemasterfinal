import { useRouter } from "expo-router";
import { useAuth } from "@/context/auth-context";
import { gpsQueueReadAll } from "@/lib/gps-queue";
import { flushAllQueues, isOnline } from "@/lib/net-sync";
import { simpleQueueReadAll } from "@/lib/simple-queue";
import {
  imageQueueReadAll,
  queueReadAll,
} from "@/lib/sync-queue";
import { getQueue } from "@/services/offline";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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

// ── Palette ───────────────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins} min${mins !== 1 ? "s" : ""} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} hr${hrs !== 1 ? "s" : ""} ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Grouping helpers ──────────────────────────────────────────────────────────
type TeardownGroup = { nodeId: string; nodeName: string; spans: any[]; photos: any[]; lastAt: string };
type CapturedGroup = { nodeId: string; nodeName: string; beforePhotos: any[]; gpsPoles: any[]; lastAt: string };

function groupTeardowns(tdItems: any[], tdImages: any[]): Record<string, TeardownGroup> {
  const map: Record<string, TeardownGroup> = {};
  tdItems.forEach(item => {
    const nodeId   = String(item.fields?.node_id ?? item.nodeId ?? "unknown");
    const nodeName = item.fields?.node_name ?? `Node #${nodeId}`;
    if (!map[nodeId]) map[nodeId] = { nodeId, nodeName, spans: [], photos: [], lastAt: item.queuedAt };
    map[nodeId].spans.push(item);
    if (item.queuedAt > map[nodeId].lastAt) map[nodeId].lastAt = item.queuedAt;
  });
  tdImages.forEach(img => {
    const nodeId = String(img.meta?.node_id ?? "unknown");
    if (!map[nodeId]) map[nodeId] = { nodeId, nodeName: `Node #${nodeId}`, spans: [], photos: [], lastAt: img.queuedAt };
    map[nodeId].photos.push(img);
    if (img.queuedAt > map[nodeId].lastAt) map[nodeId].lastAt = img.queuedAt;
  });
  return map;
}

function groupCaptured(batchImages: any[], gpsItems: any[]): Record<string, CapturedGroup> {
  const map: Record<string, CapturedGroup> = {};
  batchImages.forEach(img => {
    const nodeId   = String(img.meta?.node_id ?? "unknown");
    const nodeName = img.meta?.node_name ?? `Node #${nodeId}`;
    if (!map[nodeId]) map[nodeId] = { nodeId, nodeName, beforePhotos: [], gpsPoles: [], lastAt: img.queuedAt };
    map[nodeId].beforePhotos.push(img);
    if (img.queuedAt > map[nodeId].lastAt) map[nodeId].lastAt = img.queuedAt;
  });
  if (gpsItems.length) {
    if (!map["gps"]) map["gps"] = { nodeId: "gps", nodeName: "GPS Coordinates", beforePhotos: [], gpsPoles: [], lastAt: gpsItems[0].queuedAt };
    map["gps"].gpsPoles.push(...gpsItems);
  }
  return map;
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function QueueScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [gpsItems,      setGpsItems]      = useState<any[]>([]);
  const [teardownItems, setTeardownItems] = useState<any[]>([]);
  const [simpleItems,   setSimpleItems]   = useState<any[]>([]);
  const [napItems,      setNapItems]      = useState<any[]>([]);
  const [imageItems,    setImageItems]    = useState<any[]>([]);
  const [online,        setOnline]        = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [syncedToday,   setSyncedToday]   = useState(0);
  const [preview,       setPreview]       = useState<any | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotRef = useRef(0);

  const load = useCallback(async () => {
    const [gps, td, simple, nap, imgs, net] = await Promise.all([
      gpsQueueReadAll().catch(() => []),
      queueReadAll().catch(() => []),
      simpleQueueReadAll().catch(() => []),
      getQueue().catch(() => []),
      imageQueueReadAll().catch(() => []),
      isOnline().catch(() => false),
    ]);
    setGpsItems(gps);
    setTeardownItems(td);
    setSimpleItems(simple);
    setNapItems(nap);
    setImageItems(imgs);
    setOnline(net as boolean);
  }, []);

  // Load synced-today count from storage (resets at midnight PHT)
  useEffect(() => {
    load();
    const PHT_OFFSET = 8 * 3600_000;
    const todayKey = `synced_today_${new Date(Date.now() + PHT_OFFSET).toISOString().slice(0, 10)}`;
    AsyncStorage.getItem(todayKey).then(v => { if (v) setSyncedToday(Number(v)); }).catch(() => {});
  }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Increment synced-today in storage
  const addSyncedToday = async (count: number) => {
    const PHT_OFFSET = 8 * 3600_000;
    const todayKey = `synced_today_${new Date(Date.now() + PHT_OFFSET).toISOString().slice(0, 10)}`;
    const prev = Number(await AsyncStorage.getItem(todayKey).catch(() => "0") ?? "0");
    const next = prev + count;
    await AsyncStorage.setItem(todayKey, String(next)).catch(() => {});
    setSyncedToday(next);
  };

  const pendingImages    = imageItems.filter(i => i.status !== "synced");
  const batchBeforeImgs  = pendingImages.filter(i => i.reportLocalId?.startsWith("batch_before_") || i.meta?.lock === "1");
  const teardownImgs     = pendingImages.filter(i => !i.reportLocalId?.startsWith("batch_before_") && i.meta?.lock !== "1");
  const pendingTeardowns = teardownItems.filter(i => i.status !== "synced");

  const teardownGroups = groupTeardowns(pendingTeardowns, teardownImgs);
  const capturedGroups = groupCaptured(batchBeforeImgs, gpsItems);

  const hasTeardown = Object.keys(teardownGroups).length > 0 || simpleItems.length > 0 || napItems.length > 0;
  const hasCaptured = Object.keys(capturedGroups).length > 0;

  const totalPending =
    gpsItems.length +
    pendingTeardowns.filter(i => i.status !== "permanently_failed").length +
    simpleItems.length + napItems.length + pendingImages.length;

  const syncAll = async () => {
    if (!online) { Alert.alert("Offline", "Connect to the internet first."); return; }
    if (totalPending === 0) { Alert.alert("All Synced", "Nothing pending."); return; }

    snapshotRef.current = totalPending;
    setUploadedCount(0);
    setSubmitting(true);

    // Poll every 600ms — update counter in real-time as items move to "synced"
    pollRef.current = setInterval(async () => {
      const [td, imgs] = await Promise.all([queueReadAll(), imageQueueReadAll()]);
      const remaining = td.filter(i => i.status !== "synced").length + imgs.filter(i => i.status !== "synced").length;
      setUploadedCount(Math.max(0, snapshotRef.current - remaining));
    }, 600);

    try {
      await Promise.allSettled([
        flushAllQueues(),
        token ? import("@/services/offline").then(m => m.syncQueue(token)) : Promise.resolve(),
      ]);

      clearInterval(pollRef.current!);
      pollRef.current = null;

      // Final count
      const [newTD, newImgs] = await Promise.all([queueReadAll(), imageQueueReadAll()]);
      const remaining = newTD.filter(i => i.status !== "synced").length + newImgs.filter(i => i.status !== "synced").length;
      const synced = Math.max(0, snapshotRef.current - remaining);
      setUploadedCount(synced);

      await load();
      await addSyncedToday(synced);

      if (remaining > 0) {
        Alert.alert("Partially Synced", `${synced} uploaded · ${remaining} still pending.`);
      } else {
        Alert.alert("Synced!", `${synced} item${synced !== 1 ? "s" : ""} uploaded successfully.`);
      }
    } catch (e: any) {
      clearInterval(pollRef.current!);
      pollRef.current = null;
      Alert.alert("Sync Failed", e?.message ?? "Unknown error.");
    }
    setSubmitting(false);
  };


  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[G.green]} tintColor={G.green} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.eyebrow}>OFFLINE CENTER</Text>
            <Text style={s.title}>Pending Queue</Text>
            <Text style={s.subtitle}>Items waiting to be synchronized</Text>
          </View>
          <View style={[s.onlineBadge, { backgroundColor: online ? G.greenBg : "#FFF7ED" }]}>
            <View style={[s.onlineDot, { backgroundColor: online ? G.green : "#F97316" }]} />
            <Text style={[s.onlineText, { color: online ? G.green : "#EA580C" }]}>
              {online ? "Online" : "Offline"}
            </Text>
          </View>
        </View>

        {/* ── Stats cards ── */}
        <View style={s.statsRow}>
          <View style={[s.statCard, { flex: 1 }]}>
            <View style={s.statIconBox}>
              <Text style={s.statIcon}>🕐</Text>
            </View>
            <Text style={s.statCardLabel}>Pending Items</Text>
            <Text style={[s.statCardNum, { color: G.green }]}>{totalPending}</Text>
            <Text style={s.statCardSub}>Awaiting sync</Text>
          </View>
          <View style={[s.statCard, { flex: 1, overflow: "hidden" }]}>
            <View style={[s.statDecorCorner, { backgroundColor: G.greenBg }]} />
            <View style={s.statIconBox}>
              <Text style={s.statIcon}>✅</Text>
            </View>
            <Text style={s.statCardLabel}>Synced Today</Text>
            <Text style={[s.statCardNum, { color: G.green }]}>{syncedToday}</Text>
            <Text style={s.statCardSub}>All items up to date</Text>
          </View>
        </View>

        {/* ── Sync All Now button ── */}
        <TouchableOpacity
          style={[s.syncBtn, !online && { opacity: 0.55 }]}
          onPress={syncAll}
          activeOpacity={0.85}
          disabled={submitting}
        >
          <View style={s.syncIconBox}>
            {submitting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.syncIcon}>↻</Text>
            }
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.syncBtnTitle}>Sync All Now</Text>
            <Text style={s.syncBtnSub}>
              {totalPending === 0 ? "Nothing pending" : `Upload all ${totalPending} pending item${totalPending !== 1 ? "s" : ""}`}
            </Text>
          </View>
          <Text style={s.syncArrow}>›</Text>
        </TouchableOpacity>

        {/* ── All synced ── */}
        {!hasTeardown && !hasCaptured && (
          <View style={s.allClear}>
            <Text style={s.allClearMark}>✓</Text>
            <Text style={s.allClearTitle}>All Synced</Text>
            <Text style={s.allClearSub}>No pending uploads.</Text>
          </View>
        )}

        {/* ═══════════════════════════════
            TEARDOWN PENDING
        ════════════════════════════════ */}
        {hasTeardown && (
          <>
            <SectionLabel label="Teardown Pending" />

            {Object.values(teardownGroups).map(group => (
              <NodeCard
                key={group.nodeId}
                nodeName={group.nodeName}
                spanCount={group.spans.length}
                photoCount={group.photos.length}
                lastAt={group.lastAt}
                accent={G.green}
                onPress={() => router.push({ pathname: "/queue-node", params: { nodeId: group.nodeId, nodeName: group.nodeName, type: "teardown" } } as any)}
              />
            ))}

            {(simpleItems.length > 0 || napItems.length > 0) && (
              <NodeCard
                nodeName="Field Updates"
                spanCount={simpleItems.length + napItems.length}
                photoCount={0}
                lastAt={simpleItems[0]?.queuedAt ?? napItems[0]?.createdAt ?? new Date().toISOString()}
                accent={G.muted}
              />
            )}
          </>
        )}

        {/* ═══════════════════════════════
            CAPTURED PENDING
        ════════════════════════════════ */}
        {hasCaptured && (
          <>
            <SectionLabel icon="📷" label="Captured Pending" color={G.red} />

            {Object.values(capturedGroups).map(group => (
              <NodeCard
                key={group.nodeId}
                nodeName={group.nodeName}
                spanCount={group.beforePhotos.length}
                photoCount={group.gpsPoles.length}
                lastAt={group.lastAt}
                accent={G.red}
                spanLabel="poles"
                photoLabel="gps"
                onPress={group.nodeId !== "gps" ? () => router.push({ pathname: "/queue-node", params: { nodeId: group.nodeId, nodeName: group.nodeName, type: "captured" } } as any) : undefined}
              />
            ))}
          </>
        )}


      </ScrollView>

      {/* ── FAB ── */}
      <TouchableOpacity style={s.fab} onPress={syncAll} activeOpacity={0.85} disabled={submitting}>
        {submitting
          ? <ActivityIndicator size="small" color="#fff" />
          : <Text style={s.fabIcon}>↻</Text>
        }
      </TouchableOpacity>

      {/* ── Upload progress modal ── */}
      <Modal visible={submitting} transparent animationType="fade">
        <View style={um.backdrop}>
          <View style={um.card}>
            {/* Icon ring */}
            <View style={um.iconRing}>
              <ActivityIndicator size="large" color={G.green} />
            </View>

            <Text style={um.title}>Uploading…</Text>
            <Text style={um.sub}>Please keep the app open until sync completes.</Text>

            {/* Progress bar */}
            <View style={um.trackBg}>
              <View style={[um.trackFill, {
                width: totalPending > 0
                  ? `${Math.round((uploadedCount / totalPending) * 100)}%` as any
                  : "0%",
              }]} />
            </View>

            {/* Counter */}
            <View style={um.counterRow}>
              <Text style={um.counterUploaded}>{uploadedCount}</Text>
              <Text style={um.counterSlash}> / </Text>
              <Text style={um.counterTotal}>{totalPending}</Text>
              <Text style={um.counterLabel}> items uploaded</Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Teardown detail sheet ── */}
      <Modal visible={!!preview} transparent animationType="slide" onRequestClose={() => setPreview(null)}>
        <View style={sh.backdrop}>
          <View style={sh.sheet}>
            <View style={sh.handle} />

            {/* Header */}
            <View style={sh.headerBand}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={sh.headerEye}>PENDING TEARDOWN</Text>
                <Text style={sh.headerSpan} numberOfLines={1}>
                  {preview?.fields?.from_pole_code ?? "—"}
                  {"   →   "}
                  {preview?.fields?.to_pole_code ?? "—"}
                </Text>
                <Text style={sh.headerNode}>{preview?.fields?.node_name ?? `Node #${preview?.fields?.node_id ?? "—"}`}</Text>
              </View>
              <Pressable onPress={() => setPreview(null)} style={sh.closeBtn}>
                <Text style={sh.closeBtnText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={sh.body} showsVerticalScrollIndicator={false}>
              {/* Stats grid */}
              <View style={sh.grid}>
                {[
                  { label: "Cable Collected", value: `${preview?.fields?.collected_cable ?? "—"}m`, icon: "🔌" },
                  { label: "Expected",        value: `${preview?.fields?.expected_cable ?? "—"}m`,  icon: "📏" },
                  { label: "Full Collection", value: preview?.fields?.did_collect_all_cable === "1" ? "Yes ✓" : "No ✗", icon: "✅" },
                  { label: "Span ID",         value: preview?.fields?.pole_span_id ?? "—",           icon: "🔗" },
                ].map(({ label, value, icon }) => (
                  <View key={label} style={sh.cell}>
                    <Text style={sh.cellIcon}>{icon}</Text>
                    <Text style={sh.cellLabel}>{label}</Text>
                    <Text style={sh.cellValue}>{value}</Text>
                  </View>
                ))}
              </View>

              {/* Components */}
              {(() => {
                const f = preview?.fields ?? {};
                const comps = [
                  { k: "Node Box",   v: f.collected_node ?? 0 },
                  { k: "Amplifier",  v: f.collected_amplifier ?? 0 },
                  { k: "Extender",   v: f.collected_extender ?? 0 },
                  { k: "TSC",        v: f.collected_tsc ?? 0 },
                  { k: "Power Sup.", v: f.collected_powersupply ?? 0 },
                ].filter(c => Number(c.v) > 0);
                if (!comps.length) return null;
                return (
                  <View style={sh.section}>
                    <Text style={sh.sectionTitle}>Components Collected</Text>
                    <View style={sh.compRow}>
                      {comps.map(({ k, v }) => (
                        <View key={k} style={sh.compChip}>
                          <Text style={sh.compNum}>{v}</Text>
                          <Text style={sh.compLabel}>{k}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })()}

              {/* Photos */}
              {Object.keys(preview?.photoPaths ?? {}).length > 0 && (
                <View style={sh.section}>
                  <Text style={sh.sectionTitle}>Attached Photos</Text>
                  <View style={sh.chips}>
                    {Object.keys(preview.photoPaths).map(k => (
                      <View key={k} style={sh.chip}>
                        <Text style={sh.chipText}>📷  {k.replace(/_/g, " ")}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Partial reason */}
              {preview?.fields?.did_collect_all_cable === "0" && preview?.fields?.unrecovered_reason && (
                <View style={sh.reasonBox}>
                  <Text style={sh.reasonLabel}>⚠️  Reason for Partial Collection</Text>
                  <Text style={sh.reasonText}>{preview.fields.unrecovered_reason}</Text>
                </View>
              )}
            </ScrollView>

            <View style={sh.footer}>
              <TouchableOpacity style={sh.cancelBtn} onPress={() => setPreview(null)}>
                <Text style={sh.cancelText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={sh.syncBtn}
                onPress={async () => { setPreview(null); await syncAll(); }}
              >
                <Text style={sh.syncBtnText}>↻  Sync Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ icon, label, color = G.green }: { icon?: string; label: string; color?: string }) {
  return (
    <View style={sl.row}>
      <View style={[sl.bar, { backgroundColor: color }]} />
      {icon ? <Text style={sl.icon}>{icon}</Text> : null}
      <Text style={sl.label}>{label}</Text>
    </View>
  );
}
const sl = StyleSheet.create({
  row:   { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20, marginBottom: 12 },
  bar:   { width: 4, height: 22, borderRadius: 2 },
  icon:  { fontSize: 16 },
  label: { fontSize: 16, fontWeight: "900", color: G.ink },
});

function NodeCard({
  nodeName, spanCount, photoCount, lastAt, accent,
  spanLabel = "spans", photoLabel = "photos",
  onPress,
}: {
  nodeName: string; spanCount: number; photoCount: number; lastAt: string;
  accent: string;
  spanLabel?: string; photoLabel?: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={nc.card}
      activeOpacity={onPress ? 0.78 : 1}
      onPress={onPress}
      disabled={!onPress}
    >
      {/* Left accent bar */}
      <View style={[nc.accentBar, { backgroundColor: accent }]} />

      <View style={nc.inner}>
        {/* Top row */}
        <View style={nc.topRow}>
          <View style={nc.statusBadge}>
            <View style={[nc.statusDot, { backgroundColor: accent }]} />
            <Text style={[nc.statusText, { color: accent }]}>PENDING</Text>
          </View>
          <Image
            source={require("../../assets/images/telco-mainlogo.png")}
            style={nc.logoImg}
            resizeMode="contain"
          />
        </View>

        {/* Node name */}
        <Text style={nc.nodeName} numberOfLines={1}>{nodeName}</Text>

        {/* Meta row */}
        <View style={nc.metaRow}>
          <Text style={nc.metaItem}>
            📋  <Text style={nc.metaNum}>{spanCount}</Text>  {spanLabel.toUpperCase()}
            {photoCount > 0 ? `    📷  ${photoCount}  ${photoLabel.toUpperCase()}` : ""}
          </Text>
        </View>
        <Text style={nc.metaTime}>🕐  Last update {timeAgo(lastAt)}</Text>

        {/* Bottom row */}
        {onPress && (
          <View style={nc.bottomRow}>
            <TouchableOpacity
              style={[nc.viewBtn, { borderColor: accent }]}
              onPress={onPress}
              activeOpacity={0.75}
            >
              <Text style={[nc.viewBtnText, { color: accent }]}>View Details  ›</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}
const nc = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: G.card,
    borderRadius: 18,
    marginBottom: 12,
    shadowColor: "#0F172A",
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    overflow: "hidden",
  },
  accentBar: { width: 4, borderRadius: 0 },
  inner:     { flex: 1, paddingHorizontal: 16, paddingVertical: 16, gap: 6 },
  topRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot:   { width: 7, height: 7, borderRadius: 4 },
  statusText:  { fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  iconBox:     { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  iconText:    { fontSize: 20 },
  logoImg:     { width: 67, height: 67 },
  nodeName:    { fontSize: 22, fontWeight: "900", color: G.ink, letterSpacing: -0.3, marginTop: 2 },
  metaRow:     { flexDirection: "row", alignItems: "center", gap: 16 },
  metaItem:    { fontSize: 12, fontWeight: "700", color: G.muted, letterSpacing: 0.3 },
  metaNum:     { fontWeight: "900", color: G.ink },
  metaTime:    { fontSize: 12, fontWeight: "600", color: G.soft },
  bottomRow:   { flexDirection: "row", justifyContent: "flex-end", marginTop: 4 },
  viewBtn:     { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999, borderWidth: 1.5 },
  viewBtnText: { fontSize: 13, fontWeight: "900" },
});

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: G.bg },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 120 },

  /* Header */
  headerRow:    { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 },
  eyebrow:      { fontSize: 11, fontWeight: "900", color: G.green, letterSpacing: 1.8, marginBottom: 4 },
  title:        { fontSize: 30, fontWeight: "900", color: G.ink, letterSpacing: -0.8 },
  subtitle:     { fontSize: 13, fontWeight: "500", color: G.muted, marginTop: 3 },
  onlineBadge:  { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, marginTop: 4 },
  onlineDot:    { width: 7, height: 7, borderRadius: 4 },
  onlineText:   { fontSize: 13, fontWeight: "800" },

  /* Stats */
  statsRow:    { flexDirection: "row", gap: 12, marginBottom: 16 },
  statCard:    { backgroundColor: G.card, borderRadius: 18, padding: 16, gap: 4, shadowColor: "#0F172A", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  statDecorCorner: { position: "absolute", width: 60, height: 60, borderRadius: 30, right: -10, bottom: -10 },
  statIconBox: { width: 38, height: 38, borderRadius: 11, backgroundColor: G.greenBg, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  statIcon:    { fontSize: 18 },
  statCardLabel: { fontSize: 12, fontWeight: "700", color: G.muted },
  statCardNum:   { fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
  statCardSub:   { fontSize: 11, fontWeight: "600", color: G.soft },

  /* Sync All button */
  syncBtn: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: G.green, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 16, marginBottom: 8 },
  syncIconBox: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  syncIcon:    { fontSize: 22, color: "#fff", fontWeight: "900" },
  syncBtnTitle: { fontSize: 16, fontWeight: "900", color: "#fff" },
  syncBtnSub:   { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.75)", marginTop: 1 },
  syncArrow:    { fontSize: 22, color: "rgba(255,255,255,0.8)", fontWeight: "900" },

  /* All clear */
  allClear:      { alignItems: "center", paddingVertical: 40, gap: 6 },
  allClearMark:  { fontSize: 52, color: G.green },
  allClearTitle: { fontSize: 22, fontWeight: "900", color: G.ink },
  allClearSub:   { fontSize: 14, fontWeight: "600", color: G.muted },


  /* FAB */
  fab: { position: "absolute", bottom: 28, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: G.green, alignItems: "center", justifyContent: "center", shadowColor: G.green, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  fabIcon: { fontSize: 26, color: "#fff", fontWeight: "900" },
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
});

// ── Teardown detail sheet ─────────────────────────────────────────────────────
const sh = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  sheet:    { maxHeight: "88%", paddingBottom: 28, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: G.card, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 10 },
  handle:   { width: 44, height: 4, marginTop: 12, marginBottom: 0, borderRadius: 999, backgroundColor: G.border, alignSelf: "center" },

  // Green header band
  headerBand:  { backgroundColor: G.green, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 22, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headerEye:   { fontSize: 10, fontWeight: "900", letterSpacing: 1.8, color: "rgba(255,255,255,0.6)", marginBottom: 5 },
  headerSpan:  { fontSize: 22, fontWeight: "900", color: "#fff", letterSpacing: -0.3, fontFamily: "monospace" },
  headerNode:  { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.7)", marginTop: 4 },
  closeBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", marginTop: 2 },
  closeBtnText:{ fontSize: 18, color: "#fff", fontWeight: "700" },

  body:        { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8, gap: 18 },

  // Stats grid
  grid:        { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cell:        { width: "47%", padding: 14, borderRadius: 16, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: G.border, gap: 3 },
  cellIcon:    { fontSize: 16 },
  cellLabel:   { fontSize: 10, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", color: G.soft },
  cellValue:   { fontSize: 17, fontWeight: "900", color: G.ink },

  // Section
  section:      { gap: 10 },
  sectionTitle: { fontSize: 13, fontWeight: "900", color: G.ink },

  // Components row
  compRow:  { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  compChip: { alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: G.greenBg, borderWidth: 1, borderColor: "#A7F3D0", minWidth: 64 },
  compNum:  { fontSize: 18, fontWeight: "900", color: G.green },
  compLabel:{ fontSize: 10, fontWeight: "700", color: G.greenMid, marginTop: 1 },

  // Photos
  chips:    { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0" },
  chipText: { fontSize: 11, fontWeight: "800", color: "#047857" },

  // Reason box
  reasonBox:  { backgroundColor: "#FFFBEB", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#FDE68A", gap: 4 },
  reasonLabel:{ fontSize: 11, fontWeight: "900", color: "#B45309" },
  reasonText: { fontSize: 13, fontWeight: "600", color: "#374151", lineHeight: 19 },

  // Footer
  footer:     { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 14, borderTopWidth: 1, borderTopColor: "#F1F5F9" },
  cancelBtn:  { flex: 1, minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 16, borderWidth: 1.5, borderColor: G.border },
  cancelText: { fontSize: 14, fontWeight: "800", color: G.muted },
  syncBtn:    { flex: 2, minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: G.green },
  syncBtnText:{ fontSize: 14, fontWeight: "900", color: "#fff" },
});
