import { useAuth } from "@/context/auth-context";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getPHTNow } from "@/lib/display-time";
import { gpsQueueReadAll } from "@/lib/gps-queue";
import { getNodeDetail, getNodePoles, SkycablePole, startNodeTeardown } from "@/services/skycable";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, CircleDot, Lock, Play, Search, Timer, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, LayoutChangeEvent, SafeAreaView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

// ─── Static tile map (no WebView, no OOM risk) ───────────────────────────────
const ZOOM = 17;
const TILE_PX = 256;

function latLngToTileFrac(lat: number, lng: number, z: number) {
  const n = Math.pow(2, z);
  const xFrac = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yFrac =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    n;
  return { xFrac, yFrac, tileX: Math.floor(xFrac), tileY: Math.floor(yFrac) };
}

function StaticTileMap({ lat, lng }: { lat: number; lng: number }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const { xFrac, yFrac, tileX, tileY } = latLngToTileFrac(lat, lng, ZOOM);
  const tileUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM}/${tileY}/${tileX}`;

  const fracX = xFrac - tileX;
  const fracY = yFrac - tileY;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  const scale = size ? Math.max(size.w / TILE_PX, size.h / TILE_PX) : 1;
  const imgW = TILE_PX * scale;
  const imgH = TILE_PX * scale;

  const offsetX = size ? size.w / 2 - fracX * imgW : 0;
  const offsetY = size ? size.h / 2 - fracY * imgH : 0;

  const PIN = 18;
  const pinLeft = size ? size.w / 2 - PIN / 2 : 0;
  const pinTop = size ? size.h / 2 - PIN : 0;

  const tileUrlLeft  = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM}/${tileY}/${tileX - 1}`;
  const tileUrlRight = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM}/${tileY}/${tileX + 1}`;

  return (
    <View style={StyleSheet.absoluteFillObject} onLayout={onLayout}>
      <Image
        source={{ uri: tileUrlLeft, headers: { "User-Agent": "TelcoVantageApp/1.0" } }}
        style={{ position: "absolute", left: offsetX - imgW, top: offsetY, width: imgW, height: imgH }}
        resizeMode="cover"
      />
      <Image
        source={{ uri: tileUrl, headers: { "User-Agent": "TelcoVantageApp/1.0" } }}
        style={{ position: "absolute", left: offsetX, top: offsetY, width: imgW, height: imgH }}
        resizeMode="cover"
      />
      <Image
        source={{ uri: tileUrlRight, headers: { "User-Agent": "TelcoVantageApp/1.0" } }}
        style={{ position: "absolute", left: offsetX + imgW, top: offsetY, width: imgW, height: imgH }}
        resizeMode="cover"
      />
      {size && (
        <View
          style={{
            position: "absolute",
            left: pinLeft,
            top: pinTop,
            width: PIN,
            height: PIN,
            borderRadius: PIN / 2,
            backgroundColor: "#2563EB",
            borderWidth: 3,
            borderColor: "#FFFFFF",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 6,
            elevation: 4,
          }}
        />
      )}
    </View>
  );
}

function formatElapsed(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}h ${mm}m ${ss}s` : `${mm}m ${ss}s`;
}

function fmtPHT(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pht = new Date(d.getTime() + 8 * 3600 * 1000);
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][pht.getUTCMonth()];
  const day = pht.getUTCDate();
  const h = pht.getUTCHours();
  const min = String(pht.getUTCMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${mon} ${day} · ${h12}:${min} ${ampm}`;
}

type NodeSession = {
  date_start: string | null;
  due_date: string | null;
  date_finished: string | null;
  expected_cable: number | null;
  actual_cable: number | null;
  progress_percentage: number | null;
};

const SC: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: "#B54708", bg: "#FFF7E8" },
  in_progress: { label: "In Progress", color: "#1D4ED8", bg: "#EFF6FF" }, // some spans done, more remain
  cleared: { label: "Completed", color: "#067647", bg: "#ECFDF3" }, // all spans done
};

const SLOT_COLORS: Record<string, string> = { skycable: "#DC2626", globe: "#1D4ED8", meralco: "#F59E0B", free: "#E2E8F0" };

export default function PolesScreen() {
  const router = useRouter();
  const { token, user } = useAuth();
  const { nodeId, nodeName, nodeTeamId } = useLocalSearchParams<{ nodeId: string; nodeName: string; nodeTeamId?: string }>();
  const userTeamId = (user as any)?.team_id ?? null;

  // Block access if node is assigned to a different team
  const accessDenied =
    !!nodeTeamId && !!userTeamId &&
    String(nodeTeamId) !== String(userTeamId);

  const [search, setSearch] = useState("");
  const [poles, setPoles] = useState<SkycablePole[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  const [session, setSession] = useState<NodeSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isStarted = !!session?.date_start;

  // Load node session fields on mount
  useEffect(() => {
    if (!token || !nodeId) return;
    getNodeDetail(Number(nodeId), token)
      .then(node => {
        setSession({
          date_start: node.date_start ?? null,
          due_date: node.due_date ?? null,
          date_finished: node.date_finished ?? null,
          expected_cable: node.expected_cable ?? null,
          actual_cable: node.actual_cable ?? null,
          progress_percentage: node.progress_percentage ?? null,
        });
      })
      .catch(() => {})
      .finally(() => setSessionLoading(false));
  }, [token, nodeId]);

  // Live timer — counts up from date_start
  useEffect(() => {
    if (!session?.date_start) return;
    const startMs = new Date(session.date_start).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [session?.date_start]);

  async function handleStartTeardown() {
    if (!token || !nodeId || starting) return;
    setStarting(true);
    try {
      const now = getPHTNow();
      await startNodeTeardown(Number(nodeId), token, now);
      setSession(prev => ({ ...prev!, date_start: now }));
    } catch {
      Alert.alert("Error", "Could not start teardown. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  }

  useFocusEffect(useCallback(() => {
    if (!token || !nodeId) return;
    const CACHE_KEY = `sitemap_poles_${nodeId}`;
    let hasCached = false;

    // Helper to merge pending GPS from the queue
    const mergeGps = async (basePoles: SkycablePole[]) => {
      const q = await gpsQueueReadAll().catch(() => []);
      if (!q.length) return basePoles;
      return basePoles.map(p => {
        const pending = q.find(entry => String(entry.pole_id) === String(p.pole_id));
        if (pending) {
          return {
            ...p,
            pole: { ...p.pole, lat: String(pending.lat), lng: String(pending.lng) }
          };
        }
        return p;
      });
    };

    cacheGet<SkycablePole[]>(CACHE_KEY).then(async cached => {
      if (cached?.length) {
        // Cache exists! Use it and do NOT call the API to prevent overwriting
        const merged = await mergeGps(cached);
        setPoles(merged);
        setLoading(false);
        setOffline(false);
      } else {
        // No cache yet, fetch from API
        getNodePoles(Number(nodeId), token)
          .then(async data => {
            const merged = await mergeGps(data);
            cacheSet(CACHE_KEY, merged).catch(() => { });
            setPoles(merged);
            setOffline(false);
          })
          .catch(() => {
            setOffline(true);
          })
          .finally(() => setLoading(false));
      }
    });
  }, [token, nodeId]));

  // Only truly cleared (ALL spans done) goes to Completed tab.
  // in_progress stays in Active — it still has remaining spans.
  const isCompleted = (p: SkycablePole) => p.pole?.skycable_status === "cleared";

  const activePoles = useMemo(() => poles.filter(p => !isCompleted(p)), [poles]);
  const completedPoles = useMemo(() => poles.filter(p => isCompleted(p)), [poles]);

  const filtered = useMemo(() => {
    const base = showCompleted ? completedPoles : activePoles;
    const q = search.toLowerCase();
    return q ? base.filter(p => p.pole?.pole_code?.toLowerCase().includes(q)) : base;
  }, [search, showCompleted, activePoles, completedPoles]);

  if (accessDenied) {
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
          <View style={s.deniedWrap}>
            <View style={s.deniedIcon}>
              <Lock size={36} color="#EF4444" />
            </View>
            <Text style={s.deniedTitle}>Access Restricted</Text>
            <Text style={s.deniedSub}>
              This node is assigned to a different team.{"\n"}
              You can only access nodes assigned to your team.
            </Text>
            <TouchableOpacity style={s.deniedBtn} onPress={() => router.back()}>
              <Text style={s.deniedBtnText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </>
    );
  }

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
          <View style={s.filterRow}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => { setShowCompleted(false); setSearch(""); }}
              style={[s.filterChip, !showCompleted && s.filterChipActive]}
            >
              <Text style={[s.filterChipText, !showCompleted && s.filterChipTextActive]}>
                Pending ({activePoles.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => { setShowCompleted(true); setSearch(""); }}
              style={[s.filterChip, showCompleted && s.filterChipDone]}
            >
              <Text style={[s.filterChipText, showCompleted && s.filterChipTextActive]}>
                Completed ({completedPoles.length})
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View style={s.empty}>
            <ActivityIndicator size="large" color="#0B7A5A" />
            <Text style={s.emptyTitle}>Loading Poles...</Text>
          </View>
        ) : offline ? (
          <View style={s.empty}>
            <CircleDot size={40} color="#F59E0B" />
            <Text style={s.emptyTitle}>No offline data</Text>
            <Text style={s.emptySub}>Connect to the internet once to cache poles for offline use.</Text>
          </View>
        ) : (
          <FlatList data={filtered} keyExtractor={i => String(i.id)} contentContainerStyle={s.list} showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              sessionLoading ? (
                <View style={s.sessionLoading}>
                  <ActivityIndicator size="small" color="#0B7A5A" />
                  <Text style={s.sessionLoadingText}>Checking teardown status…</Text>
                </View>
              ) : !isStarted ? (
                // ── Gate card ──────────────────────────────────────────
                <View style={s.gateCard}>
                  <View style={s.gateIconWrap}>
                    <Lock size={28} color="#0B7A5A" />
                  </View>
                  <Text style={s.gateTitle}>Teardown Not Started</Text>
                  <Text style={s.gateSub}>
                    Tap the button below to officially begin this node's teardown. Poles will unlock once the session starts and your{" "}
                    <Text style={{ fontWeight: "800" }}>date_start</Text> is recorded in the backend.
                  </Text>
                  <TouchableOpacity
                    style={[s.startBtn, starting && { opacity: 0.6 }]}
                    activeOpacity={0.8}
                    onPress={handleStartTeardown}
                    disabled={starting}
                  >
                    {starting ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Play size={18} color="#FFFFFF" fill="#FFFFFF" />
                    )}
                    <Text style={s.startBtnText}>{starting ? "Starting…" : "Start Teardown"}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                // ── Live session strip ─────────────────────────────────
                <View style={s.sessionStrip}>
                  <View style={s.sessionTimer}>
                    <Timer size={14} color="#0B7A5A" />
                    <Text style={s.sessionTimerText}>{formatElapsed(elapsed)}</Text>
                  </View>
                  {session?.expected_cable != null && (
                    <View style={s.sessionStat}>
                      <Text style={s.sessionStatNum}>{session.expected_cable}m</Text>
                      <Text style={s.sessionStatLbl}>Expected</Text>
                    </View>
                  )}
                  {session?.actual_cable != null && (
                    <View style={s.sessionStat}>
                      <Text style={[s.sessionStatNum, { color: "#0B7A5A" }]}>{session.actual_cable}m</Text>
                      <Text style={s.sessionStatLbl}>Actual</Text>
                    </View>
                  )}
                  {session?.progress_percentage != null && (
                    <View style={s.sessionStat}>
                      <Text style={[s.sessionStatNum, { color: "#1D4ED8" }]}>{session.progress_percentage}%</Text>
                      <Text style={s.sessionStatLbl}>Progress</Text>
                    </View>
                  )}
                </View>
              )
            }
            ListEmptyComponent={isStarted ? <View style={s.empty}><CircleDot size={40} color="#D0D5DD" /><Text style={s.emptyTitle}>No poles found</Text></View> : null}
            renderItem={({ item: np }) => {
              const poleInfo = np.pole;
              if (!poleInfo) return null;
              const sc = SC[poleInfo.skycable_status] || SC.pending;
              const slots = poleInfo.cableSlots || [];
              const usedSlots = slots.filter(sl => sl.occupied_by !== "free").length;
              return (
                <TouchableOpacity
                  style={[s.cardContainer, !isStarted && s.cardLocked]}
                  activeOpacity={isStarted ? 0.8 : 1}
                  onPress={() => {
                    if (!isStarted) {
                      Alert.alert("Not Started", 'Tap "Start Teardown" first to begin working on this node.');
                      return;
                    }
                    router.push({
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
                    });
                  }}
                >
                  {poleInfo.lat && poleInfo.lng ? (
                    <View style={s.heroMapShell}>
                      <StaticTileMap lat={parseFloat(poleInfo.lat)} lng={parseFloat(poleInfo.lng)} />
                    </View>
                  ) : (
                    <View style={s.heroMapShell}>
                      <Image source={require("../../assets/images/logo.png")} style={s.noGpsLogo} resizeMode="contain" />
                    </View>
                  )}
                  <View style={s.cardBody}>
                    <View style={s.info}>
                      <Text style={s.poleCode}>{poleInfo.pole_code}</Text>
                      {poleInfo.lat && poleInfo.lng ? (
                        <Text style={s.poleSub}>{poleInfo.lat}, {poleInfo.lng}</Text>
                      ) : (
                        <Text style={s.noCoordLabel}>No Coordinates</Text>
                      )}
                      {!!np.date_start && (
                        <View style={s.tsRow}>
                          <View style={[s.tsDot, { backgroundColor: "#1D4ED8" }]} />
                          <Text style={s.tsText}>Started {fmtPHT(np.date_start)}</Text>
                        </View>
                      )}
                      {!!np.cleared_at && (
                        <View style={s.tsRow}>
                          <View style={[s.tsDot, { backgroundColor: "#067647" }]} />
                          <Text style={[s.tsText, { color: "#067647" }]}>Cleared {fmtPHT(np.cleared_at)}</Text>
                        </View>
                      )}
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
                  {!isStarted && <View style={s.cardLockOverlay}><Lock size={16} color="#94A3B8" /></View>}
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
  cardContainer: { backgroundColor: "#FFFFFF", borderRadius: 20, marginTop: 42, marginBottom: 8, marginHorizontal: 4, paddingHorizontal: 16, paddingBottom: 16, shadowColor: "#0F172A", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 16, elevation: 4 },
  cardBody: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14, marginBottom: 18 },
  info: { flex: 1 },
  poleCode: { fontSize: 18, fontWeight: "900", color: "#111827" },
  poleSub: { fontSize: 12, fontWeight: "600", color: "#667085", marginTop: 2 },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  slotsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  slotBox: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: "#F8FAFC", borderWidth: 1.5 },
  slotDot: { width: 8, height: 8, borderRadius: 4 },
  slotLabel: { fontSize: 11, fontWeight: "800" },
  slotInfo: { fontSize: 11, fontWeight: "700", color: "#98A2B3", textAlign: "center" },
  filterRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: "#E7ECF2", backgroundColor: "#FFFFFF" },
  filterChipActive: { backgroundColor: "#0B7A5A", borderColor: "#0B7A5A" },
  filterChipDone: { backgroundColor: "#059669", borderColor: "#059669" },
  filterChipText: { fontSize: 12, fontWeight: "700", color: "#667085" },
  filterChipTextActive: { color: "#FFFFFF" },
  noCoordLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94A3B8",
    marginTop: 3,
  },
  tsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 4,
  },
  tsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tsText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },
  heroMapShell: {
    height: 140,
    backgroundColor: "#F3F4F6",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    overflow: "hidden",
    marginTop: -28,
    borderWidth: 2,
    borderColor: "#E2E8F0",
  },
  seqBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 3,
  },
  seqBadgeText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#FFFFFF"
  },
  noGpsLogo: {
    width: "40%",
    height: "40%",
    opacity: 0.15,
  },

  // ── Session loading ──────────────────────────────────────────────────────
  sessionLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F0FDF4",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#BBF7D0",
  },
  sessionLoadingText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#065F46",
  },

  // ── Gate card ─────────────────────────────────────────────────────────────
  gateCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    marginBottom: 16,
    shadowColor: "#0B7A5A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 18,
    elevation: 5,
    borderWidth: 1.5,
    borderColor: "#D1FAE5",
  },
  gateIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "#ECFDF5",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: "#A7F3D0",
  },
  gateTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
    textAlign: "center",
  },
  gateSub: {
    fontSize: 13,
    fontWeight: "500",
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 22,
    paddingHorizontal: 8,
  },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#0B7A5A",
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 14,
    shadowColor: "#0B7A5A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  startBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },

  // ── Live session strip ────────────────────────────────────────────────────
  sessionStrip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 12,
    gap: 16,
    borderWidth: 1,
    borderColor: "#D1FAE5",
    shadowColor: "#0B7A5A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  sessionTimer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sessionTimerText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#0B7A5A",
    letterSpacing: -0.3,
  },
  sessionStat: { alignItems: "center" },
  sessionStatNum: { fontSize: 14, fontWeight: "900", color: "#111827" },
  sessionStatLbl: { fontSize: 9, fontWeight: "700", color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 1 },

  // ── Locked card ───────────────────────────────────────────────────────────
  cardLocked: { opacity: 0.45 },
  cardLockOverlay: { position: "absolute", top: 12, right: 12 },

  // ── Access denied screen ──────────────────────────────────────────────────
  deniedWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  deniedIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#FEF2F2", alignItems: "center", justifyContent: "center", marginBottom: 20 },
  deniedTitle: { fontSize: 20, fontWeight: "900", color: "#111827", marginBottom: 10, textAlign: "center" },
  deniedSub: { fontSize: 14, fontWeight: "500", color: "#6B7280", textAlign: "center", lineHeight: 22, marginBottom: 28 },
  deniedBtn: { backgroundColor: "#0B7A5A", paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14 },
  deniedBtnText: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
