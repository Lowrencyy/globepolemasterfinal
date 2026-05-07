import { useState, useMemo, useEffect } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ActivityIndicator, SafeAreaView, StatusBar } from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { CircleDot, Search, X, ChevronLeft } from "lucide-react-native";
import { getNodePoles, SkycablePole } from "@/services/skycable";
import { useAuth } from "@/context/auth-context";

const SC: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: "#B54708", bg: "#FFF7E8" },
  in_progress: { label: "In Progress", color: "#1D4ED8", bg: "#EEF4FF" },
  cleared: { label: "Completed", color: "#067647", bg: "#ECFDF3" },
};

const SLOT_COLORS: Record<string, string> = { skycable: "#DC2626", globe: "#1D4ED8", meralco: "#F59E0B", free: "#E2E8F0" };

export default function PolesScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const { nodeId, nodeName } = useLocalSearchParams<{ nodeId: string; nodeName: string }>();
  const [search, setSearch] = useState("");
  const [poles, setPoles] = useState<SkycablePole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadPoles() {
      if (!token || !nodeId) return;
      try {
        const data = await getNodePoles(Number(nodeId), token);
        setPoles(data);
      } catch (err) {
        console.error("Failed to load poles:", err);
      } finally {
        setLoading(false);
      }
    }
    loadPoles();
  }, [token, nodeId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? poles.filter(p => p.pole?.pole_code?.toLowerCase().includes(q)) : poles;
  }, [search, poles]);

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
            <Text style={s.headerTitle}>Poles</Text>
            <Text style={s.headerSub}>{nodeName || "Node"}</Text>
          </View>
        </View>

        <View style={s.searchWrap}>
          <View style={s.searchBox}>
            <Search size={18} color="#98A2B3" />
            <TextInput style={s.searchInput} placeholder="Search poles…" placeholderTextColor="#98A2B3" value={search} onChangeText={setSearch} autoCapitalize="none" />
            {!!search && <TouchableOpacity onPress={() => setSearch("")}><X size={16} color="#98A2B3" /></TouchableOpacity>}
          </View>
          <Text style={s.count}>{filtered.length} pole{filtered.length !== 1 ? "s" : ""}</Text>
        </View>

        {loading ? (
          <View style={s.empty}>
            <ActivityIndicator size="large" color="#0B7A5A" />
            <Text style={s.emptyTitle}>Loading Poles...</Text>
          </View>
        ) : (
          <FlatList data={filtered} keyExtractor={i => String(i.id)} contentContainerStyle={s.list} showsVerticalScrollIndicator={false}
            ListEmptyComponent={<View style={s.empty}><CircleDot size={40} color="#D0D5DD" /><Text style={s.emptyTitle}>No poles found</Text></View>}
          renderItem={({ item: np }) => {
            const poleInfo = np.pole;
            if (!poleInfo) return null;
            const sc = SC[poleInfo.skycable_status] || SC.pending;
            const slots = poleInfo.cableSlots || [];
            const usedSlots = slots.filter(sl => sl.occupied_by !== "free").length;
            return (
              <TouchableOpacity 
                style={s.card} 
                activeOpacity={0.8}
                onPress={() => router.push({
                  pathname: "/teardowns/pole-detail",
                  params: {
                    pole_id: np.pole_id,
                    pole_code: poleInfo.pole_code,
                    pole_name: poleInfo.pole_code,
                    node_id: nodeId,
                    node_name: nodeName,
                    accent: "#0B7A5A",
                    report_type: "teardown"
                  }
                })}
              >
                <View style={s.cardTop}>
                  <View style={s.seqBox}><Text style={s.seqText}>{np.sequence}</Text></View>
                  <View style={s.info}>
                    <Text style={s.poleCode}>{poleInfo.pole_code}</Text>
                    <Text style={s.poleSub}>{poleInfo.lat || "N/A"}, {poleInfo.lng || "N/A"}</Text>
                  </View>
                  <View style={[s.badge, { backgroundColor: sc.bg }]}>
                    <View style={[s.badgeDot, { backgroundColor: sc.color }]} />
                    <Text style={[s.badgeText, { color: sc.color }]}>{sc.label}</Text>
                  </View>
                </View>
                <View style={s.slotsRow}>
                  {slots.length > 0 ? slots.map(sl => {
                    const isFree = sl.occupied_by === "free";
                    const col = SLOT_COLORS[sl.occupied_by] || "#E2E8F0";
                    return (
                      <View key={sl.slot_label} style={[s.slotBox, { borderColor: isFree ? "#E2E8F0" : col + "60" }]}>
                        <View style={[s.slotDot, { backgroundColor: isFree ? "#E2E8F0" : col }]} />
                        <Text style={[s.slotLabel, { color: isFree ? "#94A3B8" : "#0F172A" }]}>{sl.slot_label}</Text>
                      </View>
                    );
                  }) : null}
                </View>
                {slots.length > 0 && <Text style={s.slotInfo}>{usedSlots}/{slots.length} slots occupied</Text>}
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
  card: { backgroundColor: "#FFFFFF", borderRadius: 28, padding: 20, borderWidth: 1.5, borderColor: "#E7ECF2", shadowColor: "#101828", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.06, shadowRadius: 18, elevation: 4 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 18 },
  seqBox: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#EEF2F6", alignItems: "center", justifyContent: "center" },
  seqText: { fontSize: 16, fontWeight: "900", color: "#0B7A5A" },
  info: { flex: 1 },
  poleCode: { fontSize: 16, fontWeight: "900", color: "#111827" },
  poleSub: { fontSize: 11, fontWeight: "600", color: "#667085", marginTop: 2 },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  slotsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  slotBox: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: "#F8FAFC", borderWidth: 1.5 },
  slotDot: { width: 8, height: 8, borderRadius: 4 },
  slotLabel: { fontSize: 11, fontWeight: "800" },
  slotInfo: { fontSize: 11, fontWeight: "700", color: "#98A2B3", textAlign: "center" },
});
