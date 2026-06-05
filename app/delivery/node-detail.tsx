import api from "@/lib/api";
import * as Location from "expo-location";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getBridgeToken } from "@/lib/token-bridge";
import { simpleQueuePush } from "@/lib/simple-queue";
import {
  calcDeliveryTotals,
  createWarehouseReceipt,
  getWarehouses,
  getWarehouseReceipts,
  totalsToReceiptItems,
  type TeardownLog,
  type Warehouse,
  type WarehouseReceipt,
} from "@/services/skycable";
import { useAuth } from "@/context/auth-context";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronLeft,
  RefreshCw,
  Send,
  Truck,
  PackageCheck,
  Warehouse as WarehouseIcon,
} from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Modal,
  PanResponder,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G = "#006241";
const G_LIGHT = "#ECFDF5";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";
const WHITE = "#FFFFFF";
const G_DARK = "#004d30";

const { height: DEVICE_H } = Dimensions.get("window");
const SHEET_COLLAPSED = DEVICE_H * 0.50;
const SHEET_EXPANDED  = 0;

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Delivery progress steps ────────────────────────────────────────────────────
function DeliverySteps({ collected, submitted, approved }: {
  collected: boolean; submitted: boolean; approved: boolean;
}) {
  const steps = [
    { label: "Collected", done: collected },
    { label: "Submitted", done: submitted },
    { label: "Approved",  done: approved  },
  ];
  return (
    <View style={ps.row}>
      {steps.map((step, i) => (
        <View key={step.label} style={ps.stepWrap}>
          {i > 0 && <View style={[ps.line, steps[i - 1].done && { backgroundColor: WHITE }]} />}
          <View style={[ps.dot, step.done && ps.dotDone]}>
            {step.done && <View style={ps.dotInner} />}
          </View>
          <Text style={[ps.lbl, step.done && ps.lblDone]}>{step.label}</Text>
        </View>
      ))}
    </View>
  );
}

function todayPHT() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function phtDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function fmtDate(d: string) {
  const [, m, day] = d.split("-").map(Number);
  return `${MONTHS[m - 1]} ${day}`;
}


function chainRef(nodeId: string, date: string) {
  let h = 0;
  for (const c of `${nodeId}-${date}`) h = (Math.imul(31, h) + c.charCodeAt(0)) >>> 0;
  return `0x${h.toString(16).padStart(8, "0").toUpperCase()}`;
}

const RECEIPT_COLOR: Record<string, string> = {
  pending:  "#f59e0b",
  approved: "#059669",
  rejected: "#ef4444",
};
const RECEIPT_LABEL: Record<string, string> = {
  pending:  "Pending for Delivery",
  approved: "Approved ✓",
  rejected: "Rejected",
};

// ── Stat chips ────────────────────────────────────────────────────────────────
function StatChip({ label, value, unit, color }: {
  label: string; value: number; unit?: string; color: string;
}) {
  return (
    <View style={[sc.chip, { borderColor: color + "30" }]}>
      <Text style={[sc.val, { color }]}>{value}{unit ?? ""}</Text>
      <Text style={sc.lbl}>{label}</Text>
    </View>
  );
}

// ── Date block ────────────────────────────────────────────────────────────────
function DateBlock({
  date, logs, receipt, nodeId, nodeName,
  isFirst, isLast, isToday, onSubmit, submitting, canSubmit, canStartInventory,
}: {
  date: string;
  logs: TeardownLog[];
  receipt: WarehouseReceipt | null;
  nodeId: string;
  nodeName: string;
  isFirst: boolean;
  isLast: boolean;
  isToday: boolean;
  onSubmit: (date: string, logs: TeardownLog[]) => void;
  submitting: string | null;
  canSubmit: boolean;
  canStartInventory: boolean;
}) {
  const router = useRouter();
  const totals = useMemo(() => calcDeliveryTotals(logs), [logs]);
  const isSubmitting = submitting === date;

  const rcColor = receipt ? (RECEIPT_COLOR[receipt.status] ?? MUTED) : null;
  const rcLabel = receipt ? (RECEIPT_LABEL[receipt.status] ?? receipt.status) : null;

  // Team name from the day's teardown logs (first one that has it)
  const teamName = logs.find(l => l.team?.name)?.team?.name ?? null;

  function openSpans() {
    router.push({
      pathname: "/delivery/date-spans",
      params: { nodeId, nodeName: encodeURIComponent(nodeName), date },
    });
  }

  return (
    <View style={bl.wrapper}>
      {!isFirst && <View style={bl.chainLine} />}

      <View style={[bl.card, isToday && { borderColor: G + "55" }]}>
        {/* Header — tappable, navigates to span detail */}
        <TouchableOpacity style={bl.header} onPress={openSpans} activeOpacity={0.75}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={bl.dateLabel}>
                {isToday ? "Today — " : ""}{fmtDate(date)}, {date.slice(0, 4)}
              </Text>
              {isToday && (
                <View style={bl.todayBadge}><Text style={bl.todayTxt}>LIVE</Text></View>
              )}
            </View>
            <Text style={bl.chainHash}>{chainRef(nodeId, date)}</Text>
          </View>

          <Text style={bl.teardownCount}>{logs.length} span{logs.length !== 1 ? "s" : ""}</Text>
        </TouchableOpacity>

        <View style={bl.divider} />

        {/* Collected totals — 7 in one row */}
        <View style={bl.statsGrid}>
          <StatChip label="Cable"  value={totals.cable}     unit="m" color="#059669" />
          <StatChip label="Node"   value={totals.node}           color="#0b6cff" />
          <StatChip label="Amp"    value={totals.amplifier}      color="#8b5cf6" />
          <StatChip label="Ext"    value={totals.extender}       color="#10b981" />
          <StatChip label="TSC"    value={totals.tsc}            color="#f59e0b" />
          <StatChip label="PSU"    value={totals.psu}            color="#ef4444" />
          <StatChip label="Case"   value={totals.psuCase}        color="#64748b" />
        </View>

        {/* Receipt status OR submit button */}
        {receipt ? (
          <View style={bl.receiptWrap}>
            {/* Pill button — centred, unclickable */}
            <View style={[bl.receiptBtn, { backgroundColor: (rcColor ?? G) + "18", borderColor: rcColor ?? G }]}>
              <View style={[bl.receiptDot, { backgroundColor: rcColor ?? G }]} />
              <Text style={[bl.receiptStatus, { color: rcColor ?? G }]}>{rcLabel}</Text>
            </View>
            {/* Start Inventory button — only for warehouse in-charge on pending receipts */}
            {receipt.status === "pending" && canStartInventory && (
              <TouchableOpacity
                style={bl.inventoryBtn}
                onPress={() => router.push({
                  pathname: "/delivery/inventory-check",
                  params: { receiptId: String(receipt.id), nodeId, nodeName: encodeURIComponent(nodeName) },
                })}
                activeOpacity={0.85}
              >
                <Text style={bl.inventoryTxt}>Start Inventory</Text>
              </TouchableOpacity>
            )}
            {/* Who submitted + team */}
            <View style={bl.receiptMeta}>
              {receipt.receivedBy && (
                <View style={bl.metaRow}>
                  <Text style={bl.metaIcon}>👤</Text>
                  <Text style={bl.metaTxt}>{receipt.receivedBy.name}</Text>
                </View>
              )}
              {teamName && (
                <View style={bl.metaRow}>
                  <Text style={bl.metaIcon}>🏗️</Text>
                  <Text style={bl.metaTxt}>{teamName}</Text>
                </View>
              )}
              {receipt.approvedBy && (
                <View style={bl.metaRow}>
                  <Text style={bl.metaIcon}>✅</Text>
                  <Text style={bl.metaTxt}>Approved by {receipt.approvedBy.name}</Text>
                </View>
              )}
            </View>
          </View>
        ) : logs.length > 0 && canSubmit ? (
          <TouchableOpacity
            style={[bl.submitBtn, isSubmitting && { opacity: 0.6 }]}
            onPress={() => onSubmit(date, logs)}
            disabled={isSubmitting}
            activeOpacity={0.85}
          >
            {isSubmitting
              ? <ActivityIndicator size="small" color={WHITE} />
              : <Send size={13} color={WHITE} />}
            <Text style={bl.submitTxt}>
              {isSubmitting ? "Submitting…" : "Submit to Warehouse"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {isLast && <View style={bl.chainLineLast} />}
    </View>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function NodeDeliveryDetail() {
  const router = useRouter();
  const { user } = useAuth();
  const role = String((user as any)?.role ?? "").toLowerCase();
  const canSubmit = ["warehouse", "admin", "executive", "exec", "project_manager"]
    .some(r => role.includes(r));
  const canStartInventory = role.includes("warehouse") && !!(user as any)?.can_approve_delivery;

  const { nodeId, nodeName } = useLocalSearchParams<{ nodeId: string; nodeName: string }>();
  const today = todayPHT();
  const decodedName = nodeName ? decodeURIComponent(nodeName) : `Node #${nodeId}`;
  const cacheKey     = `delivery_node_logs_${nodeId}_v2`;
  const receiptsCKey = `delivery_receipts_${nodeId}_v1`;

  const [logs,       setLogs]       = useState<TeardownLog[]>([]);
  const [receipts,   setReceipts]   = useState<WarehouseReceipt[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [whPicker,   setWhPicker]   = useState(false); // warehouse picker modal
  const [pendingSubmit, setPendingSubmit] = useState<{ date: string; logs: TeardownLog[] } | null>(null);
  const lastFetchRef = useRef(0);

  const loadData = useCallback(async () => {
    const [cached, cachedReceipts] = await Promise.all([
      cacheGet<TeardownLog[]>(cacheKey),
      cacheGet<WarehouseReceipt[]>(receiptsCKey),
    ]);
    if (cached)         { setLogs(cached);     setLoading(false); }
    if (cachedReceipts) { setReceipts(cachedReceipts); }

    try {
      const authToken = getBridgeToken() ?? "";

      const [tr, wr] = await Promise.allSettled([
        api.get(`/skycable/teardowns?node_id=${nodeId}&per_page=500`),
        // Warehouses — needed to know where to submit receipts
        authToken ? getWarehouses(authToken) : Promise.resolve([]),
      ]);

      if (tr.status === "fulfilled") {
        const raw = tr.value?.data;
        const all: TeardownLog[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
        setLogs(all);
        await cacheSet(cacheKey, all);
      }

      if (wr.status === "fulfilled" && Array.isArray(wr.value)) {
        const whs = wr.value as Warehouse[];
        setWarehouses(whs);

        // Fetch receipts for all warehouses, filter by node_id client-side
        if (authToken && whs.length > 0) {
          const allReceipts: WarehouseReceipt[] = [];
          await Promise.allSettled(
            whs.map(async (wh) => {
              const recs = await getWarehouseReceipts(authToken, wh.id);
              allReceipts.push(...recs.filter(r => r.node_id === Number(nodeId)));
            })
          );
          setReceipts(allReceipts);
          await cacheSet(receiptsCKey, allReceipts);
        }
      }
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
      lastFetchRef.current = Date.now();
    }
  }, [nodeId, cacheKey]);

  useFocusEffect(useCallback(() => {
    if (Date.now() - lastFetchRef.current < 30_000 && logs.length > 0) return;
    loadData();
  }, [loadData, logs.length]));

  // Group logs by PHT date, newest first, always include today
  const dateGroups = useMemo(() => {
    const map: Record<string, TeardownLog[]> = {};
    for (const log of logs) {
      const ts = log.end_time || log.start_time || (log as any).created_at;
      if (!ts) continue;
      const d = phtDate(ts);
      if (!map[d]) map[d] = [];
      map[d].push(log);
    }
    if (!map[today]) map[today] = [];
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [logs, today]);

  // Match receipt to date by receipt_date field (set to the teardown date when submitted)
  const receiptByDate = useMemo(() => {
    const out: Record<string, WarehouseReceipt> = {};
    for (const r of receipts) {
      if (r.receipt_date && !out[r.receipt_date]) out[r.receipt_date] = r;
    }
    return out;
  }, [receipts]);

  const totalBlocks = dateGroups.length;

  // Grand total across ALL dates for this node
  const grandTotals = useMemo(() => calcDeliveryTotals(logs), [logs]);

  const approvedCount  = receipts.filter(r => r.status === "approved").length;
  const pendingCount   = receipts.filter(r => r.status === "pending").length;

  async function doSubmit(date: string, pendingLogs: TeardownLog[], warehouseId: number) {
    setSubmitting(date);
    setWhPicker(false);
    setPendingSubmit(null);
    try {
      const totals = calcDeliveryTotals(pendingLogs);
      const items  = totalsToReceiptItems(totals);

      if (items.length === 0) {
        Alert.alert("Nothing to Submit", "No collected quantities recorded for this date.");
        return;
      }

      const authToken = getBridgeToken() ?? "";
      try {
        // One-time GPS ping — best-effort, doesn't block submission
        let submitted_lat: number | null = null;
        let submitted_lng: number | null = null;
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === "granted") {
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            submitted_lat = pos.coords.latitude;
            submitted_lng = pos.coords.longitude;
          }
        } catch {}

        const teardown_local_ids = pendingLogs
          .map(l => l.local_id)
          .filter((id): id is string => !!id);

        const rec = await createWarehouseReceipt(authToken, {
          warehouse_id: warehouseId,
          node_id:      Number(nodeId),
          receipt_date: date,
          items,
          submitted_lat,
          submitted_lng,
          teardown_local_ids: teardown_local_ids.length ? teardown_local_ids : undefined,
        });
        setReceipts(prev => {
          const next = [rec, ...prev];
          cacheSet(receiptsCKey, next);
          return next;
        });
        Alert.alert(
          "📦 Pending for Delivery",
          "Receipt submitted. Warehouse in-charge will review and approve before it goes to stock.",
          [{ text: "Got it", style: "default" }]
        );
      } catch (err: any) {
        if (!err?.response?.status) {
          // Offline — queue for retry
          await simpleQueuePush({
            method: "post",
            url: "/skycable/warehouse-receipts",
            body: { warehouse_id: warehouseId, node_id: Number(nodeId), receipt_date: date, items },
          });
          Alert.alert("📶 Queued Offline", "Will sync when back online.");
        } else {
          throw err;
        }
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Submit failed.");
    } finally {
      setSubmitting(null);
    }
  }

  function handleSubmit(date: string, pendingLogs: TeardownLog[]) {
    if (!pendingLogs.length) return;
    if (receiptByDate[date]) return; // already submitted
    if (warehouses.length === 0) {
      Alert.alert("No Warehouse", "No warehouse is configured. Ask your admin to set one up.");
      return;
    }
    if (warehouses.length === 1) {
      doSubmit(date, pendingLogs, warehouses[0].id);
    } else {
      // Multiple warehouses — show picker
      setPendingSubmit({ date, logs: pendingLogs });
      setWhPicker(true);
    }
  }

  // ── Bottom sheet animation ─────────────────────────────────────────────────
  const sheetY   = useRef(new Animated.Value(SHEET_COLLAPSED)).current;
  const sheetCur = useRef(SHEET_COLLAPSED);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: (_, { dy }) => Math.abs(dy) > 4,
    onMoveShouldSetPanResponder:  (_, { dy }) => Math.abs(dy) > 4,
    onPanResponderMove: (_, { dy }) => {
      const next = Math.max(SHEET_EXPANDED, Math.min(SHEET_COLLAPSED, sheetCur.current + dy));
      sheetY.setValue(next);
    },
    onPanResponderRelease: (_, { dy, vy }) => {
      const expand = vy < -0.4 || (vy <= 0.4 && dy < -60);
      const target = expand ? SHEET_EXPANDED : SHEET_COLLAPSED;
      sheetCur.current = target;
      Animated.spring(sheetY, { toValue: target, useNativeDriver: false, tension: 55, friction: 9 }).start();
    },
  })).current;

  const TOTALS = [
    { label: "Cable", value: grandTotals.cable,     unit: "m",  color: "#059669" },
    { label: "Node",  value: grandTotals.node,      unit: "",   color: "#0b6cff" },
    { label: "Amp",   value: grandTotals.amplifier, unit: "",   color: "#8b5cf6" },
    { label: "Ext",   value: grandTotals.extender,  unit: "",   color: "#10b981" },
    { label: "TSC",   value: grandTotals.tsc,       unit: "",   color: "#f59e0b" },
    { label: "PSU",   value: grandTotals.psu,       unit: "",   color: "#ef4444" },
    { label: "Case",  value: grandTotals.psuCase,   unit: "",   color: "#64748b" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: G_DARK }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Green hero area ── */}
      <SafeAreaView edges={["top"]} style={s.hero}>
        {/* Nav row */}
        <View style={s.navRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.navBtn}>
            <ChevronLeft size={22} color={WHITE} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setRefreshing(true); loadData(); }} style={s.navBtn}>
            <RefreshCw size={18} color={WHITE} style={refreshing ? { opacity: 0.4 } : undefined} />
          </TouchableOpacity>
        </View>

        {/* Truck + node identity */}
        <View style={s.heroCenter}>
          <View style={s.truckWrap}>
            <Truck size={36} color={WHITE} />
          </View>
          <Text style={s.nodeName} numberOfLines={1}>{decodedName}</Text>
          <Text style={s.nodeSubtitle}>
            {logs.length} teardown{logs.length !== 1 ? "s" : ""} · {totalBlocks} day{totalBlocks !== 1 ? "s" : ""}
          </Text>
        </View>

        {/* Progress steps */}
        <DeliverySteps
          collected={logs.length > 0}
          submitted={receipts.length > 0}
          approved={approvedCount > 0}
        />

        {/* Grand totals chips */}
        {logs.length > 0 && (
          <View style={s.totalsRow}>
            {TOTALS.map(({ label, value, unit, color }) => (
              <View key={label} style={s.totalChip}>
                <Text style={[s.totalVal, { color }]}>{value}{unit}</Text>
                <Text style={s.totalLbl}>{label}</Text>
              </View>
            ))}
          </View>
        )}
      </SafeAreaView>

      {/* ── Sliding bottom sheet ── */}
      <Animated.View style={[s.sheet, { transform: [{ translateY: sheetY }] }]}>
        {/* Drag handle */}
        <View style={s.handleArea} {...panResponder.panHandlers}>
          <View style={s.handle} />
          <View style={s.sheetTitleRow}>
            <View style={s.sheetIcon}><WarehouseIcon size={14} color={G} /></View>
            <Text style={s.sheetTitle}>Delivery Days</Text>
            <View style={s.pillsWrap}>
              {approvedCount > 0 && (
                <View style={[s.miniPill, { backgroundColor: "#05966920" }]}>
                  <Text style={[s.miniPillTxt, { color: "#059669" }]}>{approvedCount} ✓</Text>
                </View>
              )}
              {pendingCount > 0 && (
                <View style={[s.miniPill, { backgroundColor: "#f59e0b20" }]}>
                  <Text style={[s.miniPillTxt, { color: "#f59e0b" }]}>{pendingCount} pending</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {loading && logs.length === 0 ? (
          <View style={s.center}><ActivityIndicator size="large" color={G} /></View>
        ) : (
          <FlatList
            data={dateGroups}
            keyExtractor={([date]) => date}
            extraData={receiptByDate}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); loadData(); }}
                colors={[G]} tintColor={G}
              />
            }
            renderItem={({ item: [date, dateLogs], index }) => (
              <DateBlock
                date={date}
                logs={dateLogs}
                receipt={receiptByDate[date] ?? null}
                nodeId={nodeId ?? ""}
                nodeName={decodedName}
                isFirst={index === 0}
                isLast={index === totalBlocks - 1}
                isToday={date === today}
                onSubmit={handleSubmit}
                submitting={submitting}
                canSubmit={canSubmit}
                canStartInventory={canStartInventory}
              />
            )}
            ListEmptyComponent={
              <View style={s.empty}>
                <PackageCheck size={48} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No teardowns yet</Text>
                <Text style={s.emptySub}>Complete teardown spans on this node — they will appear here by date.</Text>
              </View>
            }
          />
        )}
      </Animated.View>

      {/* Warehouse picker modal (only shown when >1 warehouse) */}
      <Modal visible={whPicker} transparent animationType="slide" onRequestClose={() => setWhPicker(false)}>
        <View style={mp.overlay}>
          <View style={mp.sheet}>
            <Text style={mp.title}>Select Warehouse</Text>
            <Text style={mp.sub}>Choose where to submit this receipt</Text>
            {warehouses.map(wh => (
              <TouchableOpacity
                key={wh.id}
                style={mp.option}
                onPress={() => pendingSubmit && doSubmit(pendingSubmit.date, pendingSubmit.logs, wh.id)}
              >
                <Text style={mp.optionName}>{wh.name}</Text>
                {wh.location ? <Text style={mp.optionLoc}>{wh.location}</Text> : null}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={mp.cancel} onPress={() => setWhPicker(false)}>
              <Text style={mp.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // hero header (green zone)
  hero:         { paddingHorizontal: 16, paddingBottom: 20 },
  navRow:       { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  navBtn:       { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  heroCenter:   { alignItems: "center", marginBottom: 18 },
  truckWrap:    { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  nodeName:     { fontSize: 22, fontWeight: "900", color: WHITE, textAlign: "center" },
  nodeSubtitle: { fontSize: 12, color: "rgba(255,255,255,0.7)", fontWeight: "600", marginTop: 3 },
  totalsRow:    { flexDirection: "row", gap: 4, marginTop: 14 },
  totalChip:    { flex: 1, backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 10, paddingVertical: 6, alignItems: "center" },
  totalVal:     { fontSize: 11, fontWeight: "900", color: WHITE },
  totalLbl:     { fontSize: 7, fontWeight: "700", color: "rgba(255,255,255,0.65)", marginTop: 1, textTransform: "uppercase" },
  // bottom sheet
  sheet:        { position: "absolute", left: 0, right: 0, top: 0, height: DEVICE_H, backgroundColor: WHITE, borderTopLeftRadius: 28, borderTopRightRadius: 28, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 20, elevation: 10 },
  handleArea:   { paddingTop: 10, paddingBottom: 8, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: BORDER },
  handle:       { width: 40, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", alignSelf: "center", marginBottom: 10 },
  sheetTitleRow:{ flexDirection: "row", alignItems: "center", gap: 8 },
  sheetIcon:    { width: 28, height: 28, borderRadius: 8, backgroundColor: G_LIGHT, alignItems: "center", justifyContent: "center" },
  sheetTitle:   { fontSize: 15, fontWeight: "900", color: SLATE, flex: 1 },
  pillsWrap:    { flexDirection: "row", gap: 6 },
  miniPill:     { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  miniPillTxt:  { fontSize: 10, fontWeight: "800" },
  center:       { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  list:       { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 56 },
  empty:      { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: SLATE },
  emptySub:   { fontSize: 12, color: MUTED, fontWeight: "500", textAlign: "center", paddingHorizontal: 32 },
});

const ps = StyleSheet.create({
  row:     { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", paddingHorizontal: 8 },
  stepWrap:{ flex: 1, alignItems: "center", position: "relative" },
  line:    { position: "absolute", top: 9, left: "-50%", right: "50%", height: 2, backgroundColor: "rgba(255,255,255,0.3)" },
  dot:     { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "rgba(255,255,255,0.5)", backgroundColor: "transparent", alignItems: "center", justifyContent: "center" },
  dotDone: { borderColor: WHITE, backgroundColor: WHITE },
  dotInner:{ width: 8, height: 8, borderRadius: 4, backgroundColor: G },
  lbl:     { fontSize: 9, fontWeight: "700", color: "rgba(255,255,255,0.55)", marginTop: 5, textAlign: "center" },
  lblDone: { color: WHITE },
});

const bl = StyleSheet.create({
  wrapper:        { },
  chainLine:      { width: 2, height: 18, backgroundColor: G + "55", alignSelf: "center" },
  chainLineLast:  { width: 2, height: 12, backgroundColor: G + "22", alignSelf: "center" },
  card:           { backgroundColor: WHITE, borderRadius: 20, borderWidth: 1.5, borderColor: BORDER, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  header:         { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },

  dateLabel:      { fontSize: 14, fontWeight: "900", color: SLATE },
  chainHash:      { fontSize: 9, fontWeight: "700", color: MUTED, letterSpacing: 0.5, marginTop: 2 },
  todayBadge:     { backgroundColor: G, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  todayTxt:       { fontSize: 8, fontWeight: "900", color: WHITE, letterSpacing: 0.8 },
  teardownCount:  { fontSize: 10, fontWeight: "700", color: MUTED },
  viewSpansTxt:   { fontSize: 9, fontWeight: "700", color: G },
  divider:        { height: 1, backgroundColor: BORDER, marginHorizontal: 14 },
  statsGrid:      { flexDirection: "row", gap: 4, paddingHorizontal: 10, paddingVertical: 12 },
  receiptWrap:    { marginHorizontal: 14, marginBottom: 14, gap: 8 },
  receiptBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 12, borderWidth: 1.5, paddingVertical: 10 },
  receiptDot:     { width: 8, height: 8, borderRadius: 4 },
  receiptStatus:  { fontSize: 13, fontWeight: "900", textAlign: "center" },
  receiptMeta:    { gap: 4 },
  metaRow:        { flexDirection: "row", alignItems: "center", gap: 6 },
  metaIcon:       { fontSize: 11 },
  metaTxt:        { fontSize: 11, fontWeight: "700", color: MUTED },
  submitBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: G, borderRadius: 12, marginHorizontal: 14, marginBottom: 14, paddingVertical: 10 },
  submitTxt:      { fontSize: 13, fontWeight: "900", color: WHITE },
  inventoryBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#f59e0b", borderRadius: 12, paddingVertical: 10 },
  inventoryTxt:   { fontSize: 13, fontWeight: "900", color: WHITE },
});

const sc = StyleSheet.create({
  chip: { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 8, paddingVertical: 5, paddingHorizontal: 2, alignItems: "center", borderWidth: 1 },
  val:  { fontSize: 11, fontWeight: "900" },
  lbl:  { fontSize: 7, fontWeight: "700", color: MUTED, marginTop: 1, textTransform: "uppercase" },
});


const mp = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  sheet:     { backgroundColor: WHITE, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36, gap: 10 },
  title:     { fontSize: 18, fontWeight: "900", color: SLATE },
  sub:       { fontSize: 12, color: MUTED, fontWeight: "600", marginBottom: 6 },
  option:    { backgroundColor: "#F8FAFC", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER },
  optionName:{ fontSize: 15, fontWeight: "800", color: SLATE },
  optionLoc: { fontSize: 11, color: MUTED, fontWeight: "600", marginTop: 2 },
  cancel:    { alignItems: "center", paddingVertical: 12 },
  cancelTxt: { fontSize: 14, fontWeight: "700", color: MUTED },
});

