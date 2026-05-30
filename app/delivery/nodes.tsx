import { useAuth } from "@/context/auth-context";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getNodes, SkycableNode } from "@/services/skycable";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, Layers, MapPin, RefreshCw } from "lucide-react-native";
// Layers kept for empty state icon
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G       = "#006241";
const G_LIGHT = "#ECFDF5";
const SLATE   = "#111827";
const MUTED   = "#667085";
const BORDER  = "#E7ECF2";
const WHITE   = "#FFFFFF";
const BG      = "#F4F8F5";

const STATUS_COLOR: Record<string, string> = {
  pending:     "#F59E0B",
  in_progress: "#3B82F6",
  completed:   "#059669",
};
const STATUS_LABEL: Record<string, string> = {
  pending:     "Pending",
  in_progress: "In Progress",
  completed:   "Completed",
};

// ── Node card ─────────────────────────────────────────────────────────────────
function NodeCard({ node, onPress }: { node: SkycableNode; onPress: () => void }) {
  const color    = STATUS_COLOR[node.status] ?? MUTED;
  const label    = STATUS_LABEL[node.status] ?? node.status;
  const progress = node.progress_percentage != null ? Math.min(100, Math.max(0, Number(node.progress_percentage))) : null;
  const isCompleted = node.status === "completed";

  return (
    <TouchableOpacity style={[c.card, isCompleted && { borderColor: "#05966930" }]} onPress={onPress} activeOpacity={0.78}>
      {/* Main content */}
      <View style={c.body}>
        {/* Name row */}
        <View style={c.nameRow}>
          <Text style={c.name} numberOfLines={1}>{node.name}</Text>
          <View style={[c.statusPill, { backgroundColor: color + "15", borderColor: color + "40" }]}>
            <View style={[c.dot, { backgroundColor: color }]} />
            <Text style={[c.statusTxt, { color }]}>{label}</Text>
          </View>
        </View>

        {/* Location */}
        {(node.city || node.barangay_name) ? (
          <View style={c.locRow}>
            <MapPin size={10} color={MUTED} />
            <Text style={c.loc} numberOfLines={1}>
              {[node.barangay_name, node.city].filter(Boolean).join(", ")}
            </Text>
          </View>
        ) : null}

        {/* Progress bar */}
        {progress !== null && (
          <View style={c.progressWrap}>
            <View style={c.progressTrack}>
              <View style={[c.progressFill, { width: `${progress}%` as any, backgroundColor: color }]} />
            </View>
            <Text style={[c.progressTxt, { color }]}>{Math.round(progress)}%</Text>
          </View>
        )}

        {/* Footer metadata */}
        <View style={c.meta}>
          {node.poles_count != null && (
            <Text style={c.metaTxt}>{node.poles_count} pole{node.poles_count !== 1 ? "s" : ""}</Text>
          )}
          {node.team && (
            <Text style={c.metaTxt} numberOfLines={1}>· {node.team.name}</Text>
          )}
        </View>
      </View>

      <ChevronRight size={15} color={color} style={{ opacity: 0.6 }} />
    </TouchableOpacity>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DeliveryNodesScreen() {
  const router = useRouter();
  const { token, user } = useAuth();
  const teamId = (user as any)?.team_id ?? null;
  const { areaId, areaName } = useLocalSearchParams<{ areaId: string; areaName: string }>();
  const decodedArea = areaName ? decodeURIComponent(areaName) : "Site";

  const [nodes,      setNodes]      = useState<SkycableNode[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    const idNum    = Number(areaId);
    const teamKey  = teamId ? `sitemap_nodes_${areaId}_team_${teamId}` : null;
    const plainKey = `sitemap_nodes_${areaId}`;

    let cached: SkycableNode[] | null = null;
    if (teamKey) cached = await cacheGet<SkycableNode[]>(teamKey).catch(() => null);
    if (!cached?.length) cached = await cacheGet<SkycableNode[]>(plainKey).catch(() => null);

    if (cached?.length && !force) { setNodes(cached); setLoading(false); setRefreshing(false); return; }
    if (cached?.length) setNodes(cached);

    if (token) {
      try {
        const res   = await getNodes(idNum, token, teamId);
        const fresh = res.data ?? [];
        setNodes(fresh);
        await cacheSet(plainKey, fresh);
        if (teamKey) await cacheSet(teamKey, fresh);
      } catch {}
    }

    setLoading(false);
    setRefreshing(false);
  }, [areaId, token, teamId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pendingDeliveries = nodes.filter(n => n.status === "in_progress").length;
  const approvedCount     = nodes.filter(n => n.status === "completed").length;
  const declinedCount     = 0; // populated from receipt data when available

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
            <Text style={s.title} numberOfLines={1}>{decodedArea}</Text>
            <Text style={s.subtitle}>Select a node to view deliveries</Text>
          </View>
          <TouchableOpacity style={s.refreshBtn} onPress={() => { setRefreshing(true); load(true); }}>
            <RefreshCw size={15} color={G} />
          </TouchableOpacity>
        </View>

        {/* Summary bar */}
        {nodes.length > 0 && (
          <View style={s.summaryBar}>
            <View style={s.summaryChip}>
              <Text style={[s.summaryNum, { color: "#F59E0B" }]}>{pendingDeliveries}</Text>
              <Text style={s.summaryLbl}>Pending</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryChip}>
              <Text style={[s.summaryNum, { color: "#EF4444" }]}>{declinedCount}</Text>
              <Text style={s.summaryLbl}>Declined</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryChip}>
              <Text style={[s.summaryNum, { color: "#059669" }]}>{approvedCount}</Text>
              <Text style={s.summaryLbl}>Approved</Text>
            </View>
          </View>
        )}

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={G} /></View>
        ) : (
          <FlatList
            data={nodes}
            keyExtractor={(n) => String(n.id)}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); load(true); }}
                colors={[G]} tintColor={G}
              />
            }
            ListEmptyComponent={
              <View style={s.empty}>
                <View style={s.emptyIcon}><Layers size={32} color={G} /></View>
                <Text style={s.emptyTitle}>No nodes found</Text>
                <Text style={s.emptySub}>Pull down to refresh, or run Sync All from Profile to download nodes for this site.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <NodeCard
                node={item}
                onPress={() =>
                  router.push({
                    pathname: "/delivery/node-detail" as any,
                    params: {
                      nodeId:   String(item.id),
                      nodeName: encodeURIComponent(item.name),
                    },
                  })
                }
              />
            )}
          />
        )}
      </SafeAreaView>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: BG },
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: BG, gap: 8 },
  backBtn:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  refreshBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: G_LIGHT },
  headerText:   { flex: 1 },
  title:        { fontSize: 20, fontWeight: "900", color: SLATE, letterSpacing: -0.3 },
  subtitle:     { fontSize: 11, color: MUTED, fontWeight: "600", marginTop: 1 },
  summaryBar:   { flexDirection: "row", marginHorizontal: 16, marginBottom: 12, backgroundColor: WHITE, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingVertical: 10, paddingHorizontal: 6 },
  summaryChip:  { flex: 1, alignItems: "center", gap: 2 },
  summaryNum:   { fontSize: 18, fontWeight: "900", color: SLATE },
  summaryLbl:   { fontSize: 9, fontWeight: "700", color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  summaryDivider: { width: 1, backgroundColor: BORDER, marginVertical: 2 },
  center:       { flex: 1, alignItems: "center", justifyContent: "center" },
  list:         { paddingHorizontal: 16, paddingBottom: 48, gap: 10 },
  empty:        { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyIcon:    { width: 72, height: 72, borderRadius: 36, backgroundColor: G_LIGHT, alignItems: "center", justifyContent: "center" },
  emptyTitle:   { fontSize: 16, fontWeight: "800", color: SLATE },
  emptySub:     { fontSize: 12, color: MUTED, fontWeight: "500", textAlign: "center", paddingHorizontal: 32 },
});

const c = StyleSheet.create({
  card:         { flexDirection: "row", alignItems: "center", backgroundColor: WHITE, borderRadius: 18, borderWidth: 1.5, borderColor: BORDER, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2, paddingRight: 14 },
  body:         { flex: 1, paddingVertical: 14, paddingHorizontal: 12, gap: 5 },
  nameRow:      { flexDirection: "row", alignItems: "center", gap: 8 },
  name:         { flex: 1, fontSize: 15, fontWeight: "900", color: SLATE },
  statusPill:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  dot:          { width: 6, height: 6, borderRadius: 3 },
  statusTxt:    { fontSize: 9, fontWeight: "900", letterSpacing: 0.3 },
  locRow:       { flexDirection: "row", alignItems: "center", gap: 4 },
  loc:          { fontSize: 11, color: MUTED, fontWeight: "600", flex: 1 },
  progressWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  progressTrack:{ flex: 1, height: 4, backgroundColor: BORDER, borderRadius: 99, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 99 },
  progressTxt:  { fontSize: 10, fontWeight: "900", minWidth: 32, textAlign: "right" },
  meta:         { flexDirection: "row", gap: 4 },
  metaTxt:      { fontSize: 10, color: MUTED, fontWeight: "700" },
});
