import api from "@/lib/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  Cable,
  ChevronLeft,
  Cpu,
  Route
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const GREEN = "#0B7A5A";
const GREEN_LIGHT = "#ECFDF3";
const BLUE = "#6366F1";
const ORANGE = "#F59E0B";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";

const CACHE_PREFIX = "daily_report_preview_";

const USE_FAKE_DATA = true;

const FAKE_DATE = "2026-05-12";

const TILE_PX = 256;

function latLngToTileFrac(lat: number, lng: number, z: number) {
  const n = Math.pow(2, z);
  const xFrac = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yFrac =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { xFrac, yFrac, tileX: Math.floor(xFrac), tileY: Math.floor(yFrac) };
}

function getDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

export function SpanVicinityMap({
  fromLat,
  fromLng,
  toLat,
  toLng,
  fromCode,
  toCode,
  nodeName,
}: {
  fromLat?: number;
  fromLng?: number;
  toLat?: number;
  toLng?: number;
  fromCode: string;
  toCode: string;
  nodeName?: string;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const validFrom =
    typeof fromLat === "number" && typeof fromLng === "number" && !isNaN(fromLat);
  const validTo =
    typeof toLat === "number" && typeof toLng === "number" && !isNaN(toLat);

  const pFrom = validFrom ? { lat: fromLat, lng: fromLng } : null;
  const pTo = validTo ? { lat: toLat, lng: toLng } : null;

  const pts: { lat: number; lng: number }[] = [];
  if (pFrom) pts.push(pFrom);
  if (pTo) pts.push(pTo);
  if (pts.length === 0) {
    pts.push({ lat: 14.5995, lng: 120.9842 });
  }

  const minLat = Math.min(...pts.map((p) => p.lat));
  const maxLat = Math.max(...pts.map((p) => p.lat));
  const minLng = Math.min(...pts.map((p) => p.lng));
  const maxLng = Math.max(...pts.map((p) => p.lng));

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  const w = size?.w ?? 320;
  const h = size?.h ?? 190;

  const latSpan = Math.max(maxLat - minLat, 0.0005);
  const lngSpan = Math.max(maxLng - minLng, 0.0005);

  const zLng = Math.log2((w * 0.45 * 360) / (TILE_PX * lngSpan));
  const zLat = Math.log2((h * 0.45 * 180) / (TILE_PX * latSpan));
  const baseZoom = Math.floor(Math.min(zLng, zLat));
  const zoom = Math.max(15, Math.min(19, baseZoom + 1));

  const { xFrac, yFrac, tileX, tileY } = latLngToTileFrac(
    centerLat,
    centerLng,
    zoom
  );
  const fracX = xFrac - tileX;
  const fracY = yFrac - tileY;

  const tileBase = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tileY}`;

  const scale = size ? Math.max(size.w / TILE_PX, size.h / TILE_PX) : 1;
  const imgW = TILE_PX * scale;
  const imgH = TILE_PX * scale;
  const offsetX = size ? size.w / 2 - fracX * imgW : 0;
  const offsetY = size ? size.h / 2 - fracY * imgH : 0;

  let startX = 0,
    startY = 0,
    endX = 0,
    endY = 0;
  if (size && pFrom) {
    const pf = latLngToTileFrac(pFrom.lat, pFrom.lng, zoom);
    startX = offsetX + (pf.xFrac - tileX) * imgW;
    startY = offsetY + (pf.yFrac - tileY) * imgH;
  }
  if (size && pTo) {
    const pt = latLngToTileFrac(pTo.lat, pTo.lng, zoom);
    endX = offsetX + (pt.xFrac - tileX) * imgW;
    endY = offsetY + (pt.yFrac - tileY) * imgH;
  }

  const spanLengthMeters =
    pFrom && pTo
      ? getDistanceMeters(pFrom.lat, pFrom.lng, pTo.lat, pTo.lng)
      : 0;

  return (
    <View
      style={{
        height: 190,
        borderRadius: 22,
        overflow: "hidden",
        backgroundColor: "#1E293B",
        position: "relative",
      }}
      onLayout={(e) =>
        setSize({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
    >
      <Image
        source={{ uri: `${tileBase}/${tileX - 1}` }}
        style={{
          position: "absolute",
          left: offsetX - imgW,
          top: offsetY,
          width: imgW,
          height: imgH,
        }}
        resizeMode="cover"
      />
      <Image
        source={{ uri: `${tileBase}/${tileX}` }}
        style={{
          position: "absolute",
          left: offsetX,
          top: offsetY,
          width: imgW,
          height: imgH,
        }}
        resizeMode="cover"
      />
      <Image
        source={{ uri: `${tileBase}/${tileX + 1}` }}
        style={{
          position: "absolute",
          left: offsetX + imgW,
          top: offsetY,
          width: imgW,
          height: imgH,
        }}
        resizeMode="cover"
      />

      <View
        style={{
          ...StyleSheet.absoluteFillObject,
          backgroundColor: "rgba(15, 23, 42, 0.35)",
        }}
      />

      {size && pFrom && pTo && (() => {
        const dx = endX - startX;
        const dy = endY - startY;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        const midX = startX + dx / 2;
        const midY = startY + dy / 2;

        return (
          <View
            style={{
              position: "absolute",
              left: midX - length / 2,
              top: midY - 1.5,
              width: length,
              height: 3,
              backgroundColor: "#38BDF8",
              transform: [{ rotate: `${angle}deg` }],
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.8,
              shadowRadius: 2,
            }}
          />
        );
      })()}

      {size && pFrom && (
        <View
          style={{
            position: "absolute",
            left: startX - 8,
            top: startY - 8,
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: GREEN,
              borderWidth: 2,
              borderColor: "#FFFFFF",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.5,
              shadowRadius: 4,
            }}
          />
          <View
            style={{
              backgroundColor: GREEN,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 6,
              marginTop: 3,
            }}
          >
            <Text style={{ fontSize: 9, fontWeight: "900", color: "#FFFFFF" }}>
              {fromCode}
            </Text>
          </View>
        </View>
      )}

      {size && pTo && (
        <View
          style={{
            position: "absolute",
            left: endX - 8,
            top: endY - 8,
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: ORANGE,
              borderWidth: 2,
              borderColor: "#FFFFFF",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.5,
              shadowRadius: 4,
            }}
          />
          <View
            style={{
              backgroundColor: ORANGE,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 6,
              marginTop: 3,
            }}
          >
            <Text style={{ fontSize: 9, fontWeight: "900", color: "#FFFFFF" }}>
              {toCode}
            </Text>
          </View>
        </View>
      )}

      <View
        style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          right: 12,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: "rgba(255, 255, 255, 0.92)",
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 14,
        }}
      >
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: "900", color: SLATE }}>
            {fromCode} → {toCode}
          </Text>
          {nodeName ? (
            <Text style={{ fontSize: 10, fontWeight: "600", color: MUTED, marginTop: 1 }} numberOfLines={1}>
              {nodeName}
            </Text>
          ) : null}
        </View>
        <View style={{ backgroundColor: "#EFF6FF", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, alignItems: "flex-end" }}>
          <Text style={{ fontSize: 9, fontWeight: "800", color: "#2563EB" }}>MAP PREVIEW</Text>
          {spanLengthMeters > 0 ? (
            <Text style={{ fontSize: 10, fontWeight: "900", color: "#1D4ED8", marginTop: 1 }}>
              ~{spanLengthMeters}m span
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export type TeardownLog = {
  id: number;
  status: string;
  actual_cable: number | null;
  expected_cable: number | null;

  nodes_collected: number;
  amplifiers_collected: number;
  extenders_collected: number;
  tsc_collected: number;

  powersupply_collected: number;
  ps_housing_collected: number;

  start_time: string;
  end_time: string | null;

  captured_lat?: number;
  captured_lng?: number;

  from_lat?: number;
  from_lng?: number;

  to_lat?: number;
  to_lng?: number;

  span?: {
    id: number;

    fromPole?: {
      pole?: {
        pole_code?: string;
      };
    };

    toPole?: {
      pole?: {
        pole_code?: string;
      };
    };

    node?: {
      name?: string;
    };
  };

  team?: {
    name?: string;
  };

  lineman?: {
    id?: number;
    first_name?: string;
    last_name?: string;
  };
};

export const FAKE_LOGS: TeardownLog[] = [
  {
    id: 1,
    status: "submitted",
    actual_cable: 120,
    expected_cable: 150,

    nodes_collected: 2,
    amplifiers_collected: 1,
    extenders_collected: 0,
    tsc_collected: 1,

    powersupply_collected: 0,
    ps_housing_collected: 0,

    start_time: "2026-05-12T08:30:00",
    end_time: "2026-05-12T10:15:00",

    from_lat: 14.599512,
    from_lng: 120.984222,

    to_lat: 14.599882,
    to_lng: 120.984612,

    span: {
      id: 101,

      fromPole: {
        pole: {
          pole_code: "P-001",
        },
      },

      toPole: {
        pole: {
          pole_code: "P-002",
        },
      },

      node: {
        name: "Node Manila A",
      },
    },

    team: {
      name: "Team Alpha",
    },

    lineman: {
      first_name: "Juan",
      last_name: "Dela Cruz",
    },
  },

  {
    id: 2,
    status: "backend_approved",
    actual_cable: 85,
    expected_cable: 100,

    nodes_collected: 1,
    amplifiers_collected: 0,
    extenders_collected: 2,
    tsc_collected: 0,

    powersupply_collected: 1,
    ps_housing_collected: 0,

    start_time: "2026-05-12T11:00:00",
    end_time: "2026-05-12T12:20:00",

    from_lat: 14.60012,
    from_lng: 120.98501,

    to_lat: 14.60046,
    to_lng: 120.98539,

    span: {
      id: 102,

      fromPole: {
        pole: {
          pole_code: "P-003",
        },
      },

      toPole: {
        pole: {
          pole_code: "P-004",
        },
      },

      node: {
        name: "Node Manila B",
      },
    },

    team: {
      name: "Team Alpha",
    },

    lineman: {
      first_name: "Mark",
      last_name: "Santos",
    },
  },

  {
    id: 3,
    status: "pending",
    actual_cable: 60,
    expected_cable: 80,

    nodes_collected: 0,
    amplifiers_collected: 1,
    extenders_collected: 1,
    tsc_collected: 0,

    powersupply_collected: 0,
    ps_housing_collected: 1,

    start_time: "2026-05-12T13:10:00",
    end_time: "2026-05-12T14:05:00",

    from_lat: 14.60102,
    from_lng: 120.9861,

    to_lat: 14.60139,
    to_lng: 120.98647,

    span: {
      id: 103,

      fromPole: {
        pole: {
          pole_code: "P-005",
        },
      },

      toPole: {
        pole: {
          pole_code: "P-006",
        },
      },

      node: {
        name: "Node Manila C",
      },
    },

    team: {
      name: "Team Bravo",
    },

    lineman: {
      first_name: "Carlo",
      last_name: "Reyes",
    },
  },
];

function formatTime(time?: string | null) {
  if (!time) return "--";

  return new Date(time).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DailyReportPreviewScreen() {
  const router = useRouter();

  const params = useLocalSearchParams<{
    date: string;
  }>();

  const date = USE_FAKE_DATA ? FAKE_DATE : params.date;

  const [allLogs, setAllLogs] = useState<TeardownLog[]>(
    USE_FAKE_DATA ? FAKE_LOGS : [],
  );

  const [loading, setLoading] = useState(!USE_FAKE_DATA);

  const [refreshing, setRefreshing] = useState(false);

  const [backgroundSyncing, setBackgroundSyncing] = useState(false);

  const fetchLogs = useCallback(async () => {
    if (USE_FAKE_DATA) {
      setAllLogs(FAKE_LOGS);

      setLoading(false);
      setRefreshing(false);
      setBackgroundSyncing(false);

      return;
    }

    try {
      const cacheKey = `${CACHE_PREFIX}${date}`;

      const cache = await AsyncStorage.getItem(cacheKey);

      if (cache) {
        setAllLogs(JSON.parse(cache));
        setLoading(false);
      }

      setBackgroundSyncing(true);

      const { data } = await api.get(`/skycable/teardowns?date=${date}`);

      const items = data?.data ?? data ?? [];

      setAllLogs(items);

      await AsyncStorage.setItem(cacheKey, JSON.stringify(items));
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setBackgroundSyncing(false);
    }
  }, [date]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const totalCable = useMemo(() => {
    return allLogs.reduce((sum, log) => sum + (log.actual_cable ?? 0), 0);
  }, [allLogs]);

  const totalNodes = useMemo(() => {
    return allLogs.reduce((sum, log) => sum + (log.nodes_collected ?? 0), 0);
  }, [allLogs]);

  const totalAmplifiers = useMemo(() => {
    return allLogs.reduce(
      (sum, log) => sum + (log.amplifiers_collected ?? 0),
      0,
    );
  }, [allLogs]);

  const totalExtenders = useMemo(() => {
    return allLogs.reduce(
      (sum, log) => sum + (log.extenders_collected ?? 0),
      0,
    );
  }, [allLogs]);

  const totalTSC = useMemo(() => {
    return allLogs.reduce((sum, log) => sum + (log.tsc_collected ?? 0), 0);
  }, [allLogs]);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={s.title}>Daily Report</Text>

            <Text style={s.subtitle}>
              {date}
              {backgroundSyncing ? " · updating..." : ""}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={GREEN} />

            <Text style={s.loadingText}>Loading report...</Text>
          </View>
        ) : (
          <FlatList
            data={allLogs}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={s.list}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  fetchLogs();
                }}
                colors={[GREEN]}
              />
            }
            ListHeaderComponent={
              <>
                <View
                  style={{
                    flexDirection: "row",
                    gap: 8,
                    marginBottom: 20,
                  }}
                >
                  {[
                    {
                      label: "Spans",
                      value: String(allLogs.length),
                      color: SLATE,
                    },
                    {
                      label: "Poles",
                      value: String(allLogs.length * 2),
                      color: ORANGE,
                    },
                    {
                      label: "Cable",
                      value: `${totalCable}m`,
                      color: GREEN,
                    },
                    {
                      label: "Subcomps",
                      value: String(
                        totalNodes +
                          totalAmplifiers +
                          totalExtenders +
                          totalTSC
                      ),
                      color: BLUE,
                    },
                  ].map((stat, idx) => (
                    <View
                      key={idx}
                      style={{
                        flex: 1,
                        backgroundColor: "#FFFFFF",
                        paddingVertical: 12,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: BORDER,
                        alignItems: "center",
                        elevation: 1,
                        shadowColor: "#000",
                        shadowOpacity: 0.04,
                        shadowRadius: 4,
                        shadowOffset: { width: 0, height: 2 },
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 15,
                          fontWeight: "900",
                          color: stat.color,
                        }}
                        numberOfLines={1}
                      >
                        {stat.value}
                      </Text>
                      <Text
                        style={{
                          fontSize: 9,
                          fontWeight: "700",
                          color: MUTED,
                          marginTop: 2,
                        }}
                        numberOfLines={1}
                      >
                        {stat.label.toUpperCase()}
                      </Text>
                    </View>
                  ))}
                </View>

                <Text style={s.sectionTitle}>TEARDOWN SPANS</Text>
              </>
            }
            renderItem={({ item }) => {
              const duration =
                item.start_time && item.end_time
                  ? `${formatTime(item.start_time)} - ${formatTime(
                      item.end_time,
                    )}`
                  : "--";

              const fromCode = item.span?.fromPole?.pole?.pole_code ?? "--";
              const toCode = item.span?.toPole?.pole?.pole_code ?? "--";
              const nodeName = item.span?.node?.name ?? "Unknown Node";

              const fl = item.from_lat ?? item.captured_lat;
              const fg = item.from_lng ?? item.captured_lng;
              const tl = item.to_lat ?? fl;
              const tg = item.to_lng ?? fg;

              const statusMap: Record<
                string,
                { label: string; bg: string; color: string; border: string }
              > = {
                submitted: {
                  label: "Completed",
                  bg: "#ECFDF3",
                  color: "#0B7A5A",
                  border: "#A7F3D0",
                },
                backend_approved: {
                  label: "Approved",
                  bg: "#ECFDF3",
                  color: "#027A48",
                  border: "#A7F3D0",
                },
                subcon_approved: {
                  label: "Subcon Approved",
                  bg: "#ECFDF3",
                  color: "#0B7A5A",
                  border: "#A7F3D0",
                },
                rejected: {
                  label: "Rejected",
                  bg: "#FEF2F2",
                  color: "#DC2626",
                  border: "#FECACA",
                },
                pending: {
                  label: "Pending Upload",
                  bg: "#FFFBEB",
                  color: "#D97706",
                  border: "#FDE68A",
                },
              };
              const st = statusMap[item.status?.toLowerCase()] ?? {
                label: item.status?.toUpperCase() || "COMPLETED",
                bg: "#ECFDF3",
                color: "#0B7A5A",
                border: "#A7F3D0",
              };

              return (
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={s.card}
                  onPress={() =>
                    router.push({
                      pathname: "/daily-report/preview",
                      params: { id: item.id },
                    })
                  }
                >
                  <View style={s.mapCard}>
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

                  <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                    <View
                      style={{
                        flex: 1,
                        backgroundColor: "#F8FAFC",
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: BORDER,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 9,
                          fontWeight: "900",
                          color: MUTED,
                          letterSpacing: 0.5,
                        }}
                      >
                        COLLECTED
                      </Text>
                      <Text
                        style={{
                          fontSize: 16,
                          fontWeight: "900",
                          color: GREEN,
                          marginTop: 2,
                        }}
                      >
                        {item.actual_cable ?? 0}m
                      </Text>
                    </View>

                    <View
                      style={{
                        flex: 1,
                        backgroundColor: "#F8FAFC",
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: BORDER,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 9,
                          fontWeight: "900",
                          color: MUTED,
                          letterSpacing: 0.5,
                        }}
                      >
                        DURATION
                      </Text>
                      <Text
                        style={{
                          fontSize: 13,
                          fontWeight: "800",
                          color: SLATE,
                          marginTop: 4,
                        }}
                      >
                        {duration}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    {[
                      { label: "Nodes", count: item.nodes_collected ?? 0 },
                      { label: "Amps", count: item.amplifiers_collected ?? 0 },
                      { label: "Exts", count: item.extenders_collected ?? 0 },
                      { label: "TSC", count: item.tsc_collected ?? 0 },
                    ].map((comp, idx) => (
                      <View
                        key={idx}
                        style={{
                          flex: 1,
                          backgroundColor: "#FFFFFF",
                          paddingVertical: 8,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: BORDER,
                          alignItems: "center",
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: "900",
                            color: BLUE,
                          }}
                        >
                          {comp.count}
                        </Text>
                        <Text
                          style={{
                            fontSize: 9,
                            fontWeight: "700",
                            color: MUTED,
                            marginTop: 1,
                          }}
                        >
                          {comp.label.toUpperCase()}
                        </Text>
                      </View>
                    ))}
                  </View>

                  <View style={{ alignItems: "center", marginTop: 12 }}>
                    <View
                      style={{
                        backgroundColor: st.bg,
                        paddingHorizontal: 16,
                        paddingVertical: 6,
                        borderRadius: 100,
                        borderWidth: 1,
                        borderColor: st.border,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: "900",
                          color: st.color,
                          letterSpacing: 0.5,
                        }}
                      >
                        {st.label.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <View style={s.footerRow}>
                    <Text style={s.teamText}>{item.team?.name ?? "--"}</Text>

                    <Text style={s.linemanText}>
                      {item.lineman
                        ? `${item.lineman.first_name} ${item.lineman.last_name}`
                        : "--"}
                    </Text>
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
  container: {
    flex: 1,
    backgroundColor: "#F4F6F8",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 12,
  },

  backBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },

  title: {
    fontSize: 28,
    fontWeight: "900",
    color: SLATE,
  },

  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: MUTED,
    fontWeight: "600",
  },

  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  loadingText: {
    marginTop: 14,
    fontSize: 14,
    color: MUTED,
    fontWeight: "600",
  },

  list: {
    padding: 16,
    paddingBottom: 120,
  },

  sectionTitle: {
    marginTop: 10,
    marginBottom: 14,
    fontSize: 11,
    fontWeight: "900",
    color: "#98A2B3",
    letterSpacing: 1,
  },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },

  mapCard: {
    borderRadius: 22,
    overflow: "hidden",
    marginBottom: 16,
    marginTop: -28,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: {
      width: 0,
      height: 6,
    },
  },

  footerRow: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  teamText: {
    fontSize: 13,
    fontWeight: "800",
    color: GREEN,
  },

  linemanText: {
    fontSize: 13,
    fontWeight: "700",
    color: MUTED,
  },
});
