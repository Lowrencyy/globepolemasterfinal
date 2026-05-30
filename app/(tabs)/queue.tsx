import { useAuth } from "@/context/auth-context";
import {
  gpsQueueFlush,
  gpsQueueReadAll,
  gpsQueueRemove,
} from "@/lib/gps-queue";
import { isOnline } from "@/lib/net-sync";
import {
  processSimpleQueue,
  simpleQueueReadAll,
  simpleQueueRemove,
} from "@/lib/simple-queue";
import {
  imageQueueReadAll,
  imageQueueRemove,
  processImageQueue,
  processSyncQueue,
  queueReadAll,
  queueRemove,
} from "@/lib/sync-queue";
import { getQueue } from "@/services/offline";
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

const C = {
  bg: "#F3F6F4",
  card: "#FFFFFF",
  ink: "#0F172A",
  muted: "#64748B",
  soft: "#94A3B8",
  border: "#E2E8F0",
  green: "#0A5C3B",
  danger: "#DC2626",
  blue: "#2563EB",
  purple: "#7C3AED",
  pink: "#DB2777",
  orange: "#EA580C",
  success: "#16A34A",
};

const TYPE_META: Record<string, { color: string; icon: string; label: string }> = {
  gps:      { color: C.blue,   icon: "📍", label: "GPS Update" },
  teardown: { color: C.green,  icon: "📋", label: "Teardown" },
  simple:   { color: C.purple, icon: "✏️", label: "Field Edit" },
  image:    { color: C.pink,   icon: "🖼️", label: "Photo" },
  nap:      { color: C.orange, icon: "📦", label: "NAP / Pole" },
};

function fmtDate(iso: string | number) {
  const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
  return d.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function StatusChip({
  status,
  color,
}: {
  status: string;
  color: string;
}) {
  return (
    <View style={[chipStyles.wrap, { backgroundColor: `${color}14`, borderColor: `${color}28` }]}>
      <Text style={[chipStyles.text, { color }]}>{status}</Text>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  text: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "capitalize",
  },
});

export default function QueueScreen() {
  const { token } = useAuth();

  const [gpsItems, setGpsItems]         = useState<any[]>([]);
  const [teardownItems, setTeardownItems] = useState<any[]>([]);
  const [simpleItems, setSimpleItems]   = useState<any[]>([]);
  const [napItems, setNapItems]         = useState<any[]>([]);
  const [imageItems, setImageItems]     = useState<any[]>([]);
  const [online, setOnline]             = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [previewItem, setPreviewItem]   = useState<any | null>(null);

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

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const pendingTeardowns = teardownItems.filter((i) => i.status !== "synced");
  const pendingImages    = imageItems.filter((i) => i.status !== "synced");
  const syncableTD       = pendingTeardowns.filter((i) => i.status !== "permanently_failed");

  const totalPending =
    gpsItems.length +
    syncableTD.length +
    simpleItems.length +
    napItems.length +
    pendingImages.length;

  const submitOffline = async () => {
    if (totalPending === 0) {
      Alert.alert("All Synced", "Nothing to submit — queue is empty.");
      return;
    }
    if (!online) {
      Alert.alert("No Connection", "You're offline. Connect to the internet and try again.");
      return;
    }

    setSubmitting(true);
    try {
      const [tdResult] = await Promise.allSettled([
        processSyncQueue(),
        processSimpleQueue(),
        gpsQueueFlush(),
        processImageQueue(),
        token
          ? import("@/services/offline").then((m) => m.syncQueue(token))
          : Promise.resolve(),
      ]);

      await load();
      const td = tdResult.status === "fulfilled" ? tdResult.value : null;

      if (td && (td as any).failed > 0) {
        Alert.alert(
          "Partially Submitted",
          `${(td as any).failed} item(s) could not upload.\n${(td as any).firstError ?? ""}`,
        );
      } else {
        Alert.alert("Submitted", "All pending data has been uploaded successfully.");
      }
    } catch (e: any) {
      Alert.alert("Submission Failed", e?.message ?? "Unknown error. Please try again.");
    }
    setSubmitting(false);
  };

  const confirmRemove = (label: string, onConfirm: () => void) => {
    Alert.alert(`Remove ${label}?`, "This item will be permanently deleted from the queue.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: onConfirm },
    ]);
  };

  return (
    <SafeAreaView style={s.root} edges={["top"]}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <View style={s.hero}>
        <View style={s.heroRow}>
          <View>
            <Text style={s.heroEye}>OFFLINE CENTER</Text>
            <Text style={s.heroTitle}>Pending Queue</Text>
          </View>
          <View style={[s.netBadge, { backgroundColor: online ? "#DCFCE7" : "#FFEDD5" }]}>
            <View style={[s.netDot, { backgroundColor: online ? C.success : C.orange }]} />
            <Text style={[s.netText, { color: online ? "#15803D" : "#C2410C" }]}>
              {online ? "Online" : "Offline"}
            </Text>
          </View>
        </View>

        <View style={s.countRow}>
          <View>
            <Text style={s.countNum}>{totalPending}</Text>
            <Text style={s.countLabel}>
              {totalPending === 0 ? "No pending uploads" : "items pending upload"}
            </Text>
          </View>

          <TouchableOpacity
            style={[s.submitBtn, (!online || submitting || totalPending === 0) && s.submitBtnDim]}
            onPress={submitOffline}
            disabled={submitting || totalPending === 0}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={s.submitBtnText}>Submit Offline</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Queue cards ─────────────────────────────────────────── */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.green]} />
        }
        showsVerticalScrollIndicator={false}
      >
        {totalPending === 0 && !refreshing ? (
          <View style={s.allClear}>
            <Text style={s.allClearMark}>✓</Text>
            <Text style={s.allClearTitle}>No Pending Uploads</Text>
            <Text style={s.allClearSub}>All items have been submitted successfully.</Text>
          </View>
        ) : null}

        {/* GPS */}
        {gpsItems.length > 0 ? (
          <QueueSection
            icon={TYPE_META.gps.icon}
            color={TYPE_META.gps.color}
            title="GPS Updates"
            count={gpsItems.length}
          >
            {gpsItems.map((item, i) => (
              <QueueCard
                key={`${item.pole_id}-${i}`}
                icon={TYPE_META.gps.icon}
                color={TYPE_META.gps.color}
                title={`Pole #${item.pole_id}`}
                sub={`${item.lat?.toFixed(6)}, ${item.lng?.toFixed(6)}`}
                meta={fmtDate(item.queuedAt)}
                onRemove={() =>
                  confirmRemove("GPS update", async () => {
                    await gpsQueueRemove(item.pole_id).catch(() => {});
                    await load();
                  })
                }
              />
            ))}
          </QueueSection>
        ) : null}

        {/* Teardowns */}
        {pendingTeardowns.length > 0 ? (
          <QueueSection
            icon={TYPE_META.teardown.icon}
            color={TYPE_META.teardown.color}
            title="Teardown Submissions"
            count={pendingTeardowns.length}
          >
            {pendingTeardowns.map((item) => {
              const f = item.fields ?? {};
              const fromCode = f.from_pole_code ?? f.pole_code ?? "—";
              const toCode   = f.to_pole_code ?? "—";
              const isPerm   = item.status === "permanently_failed";
              const isFailed = item.status === "failed" || isPerm;
              const statusColor = isPerm ? C.purple : isFailed ? C.danger : C.blue;

              return (
                <QueueCard
                  key={item.id}
                  icon={TYPE_META.teardown.icon}
                  color={TYPE_META.teardown.color}
                  title={`${fromCode}  →  ${toCode}`}
                  sub={isFailed ? item.lastError : fmtDate(item.queuedAt)}
                  subError={isFailed}
                  meta={
                    item.retryCount > 0
                      ? `try ${item.retryCount}/5`
                      : fmtDate(item.queuedAt)
                  }
                  status={isPerm ? "perm. failed" : isFailed ? "failed" : item.status}
                  statusColor={statusColor}
                  onPress={() => setPreviewItem(item)}
                  onRemove={() =>
                    confirmRemove("teardown", async () => {
                      await queueRemove(item.id).catch(() => {});
                      await load();
                    })
                  }
                />
              );
            })}
          </QueueSection>
        ) : null}

        {/* Field Edits */}
        {simpleItems.length > 0 ? (
          <QueueSection
            icon={TYPE_META.simple.icon}
            color={TYPE_META.simple.color}
            title="Field Updates"
            count={simpleItems.length}
          >
            {simpleItems.map((item) => (
              <QueueCard
                key={item.id}
                icon={TYPE_META.simple.icon}
                color={TYPE_META.simple.color}
                title={`${item.method?.toUpperCase()} ${item.url}`}
                sub={JSON.stringify(item.body)}
                meta={fmtDate(item.queuedAt)}
                onRemove={() =>
                  confirmRemove("field update", async () => {
                    await simpleQueueRemove(item.id).catch(() => {});
                    await load();
                  })
                }
              />
            ))}
          </QueueSection>
        ) : null}

        {/* Photos */}
        {pendingImages.length > 0 ? (
          <QueueSection
            icon={TYPE_META.image.icon}
            color={TYPE_META.image.color}
            title="Pending Photos"
            count={pendingImages.length}
          >
            {pendingImages.map((item) => {
              const isFailed = item.status === "failed";
              return (
                <QueueCard
                  key={item.id}
                  icon={TYPE_META.image.icon}
                  color={TYPE_META.image.color}
                  title={item.fieldName?.replace(/_/g, " ") ?? "Queued photo"}
                  sub={`${item.meta?.pole_code ?? "—"}  ·  ${item.meta?.image_type ?? "—"}`}
                  meta={fmtDate(item.queuedAt)}
                  status={item.status}
                  statusColor={isFailed ? C.danger : C.blue}
                  subError={isFailed}
                  onRemove={() =>
                    confirmRemove("photo", async () => {
                      await imageQueueRemove(item.id).catch(() => {});
                      await load();
                    })
                  }
                />
              );
            })}
          </QueueSection>
        ) : null}

        {/* NAP / Pole */}
        {napItems.length > 0 ? (
          <QueueSection
            icon={TYPE_META.nap.icon}
            color={TYPE_META.nap.color}
            title="NAP / Pole Creation"
            count={napItems.length}
          >
            {napItems.map((item) => (
              <QueueCard
                key={item.id}
                icon={item.type === "CREATE_POLE" ? "🗼" : "📦"}
                color={TYPE_META.nap.color}
                title={item.type === "CREATE_POLE" ? "New Pole" : "New NAP Box"}
                sub={
                  item.payload?.pole_code ??
                  item.payload?.nap_code ??
                  JSON.stringify(item.payload).slice(0, 48)
                }
                meta={fmtDate(item.createdAt)}
                status={item.status}
                statusColor={item.status === "failed" ? C.danger : C.blue}
                onRemove={() =>
                  confirmRemove("item", async () => {
                    const { removeFromQueue } = await import("@/services/offline");
                    await removeFromQueue(item.id).catch(() => {});
                    await load();
                  })
                }
              />
            ))}
          </QueueSection>
        ) : null}
      </ScrollView>

      {/* ── Teardown preview sheet ───────────────────────────────── */}
      <Modal
        visible={!!previewItem}
        transparent
        animationType="slide"
        onRequestClose={() => setPreviewItem(null)}
      >
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <View style={s.handle} />

            <View style={s.sheetHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.sheetKicker}>PENDING TEARDOWN</Text>
                <Text style={s.sheetTitle} numberOfLines={1}>
                  {previewItem?.fields?.from_pole_code ?? previewItem?.fields?.pole_code ?? "—"}
                  {"  →  "}
                  {previewItem?.fields?.to_pole_code ?? "—"}
                </Text>
              </View>
              <Pressable onPress={() => setPreviewItem(null)} style={s.sheetClose}>
                <Text style={s.sheetCloseText}>×</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={s.sheetBody} showsVerticalScrollIndicator={false}>
              <View style={s.previewGrid}>
                {[
                  { label: "Collected", value: `${previewItem?.fields?.collected_cable ?? previewItem?.fields?.recovered_cable ?? "—"}m` },
                  { label: "Expected",  value: `${previewItem?.fields?.expected_cable ?? "—"}m` },
                  { label: "All Cable", value: previewItem?.fields?.did_collect_all_cable === "1" ? "Yes" : "No" },
                  { label: "Span ID",   value: previewItem?.fields?.pole_span_id ?? "—" },
                ].map(({ label, value }) => (
                  <View key={label} style={s.previewCell}>
                    <Text style={s.previewCellLabel}>{label}</Text>
                    <Text style={s.previewCellValue}>{value}</Text>
                  </View>
                ))}
              </View>

              {(() => {
                const f = previewItem?.fields ?? {};
                const comps = [
                  { label: "Nodes",      value: f.collected_node ?? 0 },
                  { label: "Amplifiers", value: f.collected_amplifier ?? 0 },
                  { label: "Extenders",  value: f.collected_extender ?? 0 },
                  { label: "TSC",        value: f.collected_tsc ?? 0 },
                  { label: "Power Sup.", value: f.collected_powersupply ?? 0 },
                  { label: "PS Housing", value: f.collected_powersupply_housing ?? 0 },
                ].filter((c) => Number(c.value) > 0);
                if (!comps.length) return null;
                return (
                  <View style={s.previewSection}>
                    <Text style={s.previewSectionTitle}>Components collected</Text>
                    <View style={s.previewGrid}>
                      {comps.map(({ label, value }) => (
                        <View key={label} style={s.previewCell}>
                          <Text style={s.previewCellLabel}>{label}</Text>
                          <Text style={s.previewCellValue}>{value}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })()}

              {previewItem?.fields?.did_collect_all_cable === "0" && previewItem?.fields?.unrecovered_reason ? (
                <View style={s.previewSection}>
                  <Text style={s.previewSectionTitle}>Reason for partial collection</Text>
                  <View style={s.reasonBox}>
                    <Text style={s.reasonText}>{previewItem.fields.unrecovered_reason}</Text>
                  </View>
                </View>
              ) : null}

              <View style={s.previewSection}>
                <Text style={s.previewSectionTitle}>Photos attached</Text>
                <View style={s.photoChips}>
                  {Object.keys(previewItem?.photoPaths ?? {}).length === 0 ? (
                    <Text style={s.noPhotoText}>No photos attached</Text>
                  ) : (
                    Object.keys(previewItem?.photoPaths ?? {}).map((key) => (
                      <View key={key} style={s.photoChip}>
                        <Text style={s.photoChipText}>{key.replace(/_/g, " ")}</Text>
                      </View>
                    ))
                  )}
                </View>
              </View>

              <Text style={s.queuedAt}>Queued {fmtDate(previewItem?.queuedAt ?? "")}</Text>
            </ScrollView>

            <View style={s.sheetActions}>
              <TouchableOpacity
                style={[s.sheetBtn, s.removeBtn]}
                onPress={() => {
                  const item = previewItem;
                  setPreviewItem(null);
                  confirmRemove("this teardown", async () => {
                    if (item) await queueRemove(item.id).catch(() => {});
                    await load();
                  });
                }}
              >
                <Text style={[s.sheetBtnText, { color: C.danger }]}>Remove</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.sheetBtn, s.submitSheetBtn]}
                disabled={submitting}
                onPress={async () => {
                  setPreviewItem(null);
                  await submitOffline();
                }}
              >
                <Text style={[s.sheetBtnText, { color: "#fff" }]}>
                  {submitting ? "Submitting…" : "Submit Offline"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function QueueSection({
  icon,
  color,
  title,
  count,
  children,
}: {
  icon: string;
  color: string;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <View style={s.sectionCard}>
      <View style={s.sectionHeader}>
        <View style={[s.sectionIconBox, { backgroundColor: `${color}14` }]}>
          <Text style={s.sectionIconText}>{icon}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.sectionTitle}>{title}</Text>
        </View>
        <View style={[s.countBadge, { backgroundColor: `${color}14`, borderColor: `${color}28` }]}>
          <Text style={[s.countBadgeText, { color }]}>{count}</Text>
        </View>
      </View>
      <View style={s.sectionList}>{children}</View>
    </View>
  );
}

function QueueCard({
  icon,
  color,
  title,
  sub,
  subError,
  meta,
  status,
  statusColor,
  onPress,
  onRemove,
}: {
  icon: string;
  color: string;
  title: string;
  sub?: string;
  subError?: boolean;
  meta?: string;
  status?: string;
  statusColor?: string;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  return (
    <TouchableOpacity
      style={s.card}
      activeOpacity={onPress ? 0.72 : 1}
      onPress={onPress}
    >
      <View style={[s.cardIcon, { backgroundColor: `${color}12` }]}>
        <Text style={s.cardIconText}>{icon}</Text>
      </View>

      <View style={s.cardBody}>
        <Text style={s.cardTitle} numberOfLines={1}>{title}</Text>
        {sub ? (
          <Text
            style={[s.cardSub, subError && { color: C.danger }]}
            numberOfLines={1}
          >
            {sub}
          </Text>
        ) : null}
        <View style={s.cardMeta}>
          {status ? (
            <StatusChip status={status} color={statusColor ?? C.blue} />
          ) : null}
          {meta ? <Text style={s.cardMetaText}>{meta}</Text> : null}
        </View>
      </View>

      {onRemove ? (
        <TouchableOpacity onPress={onRemove} style={s.removeIcon} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.removeIconText}>✕</Text>
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 140 },

  /* Header */
  hero: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 22,
    backgroundColor: C.green,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  heroRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroEye: { fontSize: 11, fontWeight: "900", letterSpacing: 1.4, color: "rgba(255,255,255,0.6)" },
  heroTitle: { marginTop: 3, fontSize: 26, fontWeight: "900", letterSpacing: -0.8, color: "#fff" },
  netBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999 },
  netDot: { width: 7, height: 7, borderRadius: 4 },
  netText: { fontSize: 12, fontWeight: "900" },

  countRow: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.11)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  countNum: { fontSize: 38, fontWeight: "900", color: "#fff", letterSpacing: -1 },
  countLabel: { marginTop: 2, fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.7)" },

  submitBtn: {
    minWidth: 130,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  submitBtnDim: { opacity: 0.5 },
  submitBtnText: { fontSize: 13, fontWeight: "900", color: C.green },

  /* All clear */
  allClear: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 80 },
  allClearMark: { fontSize: 52, color: C.success, marginBottom: 14, fontWeight: "900" },
  allClearTitle: { fontSize: 22, fontWeight: "900", color: C.ink, letterSpacing: -0.6 },
  allClearSub: { marginTop: 8, fontSize: 14, fontWeight: "600", color: C.muted, textAlign: "center" },

  /* Section card */
  sectionCard: {
    marginBottom: 14,
    borderRadius: 22,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  sectionIconBox: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  sectionIconText: { fontSize: 18 },
  sectionTitle: { fontSize: 14, fontWeight: "900", color: C.ink },
  countBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  countBadgeText: { fontSize: 12, fontWeight: "900" },
  sectionList: {},

  /* Queue card */
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  cardIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardIconText: { fontSize: 15 },
  cardBody: { flex: 1, minWidth: 0, gap: 3 },
  cardTitle: { fontSize: 13, fontWeight: "800", color: C.ink },
  cardSub: { fontSize: 11, fontWeight: "500", color: C.muted },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 2 },
  cardMetaText: { fontSize: 10, fontWeight: "700", color: C.soft },
  removeIcon: { padding: 6, borderRadius: 10, backgroundColor: "#FEF2F2" },
  removeIconText: { fontSize: 11, fontWeight: "900", color: C.danger },

  /* Preview sheet */
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  sheet: { maxHeight: "88%", paddingBottom: 28, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: C.card },
  handle: { width: 44, height: 5, marginTop: 10, marginBottom: 6, borderRadius: 999, backgroundColor: C.border, alignSelf: "center" },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  sheetKicker: { fontSize: 10, fontWeight: "900", letterSpacing: 1.5, color: C.soft, marginBottom: 5 },
  sheetTitle: { fontSize: 20, fontWeight: "900", color: C.ink, fontFamily: "monospace" },
  sheetClose: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "#F1F5F9" },
  sheetCloseText: { fontSize: 22, color: C.soft, lineHeight: 24 },
  sheetBody: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 16 },
  sheetActions: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#F1F5F9" },
  sheetBtn: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 18, borderWidth: 1, flex: 1 },
  sheetBtnText: { fontSize: 14, fontWeight: "900" },
  removeBtn: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  submitSheetBtn: { flex: 2, backgroundColor: C.green, borderColor: C.green },

  /* Preview content */
  previewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  previewCell: { width: "47%", paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: C.border },
  previewCellLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase", color: C.soft },
  previewCellValue: { marginTop: 4, fontSize: 17, fontWeight: "900", color: C.ink },
  previewSection: { gap: 9 },
  previewSectionTitle: { fontSize: 12, fontWeight: "900", color: C.ink },
  reasonBox: { padding: 13, borderRadius: 16, borderWidth: 1, borderColor: "#FDE68A", backgroundColor: "#FFFBEB" },
  reasonText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  photoChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: "#BBF7D0", backgroundColor: "#F0FDF4" },
  photoChipText: { fontSize: 11, fontWeight: "900", color: "#047857" },
  noPhotoText: { fontSize: 12, fontWeight: "700", color: C.soft },
  queuedAt: { paddingTop: 2, textAlign: "center", fontSize: 11, fontWeight: "700", color: C.soft },
});
