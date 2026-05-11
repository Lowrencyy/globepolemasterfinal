import { useState, useMemo, useEffect } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ActivityIndicator, SafeAreaView, StatusBar } from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { Layers, Search, X, ChevronLeft } from "lucide-react-native";
import { getNodes, SkycableNode } from "@/services/skycable";
import { useAuth } from "@/context/auth-context";
import { cacheGet, cacheSet } from "@/lib/cache";

const SC: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: "#F59E0B", bg: "#FEF3C7" },
  in_progress: { label: "In Progress", color: "#3B82F6", bg: "#DBEAFE" },
  completed: { label: "Completed", color: "#10B981", bg: "#DCFCE7" },
};

export default function NodesScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const { areaId, areaName } = useLocalSearchParams<{ areaId: string; areaName: string }>();
  const [search, setSearch] = useState("");
  const [nodes, setNodes] = useState<SkycableNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    async function loadNodes() {
      if (!token || !areaId) return;
      const CACHE_KEY = `sitemap_nodes_${areaId}`;
      let hasCached = false;

      const cached = await cacheGet<SkycableNode[]>(CACHE_KEY);
      if (cached?.length) {
        hasCached = true;
        setNodes(cached);
        setLoading(false);
        setOffline(false);
      }

      try {
        const response = await getNodes(Number(areaId), token);
        cacheSet(CACHE_KEY, response.data).catch(() => {});
        setNodes(response.data);
        setOffline(false);
      } catch {
        if (!hasCached) setOffline(true);
      } finally {
        setLoading(false);
      }
    }
    loadNodes();
  }, [token, areaId]);

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
          <View style={s.empty}>
            <ActivityIndicator size="large" color="#0B7A5A" />
            <Text style={s.emptyTitle}>Loading Nodes...</Text>
          </View>
        ) : offline ? (
          <View style={s.empty}>
            <Layers size={40} color="#F59E0B" />
            <Text style={s.emptyTitle}>No offline data</Text>
            <Text style={s.emptySub}>Connect once to cache nodes for offline use.</Text>
          </View>
        ) : (
          <FlatList data={filtered} keyExtractor={i => String(i.id)} contentContainerStyle={s.list} showsVerticalScrollIndicator={false}
            ListEmptyComponent={<View style={s.empty}><Layers size={40} color="#D0D5DD" /><Text style={s.emptyTitle}>No nodes found</Text></View>}
          renderItem={({ item: node }) => {
            const sc = SC[node.status] || SC.pending;
            return (
              <TouchableOpacity style={s.card} onPress={() => router.push({ pathname: "/teardowns/poles", params: { nodeId: node.id, nodeName: node.name } })} activeOpacity={0.7}>
                <View style={s.cardTop}>
                  <View style={[s.cardIconBox, { backgroundColor: sc.bg }]}><Layers size={18} color={sc.color} /></View>
                  <View style={s.cardTitleBlock}>
                    <Text style={s.cardTitle}>{node.name}</Text>
                    <Text style={s.cardSub}>{node.barangay_name || "N/A"}, {node.city || "N/A"}</Text>
                  </View>
                  <View style={[s.badge, { backgroundColor: sc.bg }]}>
                    <View style={[s.badgeDot, { backgroundColor: sc.color }]} />
                    <Text style={[s.badgeText, { color: sc.color }]}>{sc.label}</Text>
                  </View>
                </View>
                <View style={s.cardDivider} />
                <View style={s.metaRow}>
                  <View style={s.meta}><Text style={s.metaNum}>{node.poles_count || 0}</Text><Text style={s.metaLabel}>Poles</Text></View>
                  <View style={s.metaDivider} />
                  <View style={s.meta}><Text style={s.metaNum}>{node.expected_cable_meters || 0}m</Text><Text style={s.metaLabel}>Cable</Text></View>
                </View>
              </TouchableOpacity>
            );
          }}
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
  cardIconBox: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  cardTitleBlock: { flex: 1 },
  cardTitle: { fontSize: 17, fontWeight: "900", color: "#111827" },
  cardSub: { fontSize: 12, fontWeight: "600", color: "#667085", marginTop: 2 },
  cardDivider: { height: 1, backgroundColor: "#F1F5F9", marginVertical: 16 },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  metaRow: { flexDirection: "row", alignItems: "center" },
  meta: { flex: 1, alignItems: "center", paddingVertical: 10, backgroundColor: "#F8FAFC", borderRadius: 16, borderWidth: 1, borderColor: "#E7ECF2" },
  metaNum: { fontSize: 18, fontWeight: "900", color: "#111827" },
  metaLabel: { fontSize: 9, fontWeight: "800", color: "#98A2B3", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 4 },
  metaDivider: { width: 10, backgroundColor: "transparent" },
});
