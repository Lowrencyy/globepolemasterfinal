import { useAuth } from "@/context/auth-context";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getTileUri, networkUrl } from "@/lib/tile-cache";
import { getNodes, SkycableNode, SkycablePole } from "@/services/skycable";
import { shouldRefresh, markSynced, lockSync, unlockSync } from "@/lib/sync-guard";

function TileImage({ z, y, x, style }: { z: number; y: number; x: number; style: any }) {
  const [uri, setUri] = useState(() => networkUrl(z, y, x));
  useEffect(() => { getTileUri(z, y, x).then(setUri); }, [z, y, x]);
  return <Image source={{ uri }} style={style} resizeMode="cover" />;
}
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { CalendarCheck2, CalendarClock, ChevronLeft, Layers, Search, X } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, FlatList, Image, LayoutChangeEvent, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const TILE_PX = 256;
function latLngToTileFrac(lat: number, lng: number, z: number) {
  const n = Math.pow(2, z);
  const xFrac = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { xFrac, yFrac, tileX: Math.floor(xFrac), tileY: Math.floor(yFrac) };
}

function PolesVicinityMap({ locs }: { locs: { lat: number; lng: number }[] }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => { const { width, height } = e.nativeEvent.layout; setSize({ w: width, h: height }); };

  const minLat = Math.min(...locs.map(p => p.lat));
  const maxLat = Math.max(...locs.map(p => p.lat));
  const minLng = Math.min(...locs.map(p => p.lng));
  const maxLng = Math.max(...locs.map(p => p.lng));
  // Centroid — centers on where poles cluster, not skewed by outliers
  const centerLat = locs.reduce((a, p) => a + p.lat, 0) / locs.length;
  const centerLng = locs.reduce((a, p) => a + p.lng, 0) / locs.length;

  // Compute zoom so bounding box fits in ~55% of container (leaves padding around box)
  const w = size?.w ?? 320;
  const h = size?.h ?? 150;
  const latSpan = Math.max(maxLat - minLat, 0.0005);
  const lngSpan = Math.max(maxLng - minLng, 0.0005);
  // At zoom z: lngSpan degrees = lngSpan * 2^z * 256/360 pixels on screen
  const zLng = Math.log2((w * 0.55 * 360) / (256 * lngSpan));
  const zLat = Math.log2((h * 0.55 * 180) / (256 * latSpan));
  const zoom = Math.max(11, Math.min(17, Math.floor(Math.min(zLng, zLat))));

  const { xFrac, yFrac, tileX, tileY } = latLngToTileFrac(centerLat, centerLng, zoom);
  const fracX = xFrac - tileX; const fracY = yFrac - tileY;
  const scale = size ? Math.max(size.w / TILE_PX, size.h / TILE_PX) : 1;
  const imgW = TILE_PX * scale; const imgH = TILE_PX * scale;
  const offsetX = size ? size.w / 2 - fracX * imgW : 0;
  const offsetY = size ? size.h / 2 - fracY * imgH : 0;

  const tileBase = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tileY}`;

  let boxLeft = 0, boxTop = 0, boxW = 0, boxH = 0;
  if (size && locs.length > 1) {
    const sw = latLngToTileFrac(minLat, minLng, zoom);
    const ne = latLngToTileFrac(maxLat, maxLng, zoom);
    boxLeft = offsetX + (sw.xFrac - tileX) * imgW;
    boxTop = offsetY + (ne.yFrac - tileY) * imgH;
    boxW = (ne.xFrac - sw.xFrac) * imgW;
    boxH = (sw.yFrac - ne.yFrac) * imgH;
  }

  return (
    <View style={StyleSheet.absoluteFillObject} onLayout={onLayout}>
      <TileImage z={zoom} y={tileY} x={tileX - 1} style={{ position: "absolute", left: offsetX - imgW, top: offsetY, width: imgW, height: imgH }} />
      <TileImage z={zoom} y={tileY} x={tileX}     style={{ position: "absolute", left: offsetX,        top: offsetY, width: imgW, height: imgH }} />
      <TileImage z={zoom} y={tileY} x={tileX + 1} style={{ position: "absolute", left: offsetX + imgW, top: offsetY, width: imgW, height: imgH }} />
      {size && locs.length > 1 && (
        <View style={{ position: "absolute", left: boxLeft, top: boxTop, width: boxW, height: boxH, borderWidth: 2.5, borderColor: "#F59E0B", backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 4 }} />
      )}
      {size && locs.map((p, i) => {
        const { xFrac: px, yFrac: py } = latLngToTileFrac(p.lat, p.lng, zoom);
        return (
          <View key={i} style={{ position: "absolute", left: offsetX + (px - tileX) * imgW - 3, top: offsetY + (py - tileY) * imgH - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: "#FFF", borderWidth: 1.5, borderColor: "#F59E0B" }} />
        );
      })}
    </View>
  );
}

const SC: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: "Pending",     color: "#F59E0B", bg: "#FEF3C7" },
  in_progress: { label: "In Progress", color: "#3B82F6", bg: "#DBEAFE" },
  completed:   { label: "Completed",   color: "#10B981", bg: "#DCFCE7" },
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pht = new Date(d.getTime() + 8 * 3600 * 1000);
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][pht.getUTCMonth()];
  return `${mon} ${pht.getUTCDate()}, ${pht.getUTCFullYear()}`;
}

function NodeProgressBar({ pct, color = "#3B82F6" }: { pct: number; color?: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: pct / 100, duration: 600, useNativeDriver: false }).start();
  }, [pct]);
  return (
    <View style={{ flexDirection: "row", height: 6, borderRadius: 999, backgroundColor: "#E2E8F0", overflow: "hidden" }}>
      <Animated.View style={{ flex: anim, backgroundColor: color, borderRadius: 999 }} />
      <Animated.View style={{ flex: Animated.subtract(1, anim) as any }} />
    </View>
  );
}

function NodeCard({ node, onPress }: { node: SkycableNode; onPress: () => void }) {
  const [poleLocs, setPoleLocs]         = useState<{ lat: number; lng: number }[]>([]);
  const [cachedPolesCount, setCachedPolesCount] = useState<number | null>(null);
  const [completedCount, setCompletedCount]     = useState(0);
  const [derivedStatus, setDerivedStatus]       = useState<string>(node.status);

  useEffect(() => {
    cacheGet<SkycablePole[]>(`sitemap_poles_${node.id}`).then(poles => {
      if (!poles?.length) return;
      setCachedPolesCount(poles.length);
      const cleared = poles.filter(p => p.pole?.skycable_status === "cleared").length;
      setCompletedCount(cleared);
      const locs = poles
        .filter(p => p.pole?.lat && p.pole?.lng)
        .map(p => ({ lat: parseFloat(p.pole.lat), lng: parseFloat(p.pole.lng) }));
      setPoleLocs(locs);
      const statuses = poles.map(p => p.pole?.skycable_status ?? "pending");
      const allCleared = statuses.every(s => s === "cleared");
      const anyActive  = statuses.some(s => s === "in_progress" || s === "cleared");
      if (allCleared)   setDerivedStatus("completed");
      else if (anyActive) setDerivedStatus("in_progress");
      else setDerivedStatus("pending");
    });
  }, [node.id]);

  const sc = SC[derivedStatus] || SC.pending;
  const hasMap = poleLocs.length > 0;
  const polesCount = cachedPolesCount ?? node.poles_count ?? 0;
  const progressPct = polesCount > 0 ? Math.round((completedCount / polesCount) * 100) : (node.progress_percentage ?? 0);
  const isActive = !!node.date_start;

  return (
    <TouchableOpacity style={s.cardContainer} activeOpacity={0.8} onPress={onPress}>
      {/* Map hero */}
      <View style={s.heroMapShell}>
        {hasMap ? (
          <PolesVicinityMap locs={poleLocs} />
        ) : (
          <Image source={require("../../assets/images/telcovantage-logo.png")} style={s.noGpsLogo} resizeMode="contain" />
        )}
        {hasMap && (
          <View style={s.mapAreaLabel}>
            <Text style={s.mapAreaLabelText} numberOfLines={1}>{node.barangay_name || node.name}</Text>
          </View>
        )}
      </View>

      {/* Name + status */}
      <View style={s.cardBody}>
        <View style={s.info}>
          <Text style={s.nodeName}>{node.name}</Text>
          {(() => {
            const locText = [node.barangay_name, node.city].filter(Boolean).join(", ");
            if (!locText) return null;
            return <Text style={s.nodeSub} numberOfLines={1}>{locText}</Text>;
          })()}
        </View>
        <View style={[s.badge, { backgroundColor: sc.bg }]}>
          <View style={[s.badgeDot, { backgroundColor: sc.color }]} />
          <Text style={[s.badgeText, { color: sc.color }]}>{sc.label}</Text>
        </View>
      </View>

      {/* Progress bar (only when active or completed) */}
      {(isActive || derivedStatus === "completed") && (
        <View style={s.progressWrap}>
          <View style={s.progressLabelRow}>
            <Text style={s.progressLabel}>{completedCount}/{polesCount} poles</Text>
            <Text style={s.progressPct}>{progressPct}%</Text>
          </View>
          <NodeProgressBar
            pct={progressPct}
            color={derivedStatus === "completed" ? "#10B981" : "#3B82F6"}
          />
        </View>
      )}

      {/* Date chips */}
      {(node.date_start || node.due_date) && (
        <View style={s.datePillsRow}>
          {node.date_start && (
            <View style={s.datePill}>
              <CalendarCheck2 size={11} color="#1D4ED8" />
              <Text style={s.datePillText}>Started {fmtDate(node.date_start)}</Text>
            </View>
          )}
          {node.due_date && (
            <View style={[s.datePill, { backgroundColor: "#FFF7E8", borderColor: "#FED7AA" }]}>
              <CalendarClock size={11} color="#B54708" />
              <Text style={[s.datePillText, { color: "#92400E" }]}>Due {fmtDate(node.due_date)}</Text>
            </View>
          )}
          {node.date_finished && (
            <View style={[s.datePill, { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" }]}>
              <CalendarCheck2 size={11} color="#059669" />
              <Text style={[s.datePillText, { color: "#065F46" }]}>Done {fmtDate(node.date_finished)}</Text>
            </View>
          )}
        </View>
      )}

      {/* Stats row */}
      <View style={s.statsRow}>
        <View style={s.statBox}>
          <Text style={s.statNum}>{polesCount}</Text>
          <Text style={s.statLbl}>Total Poles</Text>
        </View>
        <View style={s.statDivider} />
        <View style={s.statBox}>
          <Text style={[s.statNum, { color: poleLocs.length > 0 ? "#10B981" : "#98A2B3" }]}>
            {cachedPolesCount !== null ? `${poleLocs.length}/${cachedPolesCount}` : "—"}
          </Text>
          <Text style={s.statLbl}>GPS Captured</Text>
        </View>
        <View style={s.statDivider} />
        <View style={s.statBox}>
          <Text style={[s.statNum, { color: "#10B981" }]}>{completedCount}</Text>
          <Text style={s.statLbl}>Completed</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function NodesScreen() {
  const router = useRouter();
  const { token, user } = useAuth();
  const { areaId, areaName } = useLocalSearchParams<{ areaId: string; areaName: string }>();
  const teamId = (user as any)?.team_id ?? null;
  const [search, setSearch] = useState("");
  const [nodes, setNodes] = useState<SkycableNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    async function loadNodes() {
      if (!token || !areaId) return;

      // Team-scoped key is written by the nodes screen itself; plain key is
      // written by the profile "Download Data" sync and downloadSitemapData().
      // Try team-scoped first, fall back to plain so synced data is always found.
      const CACHE_KEY = teamId
        ? `sitemap_nodes_${areaId}_team_${teamId}`
        : `sitemap_nodes_${areaId}`;
      const CACHE_KEY_PLAIN = `sitemap_nodes_${areaId}`;

      let cached = await cacheGet<SkycableNode[]>(CACHE_KEY);
      if (!cached?.length && CACHE_KEY !== CACHE_KEY_PLAIN) {
        cached = await cacheGet<SkycableNode[]>(CACHE_KEY_PLAIN);
      }

      if (cached?.length) setNodes(cached);
      setLoading(false); // Always unblock UI after cache check

      const GUARD_KEY = `nodes_${areaId}_${teamId ?? 0}`;
      const stale = await shouldRefresh(GUARD_KEY, 5 * 60 * 1000);
      if (!stale && cached?.length) return;
      if (!lockSync(GUARD_KEY)) return;
      try {
        const response = await getNodes(Number(areaId), token, teamId);
        setNodes(response.data);
        cacheSet(CACHE_KEY, response.data).catch(() => {});
        await markSynced(GUARD_KEY);
        setOffline(false);
      } catch {
        if (!cached?.length) setOffline(true);
      } finally {
        unlockSync(GUARD_KEY);
      }
    }
    loadNodes();
  }, [token, areaId, teamId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? nodes.filter(n => n.name.toLowerCase().includes(q)) : nodes;
  }, [search, nodes]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" backgroundColor="#F4F6F8" />
      <SafeAreaView style={s.container}>
        <View style={s.floatingHeader}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color="#111827" />
          </TouchableOpacity>
          <View style={s.floatingHeaderText}>
            <Text style={s.headerTitle}>Nodes</Text>
            <Text style={s.headerSub}>{areaName || "Sitemap Area"}</Text>
          </View>
        </View>

        <View style={s.searchWrap}>
          <View style={s.searchBox}>
            <Search size={18} color="#98A2B3" />
            <TextInput style={s.searchInput} placeholder="Search nodes…" placeholderTextColor="#98A2B3" value={search} onChangeText={setSearch} autoCapitalize="none" />
            {!!search && <TouchableOpacity onPress={() => setSearch("")}><X size={16} color="#98A2B3" /></TouchableOpacity>}
          </View>
          <Text style={s.count}>{filtered.length} node{filtered.length !== 1 ? "s" : ""}</Text>
        </View>

        {loading ? (
          <View style={s.empty}><ActivityIndicator size="large" color="#0B7A5A" /><Text style={s.emptyTitle}>Loading Nodes...</Text></View>
        ) : offline ? (
          <View style={s.empty}><Layers size={40} color="#F59E0B" /><Text style={s.emptyTitle}>No offline data</Text><Text style={s.emptySub}>Connect once to cache nodes for offline use.</Text></View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={i => String(i.id)}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<View style={s.empty}><Layers size={40} color="#D0D5DD" /><Text style={s.emptyTitle}>No nodes found</Text></View>}
            renderItem={({ item: node }) => (
              <NodeCard
                key={node.id}
                node={node}
                onPress={() => router.push({ pathname: "/teardowns/poles", params: { nodeId: node.id, nodeName: node.name, nodeTeamId: node.team_id ?? node.team?.id ?? "", reportType: node.report_type ?? "" } })}
              />
            )}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F6F8" },
  floatingHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12, backgroundColor: "#F4F6F8", zIndex: 20 },
  backBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2", alignItems: "center", justifyContent: "center", shadowColor: "#101828", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  floatingHeaderText: { flex: 1 },
  headerTitle: { fontSize: 19, fontWeight: "900", color: "#111827" },
  headerSub: { marginTop: 2, fontSize: 12, color: "#667085", fontWeight: "600" },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 10 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFFFFF", borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: "#E7ECF2", shadowColor: "#101828", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  searchInput: { flex: 1, fontSize: 14, fontWeight: "500", color: "#111827", padding: 0 },
  count: { fontSize: 12, fontWeight: "700", color: "#98A2B3", marginTop: 12, paddingHorizontal: 4 },
  list: { padding: 16, paddingTop: 4, gap: 16, paddingBottom: 40 },
  empty: { alignItems: "center", paddingTop: 80 },
  emptyTitle: { fontSize: 18, fontWeight: "900", color: "#111827", marginTop: 16 },
  emptySub: { fontSize: 13, color: "#98A2B3", fontWeight: "500", marginTop: 8, textAlign: "center", paddingHorizontal: 32 },

  cardContainer: { backgroundColor: "#FFFFFF", borderRadius: 20, marginTop: 42, marginBottom: 8, marginHorizontal: 4, paddingHorizontal: 16, paddingBottom: 16, shadowColor: "#0F172A", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 16, elevation: 4 },
  heroMapShell: { height: 150, backgroundColor: "#F3F4F6", borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 16, overflow: "hidden", marginTop: -28, borderWidth: 2, borderColor: "#E2E8F0" },
  noGpsLogo: { width: "40%", height: "40%", opacity: 0.15 },
  seqBadge: { position: "absolute", top: 10, left: 10, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 3 },
  seqBadgeText: { fontSize: 14, fontWeight: "900", color: "#FFFFFF" },
  mapAreaLabel: { position: "absolute", bottom: 8, left: 10, right: 10, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  mapAreaLabelText: { fontSize: 11, fontWeight: "700", color: "#FFFFFF" },

  cardBody: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14, marginBottom: 14 },
  info: { flex: 1 },
  nodeName: { fontSize: 18, fontWeight: "900", color: "#111827" },
  nodeSub: { fontSize: 12, fontWeight: "600", color: "#667085", marginTop: 2 },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },

  statsRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderRadius: 14, borderWidth: 1, borderColor: "#E7ECF2", paddingVertical: 10 },
  statBox: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 15, fontWeight: "900", color: "#111827" },
  statLbl: { fontSize: 9, fontWeight: "800", color: "#98A2B3", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 3 },
  statDivider: { width: 1, height: 28, backgroundColor: "#E7ECF2" },

  progressWrap: { marginBottom: 10, gap: 5 },
  progressLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressLabel: { fontSize: 11, fontWeight: "700", color: "#64748B" },
  progressPct:   { fontSize: 12, fontWeight: "900", color: "#374151" },

  datePillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  datePill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#EFF6FF", borderWidth: 1, borderColor: "#BFDBFE",
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
  },
  datePillText: { fontSize: 11, fontWeight: "700", color: "#1E3A8A" },
});
