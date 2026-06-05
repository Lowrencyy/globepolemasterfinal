import { useAuth } from "@/context/auth-context";
import { getBridgeToken } from "@/lib/token-bridge";
import {
  acceptDelivery, getIncomingDeliveries,
  type WarehouseDelivery,
} from "@/services/skycable";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  AlertTriangle, CheckCircle2, ChevronLeft,
  Package, Truck, User,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { WAREHOUSE_ARRIVED_EVENT } from "@/lib/location-tracker";
import {
  ActivityIndicator, Alert, DeviceEventEmitter, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G       = "#006241";
const GDARK   = "#004d30";
const G_LIGHT = "#ECFDF5";
const SLATE   = "#111827";
const MUTED   = "#667085";
const BORDER  = "#E7ECF2";
const WHITE   = "#FFFFFF";
const BG      = "#F8FAFC";

const ITEM_COLOR: Record<string, string> = {
  cable: "#059669", node: "#0b6cff", amplifier: "#8b5cf6",
  extender: "#10b981", tsc: "#f59e0b", powersupply: "#ef4444",
};
const ITEM_LABEL: Record<string, string> = {
  cable: "Cable (m)", node: "Node", amplifier: "Amplifier",
  extender: "Extender", tsc: "TSC", powersupply: "Power Supply",
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDT(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  const h = d.getUTCHours(), mi = String(d.getUTCMinutes()).padStart(2, "0");
  const mo = MONTHS[d.getUTCMonth()], day = d.getUTCDate();
  return `${mo} ${day} · ${h % 12 || 12}:${mi} ${h >= 12 ? "PM" : "AM"}`;
}

// ── Info row ──────────────────────────────────────────────────────────────────
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

// ── Item row ─────────────────────────────────────────────────────────────────
function ItemRow({ type, qty, unit }: { type: string; qty: number; unit: string }) {
  const color = ITEM_COLOR[type] ?? MUTED;
  return (
    <View style={[s.itemRow, { borderLeftColor: color }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.itemType}>{ITEM_LABEL[type] ?? type}</Text>
        <Text style={s.itemUnit}>{unit}</Text>
      </View>
      <Text style={[s.itemQty, { color }]}>
        {parseFloat(String(qty))}{unit === "m" ? "m" : ""}
      </Text>
    </View>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AcceptDeliveryScreen() {
  const router = useRouter();
  const { warehouseId, deliveryId } = useLocalSearchParams<{ warehouseId: string; deliveryId?: string }>();
  const { token } = useAuth();

  const [deliveries, setDeliveries] = useState<WarehouseDelivery[]>([]);
  const [selected,   setSelected]   = useState<WarehouseDelivery | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [accepting,  setAccepting]  = useState(false);
  const [done,       setDone]       = useState(false);

  useEffect(() => {
    (async () => {
      if (!warehouseId) return;
      const t = getBridgeToken() ?? token ?? "";
      try {
        const list = await getIncomingDeliveries(t, Number(warehouseId));
        setDeliveries(list);
        if (deliveryId) {
          setSelected(list.find(d => d.id === Number(deliveryId)) ?? list[0] ?? null);
        } else {
          setSelected(list[0] ?? null);
        }
      } catch {}
      finally { setLoading(false); }
    })();
  }, [warehouseId, deliveryId, token]);

  async function handleAccept() {
    if (!selected) return;
    Alert.alert(
      "Accept Delivery",
      `Confirm receipt of ${selected.items?.length ?? 0} item type(s) from ${selected.fromWarehouse?.name ?? "the source warehouse"}?\n\nStocks will be updated automatically.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Accept",
          style: "default",
          onPress: async () => {
            setAccepting(true);
            try {
              const t = getBridgeToken() ?? token ?? "";
              await acceptDelivery(t, selected.id);
              DeviceEventEmitter.emit(WAREHOUSE_ARRIVED_EVENT);
              setDone(true);
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "Could not accept delivery. Please try again.");
            } finally {
              setAccepting(false);
            }
          },
        },
      ]
    );
  }

  // ── Done state ───────────────────────────────────────────────────────────────
  if (done) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <SafeAreaView style={s.container}>
          <View style={s.doneWrap}>
            <View style={s.doneIcon}>
              <CheckCircle2 size={48} color={G} />
            </View>
            <Text style={s.doneTitle}>Delivery Accepted</Text>
            <Text style={s.doneSub}>
              Warehouse stocks have been updated. A receipt has been generated automatically.
            </Text>
            <TouchableOpacity style={s.doneBtn} onPress={() => router.back()}>
              <Text style={s.doneBtnTxt}>Back to Warehouse</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </>
    );
  }

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
            <Text style={s.title}>Incoming Delivery</Text>
            <Text style={s.subtitle}>Review items before accepting</Text>
          </View>
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={G} /></View>
        ) : !selected ? (
          <View style={s.center}>
            <Truck size={48} color="#CBD5E1" />
            <Text style={s.emptyTitle}>No incoming deliveries</Text>
            <Text style={s.emptySub}>Check back when a driver marks arrival</Text>
          </View>
        ) : (
          <>
            {/* Delivery picker (if multiple) */}
            {deliveries.length > 1 && (
              <View style={s.pickerRow}>
                {deliveries.map(d => (
                  <TouchableOpacity
                    key={d.id}
                    style={[s.pickerChip, selected?.id === d.id && s.pickerChipActive]}
                    onPress={() => setSelected(d)}
                  >
                    <Text style={[s.pickerTxt, selected?.id === d.id && s.pickerTxtActive]}>
                      #{d.id}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <ScrollView
              contentContainerStyle={s.scroll}
              showsVerticalScrollIndicator={false}
            >
              {/* Status banner */}
              <View style={[s.banner, selected.status === "arrived"
                ? { backgroundColor: G_LIGHT, borderColor: G + "40" }
                : { backgroundColor: "#EFF6FF", borderColor: "#0b6cff40" }
              ]}>
                <Truck size={16} color={selected.status === "arrived" ? G : "#0b6cff"} />
                <Text style={[s.bannerTxt, { color: selected.status === "arrived" ? GDARK : "#1d4ed8" }]}>
                  {selected.status === "arrived"
                    ? "Driver has arrived at your location"
                    : "Delivery is in transit — arrived soon"}
                </Text>
              </View>

              {/* Route card */}
              <View style={s.card}>
                <View style={s.cardHeader}>
                  <Truck size={14} color={G} />
                  <Text style={s.cardTitle}>Transfer Details</Text>
                </View>
                <InfoRow label="FROM"  value={selected.fromWarehouse?.name ?? `Warehouse #${selected.from_warehouse_id}`} />
                <InfoRow label="TO"    value={selected.toWarehouse?.name   ?? `Warehouse #${selected.to_warehouse_id}`} />
                <InfoRow label="DISPATCHED" value={fmtDT(selected.dispatched_at)} />
                {selected.arrived_at && (
                  <InfoRow label="ARRIVED" value={fmtDT(selected.arrived_at)} />
                )}
                <InfoRow label="DELIVERY ID" value={`#${selected.id}`} />
              </View>

              {/* Driver card */}
              {selected.driver && (
                <View style={s.card}>
                  <View style={s.cardHeader}>
                    <User size={14} color={G} />
                    <Text style={s.cardTitle}>Driver</Text>
                  </View>
                  <View style={s.driverRow}>
                    <View style={s.driverAvatar}>
                      <User size={20} color={G} />
                    </View>
                    <View>
                      <Text style={s.driverName}>{selected.driver.name}</Text>
                      <Text style={s.driverRole}>Delivery Driver</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Items card */}
              <View style={s.card}>
                <View style={s.cardHeader}>
                  <Package size={14} color={G} />
                  <Text style={s.cardTitle}>
                    Items to Receive · {selected.items?.length ?? 0} type{(selected.items?.length ?? 0) !== 1 ? "s" : ""}
                  </Text>
                </View>

                {selected.items && selected.items.length > 0 ? (
                  selected.items.map((it, i) => (
                    <ItemRow
                      key={i}
                      type={it.item_type}
                      qty={it.quantity}
                      unit={it.unit ?? (it.item_type === "cable" ? "m" : "pcs")}
                    />
                  ))
                ) : (
                  <Text style={s.noItems}>No items listed</Text>
                )}
              </View>

              {/* Warning */}
              <View style={s.warning}>
                <AlertTriangle size={14} color="#92400e" />
                <Text style={s.warningTxt}>
                  Accepting this delivery will update warehouse stocks automatically and cannot be undone.
                  Verify the items physically before confirming.
                </Text>
              </View>

              {/* Accept button */}
              <TouchableOpacity
                style={[s.acceptBtn, (accepting || selected.status === "accepted") && { opacity: 0.5 }]}
                onPress={handleAccept}
                disabled={accepting || selected.status === "accepted"}
                activeOpacity={0.8}
              >
                {accepting
                  ? <ActivityIndicator size="small" color={WHITE} />
                  : <CheckCircle2 size={20} color={WHITE} />}
                <Text style={s.acceptTxt}>
                  {selected.status === "accepted"
                    ? "Already Accepted"
                    : accepting
                    ? "Accepting…"
                    : "Accept Delivery & Update Stocks"}
                </Text>
              </TouchableOpacity>

              <View style={{ height: 32 }} />
            </ScrollView>
          </>
        )}
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: BG },
  center:         { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingBottom: 80 },
  header:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  backBtn:        { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title:          { fontSize: 20, fontWeight: "900", color: SLATE },
  subtitle:       { fontSize: 12, color: MUTED, fontWeight: "600" },
  scroll:         { padding: 16, gap: 12 },

  pickerRow:      { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER },
  pickerChip:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: BORDER, backgroundColor: BG },
  pickerChipActive:{ borderColor: G, backgroundColor: G_LIGHT },
  pickerTxt:      { fontSize: 12, fontWeight: "700", color: MUTED },
  pickerTxtActive:{ color: G },

  banner:         { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, padding: 14, borderWidth: 1.5 },
  bannerTxt:      { flex: 1, fontSize: 13, fontWeight: "700" },

  card:           { backgroundColor: WHITE, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: BORDER, gap: 10, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  cardHeader:     { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle:      { fontSize: 14, fontWeight: "900", color: SLATE },

  infoRow:        { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 2 },
  infoLabel:      { fontSize: 10, fontWeight: "800", color: MUTED, letterSpacing: 0.8, textTransform: "uppercase", flex: 1 },
  infoValue:      { fontSize: 13, fontWeight: "700", color: SLATE, flex: 2, textAlign: "right" },

  driverRow:      { flexDirection: "row", alignItems: "center", gap: 12 },
  driverAvatar:   { width: 44, height: 44, borderRadius: 22, backgroundColor: G_LIGHT, alignItems: "center", justifyContent: "center" },
  driverName:     { fontSize: 15, fontWeight: "800", color: SLATE },
  driverRole:     { fontSize: 12, color: MUTED, fontWeight: "600" },

  itemRow:        { flexDirection: "row", alignItems: "center", borderLeftWidth: 3, paddingLeft: 12, paddingVertical: 8, borderRadius: 4 },
  itemType:       { fontSize: 14, fontWeight: "800", color: SLATE },
  itemUnit:       { fontSize: 11, color: MUTED, fontWeight: "600", marginTop: 2 },
  itemQty:        { fontSize: 22, fontWeight: "900" },
  noItems:        { fontSize: 13, color: MUTED, fontWeight: "600", textAlign: "center", paddingVertical: 8 },

  warning:        { flexDirection: "row", gap: 10, backgroundColor: "#FFFBEB", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#f59e0b40" },
  warningTxt:     { flex: 1, fontSize: 12, fontWeight: "600", color: "#92400e", lineHeight: 18 },

  acceptBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: GDARK, borderRadius: 16, paddingVertical: 18, shadowColor: G, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  acceptTxt:      { fontSize: 15, fontWeight: "900", color: WHITE, letterSpacing: 0.2 },

  emptyTitle:     { fontSize: 16, fontWeight: "800", color: SLATE },
  emptySub:       { fontSize: 13, color: MUTED, fontWeight: "500" },

  doneWrap:       { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 },
  doneIcon:       { width: 96, height: 96, borderRadius: 48, backgroundColor: G_LIGHT, alignItems: "center", justifyContent: "center" },
  doneTitle:      { fontSize: 26, fontWeight: "900", color: SLATE },
  doneSub:        { fontSize: 14, color: MUTED, fontWeight: "500", textAlign: "center", lineHeight: 22 },
  doneBtn:        { marginTop: 8, backgroundColor: GDARK, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 40 },
  doneBtnTxt:     { fontSize: 15, fontWeight: "900", color: WHITE },
});
