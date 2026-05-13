import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Camera } from "lucide-react-native";
import { FAKE_LOGS, SpanVicinityMap, TeardownLog } from "./[date]";

const GREEN = "#0B7A5A";
const BLUE = "#6366F1";
const ORANGE = "#F59E0B";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";

function PhotoCard({
  title,
  subtitle,
  imageUri,
  tagCode,
}: {
  title: string;
  subtitle?: string;
  imageUri?: string;
  tagCode?: string;
}) {
  return (
    <View style={s.photoCard}>
      <View style={s.photoHeader}>
        <View style={{ flex: 1 }}>
          <Text style={s.photoTitle}>{title}</Text>
          {subtitle ? <Text style={s.photoSubtitle}>{subtitle}</Text> : null}
        </View>
        {tagCode ? (
          <View style={s.tagBadge}>
            <Text style={s.tagBadgeText}>{tagCode}</Text>
          </View>
        ) : null}
      </View>

      <View style={s.imageShell}>
        <Image
          source={
            imageUri
              ? { uri: imageUri }
              : require("../../assets/images/logo.png")
          }
          style={s.photoImg}
          resizeMode={imageUri ? "cover" : "contain"}
        />
        {!imageUri && (
          <View style={s.placeholderOverlay}>
            <Camera size={28} color="#94A3B8" />
            <Text style={s.placeholderText}>Field Photo Preview</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function SpanPreviewScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();

  const logItem = useMemo(() => {
    const targetId = Number(id);
    return FAKE_LOGS.find((l) => l.id === targetId) ?? FAKE_LOGS[0];
  }, [id]);

  if (!logItem) return null;

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

          {/* Before Picture */}
          <PhotoCard
            title="Before Teardown"
            subtitle="Initial baseline view prior to unlashing"
            imageUri={samplePhotoUrl}
          />

          {/* After Picture */}
          <PhotoCard
            title="After Teardown"
            subtitle="Final clean span view after post-harvest recovery"
            imageUri={samplePhotoUrl}
          />

          {/* From Pole Tag */}
          <PhotoCard
            title="From Pole Tag"
            subtitle="Destination code sticker attachment verification"
            tagCode={fromCode}
          />

          {/* To Pole Tag */}
          <PhotoCard
            title="To Pole Tag"
            subtitle="Destination code sticker attachment verification"
            tagCode={toCode}
          />

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

  photoCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },

  photoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },

  photoTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: SLATE,
  },

  photoSubtitle: {
    fontSize: 11,
    color: MUTED,
    fontWeight: "600",
    marginTop: 2,
  },

  tagBadge: {
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },

  tagBadgeText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#2563EB",
  },

  imageShell: {
    height: 180,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER,
    position: "relative",
  },

  photoImg: {
    width: "100%",
    height: "100%",
  },

  placeholderOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(248, 250, 252, 0.85)",
    alignItems: "center",
    justifyContent: "center",
  },

  placeholderText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94A3B8",
    marginTop: 6,
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
});
