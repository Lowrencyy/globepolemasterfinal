import { DELIVERY_DISPLAY, MOCK_DELIVERIES, type MockDelivery } from "@/lib/mock-deliveries";
import { Stack, useRouter } from "expo-router";
import {
  Award, Camera, CheckCircle2, ChevronLeft, ChevronRight,
  ClipboardList, Hash, MapPin, Package, User,
} from "lucide-react-native";
import { useState } from "react";
import {
  Image, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G = "#0B7A5A";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";
const WHITE = "#FFFFFF";

// Use the shared DELIVERY_DISPLAY map from mock-deliveries
function getStatusColor(status: string) { return DELIVERY_DISPLAY[status]?.color ?? "#64748b"; }
function getStatusLabel(status: string) { return DELIVERY_DISPLAY[status]?.label ?? status; }

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]} ${day}, ${y}`;
}
function fmtDT(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  const h = d.getUTCHours(), mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} · ${h % 12 || 12}:${mi} ${h >= 12 ? "PM" : "AM"}`;
}


// ── Received photo box ────────────────────────────────────────────────────────
function ReceivedPhoto({ uri }: { uri: string | null }) {
  const [error, setError] = useState(false);

  if (!uri || error) {
    return (
      <View style={ph.placeholder}>
        <Camera size={28} color="#CBD5E1" />
        <Text style={ph.placeholderTxt}>No received photo yet</Text>
      </View>
    );
  }

  return (
    <View style={ph.shell}>
      <Image
        source={{ uri }}
        style={ph.img}
        resizeMode="cover"
        onError={() => setError(true)}
      />
      <View style={ph.badge}>
        <CheckCircle2 size={11} color={WHITE} />
        <Text style={ph.badgeTxt}>Received</Text>
      </View>
    </View>
  );
}

// ── Delivery list card ────────────────────────────────────────────────────────
function DeliveryListCard({ item, onPress }: { item: MockDelivery; onPress: () => void }) {
  const color = getStatusColor(item.status);
  const label = getStatusLabel(item.status);

  const components = [
    { l: "Cable",       v: item.total_cable,     u: "m",  c: "#059669" },
    { l: "Node",        v: item.total_node,       u: "",   c: "#0b6cff" },
    { l: "Amplifier",   v: item.total_amplifier,  u: "",   c: "#8b5cf6" },
    { l: "Extender",    v: item.total_extender,   u: "",   c: "#10b981" },
    { l: "TSC",         v: item.total_tsc,        u: "",   c: "#f59e0b" },
    { l: "PSU",         v: item.total_psu,        u: "",   c: "#ef4444" },
    { l: "PSU Case",    v: item.total_psu_case,   u: "",   c: "#64748b" },
  ];

  return (
    <TouchableOpacity style={lc.card} onPress={onPress} activeOpacity={0.87}>
      {/* Colored accent bar */}
      <View style={[lc.bar, { backgroundColor: color }]} />

      {/* Top row: token + date */}
      <View style={lc.topRow}>
        <View style={lc.tokenRow}>
          <Hash size={13} color={G} />
          <Text style={lc.token}>{item.token}</Text>
        </View>
        <View style={[lc.statusBadge, { backgroundColor: color + "18" }]}>
          <View style={[lc.dot, { backgroundColor: color }]} />
          <Text style={[lc.statusTxt, { color }]}>{label}</Text>
        </View>
      </View>

      {/* Organization + location */}
      <View style={lc.locRow}>
        <Text style={{ fontSize: 10, marginRight: 2 }}>🏢</Text>
        <Text style={[lc.locTxt, { color: "#2563EB" }]} numberOfLines={1}>{item.organization}</Text>
      </View>
      {item.current_location ? (
        <View style={lc.locRow}>
          <MapPin size={11} color={MUTED} />
          <Text style={lc.locTxt} numberOfLines={1}>{item.current_location}</Text>
        </View>
      ) : null}

      {/* Received photo */}
      <ReceivedPhoto uri={item.received_image_uri} />

      {/* Components grid */}
      <Text style={lc.sectionLabel}>COLLECTED ITEMS — {item.teardown_count} TEARDOWNS</Text>
      <View style={lc.grid}>
        {components.map(x => (
          <View key={x.l} style={lc.gridItem}>
            <Text style={[lc.gridVal, { color: x.c }]}>
              {x.v > 0 ? `${x.v}${x.u}` : "—"}
            </Text>
            <Text style={lc.gridLbl}>{x.l}</Text>
          </View>
        ))}
      </View>

      {/* People row */}
      <View style={lc.peopleRow}>
        <View style={lc.personBlock}>
          <User size={13} color={G} />
          <View>
            <Text style={lc.personRole}>Delivered by</Text>
            <Text style={lc.personName}>{item.delivered_by}</Text>
          </View>
        </View>
        <View style={lc.personDivider} />
        <View style={lc.personBlock}>
          <Award size={13} color="#8b5cf6" />
          <View>
            <Text style={lc.personRole}>Approved by</Text>
            <Text style={[lc.personName, { color: "#8b5cf6" }]}>{item.approved_by}</Text>
          </View>
        </View>
      </View>

      {/* Received date */}
      <View style={lc.receivedRow}>
        <CheckCircle2 size={12} color={G} />
        <Text style={lc.receivedTxt}>Received {fmtDT(item.received_at)}</Text>
      </View>

      {/* Tap for details */}
      <View style={lc.footer}>
        <Text style={lc.footerTxt}>View full details</Text>
        <ChevronRight size={14} color={G} />
      </View>
    </TouchableOpacity>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function DeliveryListScreen() {
  const router = useRouter();

  // Group deliveries by date
  const groups = MOCK_DELIVERIES.reduce<Record<string, MockDelivery[]>>((acc, d) => {
    if (!acc[d.date]) acc[d.date] = [];
    acc[d.date].push(d);
    return acc;
  }, {});
  const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <ClipboardList size={18} color={G} />
              <Text style={s.title}>Delivery Reports</Text>
            </View>
            <Text style={s.subtitle}>{MOCK_DELIVERIES.length} deliveries · all statuses</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {sortedDates.map(date => (
            <View key={date}>
              {/* Date section header */}
              <View style={s.dateHeader}>
                <View style={s.dateLine} />
                <Text style={s.dateLabelTxt}>{fmtDate(date)}</Text>
                <View style={s.dateLine} />
              </View>

              {/* Cards for this date */}
              {groups[date].map(item => (
                <DeliveryListCard
                  key={item.id}
                  item={item}
                  onPress={() =>
                    router.push({ pathname: "/delivery/[id]", params: { id: String(item.id) } } as any)
                  }
                />
              ))}
            </View>
          ))}

          {MOCK_DELIVERIES.length === 0 && (
            <View style={s.empty}>
              <Package size={52} color="#CBD5E1" />
              <Text style={s.emptyTitle}>No delivery reports yet</Text>
              <Text style={s.emptySub}>Deliveries will appear here once submitted.</Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#F8FAFC" },
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 10 },
  backBtn:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerText:   { flex: 1 },
  title:        { fontSize: 19, fontWeight: "900", color: SLATE },
  subtitle:     { fontSize: 12, color: MUTED, fontWeight: "600", marginTop: 1 },
  scroll:       { padding: 16, paddingBottom: 56, gap: 4 },
  dateHeader:   { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 14 },
  dateLine:     { flex: 1, height: 1, backgroundColor: BORDER },
  dateLabelTxt: { fontSize: 11, fontWeight: "800", color: MUTED, letterSpacing: 0.5, textTransform: "uppercase" },
  empty:        { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTitle:   { fontSize: 17, fontWeight: "800", color: SLATE },
  emptySub:     { fontSize: 13, color: MUTED, fontWeight: "500", textAlign: "center", paddingHorizontal: 32 },
});

const ph = StyleSheet.create({
  shell:          { borderRadius: 14, overflow: "hidden", height: 160, marginVertical: 12, position: "relative" },
  img:            { width: "100%", height: "100%" },
  badge:          { position: "absolute", bottom: 8, right: 10, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: G, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeTxt:       { fontSize: 10, fontWeight: "800", color: WHITE },
  placeholder:    { height: 120, backgroundColor: "#F1F5F9", borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 6, marginVertical: 12, borderWidth: 1.5, borderColor: BORDER, borderStyle: "dashed" },
  placeholderTxt: { fontSize: 11, fontWeight: "600", color: "#CBD5E1" },
});

const lc = StyleSheet.create({
  card:        { backgroundColor: WHITE, borderRadius: 20, padding: 16, paddingLeft: 20, borderWidth: 1, borderColor: BORDER, marginBottom: 14, shadowColor: "#0F172A", shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3, overflow: "hidden" },
  bar:         { position: "absolute", left: 0, top: 0, bottom: 0, width: 5, borderTopLeftRadius: 20, borderBottomLeftRadius: 20 },
  topRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 },
  tokenRow:    { flexDirection: "row", alignItems: "center", gap: 5 },
  token:       { fontSize: 15, fontWeight: "900", color: SLATE },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  dot:         { width: 6, height: 6, borderRadius: 3 },
  statusTxt:   { fontSize: 10, fontWeight: "800" },
  locRow:      { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  locTxt:      { fontSize: 11, color: MUTED, fontWeight: "600", flex: 1 },
  sectionLabel:{ fontSize: 9, fontWeight: "800", color: MUTED, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 },
  grid:        { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 },
  gridItem:    { flex: 1, minWidth: 72, backgroundColor: "#F8FAFC", borderRadius: 12, padding: 8, alignItems: "center", borderWidth: 1, borderColor: BORDER },
  gridVal:     { fontSize: 14, fontWeight: "900" },
  gridLbl:     { fontSize: 8, fontWeight: "700", color: MUTED, marginTop: 2, textTransform: "uppercase" },
  peopleRow:   { flexDirection: "row", alignItems: "stretch", backgroundColor: "#F8FAFC", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: BORDER, marginBottom: 10 },
  personBlock: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7 },
  personDivider: { width: 1, backgroundColor: BORDER, marginHorizontal: 10 },
  personRole:  { fontSize: 9, fontWeight: "700", color: MUTED, textTransform: "uppercase", letterSpacing: 0.4 },
  personName:  { fontSize: 13, fontWeight: "800", color: SLATE, marginTop: 1 },
  receivedRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 12 },
  receivedTxt: { fontSize: 11, fontWeight: "700", color: G },
  footer:      { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3, paddingTop: 10, borderTopWidth: 1, borderTopColor: BORDER },
  footerTxt:   { fontSize: 12, fontWeight: "700", color: G },
});
