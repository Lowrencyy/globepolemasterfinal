import { useAuth } from "@/context/auth-context";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getAreas, SkycableArea } from "@/services/skycable";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  RefreshCw,
} from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
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

const G = "#006241";
const G_LIGHT = "#ECFDF5";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";
const WHITE = "#FFFFFF";
const BG = "#F4F8F5";

// ── Site card ─────────────────────────────────────────────────────────────────
function SiteCard({ area, onPress }: { area: SkycableArea; onPress: () => void }) {
  return (
    <TouchableOpacity style={c.card} onPress={onPress} activeOpacity={0.82}>
      {/* left accent bar */}
      <View style={c.accent} />

      <View style={c.body}>
        {/* top row */}
        <View style={c.topRow}>
          <View style={c.iconWrap}>
            <MapPin size={16} color={G} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={c.name} numberOfLines={1}>{area.name}</Text>
            <Text style={c.sub}>Skycable Site · {area.nodes_count || 0} node{area.nodes_count !== 1 ? "s" : ""}</Text>
          </View>
          <ChevronRight size={18} color={G} />
        </View>

        {/* stats row */}
        <View style={c.statsRow}>
          <View style={c.stat}>
            <Text style={[c.statNum, { color: SLATE }]}>{area.nodes_count || 0}</Text>
            <Text style={c.statLbl}>Nodes</Text>
          </View>
          <View style={c.statDiv} />
          <View style={c.stat}>
            <Text style={[c.statNum, { color: "#B42318" }]}>{area.pending_count || 0}</Text>
            <Text style={c.statLbl}>Pending</Text>
          </View>
          <View style={c.statDiv} />
          <View style={c.stat}>
            <Text style={[c.statNum, { color: "#175CD3" }]}>{area.in_progress_count || 0}</Text>
            <Text style={c.statLbl}>In Progress</Text>
          </View>
          <View style={c.statDiv} />
          <View style={c.stat}>
            <Text style={[c.statNum, { color: "#027A48" }]}>{area.completed_count || 0}</Text>
            <Text style={c.statLbl}>Done</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DeliveryScreen() {
  const router = useRouter();
  const { token, user } = useAuth();
  const teamId = (user as any)?.team_id ?? null;

  const [areas, setAreas] = useState<SkycableArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastFetchRef = useRef(0);

  const load = useCallback(async (force = false) => {
    const CACHE_KEY = teamId ? `sitemap_areas_team_${teamId}` : "sitemap_areas";

    const cached = await cacheGet<SkycableArea[]>(CACHE_KEY);
    if (cached?.length) {
      setAreas(cached);
      setLoading(false);
      if (!force && Date.now() - lastFetchRef.current < 5 * 60 * 1000) {
        setRefreshing(false);
        return;
      }
    }

    if (!token) { setLoading(false); setRefreshing(false); return; }

    try {
      const data = await getAreas(token, teamId);
      setAreas(data);
      cacheSet(CACHE_KEY, data).catch(() => {});
      lastFetchRef.current = Date.now();
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, teamId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
            <Text style={s.title}>Delivery Status</Text>
            <Text style={s.subtitle}>Teardown delivery per site</Text>
          </View>
          <TouchableOpacity
            style={s.iconBtn}
            onPress={() => { setRefreshing(true); load(true); }}
          >
            <RefreshCw size={18} color={G} style={refreshing ? { opacity: 0.4 } : undefined} />
          </TouchableOpacity>
        </View>

        {loading && areas.length === 0 ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={G} />
            <Text style={s.loadingTxt}>Loading sites…</Text>
          </View>
        ) : (
          <FlatList
            data={areas}
            keyExtractor={(a) => String(a.id)}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); load(true); }}
                colors={[G]}
                tintColor={G}
              />
            }
            ListEmptyComponent={
              <View style={s.empty}>
                <MapPin size={42} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No sites found</Text>
                <Text style={s.emptySub}>Sync first from the Profile screen to load your assigned sites.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <SiteCard
                area={item}
                onPress={() =>
                  router.push({
                    pathname: "/delivery/nodes" as any,
                    params: {
                      areaId: String(item.id),
                      areaName: encodeURIComponent(item.name),
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
  container:      { flex: 1, backgroundColor: BG },
  header:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: BG, gap: 8 },
  backBtn:        { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconBtn:        { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: G_LIGHT },
  headerText:     { flex: 1 },
  title:          { fontSize: 20, fontWeight: "900", color: SLATE },
  subtitle:       { fontSize: 11, color: MUTED, fontWeight: "600", marginTop: 1 },
  center:         { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingTxt:     { fontSize: 13, color: MUTED, fontWeight: "600" },
  list:           { padding: 16, gap: 10, paddingBottom: 48 },
  empty:          { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTitle:     { fontSize: 16, fontWeight: "800", color: SLATE },
  emptySub:       { fontSize: 12, color: MUTED, fontWeight: "500", textAlign: "center", paddingHorizontal: 32 },
});

const c = StyleSheet.create({
  card:     { flexDirection: "row", backgroundColor: WHITE, borderRadius: 18, borderWidth: 1, borderColor: BORDER, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  accent:   { width: 4, backgroundColor: G, borderTopLeftRadius: 18, borderBottomLeftRadius: 18 },
  body:     { flex: 1, padding: 14, gap: 12 },
  topRow:   { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: G_LIGHT, alignItems: "center", justifyContent: "center" },
  name:     { fontSize: 15, fontWeight: "900", color: SLATE },
  sub:      { fontSize: 11, fontWeight: "600", color: MUTED, marginTop: 1 },
  statsRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderRadius: 12, padding: 10 },
  stat:     { flex: 1, alignItems: "center" },
  statNum:  { fontSize: 16, fontWeight: "900" },
  statLbl:  { fontSize: 9, fontWeight: "700", color: MUTED, marginTop: 2, textTransform: "uppercase" },
  statDiv:  { width: 1, height: 28, backgroundColor: BORDER },
});
