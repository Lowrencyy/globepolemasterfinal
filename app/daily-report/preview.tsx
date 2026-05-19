import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  StatusBar,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { SpanVicinityMap, type TeardownLog } from "./[date]";
import api from "@/lib/api";
import { useEffect } from "react";

const GREEN = "#0B7A5A";
const BLUE = "#6366F1";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";

export default function SpanPreviewScreen() {
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState("");
  const router = useRouter();
  const { id } = useLocalSearchParams();

  const [logItem, setLogItem] = useState<TeardownLog | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDetail() {
      try {
        setLoading(true);
        const { data } = await api.get(`/skycable/teardowns/${id}`);
        setLogItem(data?.data ?? data);
      } catch (err) {
        console.error("Failed to fetch report detail:", err);
      } finally {
        setLoading(false);
      }
    }
    if (id) fetchDetail();
  }, [id]);

  if (loading) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={GREEN} />
        <Text style={{ marginTop: 12, color: MUTED, fontWeight: '600' }}>Loading Preview...</Text>
      </View>
    );
  }

  if (!logItem) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>
          <Text style={s.title}>Not Found</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
           <Text style={{ fontSize: 18, fontWeight: '900', color: SLATE }}>No Daily Report Found</Text>
           <Text style={{ textAlign: 'center', color: MUTED, marginTop: 8 }}>The requested report record could not be retrieved from the backend.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const fromCode = logItem.span?.fromPole?.pole?.pole_code ?? "--";
  const toCode = logItem.span?.toPole?.pole?.pole_code ?? "--";
  const nodeName = logItem.span?.node?.name ?? "Unknown Node";

  const fl = logItem.from_lat ?? logItem.captured_lat;
  const fg = logItem.from_lng ?? logItem.captured_lng;
  const tl = logItem.to_lat ?? fl;
  const tg = logItem.to_lng ?? fg;

  const duration =
    logItem.start_time && logItem.end_time
      ? `${new Date(logItem.start_time).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })} - ${new Date(logItem.end_time).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : "--";

  // Simulate remote field image assets if present, fallback gracefully to placeholders
  const samplePhotoUrl =
    "https://images.unsplash.com/photo-1599580661902-1718bc321c17?auto=format&fit=crop&w=600&q=80";

  const getImgUrl = (val: unknown): string => {
    if (!val) return "";
    if (typeof val === "string" && val.trim()) return val.trim();
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = getImgUrl(item);
        if (found) return found;
      }
    }
    if (typeof val === "object") {
      const rec = val as Record<string, any>;
      const possible = [rec.url, rec.uri, rec.path, rec.src, rec.image_url, rec.photo_url, rec.file_url];
      for (const c of possible) {
        if (typeof c === "string" && c.trim()) return c.trim();
      }
    }
    return "";
  };

  const extractPhoto = (keys: string[]): string => {
    const rec = logItem as Record<string, any>;
    for (const k of keys) {
      const u = getImgUrl(rec[k]);
      if (u) return u;
    }
    return samplePhotoUrl;
  };

  const fromPhotos = [
    { label: "Before", uri: getImgUrl((logItem as any).photos?.from_before) || extractPhoto(["from_before", "from_before_photo", "before_photo", "before_image", "before_photo_url"]) },
    { label: "After", uri: getImgUrl((logItem as any).photos?.from_after) || extractPhoto(["from_after", "from_after_photo"]) },
    { label: "Tag", uri: getImgUrl((logItem as any).photos?.from_tag) || extractPhoto(["from_tag", "from_pole_tag", "from_tag_photo", "from_pole_photo"]) },
  ];

  const toPhotos = [
    { label: "Before", uri: getImgUrl((logItem as any).photos?.to_before) || extractPhoto(["to_before", "to_before_photo"]) },
    { label: "After", uri: getImgUrl((logItem as any).photos?.to_after) || extractPhoto(["to_after", "to_after_photo", "after_photo", "after_image", "after_photo_url"]) },
    { label: "Tag", uri: getImgUrl((logItem as any).photos?.to_tag) || extractPhoto(["to_tag", "to_pole_tag", "to_tag_photo"]) },
  ];

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" backgroundColor="#F4F6F8" />

      <SafeAreaView style={s.container}>
        {/* Navigation Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>
          <View style={{ flex: 1, paddingRight: 32 }}>
            <Text style={s.title}>Span Preview</Text>
            <Text style={s.subtitle}>
              Report #{logItem.id} · {logItem.team?.name ?? "Team"}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Top GIS Map Layout Shell */}
          <View style={s.mapWrapper}>
            <SpanVicinityMap
              fromLat={fl}
              fromLng={fg}
              toLat={tl}
              toLng={tg}
              fromCode={fromCode}
              toCode={toCode}
              nodeName={nodeName}
            />
          </View>

          {/* Core Collected Metrics & Duration Sub-Grid */}
          <View style={s.metricsGridRow}>
            <View style={s.metricBox}>
              <Text style={s.metricLbl}>CABLE COLLECTED</Text>
              <Text style={s.metricValGreen}>
                {logItem.actual_cable ?? 0}m
              </Text>
            </View>
            <View style={s.metricBox}>
              <Text style={s.metricLbl}>DURATION</Text>
              <Text style={s.metricValDark}>{duration}</Text>
            </View>
          </View>

          {/* Sub-Components Collected Counter Row */}
          <Text style={s.sectionTitle}>COLLECTED COMPONENTS</Text>
          <View style={s.componentsRow}>
            {[
              { label: "Nodes", count: logItem.nodes_collected ?? 0 },
              { label: "Amps", count: logItem.amplifiers_collected ?? 0 },
              { label: "Exts", count: logItem.extenders_collected ?? 0 },
              { label: "TSC", count: logItem.tsc_collected ?? 0 },
            ].map((comp, idx) => (
              <View key={idx} style={s.compChip}>
                <Text style={s.compVal}>{comp.count}</Text>
                <Text style={s.compLbl}>{comp.label.toUpperCase()}</Text>
              </View>
            ))}
          </View>

          {/* Comprehensive Captured Media Reports */}
          <Text style={s.sectionTitle}>CAPTURED FIELD PHOTOS</Text>

          {/* FROM POLE PHOTOS ROW */}
          <View style={s.photoSectionCard}>
            <Text style={s.photoSectionTitle}>From Pole ({fromCode})</Text>
            <View style={s.photoGridRow}>
              {fromPhotos.map((p, idx) => (
                <Pressable
                  key={idx}
                  style={({ pressed }) => [
                    s.photoThumbWrap,
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => {
                    setViewerUri(p.uri);
                    setViewerTitle(`From Pole - ${p.label}`);
                  }}
                >
                  <Image
                    source={{ uri: p.uri }}
                    style={s.thumbImage}
                    resizeMode="cover"
                  />
                  <Text style={s.thumbLabel}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* TO POLE PHOTOS ROW */}
          <View style={s.photoSectionCard}>
            <Text style={s.photoSectionTitle}>To Pole ({toCode})</Text>
            <View style={s.photoGridRow}>
              {toPhotos.map((p, idx) => (
                <Pressable
                  key={idx}
                  style={({ pressed }) => [
                    s.photoThumbWrap,
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => {
                    setViewerUri(p.uri);
                    setViewerTitle(`To Pole - ${p.label}`);
                  }}
                >
                  <Image
                    source={{ uri: p.uri }}
                    style={s.thumbImage}
                    resizeMode="cover"
                  />
                  <Text style={s.thumbLabel}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Lineman Accountability Footer */}
          <View style={s.footerBlock}>
            <Text style={s.footerTitle}>ASSIGNED LINEMAN</Text>
            <Text style={s.linemanName}>
              {logItem.lineman
                ? `${logItem.lineman.first_name} ${logItem.lineman.last_name}`
                : "Juan Dela Cruz"}
            </Text>
            <Text style={s.teamLbl}>{logItem.team?.name ?? "Team Alpha"}</Text>
          </View>
        </ScrollView>

        {/* Lightbox Image Viewer Modal */}
        <Modal
          visible={!!viewerUri}
          transparent
          animationType="fade"
          onRequestClose={() => setViewerUri(null)}
        >
          <View style={s.viewerBackdrop}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setViewerUri(null)}
            />
            <View style={s.viewerCard}>
              <View style={s.viewerHeader}>
                <Text style={s.viewerTitle}>{viewerTitle}</Text>
                <Pressable
                  onPress={() => setViewerUri(null)}
                  style={s.viewerClose}
                >
                  <Text style={s.viewerCloseText}>✕</Text>
                </Pressable>
              </View>
              {viewerUri ? (
                <Image
                  source={{ uri: viewerUri }}
                  style={s.viewerImage}
                  resizeMode="cover"
                />
              ) : null}
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F6F8",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },

  title: {
    fontSize: 20,
    fontWeight: "900",
    color: SLATE,
  },

  subtitle: {
    fontSize: 12,
    color: MUTED,
    fontWeight: "600",
    marginTop: 1,
  },

  scroll: {
    padding: 16,
    paddingBottom: 60,
  },

  mapWrapper: {
    borderRadius: 22,
    overflow: "hidden",
    marginBottom: 16,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },

  metricsGridRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },

  metricBox: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
  },

  metricLbl: {
    fontSize: 9,
    fontWeight: "900",
    color: MUTED,
    letterSpacing: 0.8,
  },

  metricValGreen: {
    fontSize: 22,
    fontWeight: "900",
    color: GREEN,
    marginTop: 4,
  },

  metricValDark: {
    fontSize: 15,
    fontWeight: "900",
    color: SLATE,
    marginTop: 8,
  },

  sectionTitle: {
    fontSize: 11,
    fontWeight: "900",
    color: "#98A2B3",
    letterSpacing: 1.2,
    marginTop: 12,
    marginBottom: 10,
  },

  componentsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 20,
  },

  compChip: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
  },

  compVal: {
    fontSize: 16,
    fontWeight: "900",
    color: BLUE,
  },

  compLbl: {
    fontSize: 9,
    fontWeight: "700",
    color: MUTED,
    marginTop: 2,
  },

  photoSectionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: BORDER,
    elevation: 1,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  photoSectionTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: SLATE,
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  photoGridRow: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  photoThumbWrap: {
    flex: 1,
    alignItems: "center",
  },
  thumbImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: BORDER,
  },
  thumbLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: MUTED,
    marginTop: 6,
    textAlign: "center",
  },

  footerBlock: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
  },

  footerTitle: {
    fontSize: 9,
    fontWeight: "900",
    color: MUTED,
    letterSpacing: 1,
  },

  linemanName: {
    fontSize: 16,
    fontWeight: "900",
    color: GREEN,
    marginTop: 4,
  },

  teamLbl: {
    fontSize: 12,
    fontWeight: "700",
    color: SLATE,
    marginTop: 2,
  },

  viewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  viewerCard: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 20,
    overflow: "hidden",
    elevation: 5,
  },
  viewerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  viewerTitle: { fontSize: 15, fontWeight: "900", color: SLATE },
  viewerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerCloseText: { fontSize: 14, fontWeight: "800", color: MUTED },
  viewerImage: { width: "100%", height: 340 },
});
