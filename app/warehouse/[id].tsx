import { useAuth } from "@/context/auth-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  Image as ImageIcon,
  MapPin,
  Package,
  ShieldCheck,
  User,
  Warehouse as WarehouseIcon,
  X,
} from "lucide-react-native";
import React, { useMemo, useState } from "react";
import {
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import api from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/cache";
import { useEffect } from "react";

function buildWarehouseDetailMapHtml(spans: any[]) {
  const points = spans.flatMap(s => [
    { lat: parseFloat(s.from_pole?.pole?.map_latitude || "0"), lng: parseFloat(s.from_pole?.pole?.map_longitude || "0"), label: s.from_pole?.pole?.pole_code || "P" },
    { lat: parseFloat(s.to_pole?.pole?.map_latitude || "0"), lng: parseFloat(s.to_pole?.pole?.map_longitude || "0"), label: s.to_pole?.pole?.pole_code || "P" }
  ]).filter(p => p.lat !== 0);

  const center = points.length > 0 ? points[0] : { lat: 14.5995, lng: 120.9842 };

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #map { width: 100%; height: 100%; overflow: hidden; background: #0F172A; }
    .pin-label {
      background: #0B7A5A;
      color: white;
      padding: 3px 7px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 900;
      white-space: nowrap;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
      border: 1.5px solid rgba(255,255,255,0.3);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var map = L.map('map', { zoomControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: ''
    }).addTo(map);

    var points = ${JSON.stringify(points)};
    var bounds = L.latLngBounds();

    points.forEach(function(p) {
      var icon = L.divIcon({ className: '', html: '<div class="pin-label">' + p.label + '</div>', iconSize: [40, 20], iconAnchor: [20, 10] });
      L.marker([p.lat, p.lng], { icon: icon }).addTo(map);
      bounds.extend([p.lat, p.lng]);
    });

    ${JSON.stringify(spans)}.forEach(function(s) {
       var f = [parseFloat(s.from_pole?.pole?.map_latitude), parseFloat(s.from_pole?.pole?.map_longitude)];
       var t = [parseFloat(s.to_pole?.pole?.map_latitude), parseFloat(s.to_pole?.pole?.map_longitude)];
       if(f[0] && t[0]) {
         L.polyline([f, t], { color: '#10B981', weight: 4, opacity: 0.8, dashArray: '6, 8' }).addTo(map);
       }
    });

    if(points.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40] });
    } else {
      map.setView([14.5995, 120.9842], 13);
    }
  </script>
</body>
</html>`;
}

const GREEN = "#0B7A5A";
const GREEN_SOFT = "#E8F7F1";
const INK = "#0F172A";
const SLATE = "#334155";
const MUTED = "#64748B";
const SUBTLE = "#94A3B8";
const BORDER = "#E2E8F0";
const CARD = "#FFFFFF";
const BG = "#F5F7FA";
const WHITE = "#FFFFFF";

const MOCK_DELIVERIES = [
  {
    id: 1,
    type: "Daily Delivery",
    cable: 120,
    node: 2,
    amplifier: 1,
    extender: 0,
    tsc: 15,
    date: "May 15, 2026",
    time: "08:30 AM",
    status: "Received",
    team: "Warehouse A Team",
    receivedBy: "Juan Dela Cruz",
    approvedBy: "Engr. Mark Reyes",
    location: "Main Storage Hub, Manila",
    node_id: 1, // Mock node ID linked to existing cached spans
    proofImage:
      "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=80",
  },
];

const inventoryItems = [
  { label: "Cable Recovered", value: "120m" },
  { label: "Nodes Total", value: "2 pcs" },
  { label: "Amplifiers", value: "1 pc" },
  { label: "Extenders", value: "0 pcs" },
  { label: "TSC Connectors", value: "15 pcs" },
];

export default function DeliveryDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { user } = useAuth();

  const [modalVisible, setModalVisible] = useState(false);
  const [polesModalVisible, setPolesModalVisible] = useState(false);
  const [isApproved, setIsApproved] = useState(false);

  const role = user?.role?.toLowerCase() || "guest";
  const isPM = role === "project manager" || role === "admin";

  const delivery = useMemo(() => {
    return MOCK_DELIVERIES.find((d) => d.id === Number(id)) || MOCK_DELIVERIES[0];
  }, [id]);

  const approvalLabel = isApproved ? "Approved" : "Pending";

  const [spans, setSpans] = useState<any[]>([]);

  useEffect(() => {
    if (!delivery.node_id) return;
    const key = `spans_node_${delivery.node_id}`;
    cacheGet<any[]>(key).then((cached) => {
      if (cached?.length) {
        setSpans(cached);
        return;
      }
      api.get(`/skycable/spans?node_id=${delivery.node_id}`).then(({ data }) => {
        const all = Array.isArray(data) ? data : (data?.data ?? []);
        setSpans(all);
        cacheSet(key, all).catch(() => {});
      }).catch(() => {});
    });
  }, [delivery.node_id]);

  const uniquePoles = useMemo(() => {
    const codes = new Set<string>();
    spans.forEach(s => {
      if (s.from_pole?.pole?.pole_code) codes.add(s.from_pole.pole.pole_code);
      if (s.to_pole?.pole?.pole_code) codes.add(s.to_pole.pole.pole_code);
    });
    return Array.from(codes);
  }, [spans]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={s.container} edges={["top"]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.75}>
            <ChevronLeft size={23} color={INK} />
          </TouchableOpacity>

          <View style={s.headerCopy}>
            <Text style={s.eyebrow} numberOfLines={1}>REF #100254</Text>
            <Text style={s.title} numberOfLines={1}>Delivery Details</Text>
          </View>

          <View style={[s.statusPill, isApproved && s.statusPillApproved]}>
            <Text style={[s.statusText, isApproved && s.statusTextApproved]} numberOfLines={1}>
              {approvalLabel}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <SectionTitle title="Teardown Context" />
          <View style={s.card}>
            <View style={s.mapPreview}>
              <WebView
                originWhitelist={["*"]}
                source={{ html: buildWarehouseDetailMapHtml(spans) }}
                style={{ flex: 1 }}
                scrollEnabled={false}
              />
              <View style={s.mapInfoBox}>
                <Text style={s.mapInfoTitle} numberOfLines={1}>Area Node Preview</Text>
                <Text style={s.mapInfoSub} numberOfLines={1}>{spans.length} spans collected from this node</Text>
              </View>
            </View>

            <View style={s.metaGrid}>
              <TouchableOpacity style={s.metaBox} onPress={() => setPolesModalVisible(true)} activeOpacity={0.8}>
                <Text style={s.metaLabel} numberOfLines={1}>Poles Involved</Text>
                <Text style={s.metaValue} numberOfLines={1}>{uniquePoles.slice(0, 2).join(", ")}{uniquePoles.length > 2 ? "..." : ""}</Text>
              </TouchableOpacity>
              <View style={s.metaBox}>
                <Text style={s.metaLabel} numberOfLines={1}>Cable Collected</Text>
                <Text style={s.metaValue} numberOfLines={1}>120 meters</Text>
              </View>
            </View>
          </View>

          <View style={s.heroCard}>
            <TouchableOpacity activeOpacity={0.9} onPress={() => setModalVisible(true)}>
              <Image source={{ uri: delivery.proofImage }} style={s.heroImage} resizeMode="cover" />
              <View style={s.heroShade} />
              <View style={s.heroBadge}>
                <ImageIcon size={15} color={WHITE} />
                <Text style={s.heroBadgeText} numberOfLines={1}>View Proof</Text>
              </View>
              <View style={s.heroContent}>
                <Text style={s.heroLabel} numberOfLines={1}>{delivery.type}</Text>
                <Text style={s.heroTitle} numberOfLines={2}>Recovered materials delivery receipt</Text>
              </View>
            </TouchableOpacity>
          </View>

          <View style={s.summaryGrid}>
            <MetricCard label="Cable" value="120m" />
            <MetricCard label="Nodes" value="2" />
            <MetricCard label="Amp" value="1" />
            <MetricCard label="TSC" value="15" />
          </View>

          <SectionTitle title="Receipt Information" />
          <View style={s.card}>
            <DetailRow icon={<Calendar size={19} color={GREEN} />} label="Received Date" value={`${delivery.date} • ${delivery.time}`} />
            <DetailRow icon={<User size={19} color={GREEN} />} label="Teardown / Approved By" value={`${delivery.receivedBy} / ${isApproved ? delivery.approvedBy : "Not yet approved"}`} />
            <DetailRow icon={<MapPin size={19} color={GREEN} />} label="Node Location" value="N-5420 • Brgy. 123, Makati City" />
            <DetailRow icon={<WarehouseIcon size={19} color={GREEN} />} label="Warehouse Destination" value="Main Hub Warehouse, Manila" isLast />
          </View>

          <SectionTitle title="Itemized Delivery List" />
          <View style={s.cardCompact}>
            {inventoryItems.map((item, index) => (
              <View key={item.label} style={[s.inventoryRow, index === inventoryItems.length - 1 && s.noBorder]}>
                <Text style={s.inventoryLabel} numberOfLines={1}>{item.label}</Text>
                <Text style={s.inventoryValue} numberOfLines={1}>{item.value}</Text>
              </View>
            ))}
          </View>

          <SectionTitle title="Spans Collected (Click to view Teardown)" />
          <View style={s.spansContainer}>
             <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                {spans.map((span, idx) => (
                  <TouchableOpacity 
                    key={span.id || idx} 
                    style={s.spanCard}
                    onPress={() => router.push({
                      pathname: '/daily-report/preview',
                      params: { span_id: span.id, from_pole_code: span.from_pole?.pole?.pole_code, to_pole_code: span.to_pole?.pole?.pole_code }
                    } as any)}
                  >
                    <View style={s.spanNodes}>
                      <Text style={s.spanNodeText}>{span.from_pole?.pole?.pole_code || "N/A"}</Text>
                      <View style={s.spanArrow}><Text style={s.arrowText}>→</Text></View>
                      <Text style={s.spanNodeText}>{span.to_pole?.pole?.pole_code || "N/A"}</Text>
                    </View>
                    <Text style={s.spanDist}>{span.strand_length || 0}m</Text>
                  </TouchableOpacity>
                ))}
             </ScrollView>
          </View>

          <View style={s.sourceCard}>
            <View style={s.sourceHeader}>
              <View style={s.sourceIcon}><Package size={16} color={GREEN} /></View>
              <Text style={s.sourceTitle} numberOfLines={1}>Recovery Source</Text>
            </View>
            <Text style={s.sourceText}>
              Generated from the Teardown Logs of May 15, 2026. All listed assets were recovered from the field for warehouse receipt.
            </Text>
          </View>

          {isPM ? (
            !isApproved ? (
              <TouchableOpacity style={s.approveBtn} onPress={() => setIsApproved(true)} activeOpacity={0.85}>
                <CheckCircle2 size={22} color={WHITE} />
                <Text style={s.approveBtnText} numberOfLines={1}>Approve Delivery</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.approvedBtn}>
                <CheckCircle2 size={22} color={GREEN} />
                <Text style={s.approvedBtnText} numberOfLines={1}>Delivery Approved</Text>
              </View>
            )
          ) : (
            <View style={s.previewCard}>
              <View style={s.previewIconWrap}>
                <ShieldCheck size={23} color={GREEN} />
              </View>
              <View style={s.previewCopy}>
                <Text style={s.previewTitle} numberOfLines={1}>{isApproved ? "Delivery Approved" : "Pending Approval"}</Text>
                <Text style={s.previewSub} numberOfLines={3}>
                  {isApproved
                    ? "This delivery has been verified and added to warehouse inventory."
                    : "Only Project Managers can approve field-recovered material deliveries."}
                </Text>
              </View>
            </View>
          )}
        </ScrollView>

        <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
          <View style={s.modalBackdrop}>
            <TouchableOpacity style={s.closeModal} onPress={() => setModalVisible(false)} activeOpacity={0.75}>
              <X size={27} color={WHITE} />
            </TouchableOpacity>
            <Image source={{ uri: delivery.proofImage }} style={s.fullImage} resizeMode="contain" />
            <View style={s.modalFooter}>
              <Text style={s.modalFooterTitle} numberOfLines={1}>Proof of Delivery</Text>
              <Text style={s.modalFooterSub} numberOfLines={1}>{delivery.date} • {delivery.location}</Text>
            </View>
          </View>
        </Modal>

        <Modal visible={polesModalVisible} transparent animationType="slide" onRequestClose={() => setPolesModalVisible(false)}>
          <View style={s.bottomModalOverlay}>
            <View style={s.bottomModalContent}>
              <View style={s.modalHeaderRow}>
                <Text style={s.modalTitle} numberOfLines={1}>Poles Involved</Text>
                <TouchableOpacity onPress={() => setPolesModalVisible(false)} style={s.modalCloseBtn}>
                  <X size={22} color={INK} />
                </TouchableOpacity>
              </View>
              <ScrollView style={s.polesScroll} showsVerticalScrollIndicator={false}>
                {uniquePoles.map((pole) => (
                  <View key={pole} style={s.poleItemRow}>
                    <View style={s.poleIcon}><MapPin size={17} color={GREEN} /></View>
                    <Text style={s.poleItemText} numberOfLines={1}>{pole}</Text>
                    <View style={s.poleStatus}>
                      <Text style={s.poleStatusText} numberOfLines={1}>Done</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={s.sectionTitle} numberOfLines={1}>{title}</Text>;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metricCard}>
      <Text style={s.metricValue} numberOfLines={1}>{value}</Text>
      <Text style={s.metricLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function DetailRow({ icon, label, value, isLast }: { icon: React.ReactNode; label: string; value: string; isLast?: boolean }) {
  return (
    <View style={[s.detailRow, isLast && s.noBorder]}>
      <View style={s.detailIcon}>{icon}</View>
      <View style={s.detailCopy}>
        <Text style={s.detailLabel} numberOfLines={1}>{label}</Text>
        <Text style={s.detailValue} numberOfLines={2}>{value}</Text>
      </View>
    </View>
  );
}

const shadow = Platform.select({
  ios: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  android: {
    elevation: 3,
  },
});

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF2F7",
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
    marginRight: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "800",
    color: SUBTLE,
    letterSpacing: 0.7,
  },
  title: {
    fontSize: 20,
    fontWeight: "900",
    color: INK,
    marginTop: 1,
  },
  statusPill: {
    maxWidth: 100,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
  },
  statusPillApproved: {
    backgroundColor: GREEN_SOFT,
    borderColor: "#BDEAD9",
  },
  statusText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#C2410C",
  },
  statusTextApproved: {
    color: GREEN,
  },
  scroll: {
    padding: 16,
    paddingBottom: 44,
  },
  heroCard: {
    height: 218,
    borderRadius: 30,
    overflow: "hidden",
    backgroundColor: "#CBD5E1",
    marginBottom: 14,
    ...shadow,
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  heroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2, 6, 23, 0.28)",
  },
  heroBadge: {
    position: "absolute",
    top: 14,
    right: 14,
    maxWidth: 132,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(15, 23, 42, 0.72)",
  },
  heroBadgeText: {
    color: WHITE,
    fontSize: 12,
    fontWeight: "900",
  },
  heroContent: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 18,
  },
  heroLabel: {
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: "900",
    color: "#D1FAE5",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  heroTitle: {
    fontSize: 24,
    lineHeight: 29,
    color: WHITE,
    fontWeight: "900",
  },
  summaryGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 22,
  },
  metricCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: CARD,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#EEF2F7",
  },
  metricValue: {
    fontSize: 18,
    fontWeight: "900",
    color: GREEN,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: MUTED,
    marginTop: 3,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "900",
    color: SLATE,
    letterSpacing: 0.4,
    marginBottom: 10,
    marginLeft: 2,
  },
  card: {
    backgroundColor: CARD,
    borderRadius: 26,
    padding: 16,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: "#EEF2F7",
    ...shadow,
  },
  cardCompact: {
    backgroundColor: CARD,
    borderRadius: 24,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#EEF2F7",
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  detailIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: GREEN_SOFT,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },
  detailCopy: {
    flex: 1,
    minWidth: 0,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: "900",
    color: SUBTLE,
    textTransform: "uppercase",
    letterSpacing: 0.45,
  },
  detailValue: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: INK,
    marginTop: 3,
  },
  noBorder: {
    borderBottomWidth: 0,
  },
  mapPreview: {
    height: 172,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: "#ECFEFF",
    borderWidth: 1,
    borderColor: "#CFFAFE",
    position: "relative",
    marginBottom: 14,
  },
  routeDotStart: {
    position: "absolute",
    top: "33%",
    left: "21%",
    backgroundColor: GREEN,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
  },
  routeDotEnd: {
    position: "absolute",
    top: "42%",
    right: "24%",
    backgroundColor: GREEN,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
  },
  routeDotText: {
    color: WHITE,
    fontSize: 10,
    fontWeight: "900",
  },
  routeLine: {
    position: "absolute",
    top: "48%",
    left: "32%",
    width: "35%",
    height: 3,
    borderRadius: 999,
    backgroundColor: GREEN,
    transform: [{ rotate: "12deg" }],
  },
  mapInfoBox: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.88)",
  },
  mapInfoTitle: {
    fontSize: 12,
    fontWeight: "900",
    color: INK,
  },
  mapInfoSub: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED,
    marginTop: 2,
  },
  metaGrid: {
    flexDirection: "row",
    gap: 10,
  },
  metaBox: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "#F8FAFC",
    borderRadius: 18,
    padding: 13,
    borderWidth: 1,
    borderColor: "#EEF2F7",
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: "900",
    color: SUBTLE,
    marginBottom: 5,
  },
  metaValue: {
    fontSize: 13,
    fontWeight: "900",
    color: INK,
  },
  inventoryRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  inventoryLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: "800",
    color: SLATE,
  },
  inventoryValue: {
    flexShrink: 0,
    fontSize: 15,
    fontWeight: "900",
    color: GREEN,
  },
  sourceCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: 24,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },
  sourceHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  sourceIcon: {
    width: 30,
    height: 30,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GREEN_SOFT,
    marginRight: 9,
  },
  sourceTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: "900",
    color: GREEN,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  sourceText: {
    fontSize: 13,
    lineHeight: 19,
    color: MUTED,
    fontWeight: "650",
  },
  approveBtn: {
    height: 62,
    borderRadius: 22,
    backgroundColor: GREEN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    ...shadow,
  },
  approveBtnText: {
    color: WHITE,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  approvedBtn: {
    height: 62,
    borderRadius: 22,
    backgroundColor: GREEN_SOFT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#BDEAD9",
  },
  approvedBtnText: {
    color: GREEN,
    fontSize: 16,
    fontWeight: "900",
  },
  previewCard: {
    backgroundColor: CARD,
    borderRadius: 26,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    gap: 13,
  },
  previewIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GREEN_SOFT,
  },
  previewCopy: {
    flex: 1,
    minWidth: 0,
  },
  previewTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: INK,
  },
  previewSub: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
    fontWeight: "650",
    marginTop: 3,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  closeModal: {
    position: "absolute",
    top: 52,
    right: 20,
    zIndex: 10,
    backgroundColor: "rgba(255,255,255,0.15)",
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  fullImage: {
    width: "100%",
    height: "72%",
  },
  modalFooter: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 42,
    alignItems: "center",
  },
  modalFooterTitle: {
    color: WHITE,
    fontSize: 18,
    fontWeight: "900",
  },
  modalFooterSub: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    marginTop: 4,
    fontWeight: "700",
    textAlign: "center",
  },
  bottomModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "flex-end",
  },
  bottomModalContent: {
    backgroundColor: CARD,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 22,
    maxHeight: "70%",
  },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  modalTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 20,
    fontWeight: "900",
    color: INK,
  },
  modalCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
  },
  polesScroll: {
    marginBottom: 10,
  },
  poleItemRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    gap: 12,
  },
  poleIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GREEN_SOFT,
  },
  poleItemText: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: "900",
    color: INK,
  },
  poleStatus: {
    flexShrink: 0,
    backgroundColor: GREEN_SOFT,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  poleStatusText: {
    fontSize: 10,
    fontWeight: "900",
    color: GREEN,
  },
  spansContainer: {
    marginBottom: 24,
  },
  spanCard: {
    backgroundColor: WHITE,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1.5,
    borderColor: GREEN_SOFT,
    minWidth: 140,
    alignItems: 'center',
    ...shadow,
  },
  spanNodes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  spanNodeText: {
    fontSize: 13,
    fontWeight: '900',
    color: INK,
  },
  spanArrow: {
    backgroundColor: GREEN_SOFT,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowText: {
    fontSize: 12,
    color: GREEN,
    fontWeight: '900',
  },
  spanDist: {
    fontSize: 11,
    fontWeight: '800',
    color: MUTED,
  },
});
