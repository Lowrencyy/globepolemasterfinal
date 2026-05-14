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

const COLORS = {
  primary: "#0A5C3B",
  bg: "#F3F6F4",
  card: "#FFFFFF",
  ink: "#0F172A",
  muted: "#64748B",
  softMuted: "#94A3B8",
  border: "#E2E8F0",
  danger: "#DC2626",
  blue: "#2563EB",
  purple: "#7C3AED",
  pink: "#DB2777",
  orange: "#EA580C",
  success: "#16A34A",
};

const SECTION_COLORS = {
  gps: "#2563EB",
  teardown: COLORS.primary,
  simple: "#7C3AED",
  images: "#DB2777",
  nap: "#EA580C",
};

type SectionKey = "gps" | "teardown" | "simple" | "nap" | "images" | "all";

type QueueSectionProps = {
  title: string;
  subtitle: string;
  icon: string;
  count: number;
  color: string;
  retrying: boolean;
  onRetry: () => void;
  onClear: () => void;
  children: React.ReactNode;
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


function Pill({
  label,
  color,
  tone = "light",
}: {
  label: string;
  color: string;
  tone?: "light" | "solid";
}) {
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: tone === "solid" ? color : `${color}14`,
          borderColor: tone === "solid" ? color : `${color}24`,
        },
      ]}
    >
      <Text
        style={[
          styles.pillText,
          { color: tone === "solid" ? "#FFFFFF" : color },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function QueueSection({
  title,
  subtitle,
  icon,
  count,
  color,
  retrying,
  onRetry,
  onClear,
  children,
}: QueueSectionProps) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionTop}>
        <View style={[styles.sectionIcon, { backgroundColor: `${color}12` }]}>
          <Text style={styles.sectionIconText}>{icon}</Text>
        </View>

        <View style={styles.sectionHeading}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Pill label={`${count}`} color={color} />
          </View>
          <Text style={styles.sectionSub}>{subtitle}</Text>
        </View>
      </View>

      {count > 0 ? (
        <View style={styles.sectionControls}>
          <TouchableOpacity
            style={[styles.softButton, { borderColor: `${color}30` }]}
            onPress={onRetry}
            disabled={retrying}
          >
            {retrying ? (
              <ActivityIndicator size="small" color={color} />
            ) : (
              <Text style={[styles.softButtonText, { color }]}>Retry all</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.clearButton} onPress={onClear}>
            <Text style={styles.clearButtonText}>Clear</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.listWrap}>{children}</View>
    </View>
  );
}

function EmptyState({ label = "No pending items" }: { label?: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>✓</Text>
      <Text style={styles.emptyText}>{label}</Text>
    </View>
  );
}

function QueueRow({
  icon,
  tint,
  title,
  subtitle,
  meta,
  status,
  statusColor = COLORS.blue,
  error,
  onPress,
}: {
  icon: string;
  tint: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: string;
  status?: string;
  statusColor?: string;
  error?: string | null;
  onPress?: () => void;
}) {
  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper
      style={styles.queueRow}
      activeOpacity={0.72}
      onPress={onPress as any}
    >
      <View style={[styles.queueIcon, { backgroundColor: `${tint}12` }]}>
        <Text style={styles.queueIconText}>{icon}</Text>
      </View>

      <View style={styles.queueBody}>
        <Text style={styles.queueTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.queueSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {error ? (
          <Text style={[styles.queueSub, styles.errorText]} numberOfLines={1}>
            {error}
          </Text>
        ) : null}
      </View>

      <View style={styles.queueRight}>
        {status ? <Pill label={status} color={statusColor} /> : null}
        {meta ? <Text style={styles.queueMeta}>{meta}</Text> : null}
      </View>
    </Wrapper>
  );
}

export default function QueueScreen() {
  const { token } = useAuth();

  const [gpsItems, setGpsItems] = useState<any[]>([]);
  const [teardownItems, setTeardownItems] = useState<any[]>([]);
  const [simpleItems, setSimpleItems] = useState<any[]>([]);
  const [napItems, setNapItems] = useState<any[]>([]);
  const [imageItems, setImageItems] = useState<any[]>([]);
  const [online, setOnline] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState<SectionKey | null>(null);
  const [previewItem, setPreviewItem] = useState<any | null>(null);

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
    setOnline(net);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const pendingTeardowns = teardownItems.filter((i) => i.status !== "synced");
  const pendingImages = imageItems.filter((i) => i.status !== "synced");
  const syncableTeardowns = pendingTeardowns.filter(
    (i) => i.status !== "permanently_failed",
  );
  const syncableImages = pendingImages.filter(
    (i) => i.status !== "permanently_failed",
  );

  const totalPending =
    gpsItems.length +
    syncableTeardowns.length +
    simpleItems.length +
    napItems.length +
    syncableImages.length;


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
      submitted: 0,
      failed: pendingTeardowns.length,
      permanentlyFailed: 0,
      firstError: e?.message ?? "Unknown error",
    }));

    await load();
    setRetrying(null);

    if (result.permanentlyFailed > 0) {
      Alert.alert(
        "Upload Error",
        `${result.permanentlyFailed} item(s) permanently failed. Please remove them manually.`,
      );
    } else if (result.failed > 0) {
      Alert.alert(
        "Upload Failed",
        result.firstError
          ? `${result.failed} item(s) still pending.\n\nReason: ${result.firstError}`
          : `${result.failed} item(s) could not upload.`,
      );
    } else if (result.submitted > 0) {
      Alert.alert(
        "Uploaded",
        `${result.submitted} teardown report(s) submitted successfully.`,
      );
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

  const retryImages = async () => {
    setRetrying("images");
    try {
      await processImageQueue();
    } catch (e: any) {
      Alert.alert("Retry Failed", e?.message ?? "Could not reach backend.");
    }
    await load();
    setRetrying(null);
  };

  const syncAll = async () => {
    if (totalPending === 0) {
      Alert.alert("No offline data to sync", "All items are already synced.");
      return;
    }

    setRetrying("all");
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

      if (td && td.failed > 0) {
        Alert.alert(
          "Sync Partial",
          `${td.failed} item(s) could not upload.\n${td.firstError ?? ""}`,
        );
      } else {
        Alert.alert("Sync Complete", "All pending data has been uploaded.");
      }
    } catch (e: any) {
      Alert.alert("Sync Failed", e?.message ?? "Unknown error.");
    }
    setRetrying(null);
  };

  const confirmClear = (label: string, onConfirm: () => void) => {
    Alert.alert(`Clear ${label}?`, "These items will be permanently removed.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: onConfirm },
    ]);
  };

  const clearGps = () =>
    confirmClear("GPS queue", async () => {
      for (const item of gpsItems)
        await gpsQueueRemove(item.pole_id).catch(() => {});
      await load();
    });

  const clearTeardown = () =>
    confirmClear("teardown queue", async () => {
      for (const item of teardownItems)
        await queueRemove(item.id).catch(() => {});
      await load();
    });

  const clearSimple = () =>
    confirmClear("simple queue", async () => {
      for (const item of simpleItems)
        await simpleQueueRemove(item.id).catch(() => {});
      await load();
    });

  const clearNap = () =>
    confirmClear("NAP/Pole queue", async () => {
      const { removeFromQueue } = await import("@/services/offline");
      for (const item of napItems)
        await removeFromQueue(item.id).catch(() => {});
      await load();
    });

  const clearImages = () =>
    confirmClear("image queue", async () => {
      for (const item of pendingImages)
        await imageQueueRemove(item.id).catch(() => {});
      await load();
    });

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <View>
            <Text style={styles.kicker}>OFFLINE CENTER</Text>
            <Text style={styles.heroTitle}>Pending Queue</Text>
          </View>

          <View
            style={[
              styles.connectionBadge,
              { backgroundColor: online ? "#DCFCE7" : "#FFEDD5" },
            ]}
          >
            <View
              style={[
                styles.connectionDot,
                { backgroundColor: online ? COLORS.success : COLORS.orange },
              ]}
            />
            <Text
              style={[
                styles.connectionText,
                { color: online ? "#15803D" : "#C2410C" },
              ]}
            >
              {online ? "Online" : "Offline"}
            </Text>
          </View>
        </View>

        <View style={styles.summaryCard}>
          <View>
            <Text style={styles.summaryNumber}>{totalPending}</Text>
            <Text style={styles.summaryLabel}>
              {totalPending === 0
                ? "Everything is synced"
                : "Items waiting to upload"}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.syncButton,
              (retrying === "all" || totalPending === 0) &&
                styles.disabledButton,
            ]}
            onPress={syncAll}
            disabled={retrying === "all" || totalPending === 0}
          >
            {retrying === "all" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.syncButtonText}>Sync all</Text>
            )}
          </TouchableOpacity>
        </View>

        {totalPending === 0 ? (
          <Text style={styles.heroHint}>
            Pull down to check for new pending data.
          </Text>
        ) : null}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {totalPending === 0 && !refreshing ? (
          <View style={styles.allClearCard}>
            <Text style={styles.allClearMark}>✓</Text>
            <Text style={styles.allClearTitle}>You’re all caught up</Text>
            <Text style={styles.allClearSub}>
              There are no pending uploads on this device.
            </Text>
          </View>
        ) : null}

        {totalPending > 0 ? (
          <>
            <QueueSection
              title="GPS Updates"
              subtitle="Pole location changes"
              icon="📍"
              count={gpsItems.length}
              color={SECTION_COLORS.gps}
              retrying={retrying === "gps"}
              onRetry={retryGps}
              onClear={clearGps}
            >
              {gpsItems.length === 0 ? (
                <EmptyState />
              ) : (
                gpsItems.map((item, i) => (
                  <QueueRow
                    key={`${item.pole_id}-${i}`}
                    icon="📍"
                    tint={SECTION_COLORS.gps}
                    title={`Pole #${item.pole_id}`}
                    subtitle={`${item.lat?.toFixed(6)}, ${item.lng?.toFixed(6)}`}
                    meta={fmtDate(item.queuedAt)}
                  />
                ))
              )}
            </QueueSection>

            <QueueSection
              title="Teardown Submissions"
              subtitle="Span reports and collected materials"
              icon="📋"
              count={pendingTeardowns.length}
              color={SECTION_COLORS.teardown}
              retrying={retrying === "teardown"}
              onRetry={retryTeardown}
              onClear={clearTeardown}
            >
              {pendingTeardowns.length === 0 ? (
                <EmptyState />
              ) : (
                pendingTeardowns.map((item) => {
                  const f = item.fields ?? {};
                  const fromCode = f.from_pole_code ?? f.pole_code ?? "—";
                  const toCode = f.to_pole_code ?? "—";
                  const isPermanent = item.status === "permanently_failed";
                  const isFailed = item.status === "failed" || isPermanent;
                  const statusColor = isPermanent
                    ? COLORS.purple
                    : isFailed
                      ? COLORS.danger
                      : COLORS.blue;

                  return (
                    <QueueRow
                      key={item.id}
                      icon="📋"
                      tint={SECTION_COLORS.teardown}
                      title={
                        <>
                          <Text style={{ color: COLORS.primary }}>
                            {fromCode}
                          </Text>
                          <Text style={{ color: COLORS.softMuted }}> → </Text>
                          <Text style={{ color: "#4F46E5" }}>{toCode}</Text>
                        </>
                      }
                      subtitle={fmtDate(item.queuedAt)}
                      status={isPermanent ? "perm. failed" : item.status}
                      statusColor={statusColor}
                      meta={
                        (item.retryCount ?? 0) > 0
                          ? `try ${item.retryCount}/5`
                          : undefined
                      }
                      error={isFailed ? item.lastError : null}
                      onPress={() => setPreviewItem(item)}
                    />
                  );
                })
              )}
            </QueueSection>

            <QueueSection
              title="Field Updates"
              subtitle="Small API changes saved offline"
              icon="✏️"
              count={simpleItems.length}
              color={SECTION_COLORS.simple}
              retrying={retrying === "simple"}
              onRetry={retrySimple}
              onClear={clearSimple}
            >
              {simpleItems.length === 0 ? (
                <EmptyState />
              ) : (
                simpleItems.map((item) => (
                  <QueueRow
                    key={item.id}
                    icon="✏️"
                    tint={SECTION_COLORS.simple}
                    title={`${item.method?.toUpperCase()} ${item.url}`}
                    subtitle={JSON.stringify(item.body)}
                    meta={fmtDate(item.queuedAt)}
                  />
                ))
              )}
            </QueueSection>

            <QueueSection
              title="Pending Images"
              subtitle="Photos waiting for upload"
              icon="🖼️"
              count={pendingImages.length}
              color={SECTION_COLORS.images}
              retrying={retrying === "images"}
              onRetry={retryImages}
              onClear={clearImages}
            >
              {pendingImages.length === 0 ? (
                <EmptyState />
              ) : (
                pendingImages.map((item) => {
                  const isFailed = item.status === "failed";
                  return (
                    <QueueRow
                      key={item.id}
                      icon="🖼️"
                      tint={SECTION_COLORS.images}
                      title={
                        item.fieldName?.replace(/_/g, " ") ?? "Queued image"
                      }
                      subtitle={`${item.meta?.pole_code ?? "—"} · ${item.meta?.image_type ?? "—"}`}
                      status={item.status}
                      statusColor={isFailed ? COLORS.danger : COLORS.blue}
                      meta={fmtDate(item.queuedAt)}
                      error={isFailed ? item.lastError : null}
                    />
                  );
                })
              )}
            </QueueSection>

            <QueueSection
              title="NAP / Pole Creation"
              subtitle="New infrastructure records"
              icon="📦"
              count={napItems.length}
              color={SECTION_COLORS.nap}
              retrying={retrying === "nap"}
              onRetry={retryNap}
              onClear={clearNap}
            >
              {napItems.length === 0 ? (
                <EmptyState />
              ) : (
                napItems.map((item) => (
                  <QueueRow
                    key={item.id}
                    icon={item.type === "CREATE_POLE" ? "🗼" : "📦"}
                    tint={SECTION_COLORS.nap}
                    title={
                      item.type === "CREATE_POLE" ? "New Pole" : "New NAP Box"
                    }
                    subtitle={
                      item.payload?.pole_code ??
                      item.payload?.nap_code ??
                      JSON.stringify(item.payload).slice(0, 40)
                    }
                    status={item.status}
                    statusColor={
                      item.status === "failed" ? COLORS.danger : COLORS.blue
                    }
                    meta={fmtDate(item.createdAt)}
                  />
                ))
              )}
            </QueueSection>
          </>
        ) : null}
      </ScrollView>

      <Modal
        visible={!!previewItem}
        transparent
        animationType="slide"
        onRequestClose={() => setPreviewItem(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />

            <View style={styles.modalHeader}>
              <View style={styles.modalTitleWrap}>
                <Text style={styles.modalKicker}>PENDING TEARDOWN</Text>
                <View style={styles.spanRow}>
                  <Text style={styles.spanFrom}>
                    {previewItem?.fields?.from_pole_code ??
                      previewItem?.fields?.pole_code ??
                      "—"}
                  </Text>
                  <Text style={styles.spanArrow}>→</Text>
                  <Text style={styles.spanTo}>
                    {previewItem?.fields?.to_pole_code ?? "—"}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => setPreviewItem(null)}
                style={styles.modalClose}
              >
                <Text style={styles.modalCloseText}>×</Text>
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalBody}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.previewGrid}>
                {[
                  {
                    label: "Collected",
                    value: `${previewItem?.fields?.collected_cable ?? previewItem?.fields?.recovered_cable ?? "—"}m`,
                  },
                  {
                    label: "Expected",
                    value: `${previewItem?.fields?.expected_cable ?? "—"}m`,
                  },
                  {
                    label: "All Cable",
                    value:
                      previewItem?.fields?.did_collect_all_cable === "1"
                        ? "Yes"
                        : "No",
                  },
                  {
                    label: "Span ID",
                    value: previewItem?.fields?.pole_span_id ?? "—",
                  },
                ].map(({ label, value }) => (
                  <View key={label} style={styles.previewCell}>
                    <Text style={styles.previewLabel}>{label}</Text>
                    <Text style={styles.previewValue}>{value}</Text>
                  </View>
                ))}
              </View>

              {(() => {
                const f = previewItem?.fields ?? {};
                const comps = [
                  {
                    label: "Nodes",
                    value: f.collected_node ?? f.nodes_collected ?? 0,
                  },
                  {
                    label: "Amplifiers",
                    value: f.collected_amplifier ?? f.amplifiers_collected ?? 0,
                  },
                  {
                    label: "Extenders",
                    value: f.collected_extender ?? f.extenders_collected ?? 0,
                  },
                  {
                    label: "TSC",
                    value: f.collected_tsc ?? f.tsc_collected ?? 0,
                  },
                  {
                    label: "Power Sup.",
                    value:
                      f.collected_powersupply ?? f.powersupply_collected ?? 0,
                  },
                  {
                    label: "PS Housing",
                    value:
                      f.collected_powersupply_housing ??
                      f.ps_housing_collected ??
                      0,
                  },
                ].filter((c) => Number(c.value) > 0);

                if (!comps.length) return null;

                return (
                  <View style={styles.previewSection}>
                    <Text style={styles.previewSectionTitle}>
                      Components collected
                    </Text>
                    <View style={styles.previewGrid}>
                      {comps.map(({ label, value }) => (
                        <View key={label} style={styles.previewCell}>
                          <Text style={styles.previewLabel}>{label}</Text>
                          <Text style={styles.previewValue}>{value}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })()}

              {previewItem?.fields?.did_collect_all_cable === "0" &&
              previewItem?.fields?.unrecovered_reason ? (
                <View style={styles.previewSection}>
                  <Text style={styles.previewSectionTitle}>
                    Reason for partial collection
                  </Text>
                  <Text style={styles.reasonBox}>
                    {previewItem.fields.unrecovered_reason}
                  </Text>
                </View>
              ) : null}

              <View style={styles.previewSection}>
                <Text style={styles.previewSectionTitle}>Photos attached</Text>
                <View style={styles.photoChips}>
                  {Object.keys(previewItem?.photoPaths ?? {}).map((key) => (
                    <View key={key} style={styles.photoChip}>
                      <Text style={styles.photoChipText}>
                        {key.replace(/_/g, " ")}
                      </Text>
                    </View>
                  ))}
                  {Object.keys(previewItem?.photoPaths ?? {}).length === 0 ? (
                    <Text style={styles.noPhotoText}>No photos attached</Text>
                  ) : null}
                </View>
              </View>

              <Text style={styles.queuedAt}>
                Queued {fmtDate(previewItem?.queuedAt ?? "")}
              </Text>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.removeButton]}
                onPress={() => {
                  setPreviewItem(null);
                  confirmClear("this item", async () => {
                    if (previewItem)
                      await queueRemove(previewItem.id).catch(() => {});
                    await load();
                  });
                }}
              >
                <Text
                  style={[styles.modalButtonText, { color: COLORS.danger }]}
                >
                  Remove
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.retryButton]}
                disabled={retrying === "teardown"}
                onPress={async () => {
                  setPreviewItem(null);
                  await retryTeardown();
                }}
              >
                <Text style={[styles.modalButtonText, { color: "#FFFFFF" }]}>
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
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    flex: 1,
  },
  hero: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
    backgroundColor: COLORS.primary,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  kicker: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
    color: "rgba(255,255,255,0.65)",
  },
  heroTitle: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.8,
    color: "#FFFFFF",
  },
  connectionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  connectionDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  connectionText: {
    fontSize: 12,
    fontWeight: "900",
  },
  summaryCard: {
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  summaryNumber: {
    fontSize: 36,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -1,
  },
  summaryLabel: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "700",
    color: "rgba(255,255,255,0.74)",
  },
  syncButton: {
    minWidth: 104,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
  },
  disabledButton: {
    opacity: 0.55,
  },
  syncButtonText: {
    fontSize: 13,
    fontWeight: "900",
    color: COLORS.primary,
  },
  heroHint: {
    textAlign: "center",
    marginTop: 16,
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255,255,255,0.68)",
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 140,
    justifyContent: "center",
  },
  allClearCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 90,
  },
  allClearMark: {
    fontSize: 48,
    color: COLORS.success,
    marginBottom: 14,
    fontWeight: "900",
  },
  allClearTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: COLORS.ink,
    textAlign: "center",
    letterSpacing: -0.8,
  },
  allClearSub: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
    color: COLORS.muted,
    textAlign: "center",
    maxWidth: 280,
  },
  sectionCard: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 24,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  sectionTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sectionIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionIconText: {
    fontSize: 20,
  },
  sectionHeading: {
    flex: 1,
    minWidth: 0,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "900",
    color: COLORS.ink,
  },
  sectionSub: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.muted,
  },
  sectionControls: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  softButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
  },
  softButtonText: {
    fontSize: 12,
    fontWeight: "900",
  },
  clearButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: "#FEF2F2",
  },
  clearButtonText: {
    fontSize: 12,
    fontWeight: "900",
    color: COLORS.danger,
  },
  listWrap: {
    marginTop: 10,
    overflow: "hidden",
    borderRadius: 18,
    backgroundColor: "#F8FAFC",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
  },
  emptyIcon: {
    fontSize: 18,
    color: COLORS.success,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.softMuted,
  },
  queueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF2F7",
  },
  queueIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  queueIconText: {
    fontSize: 17,
  },
  queueBody: {
    flex: 1,
    minWidth: 0,
  },
  queueTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: COLORS.ink,
  },
  queueSub: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.muted,
  },
  errorText: {
    color: COLORS.danger,
    fontWeight: "700",
  },
  queueRight: {
    alignItems: "flex-end",
    gap: 5,
    maxWidth: 104,
  },
  queueMeta: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.softMuted,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "capitalize",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    maxHeight: "88%",
    paddingBottom: 28,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: COLORS.card,
  },
  modalHandle: {
    width: 44,
    height: 5,
    marginTop: 10,
    marginBottom: 6,
    borderRadius: 999,
    backgroundColor: COLORS.border,
    alignSelf: "center",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  modalTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  modalKicker: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
    color: COLORS.softMuted,
    marginBottom: 7,
  },
  spanRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  spanFrom: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.primary,
    fontFamily: "monospace",
  },
  spanArrow: {
    fontSize: 18,
    fontWeight: "900",
    color: "#CBD5E1",
  },
  spanTo: {
    fontSize: 20,
    fontWeight: "900",
    color: "#4F46E5",
    fontFamily: "monospace",
  },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
  },
  modalCloseText: {
    fontSize: 22,
    color: COLORS.softMuted,
    lineHeight: 24,
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 16,
  },
  previewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  previewCell: {
    width: "47%",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  previewLabel: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: COLORS.softMuted,
  },
  previewValue: {
    marginTop: 4,
    fontSize: 17,
    fontWeight: "900",
    color: COLORS.ink,
  },
  previewSection: {
    gap: 9,
  },
  previewSectionTitle: {
    fontSize: 12,
    fontWeight: "900",
    color: COLORS.ink,
  },
  reasonBox: {
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#FDE68A",
    backgroundColor: "#FFFBEB",
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
  },
  photoChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  photoChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#BBF7D0",
    backgroundColor: "#F0FDF4",
  },
  photoChipText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#047857",
  },
  noPhotoText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.softMuted,
  },
  queuedAt: {
    paddingTop: 2,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.softMuted,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  modalButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 1,
  },
  removeButton: {
    flex: 1,
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  retryButton: {
    flex: 2,
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: "900",
  },
});
