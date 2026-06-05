import { useAuth } from "@/context/auth-context";
import { getBridgeToken } from "@/lib/token-bridge";
import {
  arriveDelivery, getDriverDeliveries, startDelivery,
  type WarehouseDelivery,
} from "@/services/skycable";
import api from "@/services/api";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import * as Location from "expo-location";
import {
  ChevronLeft, CheckCircle2, Navigation, NavigationOff,
  Package, PlayCircle, RefreshCw, Truck,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, RefreshControl,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G      = "#006241";
const GDARK  = "#004d30";
const G_LIGHT= "#ECFDF5";
const SLATE  = "#111827";
const MUTED  = "#667085";
const BORDER = "#E7ECF2";
const WHITE  = "#FFFFFF";
const BG     = "#F8FAFC";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// ── Delivery card ──────────────────────────────────────────────────────────────
function DeliveryCard({
  item, isTracking, isStarting, isArriving, onStart, onToggleGPS, onArrive,
}: {
  item:       WarehouseDelivery;
  isTracking: boolean;
  isStarting: boolean;
  isArriving: boolean;
  onStart:    (d: WarehouseDelivery) => void;
  onToggleGPS:(d: WarehouseDelivery) => void;
  onArrive:   (d: WarehouseDelivery) => void;
}) {
  const isPending   = item.status === "pending";
  const isInTransit = item.status === "in_transit";
  const isArrived   = item.status === "arrived";

  const statusColor = isPending ? "#f59e0b" : isInTransit ? "#0b6cff" : isArrived ? "#059669" : "#6b7280";
  const statusLabel = isPending ? "Ready to Start" : isInTransit ? "In Transit" : isArrived ? "Arrived ✓" : "Delivered";
  const statusBg    = isPending ? "#FFFBEB" : isInTransit ? "#EFF6FF" : isArrived ? "#ECFDF5" : "#F8FAFC";

  return (
    <View style={[dc.card, isPending && dc.cardReady, isInTransit && dc.cardTransit, isArrived && dc.cardArrived]}>
      {/* Route */}
      <View style={dc.routeRow}>
        <View style={dc.iconWrap}>
          <Truck size={20} color={isInTransit ? "#0b6cff" : G} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={dc.route} numberOfLines={1}>
            {item.fromWarehouse?.name ?? `WH #${item.from_warehouse_id}`}
          </Text>
          <Text style={dc.routeArrow}>↓ to</Text>
          <Text style={[dc.route, { color: G }]} numberOfLines={1}>
            {item.toWarehouse?.name ?? `WH #${item.to_warehouse_id}`}
          </Text>
        </View>
        <View style={[dc.badge, { backgroundColor: statusBg, borderColor: statusColor + "40" }]}>
          <View style={[dc.badgeDot, { backgroundColor: statusColor }]} />
          <Text style={[dc.badgeTxt, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <Text style={dc.date}>{fmtDate(item.created_at)}</Text>

      {/* Items */}
      {item.items && item.items.length > 0 && (
        <View style={dc.itemsRow}>
          {item.items.map((it, i) => (
            <View key={i} style={dc.itemChip}>
              <Text style={dc.itemQty}>
                {parseFloat(String(it.quantity))}{it.item_type === "cable" ? "m" : ""}
              </Text>
              <Text style={dc.itemLabel}>{it.item_type}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Start Delivery button (pending = approved but not started) */}
      {isPending && (
        <TouchableOpacity
          style={[dc.startBtn, isStarting && { opacity: 0.5 }]}
          onPress={() => onStart(item)}
          disabled={isStarting}
          activeOpacity={0.8}
        >
          {isStarting
            ? <ActivityIndicator size="small" color={WHITE} />
            : <PlayCircle size={18} color={WHITE} />}
          <Text style={dc.startTxt}>
            {isStarting ? "Starting…" : "Start Delivery"}
          </Text>
        </TouchableOpacity>
      )}

      {/* GPS toggle + Mark Arrived (in_transit) */}
      {isInTransit && (
        <View style={dc.transitActions}>
          <TouchableOpacity
            style={[dc.gpsBtn, isTracking && dc.gpsBtnActive]}
            onPress={() => onToggleGPS(item)}
            activeOpacity={0.8}
          >
            {isTracking
              ? <Navigation size={15} color={WHITE} />
              : <NavigationOff size={15} color={G} />}
            <Text style={[dc.gpsTxt, isTracking && dc.gpsTxtActive]}>
              {isTracking ? "GPS Live" : "Start GPS"}
            </Text>
            {isTracking && <View style={dc.liveDot} />}
          </TouchableOpacity>

          <TouchableOpacity
            style={[dc.arrivedBtn, isArriving && { opacity: 0.5 }]}
            onPress={() => onArrive(item)}
            disabled={isArriving}
            activeOpacity={0.8}
          >
            {isArriving
              ? <ActivityIndicator size="small" color={WHITE} />
              : <CheckCircle2 size={15} color={WHITE} />}
            <Text style={dc.arrivedTxt}>
              {isArriving ? "Marking…" : "Mark Arrived"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Arrived state — waiting for warehouse to accept */}
      {isArrived && (
        <View style={dc.arrivedInfo}>
          <CheckCircle2 size={14} color="#059669" />
          <Text style={dc.arrivedInfoTxt}>
            Arrived at {item.toWarehouse?.name ?? "destination"} · Waiting for acceptance
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DriverScreen() {
  const router    = useRouter();
  const { token, user } = useAuth();

  const [deliveries,  setDeliveries]  = useState<WarehouseDelivery[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [trackingId,  setTrackingId]  = useState<number | null>(null);
  const [startingId,  setStartingId]  = useState<number | null>(null);
  const [arrivingId,  setArrivingId]  = useState<number | null>(null);
  const [gpsActive,   setGpsActive]   = useState(false);

  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const trackingIdRef  = useRef<number | null>(null);

  useEffect(() => {
    if (!user) return;
    const allowed = !!(user as any).is_driver || !!(user as any).is_admin || !!(user as any).is_executive;
    if (!allowed) router.replace("/" as any);
  }, [user]);

  const load = useCallback(async () => {
    const authToken = getBridgeToken() ?? token ?? "";
    try {
      const data = await getDriverDeliveries(authToken);
      setDeliveries(data);
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    return () => { locationSubRef.current?.remove(); };
  }, []);

  async function postGPS(coords: Location.LocationObjectCoords) {
    const authToken = getBridgeToken() ?? token ?? "";
    try {
      await api.request("/skycable/lineman/location", {
        method: "POST",
        body: JSON.stringify({
          latitude:  coords.latitude,
          longitude: coords.longitude,
          accuracy:  coords.accuracy,
        }),
      }, authToken);
    } catch {}
  }

  async function beginGPS(delivery: WarehouseDelivery) {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Location access is needed to broadcast your GPS.");
      return;
    }
    setTrackingId(delivery.id);
    trackingIdRef.current = delivery.id;
    setGpsActive(true);

    // Post immediately on start
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    postGPS(current.coords);

    locationSubRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 15_000, distanceInterval: 15 },
      (loc) => { if (trackingIdRef.current) postGPS(loc.coords); }
    );
  }

  function stopGPS() {
    locationSubRef.current?.remove();
    locationSubRef.current = null;
    trackingIdRef.current  = null;
    setTrackingId(null);
    setGpsActive(false);
  }

  async function handleStart(delivery: WarehouseDelivery) {
    setStartingId(delivery.id);
    try {
      const authToken = getBridgeToken() ?? token ?? "";
      const updated   = await startDelivery(authToken, delivery.id);
      // Replace in list and automatically begin GPS
      setDeliveries(prev => prev.map(d => d.id === updated.id ? updated : d));
      await beginGPS(updated);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not start delivery.");
    } finally {
      setStartingId(null);
    }
  }

  async function handleArrive(delivery: WarehouseDelivery) {
    Alert.alert(
      "Mark as Arrived?",
      `Confirm you've arrived at ${delivery.toWarehouse?.name ?? "the destination"}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            setArrivingId(delivery.id);
            try {
              const authToken = getBridgeToken() ?? token ?? "";
              const updated   = await arriveDelivery(authToken, delivery.id);
              setDeliveries(prev => prev.map(d => d.id === updated.id ? updated : d));
              Alert.alert("Arrived ✓", "Destination notified. GPS stays on until you stop it manually.");
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "Could not mark arrival.");
            } finally {
              setArrivingId(null);
            }
          },
        },
      ]
    );
  }

  function handleToggleGPS(delivery: WarehouseDelivery) {
    if (trackingId === delivery.id) {
      stopGPS();
      return;
    }
    if (trackingId !== null) {
      Alert.alert(
        "Switch Delivery?",
        "You're already broadcasting for another delivery. Switch?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Switch", onPress: () => { stopGPS(); beginGPS(delivery); } },
        ]
      );
    } else {
      beginGPS(delivery);
    }
  }

  const pendingCount   = deliveries.filter(d => d.status === "pending").length;
  const transitCount   = deliveries.filter(d => d.status === "in_transit").length;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={s.container}>

        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Driver Dashboard</Text>
            <Text style={s.subtitle}>{(user as any)?.name ?? "My deliveries"}</Text>
          </View>
          <TouchableOpacity
            onPress={() => { setRefreshing(true); load(); }}
            style={s.iconBtn}
          >
            <RefreshCw size={16} color={G} style={refreshing ? { opacity: 0.4 } : undefined} />
          </TouchableOpacity>
        </View>

        {/* GPS banner */}
        {gpsActive && (
          <View style={s.gpsBanner}>
            <View style={s.gpsBannerDot} />
            <Text style={s.gpsBannerTxt}>Live GPS broadcasting to recipient</Text>
            <TouchableOpacity onPress={stopGPS}>
              <Text style={s.gpsBannerStop}>Stop</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Stats row */}
        {!loading && deliveries.length > 0 && (
          <View style={s.statsRow}>
            <View style={[s.stat, { borderColor: "#f59e0b40", backgroundColor: "#FFFBEB" }]}>
              <Text style={[s.statVal, { color: "#f59e0b" }]}>{pendingCount}</Text>
              <Text style={s.statLbl}>Ready</Text>
            </View>
            <View style={[s.stat, { borderColor: "#0b6cff40", backgroundColor: "#EFF6FF" }]}>
              <Text style={[s.statVal, { color: "#0b6cff" }]}>{transitCount}</Text>
              <Text style={s.statLbl}>In Transit</Text>
            </View>
          </View>
        )}

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={G} /></View>
        ) : (
          <FlatList
            data={deliveries}
            keyExtractor={d => String(d.id)}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); load(); }}
                colors={[G]} tintColor={G}
              />
            }
            ListEmptyComponent={
              <View style={s.empty}>
                <Truck size={48} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No deliveries assigned</Text>
                <Text style={s.emptySub}>You'll see assigned deliveries here</Text>
              </View>
            }
            renderItem={({ item }) => (
              <DeliveryCard
                item={item}
                isTracking={trackingId === item.id}
                isStarting={startingId === item.id}
                isArriving={arrivingId === item.id}
                onStart={handleStart}
                onToggleGPS={handleToggleGPS}
                onArrive={handleArrive}
              />
            )}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: BG },
  center:       { flex: 1, alignItems: "center", justifyContent: "center" },
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  backBtn:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconBtn:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: G_LIGHT },
  title:        { fontSize: 20, fontWeight: "900", color: SLATE },
  subtitle:     { fontSize: 12, color: MUTED, fontWeight: "600" },
  gpsBanner:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: GDARK, paddingHorizontal: 16, paddingVertical: 10 },
  gpsBannerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#4ade80" },
  gpsBannerTxt: { flex: 1, fontSize: 12, fontWeight: "700", color: WHITE },
  gpsBannerStop:{ fontSize: 12, fontWeight: "900", color: "#fca5a5" },
  statsRow:     { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 14 },
  stat:         { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1.5, padding: 12 },
  statVal:      { fontSize: 22, fontWeight: "900" },
  statLbl:      { fontSize: 11, fontWeight: "700", color: MUTED },
  list:         { padding: 16, gap: 12, paddingBottom: 48 },
  empty:        { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTitle:   { fontSize: 16, fontWeight: "800", color: SLATE },
  emptySub:     { fontSize: 13, color: MUTED, fontWeight: "500" },
});

const dc = StyleSheet.create({
  card:         { backgroundColor: WHITE, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: BORDER, gap: 10, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  cardReady:    { borderColor: "#f59e0b50", borderWidth: 1.5 },
  cardTransit:  { borderColor: "#0b6cff40", borderWidth: 1.5 },
  routeRow:     { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap:     { width: 44, height: 44, borderRadius: 22, backgroundColor: G_LIGHT, alignItems: "center", justifyContent: "center" },
  route:        { fontSize: 13, fontWeight: "800", color: SLATE },
  routeArrow:   { fontSize: 10, color: MUTED, fontWeight: "600" },
  badge:        { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 5 },
  badgeDot:     { width: 6, height: 6, borderRadius: 3, marginBottom: 2, alignSelf: "center" },
  badgeTxt:     { fontSize: 9, fontWeight: "900", textAlign: "center" },
  date:         { fontSize: 11, color: MUTED, fontWeight: "500", paddingLeft: 54 },
  itemsRow:     { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  itemChip:     { backgroundColor: BG, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignItems: "center", borderWidth: 1, borderColor: BORDER },
  itemQty:      { fontSize: 13, fontWeight: "900", color: SLATE },
  itemLabel:    { fontSize: 9, fontWeight: "700", color: MUTED, textTransform: "uppercase", marginTop: 1 },
  startBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: GDARK, borderRadius: 14, paddingVertical: 14, shadowColor: G, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  startTxt:     { fontSize: 14, fontWeight: "900", color: WHITE, letterSpacing: 0.2 },
  gpsBtn:       { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 13, borderWidth: 1.5, borderColor: G + "60", backgroundColor: G_LIGHT, paddingVertical: 12, paddingHorizontal: 14 },
  gpsBtnActive: { backgroundColor: G, borderColor: G },
  gpsTxt:       { flex: 1, fontSize: 13, fontWeight: "800", color: G },
  gpsTxtActive: { color: WHITE },
  liveDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: "#4ade80" },
  transitActions:  { flexDirection: "row", gap: 8 },
  arrivedBtn:      { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#059669", borderRadius: 13, paddingVertical: 12 },
  arrivedTxt:      { fontSize: 13, fontWeight: "800", color: WHITE },
  cardArrived:     { borderColor: "#05996940", borderWidth: 1.5 },
  arrivedInfo:     { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#ECFDF5", borderRadius: 10, padding: 10 },
  arrivedInfoTxt:  { flex: 1, fontSize: 12, fontWeight: "600", color: "#059669" },
});
