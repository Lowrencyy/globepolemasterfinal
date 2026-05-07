import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { gpsQueueReadAll, gpsQueueFlush, gpsQueueRemove } from "@/lib/gps-queue";
import { simpleQueueReadAll, simpleQueueRemove, processSimpleQueue } from "@/lib/simple-queue";
import { queueReadAll, queueRemove, processSyncQueue } from "@/lib/sync-queue";
import { getQueue } from "@/services/offline";
import { isOnline } from "@/lib/net-sync";
import { useAuth } from "@/context/auth-context";

const PRIMARY = "#0A5C3B";
const OFFLINE_BG = "#FFF7ED";
const OFFLINE_DOT = "#F97316";
const PENDING_BG = "#EFF6FF";

type SectionKey = "gps" | "teardown" | "simple" | "nap";

function fmtDate(iso: string | number) {
  const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
  return d.toLocaleString("en-PH", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function SectionHeader({
  label, count, color, onRetry, onClear, retrying,
}: {
  label: string; count: number; color: string;
  onRetry: () => void; onClear: () => void; retrying: boolean;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionLeft}>
        <View style={[styles.sectionDot, { backgroundColor: color }]} />
        <Text style={styles.sectionTitle}>{label}</Text>
        <View style={[styles.countBadge, { backgroundColor: count > 0 ? color + "20" : "#F1F5F9" }]}>
          <Text style={[styles.countText, { color: count > 0 ? color : "#94A3B8" }]}>{count}</Text>
        </View>
      </View>
      {count > 0 && (
        <View style={styles.sectionActions}>
          <TouchableOpacity style={styles.retryBtn} onPress={onRetry} disabled={retrying}>
            {retrying
              ? <ActivityIndicator size="small" color={color} />
              : <Text style={[styles.retryText, { color }]}>Retry all</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.clearBtn} onPress={onClear}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function EmptySection() {
  return (
    <View style={styles.emptyRow}>
      <Text style={styles.emptyText}>No pending items</Text>
    </View>
  );
}

export default function QueueScreen() {
  const { token } = useAuth();

  const [gpsItems,      setGpsItems]      = useState<any[]>([]);
  const [teardownItems, setTeardownItems] = useState<any[]>([]);
  const [simpleItems,   setSimpleItems]   = useState<any[]>([]);
  const [napItems,      setNapItems]      = useState<any[]>([]);
  const [online,        setOnline]        = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [retrying,      setRetrying]      = useState<SectionKey | null>(null);
  const [previewItem,   setPreviewItem]   = useState<any | null>(null);

  const load = useCallback(async () => {
    const [gps, td, simple, nap, net] = await Promise.all([
      gpsQueueReadAll().catch(() => []),
      queueReadAll().catch(() => []),
      simpleQueueReadAll().catch(() => []),
      getQueue().catch(() => []),
      isOnline().catch(() => false),
    ]);
    setGpsItems(gps);
    setTeardownItems(td);
    setSimpleItems(simple);
    setNapItems(nap);
    setOnline(net);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const totalPending = gpsItems.length + teardownItems.length + simpleItems.length + napItems.length;

  // ── Retry handlers ────────────────────────────────────────────────────────

  const retryGps = async () => {
    setRetrying("gps");
    try {
      await gpsQueueFlush();
    } catch (e: any) {
      Alert.alert("Retry Failed", e?.message ?? "Could not reach backend.");
    }
    await load();
    setRetrying(null);
  };

  const retryTeardown = async () => {
    setRetrying("teardown");
    const result = await processSyncQueue().catch((e: any) => ({
      submitted: 0, failed: teardownItems.length,
      firstError: e?.message ?? "Unknown error",
    }));
    await load();
    setRetrying(null);
    if (result.failed > 0) {
      Alert.alert(
        "Upload Failed",
        result.firstError
          ? `${result.failed} item(s) still pending.\n\nReason: ${result.firstError}`
          : `${result.failed} item(s) could not be uploaded. Check your connection and try again.`,
      );
    } else if (result.submitted > 0) {
      Alert.alert("Uploaded", `${result.submitted} teardown report(s) submitted successfully.`);
    }
  };

  const retrySimple = async () => {
    setRetrying("simple");
    try {
      await processSimpleQueue();
    } catch (e: any) {
      Alert.alert("Retry Failed", e?.message ?? "Could not reach backend.");
    }
    await load();
    setRetrying(null);
  };

  const retryNap = async () => {
    if (!token) return;
    setRetrying("nap");
    try {
      const { syncQueue } = await import("@/services/offline");
      await syncQueue(token);
    } catch (e: any) {
      Alert.alert("Retry Failed", e?.message ?? "Could not reach backend.");
    }
    await load();
    setRetrying(null);
  };

  // ── Clear handlers ────────────────────────────────────────────────────────

  const confirmClear = (label: string, onConfirm: () => void) => {
    Alert.alert(`Clear ${label}?`, "These items will be permanently removed.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: onConfirm },
    ]);
  };

  const clearGps = () => confirmClear("GPS queue", async () => {
    for (const item of gpsItems) await gpsQueueRemove(item.pole_id).catch(() => {});
    await load();
  });

  const clearTeardown = () => confirmClear("teardown queue", async () => {
    for (const item of teardownItems) await queueRemove(item.id).catch(() => {});
    await load();
  });

  const clearSimple = () => confirmClear("simple queue", async () => {
    for (const item of simpleItems) await simpleQueueRemove(item.id).catch(() => {});
    await load();
  });

  const clearNap = () => confirmClear("NAP/Pole queue", async () => {
    const { removeFromQueue } = await import("@/services/offline");
    for (const item of napItems) await removeFromQueue(item.id).catch(() => {});
    await load();
  });

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Pending Queue</Text>
          <Text style={styles.headerSub}>
            {totalPending === 0 ? "All synced" : `${totalPending} item${totalPending !== 1 ? "s" : ""} waiting`}
          </Text>
        </View>
        <View style={[styles.netBadge, { backgroundColor: online ? "#DCFCE7" : OFFLINE_BG }]}>
          <View style={[styles.netDot, { backgroundColor: online ? "#16A34A" : OFFLINE_DOT }]} />
          <Text style={[styles.netText, { color: online ? "#15803D" : "#C2410C" }]}>
            {online ? "Online" : "Offline"}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
        showsVerticalScrollIndicator={false}
      >
        {totalPending === 0 && !refreshing && (
          <View style={styles.allClearBox}>
            <Text style={styles.allClearIcon}>✓</Text>
            <Text style={styles.allClearTitle}>All synced</Text>
            <Text style={styles.allClearSub}>No pending uploads. Pull down to refresh.</Text>
          </View>
        )}

        {/* ── GPS Queue ── */}
        <View style={styles.section}>
          <SectionHeader
            label="GPS Updates"
            count={gpsItems.length}
            color="#3B82F6"
            onRetry={retryGps}
            onClear={clearGps}
            retrying={retrying === "gps"}
          />
          {gpsItems.length === 0 ? <EmptySection /> : gpsItems.map((item, i) => (
            <View key={item.pole_id + i} style={[styles.row, i < gpsItems.length - 1 && styles.rowBorder]}>
              <View style={[styles.rowIcon, { backgroundColor: PENDING_BG }]}>
                <Text style={styles.rowIconText}>📍</Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>Pole #{item.pole_id}</Text>
                <Text style={styles.rowSub}>{item.lat?.toFixed(6)}, {item.lng?.toFixed(6)}</Text>
              </View>
              <Text style={styles.rowTime}>{fmtDate(item.queuedAt)}</Text>
            </View>
          ))}
        </View>

        {/* ── Teardown Queue ── */}
        <View style={styles.section}>
          <SectionHeader
            label="Teardown Submissions"
            count={teardownItems.length}
            color={PRIMARY}
            onRetry={retryTeardown}
            onClear={clearTeardown}
            retrying={retrying === "teardown"}
          />
          {teardownItems.length === 0 ? <EmptySection /> : teardownItems.map((item, i) => {
            const f = item.fields ?? {};
            const fromCode = f.from_pole_code ?? f.pole_code ?? "—";
            const toCode   = f.to_pole_code ?? "—";
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.row, i < teardownItems.length - 1 && styles.rowBorder]}
                activeOpacity={0.7}
                onPress={() => setPreviewItem(item)}
              >
                <View style={[styles.rowIcon, { backgroundColor: "#F0FDF4" }]}>
                  <Text style={styles.rowIconText}>📋</Text>
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>
                    <Text style={{ color: PRIMARY }}>{fromCode}</Text>
                    {"  →  "}
                    <Text style={{ color: "#6366F1" }}>{toCode}</Text>
                  </Text>
                  <Text style={styles.rowSub}>{fmtDate(item.queuedAt)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Simple Queue ── */}
        <View style={styles.section}>
          <SectionHeader
            label="Field Updates"
            count={simpleItems.length}
            color="#8B5CF6"
            onRetry={retrySimple}
            onClear={clearSimple}
            retrying={retrying === "simple"}
          />
          {simpleItems.length === 0 ? <EmptySection /> : simpleItems.map((item, i) => (
            <View key={item.id} style={[styles.row, i < simpleItems.length - 1 && styles.rowBorder]}>
              <View style={[styles.rowIcon, { backgroundColor: "#F5F3FF" }]}>
                <Text style={styles.rowIconText}>✏️</Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{item.method?.toUpperCase()} {item.url}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {JSON.stringify(item.body)}
                </Text>
              </View>
              <Text style={styles.rowTime}>{fmtDate(item.queuedAt)}</Text>
            </View>
          ))}
        </View>

        {/* ── NAP / Pole Queue ── */}
        <View style={[styles.section, { marginBottom: 32 }]}>
          <SectionHeader
            label="NAP / Pole Creation"
            count={napItems.length}
            color="#F97316"
            onRetry={retryNap}
            onClear={clearNap}
            retrying={retrying === "nap"}
          />
          {napItems.length === 0 ? <EmptySection /> : napItems.map((item, i) => (
            <View key={item.id} style={[styles.row, i < napItems.length - 1 && styles.rowBorder]}>
              <View style={[styles.rowIcon, { backgroundColor: OFFLINE_BG }]}>
                <Text style={styles.rowIconText}>{item.type === "CREATE_POLE" ? "🗼" : "📦"}</Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{item.type === "CREATE_POLE" ? "New Pole" : "New NAP Box"}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {item.payload?.pole_code ?? item.payload?.nap_code ?? JSON.stringify(item.payload).slice(0, 40)}
                </Text>
              </View>
              <View style={styles.rowRight}>
                <View style={[styles.statusPill, {
                  backgroundColor: item.status === "failed" ? "#FEF2F2" : PENDING_BG,
                }]}>
                  <Text style={[styles.statusText, {
                    color: item.status === "failed" ? "#DC2626" : "#3B82F6",
                  }]}>{item.status}</Text>
                </View>
                <Text style={styles.rowTime}>{fmtDate(item.createdAt)}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ── Teardown Preview Modal ── */}
      <Modal
        visible={!!previewItem}
        transparent
        animationType="slide"
        onRequestClose={() => setPreviewItem(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {/* Handle */}
            <View style={styles.modalHandle} />

            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalHeaderLabel}>PENDING TEARDOWN</Text>
                <View style={styles.spanRow}>
                  <Text style={styles.spanFrom}>{previewItem?.fields?.from_pole_code ?? previewItem?.fields?.pole_code ?? "—"}</Text>
                  <Text style={styles.spanArrow}>→</Text>
                  <Text style={styles.spanTo}>{previewItem?.fields?.to_pole_code ?? "—"}</Text>
                </View>
              </View>
              <Pressable onPress={() => setPreviewItem(null)} style={styles.modalClose}>
                <Text style={{ fontSize: 20, color: "#94A3B8" }}>×</Text>
              </Pressable>
            </View>

            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Cable info */}
              <View style={styles.previewGrid}>
                {[
                  { label: "Collected",  value: `${previewItem?.fields?.collected_cable ?? previewItem?.fields?.recovered_cable ?? "—"}m` },
                  { label: "Expected",   value: `${previewItem?.fields?.expected_cable ?? "—"}m` },
                  { label: "All Cable",  value: previewItem?.fields?.did_collect_all_cable === "1" ? "Yes" : "No" },
                  { label: "Span ID",    value: previewItem?.fields?.pole_span_id ?? "—" },
                ].map(({ label, value }) => (
                  <View key={label} style={styles.previewCell}>
                    <Text style={styles.previewCellLabel}>{label}</Text>
                    <Text style={styles.previewCellValue}>{value}</Text>
                  </View>
                ))}
              </View>

              {/* Components */}
              {(() => {
                const f = previewItem?.fields ?? {};
                const comps = [
                  { label: "Nodes",       value: f.collected_node        ?? f.nodes_collected        ?? 0 },
                  { label: "Amplifiers",  value: f.collected_amplifier   ?? f.amplifiers_collected   ?? 0 },
                  { label: "Extenders",   value: f.collected_extender    ?? f.extenders_collected    ?? 0 },
                  { label: "TSC",         value: f.collected_tsc         ?? f.tsc_collected          ?? 0 },
                  { label: "Power Sup.",  value: f.collected_powersupply ?? f.powersupply_collected  ?? 0 },
                  { label: "PS Housing",  value: f.collected_powersupply_housing ?? f.ps_housing_collected ?? 0 },
                ].filter(c => Number(c.value) > 0);
                if (!comps.length) return null;
                return (
                  <View style={styles.previewSection}>
                    <Text style={styles.previewSectionTitle}>COMPONENTS COLLECTED</Text>
                    <View style={styles.previewGrid}>
                      {comps.map(({ label, value }) => (
                        <View key={label} style={styles.previewCell}>
                          <Text style={styles.previewCellLabel}>{label}</Text>
                          <Text style={styles.previewCellValue}>{value}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })()}

              {/* Reason if partial */}
              {previewItem?.fields?.did_collect_all_cable === "0" && previewItem?.fields?.unrecovered_reason ? (
                <View style={styles.previewSection}>
                  <Text style={styles.previewSectionTitle}>REASON FOR PARTIAL COLLECTION</Text>
                  <Text style={styles.previewReasonText}>{previewItem.fields.unrecovered_reason}</Text>
                </View>
              ) : null}

              {/* Photos */}
              <View style={styles.previewSection}>
                <Text style={styles.previewSectionTitle}>PHOTOS ATTACHED</Text>
                <View style={styles.photoChips}>
                  {Object.keys(previewItem?.photoPaths ?? {}).map(key => (
                    <View key={key} style={styles.photoChip}>
                      <Text style={styles.photoChipText}>{key.replace(/_/g, " ")}</Text>
                    </View>
                  ))}
                  {Object.keys(previewItem?.photoPaths ?? {}).length === 0 && (
                    <Text style={styles.previewCellLabel}>No photos attached</Text>
                  )}
                </View>
              </View>

              {/* Queued at */}
              <Text style={styles.queuedAt}>Queued {fmtDate(previewItem?.queuedAt ?? "")}</Text>
            </ScrollView>

            {/* Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}
                onPress={() => {
                  setPreviewItem(null);
                  confirmClear("this item", async () => {
                    if (previewItem) await queueRemove(previewItem.id).catch(() => {});
                    await load();
                  });
                }}
              >
                <Text style={[styles.modalBtnText, { color: "#DC2626" }]}>Remove</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: PRIMARY, flex: 2 }]}
                disabled={retrying === "teardown"}
                onPress={async () => {
                  setPreviewItem(null);
                  await retryTeardown();
                }}
              >
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>
                  {retrying === "teardown" ? "Retrying…" : "Retry Upload"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: "#F4F6F8" },
  header:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E9EDF2" },
  headerTitle: { fontSize: 20, fontWeight: "900", color: "#111827", letterSpacing: -0.3 },
  headerSub:   { fontSize: 12, color: "#6B7280", marginTop: 2, fontWeight: "500" },
  netBadge:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  netDot:      { width: 7, height: 7, borderRadius: 4 },
  netText:     { fontSize: 12, fontWeight: "700" },

  content: { paddingHorizontal: 16, paddingTop: 16 },

  allClearBox:   { alignItems: "center", paddingVertical: 60 },
  allClearIcon:  { fontSize: 48, color: "#16A34A", marginBottom: 12 },
  allClearTitle: { fontSize: 18, fontWeight: "800", color: "#111827", marginBottom: 4 },
  allClearSub:   { fontSize: 13, color: "#6B7280", textAlign: "center" },

  section: {
    backgroundColor: "#fff",
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E9EDF2",
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  sectionLeft:   { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionDot:    { width: 8, height: 8, borderRadius: 4 },
  sectionTitle:  { fontSize: 13, fontWeight: "800", color: "#111827" },
  countBadge:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  countText:     { fontSize: 11, fontWeight: "800" },
  sectionActions:{ flexDirection: "row", gap: 8, alignItems: "center" },
  retryBtn:      { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0" },
  retryText:     { fontSize: 11, fontWeight: "700" },
  clearBtn:      { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#FEF2F2" },
  clearText:     { fontSize: 11, fontWeight: "700", color: "#DC2626" },

  emptyRow:  { paddingHorizontal: 14, paddingVertical: 14, alignItems: "center" },
  emptyText: { fontSize: 12, color: "#94A3B8", fontStyle: "italic" },

  row:        { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  rowBorder:  { borderBottomWidth: 1, borderBottomColor: "#F8FAFC" },
  rowIcon:    { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowIconText:{ fontSize: 16 },
  rowBody:    { flex: 1, minWidth: 0 },
  rowTitle:   { fontSize: 13, fontWeight: "700", color: "#111827" },
  rowSub:     { fontSize: 11, color: "#6B7280", marginTop: 2 },
  rowRight:   { alignItems: "flex-end", gap: 4 },
  rowTime:    { fontSize: 10, color: "#9CA3AF" },
  statusPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: "700" },

  // ── Teardown preview modal ──────────────────────────────────────────────────
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingBottom: 32,
    maxHeight: "88%",
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E2E8F0", alignSelf: "center", marginTop: 10, marginBottom: 4 },
  modalHeader: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: "#F1F5F9",
  },
  modalHeaderLabel: { fontSize: 10, fontWeight: "800", color: "#94A3B8", letterSpacing: 1.5, marginBottom: 6 },
  spanRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  spanFrom: { fontSize: 18, fontWeight: "900", color: "#0A5C3B", fontFamily: "monospace" },
  spanArrow: { fontSize: 16, fontWeight: "700", color: "#CBD5E1" },
  spanTo:   { fontSize: 18, fontWeight: "900", color: "#6366F1", fontFamily: "monospace" },
  modalClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },

  modalBody: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 16 },

  previewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  previewCell: {
    width: "47%", backgroundColor: "#F8FAFC",
    borderRadius: 14, borderWidth: 1, borderColor: "#E9EDF2",
    paddingHorizontal: 14, paddingVertical: 10,
  },
  previewCellLabel: { fontSize: 10, fontWeight: "700", color: "#94A3B8", letterSpacing: 0.8, textTransform: "uppercase" },
  previewCellValue: { fontSize: 16, fontWeight: "900", color: "#111827", marginTop: 3 },

  previewSection: { gap: 8 },
  previewSectionTitle: { fontSize: 10, fontWeight: "800", color: "#94A3B8", letterSpacing: 1.5 },
  previewReasonText: {
    fontSize: 13, color: "#374151", fontWeight: "500",
    backgroundColor: "#FFFBEB", borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: "#FDE68A",
  },

  photoChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  photoChip: {
    backgroundColor: "#F0FDF4", borderRadius: 8, borderWidth: 1,
    borderColor: "#BBF7D0", paddingHorizontal: 10, paddingVertical: 4,
  },
  photoChipText: { fontSize: 11, fontWeight: "700", color: "#059669" },

  queuedAt: { fontSize: 11, color: "#9CA3AF", textAlign: "center", paddingTop: 4 },

  modalActions: {
    flexDirection: "row", gap: 10,
    paddingHorizontal: 20, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: "#F1F5F9",
  },
  modalBtn: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingVertical: 14, borderRadius: 16,
    borderWidth: 1, borderColor: "transparent",
  },
  modalBtnText: { fontSize: 14, fontWeight: "800" },
});
