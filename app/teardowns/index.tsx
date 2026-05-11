import { useState, useMemo, useEffect } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, SafeAreaView, StatusBar } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Map, ChevronRight, Search, X, MapPin, Building2, ChevronLeft } from "lucide-react-native";
import { getAreas, SkycableArea } from "@/services/skycable";
import { useAuth } from "@/context/auth-context";
import { cacheGet, cacheSet } from "@/lib/cache";

const CACHE_KEY = "sitemap_areas";

export default function AreasScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [areas, setAreas] = useState<SkycableArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    async function loadAreas() {
      if (!token) return;
      let hasCached = false;

      const cached = await cacheGet<SkycableArea[]>(CACHE_KEY);
      if (cached?.length) {
        hasCached = true;
        setAreas(cached);
        setLoading(false);
        setOffline(false);
      }

      try {
        const data = await getAreas(token);
        cacheSet(CACHE_KEY, data).catch(() => {});
        setAreas(data);
        setOffline(false);
      } catch {
        if (!hasCached) setOffline(true);
      } finally {
        setLoading(false);
      }
    }
    loadAreas();
  }, [token]);

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
            <Text style={s.headerSub}>Skycable Teardown</Text>
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
          <View style={s.empty}>
            <ActivityIndicator size="large" color="#0B7A5A" />
            <Text style={s.emptyTitle}>Loading Sites...</Text>
          </View>
        ) : offline ? (
          <View style={s.empty}>
            <Map size={40} color="#F59E0B" />
            <Text style={s.emptyTitle}>No offline data</Text>
            <Text style={s.emptySub}>Connect once to cache sites for offline use.</Text>
          </View>
        ) : (
          <FlatList data={filtered} keyExtractor={i => String(i.id)} contentContainerStyle={s.list} showsVerticalScrollIndicator={false}
            ListEmptyComponent={<View style={s.empty}><Map size={40} color="#D0D5DD" /><Text style={s.emptyTitle}>No sites found</Text></View>}
            renderItem={({ item: area }) => (
              <TouchableOpacity style={s.card} onPress={() => router.push({ pathname: "/teardowns/nodes", params: { areaId: area.id, areaName: area.name } })} activeOpacity={0.8}>
                <View style={s.cardTop}>
                  <View style={s.cardIconBox}><Building2 size={22} color="#0B7A5A" /></View>
                  <View style={s.cardTitleBlock}>
                    <Text style={s.cardTitle}>{area.name}</Text>
                    <Text style={s.cardSub}>Skycable Site</Text>
                  </View>
                  <ChevronRight size={20} color="#D0D5DD" />
                </View>
                <View style={s.cardDivider} />
                <View style={s.statsRow}>
                  <View style={s.statChip}><Text style={s.statNum}>{area.nodes_count || 0}</Text><Text style={s.statLabel}>Nodes</Text></View>
                  <View style={[s.statChip, { borderColor: "#FEF3F2", backgroundColor: "#FEF3F2" }]}><Text style={[s.statNum, { color: "#B42318" }]}>{area.pending_count || 0}</Text><Text style={[s.statLabel, { color: "#D92D20" }]}>Pending</Text></View>
                  <View style={[s.statChip, { borderColor: "#EFF8FF", backgroundColor: "#EFF8FF" }]}><Text style={[s.statNum, { color: "#175CD3" }]}>{area.in_progress_count || 0}</Text><Text style={[s.statLabel, { color: "#2E90FA" }]}>Progress</Text></View>
                  <View style={[s.statChip, { borderColor: "#ECFDF3", backgroundColor: "#ECFDF3" }]}><Text style={[s.statNum, { color: "#027A48" }]}>{area.completed_count || 0}</Text><Text style={[s.statLabel, { color: "#12B76A" }]}>Done</Text></View>
                </View>
              </TouchableOpacity>
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
  card: { backgroundColor: "#FFFFFF", borderRadius: 28, padding: 20, borderWidth: 1.5, borderColor: "#E7ECF2", shadowColor: "#101828", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.06, shadowRadius: 18, elevation: 4 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  cardIconBox: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#ECFDF3", alignItems: "center", justifyContent: "center" },
  cardTitleBlock: { flex: 1 },
  cardTitle: { fontSize: 17, fontWeight: "900", color: "#111827" },
  cardSub: { fontSize: 12, fontWeight: "600", color: "#667085", marginTop: 2 },
  cardDivider: { height: 1, backgroundColor: "#F1F5F9", marginVertical: 16 },
  statsRow: { flexDirection: "row", gap: 10 },
  statChip: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 16, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E7ECF2" },
  statNum: { fontSize: 18, fontWeight: "900", color: "#111827" },
  statLabel: { fontSize: 9, fontWeight: "800", color: "#98A2B3", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 4 },
});
