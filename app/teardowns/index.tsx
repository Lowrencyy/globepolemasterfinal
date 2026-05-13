import { useState, useMemo, useEffect } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, StatusBar, Image, LayoutChangeEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { Map, Search, X, ChevronLeft } from "lucide-react-native";
import { getAreas, SkycableArea, SkycableNode, SkycablePole } from "@/services/skycable";
import { useAuth } from "@/context/auth-context";
import { cacheGet, cacheSet } from "@/lib/cache";

// ─── Vicinity Map (reused from nodes.tsx pattern) ─────────────────────────────
const TILE_PX = 256;

function latLngToTileFrac(lat: number, lng: number, z: number) {
  const n = Math.pow(2, z);
  const xFrac = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { xFrac, yFrac, tileX: Math.floor(xFrac), tileY: Math.floor(yFrac) };
}

function VicinityMap({ locs }: { locs: { lat: number; lng: number }[] }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => { const { width, height } = e.nativeEvent.layout; setSize({ w: width, h: height }); };

  const minLat = Math.min(...locs.map(p => p.lat));
  const maxLat = Math.max(...locs.map(p => p.lat));
  const minLng = Math.min(...locs.map(p => p.lng));
  const maxLng = Math.max(...locs.map(p => p.lng));
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  const w = size?.w ?? 320;
  const h = size?.h ?? 150;
  const latSpan = Math.max(maxLat - minLat, 0.0005);
  const lngSpan = Math.max(maxLng - minLng, 0.0005);
  const zLng = Math.log2((w * 0.55 * 360) / (256 * lngSpan));
  const zLat = Math.log2((h * 0.55 * 180) / (256 * latSpan));
  const zoom = Math.max(10, Math.min(16, Math.floor(Math.min(zLng, zLat))));

  const { xFrac, yFrac, tileX, tileY } = latLngToTileFrac(centerLat, centerLng, zoom);
  const fracX = xFrac - tileX; const fracY = yFrac - tileY;
  const tileBase = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tileY}`;

  const scale = size ? Math.max(size.w / TILE_PX, size.h / TILE_PX) : 1;
  const imgW = TILE_PX * scale; const imgH = TILE_PX * scale;
  const offsetX = size ? size.w / 2 - fracX * imgW : 0;
  const offsetY = size ? size.h / 2 - fracY * imgH : 0;

  // Bounding box overlay
  let boxLeft = 0, boxTop = 0, boxW = 0, boxH = 0, showBox = false;
  if (size && latSpan > 0.0005 && lngSpan > 0.0005) {
    const sw = latLngToTileFrac(minLat, minLng, zoom);
    const ne = latLngToTileFrac(maxLat, maxLng, zoom);
    boxLeft = offsetX + (sw.xFrac - tileX) * imgW;
    boxTop  = offsetY + (ne.yFrac - tileY) * imgH;
    boxW = (ne.xFrac - sw.xFrac) * imgW;
    boxH = (sw.yFrac - ne.yFrac) * imgH;
    showBox = boxW > 2 && boxH > 2;
  }

  return (
    <View style={StyleSheet.absoluteFillObject} onLayout={onLayout}>
      <Image source={{ uri: `${tileBase}/${tileX - 1}` }} style={{ position: "absolute", left: offsetX - imgW, top: offsetY, width: imgW, height: imgH }} resizeMode="cover" />
      <Image source={{ uri: `${tileBase}/${tileX}` }} style={{ position: "absolute", left: offsetX, top: offsetY, width: imgW, height: imgH }} resizeMode="cover" />
      <Image source={{ uri: `${tileBase}/${tileX + 1}` }} style={{ position: "absolute", left: offsetX + imgW, top: offsetY, width: imgW, height: imgH }} resizeMode="cover" />
      {/* Pole dots */}
      {size && locs.map((p, i) => {
        const { xFrac: px, yFrac: py } = latLngToTileFrac(p.lat, p.lng, zoom);
        return <View key={i} style={{ position: "absolute", left: offsetX + (px - tileX) * imgW - 3, top: offsetY + (py - tileY) * imgH - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: "#FFF", borderWidth: 1.5, borderColor: "#F59E0B" }} />;
      })}
      {/* Bounding box */}
      {showBox && (
        <View style={{ position: "absolute", left: boxLeft, top: boxTop, width: boxW, height: boxH, borderWidth: 2, borderColor: "#F59E0B", backgroundColor: "rgba(245,158,11,0.10)", borderRadius: 3 }} />
      )}
    </View>
  );
}

// ─── Area Card ──────────────────────────────────────────────────────────────
function AreaCard({ area, onPress }: { area: SkycableArea; onPress: () => void }) {
  const [locs, setLocs] = useState<{ lat: number; lng: number }[]>([]);

  useEffect(() => {
    (async () => {
      const nodes = await cacheGet<SkycableNode[]>(`sitemap_nodes_${area.id}`).catch(() => null);
      if (!nodes?.length) return;
      const allLocs: { lat: number; lng: number }[] = [];
      await Promise.all(
        nodes.map(async (node) => {
          const poles = await cacheGet<SkycablePole[]>(`sitemap_poles_${node.id}`).catch(() => null);
          if (!poles) return;
          poles.forEach(p => {
            if (p.pole?.lat && p.pole?.lng) {
              allLocs.push({ lat: parseFloat(p.pole.lat), lng: parseFloat(p.pole.lng) });
            }
          });
        })
      );
      setLocs(allLocs);
    })();
  }, [area.id]);

  const hasMap = locs.length > 0;

  return (
    <TouchableOpacity style={s.cardContainer} activeOpacity={0.8} onPress={onPress}>
      <View style={s.heroMapShell}>
        {hasMap ? (
          <VicinityMap locs={locs} />
        ) : (
          <Image source={require("../../assets/images/logo.png")} style={s.noGpsLogo} resizeMode="contain" />
        )}
        {hasMap && (
          <View style={s.mapAreaLabel}>
            <Text style={s.mapAreaLabelText} numberOfLines={1}>{area.name}</Text>
          </View>
        )}
      </View>

      <View style={s.cardBody}>
        <View style={s.info}>
          <Text style={s.areaName}>{area.name}</Text>
          <Text style={s.areaSub}>Skycable Site · {area.nodes_count || 0} Nodes</Text>
        </View>
      </View>

      <View style={s.statsRow}>
        <View style={s.statBox}>
          <Text style={s.statNum}>{area.nodes_count || 0}</Text>
          <Text style={s.statLbl}>Nodes</Text>
        </View>
        <View style={s.statDivider} />
        <View style={s.statBox}>
          <Text style={[s.statNum, { color: "#B42318" }]}>{area.pending_count || 0}</Text>
          <Text style={s.statLbl}>Pending</Text>
        </View>
        <View style={s.statDivider} />
        <View style={s.statBox}>
          <Text style={[s.statNum, { color: "#175CD3" }]}>{area.in_progress_count || 0}</Text>
          <Text style={s.statLbl}>Progress</Text>
        </View>
        <View style={s.statDivider} />
        <View style={s.statBox}>
          <Text style={[s.statNum, { color: "#027A48" }]}>{area.completed_count || 0}</Text>
          <Text style={s.statLbl}>Done</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function AreasScreen() {
  const router = useRouter();
  const { token, user } = useAuth();
  const teamId = (user as any)?.team_id ?? null;
  const [search, setSearch] = useState("");
  const [areas, setAreas] = useState<SkycableArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    async function loadAreas() {
      if (!token) return;

      // Separate cache per team so unfiltered admin cache doesn't bleed through
      const CACHE_KEY = teamId ? `sitemap_areas_team_${teamId}` : "sitemap_areas";

      // Show cached data instantly while fetching fresh
      const cached = await cacheGet<SkycableArea[]>(CACHE_KEY);
      if (cached?.length) {
        setAreas(cached);
        setLoading(false);
      }

      // Always fetch — team filter must always be applied
      try {
        const data = await getAreas(token, teamId);
        setAreas(data);
        cacheSet(CACHE_KEY, data).catch(() => {});
        setOffline(false);
      } catch {
        if (!cached?.length) setOffline(true);
      } finally {
        setLoading(false);
      }
    }
    loadAreas();
  }, [token, teamId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? areas.filter(a => a.name.toLowerCase().includes(q)) : areas;
  }, [search, areas]);

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
            <Text style={s.headerTitle}>Sitemap</Text>
            <Text style={s.headerSub}>Skycable Teardown Areas</Text>
          </View>
        </View>

        <View style={s.searchWrap}>
          <View style={s.searchBox}>
            <Search size={18} color="#98A2B3" />
            <TextInput style={s.searchInput} placeholder="Search sites…" placeholderTextColor="#98A2B3" value={search} onChangeText={setSearch} autoCapitalize="none" />
            {!!search && <TouchableOpacity onPress={() => setSearch("")}><X size={16} color="#98A2B3" /></TouchableOpacity>}
          </View>
          <Text style={s.count}>{filtered.length} site{filtered.length !== 1 ? "s" : ""}</Text>
        </View>

        {loading ? (
          <View style={s.empty}><ActivityIndicator size="large" color="#0B7A5A" /><Text style={s.emptyTitle}>Loading Sites...</Text></View>
        ) : offline ? (
          <View style={s.empty}><Map size={40} color="#F59E0B" /><Text style={s.emptyTitle}>No offline data</Text><Text style={s.emptySub}>Connect once to cache sites for offline use.</Text></View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={i => String(i.id)}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<View style={s.empty}><Map size={40} color="#D0D5DD" /><Text style={s.emptyTitle}>No sites found</Text></View>}
            renderItem={({ item: area }) => (
              <AreaCard
                key={area.id}
                area={area}
                onPress={() => router.push({ pathname: "/teardowns/nodes", params: { areaId: area.id, areaName: area.name } })}
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

  // Hero card
  cardContainer: { backgroundColor: "#FFFFFF", borderRadius: 20, marginTop: 42, marginBottom: 8, marginHorizontal: 4, paddingHorizontal: 16, paddingBottom: 16, shadowColor: "#0F172A", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 16, elevation: 4 },
  heroMapShell: { height: 160, backgroundColor: "#F3F4F6", borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 16, overflow: "hidden", marginTop: -28, borderWidth: 2, borderColor: "#E2E8F0" },
  noGpsLogo: { width: "40%", height: "40%", opacity: 0.15 },
  mapAreaLabel: { position: "absolute", bottom: 8, left: 10, right: 10, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  mapAreaLabelText: { fontSize: 11, fontWeight: "700", color: "#FFFFFF" },

  cardBody: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14, marginBottom: 14 },
  info: { flex: 1 },
  areaName: { fontSize: 18, fontWeight: "900", color: "#111827" },
  areaSub: { fontSize: 12, fontWeight: "600", color: "#667085", marginTop: 2 },

  statsRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderRadius: 14, borderWidth: 1, borderColor: "#E7ECF2", paddingVertical: 10 },
  statBox: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 15, fontWeight: "900", color: "#111827" },
  statLbl: { fontSize: 9, fontWeight: "800", color: "#98A2B3", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 3 },
  statDivider: { width: 1, height: 28, backgroundColor: "#E7ECF2" },
});
