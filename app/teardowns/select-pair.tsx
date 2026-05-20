import api from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/cache";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

type SpanPoleRef = {
  id: number;
  pole?: { id: number; pole_code: string; lat?: string | null; lng?: string | null } | null;
} | null;

type Span = {
  id: number;
  span_code: string | null;
  strand_length: number;
  number_of_runs: number;
  status: string;
  from_pole: SpanPoleRef;
  to_pole: SpanPoleRef;
  components?: { component_type: string; expected_count: number }[];
};

function sanitize(s?: string) {
  return (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "_");
}

function buildSpanMapHtml(
  fromLat: number,
  fromLng: number,
  fromLabel: string,
  toLat: number,
  toLng: number,
  toLabel: string,
  accent: string,
) {
  const midLat = (fromLat + toLat) / 2;
  const midLng = (fromLng + toLng) / 2;

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body,#map{
  width:100%;
  height:100%;
  background:#eef2f7;
  font-family:-apple-system,BlinkMacSystemFont,sans-serif;
}
.leaflet-div-icon{background:none!important;border:none!important;}
.pin{display:flex;flex-direction:column;align-items:center;}
.pin-dot{
  width:14px;
  height:14px;
  border-radius:50%;
  border:2px solid #fff;
  box-shadow:0 2px 8px rgba(0,0,0,0.35);
}
.pin-label{
  margin-top:4px;
  background:rgba(15,23,42,0.88);
  color:#fff;
  font-size:10px;
  font-weight:800;
  padding:4px 8px;
  border-radius:999px;
  white-space:nowrap;
}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('map',{
  zoomControl:true,
  scrollWheelZoom:true,
  dragging:true,
  doubleClickZoom:true,
  touchZoom:true
}).setView([${midLat},${midLng}],16);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{
  subdomains:'abcd',
  maxZoom:20
}).addTo(map);

var fromIcon=L.divIcon({
  className:'',
  html:'<div class="pin"><div class="pin-dot" style="background:${accent}"></div><div class="pin-label">${fromLabel}</div></div>',
  iconAnchor:[7,7]
});

var toIcon=L.divIcon({
  className:'',
  html:'<div class="pin"><div class="pin-dot" style="background:#6366F1"></div><div class="pin-label">${toLabel}</div></div>',
  iconAnchor:[7,7]
});

L.marker([${fromLat},${fromLng}],{icon:fromIcon}).addTo(map);
L.marker([${toLat},${toLng}],{icon:toIcon}).addTo(map);

L.polyline([[${fromLat},${fromLng}],[${toLat},${toLng}]],{
  color:'${accent}',
  weight:5,
  opacity:0.9,
  dashArray:'8,5'
}).addTo(map);


var bounds=L.latLngBounds([[${fromLat},${fromLng}],[${toLat},${toLng}]]);
map.fitBounds(bounds,{padding:[48,48],maxZoom:18});
setTimeout(function(){ map.invalidateSize(); }, 120);
</script>
</body>
</html>`;
}

function getExpected(span: Span, type: string) {
  return span.components?.find((c) => c.component_type === type)?.expected_count ?? 0;
}

function getSpanCoords(
  span: Span,
  poleId: string,
  fallbackFromLat?: string,
  fallbackFromLng?: string,
) {
  const isFromPole = String(span.from_pole?.pole?.id) === String(poleId);

  const fromLat = isFromPole
    ? (fallbackFromLat ?? span.from_pole?.pole?.lat ?? null)
    : (span.to_pole?.pole?.lat ?? null);
  const fromLng = isFromPole
    ? (fallbackFromLng ?? span.from_pole?.pole?.lng ?? null)
    : (span.to_pole?.pole?.lng ?? null);
  const toLat = isFromPole
    ? (span.to_pole?.pole?.lat ?? null)
    : (span.from_pole?.pole?.lat ?? null);
  const toLng = isFromPole
    ? (span.to_pole?.pole?.lng ?? null)
    : (span.from_pole?.pole?.lng ?? null);

  const hasCoords = !!(fromLat && fromLng && toLat && toLng);

  return {
    hasCoords,
    fromLat: fromLat ? Number(fromLat) : null,
    fromLng: fromLng ? Number(fromLng) : null,
    toLat: toLat ? Number(toLat) : null,
    toLng: toLng ? Number(toLng) : null,
  };
}

function shortPole(code?: string | null) {
  if (!code) return "—";
  return code.replace(/^[A-Z0-9]+-/, "");
}

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statPillLabel}>{label}</Text>
      <Text style={styles.statPillValue}>{value}</Text>
    </View>
  );
}

function DetailStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <View style={styles.detailStatCard}>
      <Text style={styles.detailStatLabel}>{label}</Text>
      <Text style={styles.detailStatValue}>{value}</Text>
    </View>
  );
}

function RouteMini({
  fromCode,
  toCode,
  accentColor,
}: {
  fromCode: string;
  toCode: string;
  accentColor: string;
}) {
  return (
    <View style={styles.routeMini}>
      <View style={styles.routeMiniPole}>
        <View style={[styles.routeMiniDot, { backgroundColor: accentColor }]} />
        <Text style={styles.routeMiniCode} numberOfLines={1} ellipsizeMode="tail">
          {fromCode}
        </Text>
      </View>

      <View style={styles.routeMiniCenter}>
        <View style={[styles.routeMiniLine, { borderColor: `${accentColor}66` }]} />
        <MaterialCommunityIcons name="transmission-tower" size={11} color={accentColor} />
        <View style={[styles.routeMiniLine, { borderColor: `${accentColor}66` }]} />
      </View>

      <View style={[styles.routeMiniPole, { justifyContent: "flex-end" }]}>
        <View style={[styles.routeMiniDot, { backgroundColor: "#6366F1" }]} />
        <Text style={styles.routeMiniCode} numberOfLines={1} ellipsizeMode="tail">
          {toCode}
        </Text>
      </View>
    </View>
  );
}

function SpanCard({
  fromCode,
  poleCode,
  poleName,
  spanCode,
  expectedCable,
  lengthMeters,
  runs,
  accentColor,
  index,
  onCardPress,
  onVicinityPress,
}: {
  fromCode: string;
  poleCode: string;
  poleName: string;
  spanCode: string;
  expectedCable: number;
  lengthMeters: number;
  runs: number;
  accentColor: string;
  index: number;
  onCardPress: () => void;
  onVicinityPress: () => void;
}) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          scale: withSpring(pressed.value ? 0.985 : 1, {
            damping: 18,
            stiffness: 240,
          }),
        },
      ],
      opacity: withTiming(pressed.value ? 0.97 : 1, { duration: 100 }),
    };
  });

  return (
    <Animated.View entering={FadeInDown.delay(index * 70).springify()}>
      <Pressable
        onPress={onCardPress}
        onPressIn={() => {
          pressed.value = 1;
        }}
        onPressOut={() => {
          pressed.value = 0;
        }}
      >
        <Animated.View
          style={[
            styles.spanCard,
            {
              borderColor: `${accentColor}20`,
              shadowColor: accentColor,
            },
            animatedStyle,
          ]}
        >
          <View
            style={[
              styles.spanCardGlowOne,
              { backgroundColor: `${accentColor}12` },
            ]}
          />
          <View
            style={[
              styles.spanCardGlowTwo,
              { backgroundColor: `${accentColor}0D` },
            ]}
          />

          <View style={styles.spanCardTop}>
            <View
              style={[
                styles.destinationPill,
                {
                  backgroundColor: `${accentColor}12`,
                  borderColor: `${accentColor}24`,
                },
              ]}
            >
              <Text
                style={[styles.destinationPillText, { color: accentColor }]}
              >
                Destination Pole
              </Text>
            </View>

            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onVicinityPress();
              }}
              style={({ pressed: btnPressed }) => [
                styles.iconGhostBtn,
                btnPressed && styles.buttonPressed,
              ]}
            >
              <Ionicons name="map-outline" size={17} color={accentColor} />
            </Pressable>
          </View>

          <RouteMini
            fromCode={shortPole(fromCode)}
            toCode={shortPole(poleCode)}
            accentColor={accentColor}
          />

          <Text
            style={[styles.spanPoleCode, { color: accentColor }]}
            numberOfLines={1}
          >
            {poleCode}
          </Text>

          <Text style={styles.spanPoleName} numberOfLines={1}>
            {poleName || poleCode}
          </Text>

          <Text style={styles.spanCodeText} numberOfLines={1}>
            {spanCode || "No span code"}
          </Text>

          <View style={styles.spanStatsRow}>
            <StatPill label="Cable" value={`${expectedCable}m`} />
            <StatPill label="Length" value={`${lengthMeters}m`} />
            <StatPill label="Runs" value={runs} />
          </View>

          <View style={styles.bottomActions}>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onVicinityPress();
              }}
              style={({ pressed: btnPressed }) => [
                styles.secondaryAction,
                {
                  backgroundColor: `${accentColor}10`,
                  borderColor: `${accentColor}24`,
                },
                btnPressed && styles.buttonPressed,
              ]}
            >
              <Ionicons
                name="navigate-circle-outline"
                size={16}
                color={accentColor}
              />
              <Text
                style={[styles.secondaryActionText, { color: accentColor }]}
              >
                View Vicinity
              </Text>
            </Pressable>

            <View
              style={[
                styles.primaryHint,
                {
                  backgroundColor: `${accentColor}0E`,
                  borderColor: `${accentColor}20`,
                },
              ]}
            >
              <Text style={[styles.primaryHintText, { color: accentColor }]}>
                Tap card to continue
              </Text>
            </View>
          </View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

export default function SelectPairScreen() {
  const {
    pole_id,
    pole_code,
    pole_name,
    node_id,
    project_id,
    project_name,
    accent,
    from_pole_latitude,
    from_pole_longitude,
    from_pole_gps_captured_at,
  } = useLocalSearchParams<{
    pole_id: string;
    pole_code: string;
    pole_name: string;
    node_id: string;
    project_id: string;
    project_name: string;
    accent: string;
    from_pole_latitude: string;
    from_pole_longitude: string;
    from_pole_gps_captured_at: string;
  }>();

  const accentColor = accent || "#0B7A5A";

  const [spans, setSpans] = useState<Span[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "empty">("loading");
  const [allDone, setAllDone] = useState(false); // true = had spans but all completed

  // Auto-navigate back to poles after 2 s when all spans are done
  useEffect(() => {
    if (!allDone) return;
    const timer = setTimeout(() => {
      router.replace({
        pathname: "/teardowns/poles",
        params: { nodeId: node_id, nodeName: pole_name, accent },
      } as any);
    }, 2000);
    return () => clearTimeout(timer);
  }, [allDone, accent, node_id, pole_name]);
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const [showVicinityModal, setShowVicinityModal] = useState(false);

  // Report new intermediate pole
  const [showNewPoleModal, setShowNewPoleModal] = useState(false);
  const [newPoleName, setNewPoleName] = useState("");
  const [newPoleSpanId, setNewPoleSpanId] = useState<number | null>(null);
  const [newPoleTargetSpan, setNewPoleTargetSpan] = useState<Span | null>(null);
  const [submittingNewPole, setSubmittingNewPole] = useState(false);

  useEffect(() => {
    if (!pole_code || !node_id) return;

    (async () => {
      const projFolder = sanitize(project_name);
      const poleSanitized = sanitize(pole_code);
      const srcDir = `${FileSystem.documentDirectory}pole_drafts/${projFolder}/${node_id}/${pole_id}/`;
      const destDir = `${FileSystem.documentDirectory}teardown_drafts/${projFolder}/${node_id}/${pole_id}/`;

      await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });

      const srcFiles = [
        {
          src: `pole_${pole_id}_before.jpg`,
          dest: `${poleSanitized}_before.jpg`,
        },
        {
          src: `pole_${pole_id}_after.jpg`,
          dest: `${poleSanitized}_after.jpg`,
        },
        {
          src: `pole_${pole_id}_poletag.jpg`,
          dest: `${poleSanitized}_poletag.jpg`,
        },
      ];

      let beforeCopied = false;

      for (const f of srcFiles) {
        const srcPath = srcDir + f.src;
        const destPath = destDir + f.dest;
        const info = await FileSystem.getInfoAsync(srcPath);

        if (info.exists) {
          const destInfo = await FileSystem.getInfoAsync(destPath);
          if (!destInfo.exists) {
            await FileSystem.copyAsync({ from: srcPath, to: destPath }).catch(
              () => {},
            );
          }
          if (f.dest.includes("_before")) beforeCopied = true;
        }
      }

      if (!beforeCopied) {
        const destInfo = await FileSystem.getInfoAsync(
          destDir + `${poleSanitized}_before.jpg`,
        );

        if (!destInfo.exists) {
          Alert.alert(
            "Photos not found",
            "Starting pole photos not found. Please go back and retake them.",
            [{ text: "Go Back", onPress: () => router.back() }],
          );
        }
      }
    })();
  }, [pole_code, node_id, project_name, pole_id]);

  const getDisplayPole = useCallback((span: Span) => {
    const isFromPole = String(span.from_pole?.pole?.id) === String(pole_id);
    return isFromPole ? span.to_pole?.pole : span.from_pole?.pole;
  }, [pole_id]);

  const navigateToKabila = useCallback((span: Span) => {
    const isFromPole = String(span.from_pole?.pole?.id) === String(pole_id);
    const destPole = isFromPole ? span.to_pole : span.from_pole;

    const actualFromCode = isFromPole ? pole_code : (span.to_pole?.pole?.pole_code ?? pole_code);
    const actualFromName = isFromPole ? (pole_name ?? pole_code) : (span.to_pole?.pole?.pole_code ?? pole_code);
    const actualToId = String(destPole?.pole?.id ?? "");
    const actualToCode = destPole?.pole?.pole_code ?? "";
    const actualToName = destPole?.pole?.pole_code ?? "";

    router.push({
      pathname: "/teardowns/destination-pole" as any,
      params: {
        pole_code: actualFromCode,
        pole_name: actualFromName,
        node_id,
        project_id,
        project_name,
        accent,
        span_id: String(span.id),
        span_code: span.span_code ?? "",
        to_pole_id: actualToId,
        to_pole_code: actualToCode,
        to_pole_name: actualToName,
        expected_cable: String(getExpected(span, "cable")),
        length_meters: String(span.strand_length),
        declared_runs: String(span.number_of_runs),
        expected_node: String(getExpected(span, "node")),
        expected_amplifier: String(getExpected(span, "amplifier")),
        expected_extender: String(getExpected(span, "extender")),
        expected_tsc: String(getExpected(span, "tsc")),
        expected_powersupply: String(getExpected(span, "powersupply")),
        expected_powersupply_housing: String(getExpected(span, "powersupply_case")),
        from_pole_id: pole_id ?? "",
        from_pole_latitude: from_pole_latitude ?? "",
        from_pole_longitude: from_pole_longitude ?? "",
        from_pole_gps_captured_at: from_pole_gps_captured_at ?? "",
      },
    });
  }, [accent, from_pole_gps_captured_at, from_pole_latitude, from_pole_longitude, node_id, pole_code, pole_id, pole_name, project_id, project_name]);

  useEffect(() => {
    if (!pole_id || !node_id) return;

    setStatus("loading");
    const CACHE_KEY = `spans_pole_${pole_id}`;

    cacheGet<Span[]>(CACHE_KEY).then((cached) => {
      if (cached?.length) {
        const active = cached.filter((s) => s.status !== "completed" && s.status !== "superseded");
        if (active.length === 1) {
          navigateToKabila(active[0]);
          return;
        }
        if (active.length > 0) {
          setSpans(active);
          setStatus("ok");
          return; // Skip background fetch if we already have valid data
        }
      }

      api
        .get(`/skycable/spans?node_id=${node_id}`)
        .then(({ data }) => {
          const all: Span[] = Array.isArray(data) ? data : (data?.data ?? []);
          const list = all.filter(
            (s) =>
              String(s.from_pole?.pole?.id) === String(pole_id) ||
              String(s.to_pole?.pole?.id) === String(pole_id),
          );
          cacheSet(CACHE_KEY, list);

          const active = list.filter((s) => s.status !== "completed" && s.status !== "superseded");

          if (active.length === 0) {
            if (list.length > 0) setAllDone(true); // had spans but all completed
            setStatus("empty");
            return;
          }

          if (active.length === 1) {
            navigateToKabila(active[0]);
            return;
          }

          setSpans(active);
          setStatus("ok");
        })
        .catch(() => {
          if (!cached?.length) {
            setStatus("error");
          } else {
            const active = cached.filter((s) => s.status !== "completed" && s.status !== "superseded");
            if (active.length === 0) {
              if (cached.length > 0) setAllDone(true);
              setStatus("empty");
            }
          }
        });
    });
  }, [pole_id, node_id, navigateToKabila]);


  function retryFetch() {
    if (!pole_id || !node_id) return;

    setStatus("loading");
    const CACHE_KEY = `spans_pole_${pole_id}`;

    api
      .get(`/skycable/spans?node_id=${node_id}`)
      .then(({ data }) => {
        const all: Span[] = Array.isArray(data) ? data : (data?.data ?? []);
        const list = all.filter(
          (s) =>
            String(s.from_pole?.pole?.id) === String(pole_id) ||
            String(s.to_pole?.pole?.id) === String(pole_id),
        );
        cacheSet(CACHE_KEY, list);

        const active = list.filter((s) => s.status !== "completed" && s.status !== "superseded");

        if (active.length === 0) {
          setStatus("empty");
          return;
        }

        if (active.length === 1) {
          navigateToKabila(active[0]);
          return;
        }

        setSpans(active);
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }

  function openVicinity(span: Span) {
    setSelectedSpan(span);
    setShowVicinityModal(true);
  }

  function openNewPoleModal(span: Span) {
    const fromLabel = span.from_pole?.pole?.pole_code ?? "Pole 1";
    const toLabel   = span.to_pole?.pole?.pole_code   ?? "Pole 2";
    Alert.alert(
      "Insert New Pole",
      `Do you want to add a new pole between:\n\n${fromLabel}  →  ${toLabel}\n\nThis will split the span into two new connections.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, Continue",
          onPress: () => {
            setNewPoleSpanId(span.id);
            setNewPoleTargetSpan(span);
            setNewPoleName("");
            setShowNewPoleModal(true);
          },
        },
      ],
    );
  }

  async function handleReportNewPole() {
    const name = newPoleName.trim();
    if (!name || !newPoleSpanId) return;
    setSubmittingNewPole(true);

    // Generate idempotency key so duplicate taps / retries don't create duplicate poles
    const idemKey = `split_${newPoleSpanId}_${Date.now()}`;

    try {
      const res = await api.post(`/skycable/spans/${newPoleSpanId}/split`, {
        pole_name: name,
        idempotency_key: idemKey,
      });
      const { span_a, span_b, new_pole } = (res as any).data ?? res;

      setShowNewPoleModal(false);
      setNewPoleName("");
      const splitId = newPoleSpanId;
      setNewPoleSpanId(null);
      setNewPoleTargetSpan(null);

      // Instantly update the spans list — no alert, list refreshes immediately
      setSpans((prev) => {
        const without = prev.filter((s) => s.id !== splitId);
        const built: Span[] = [];
        for (const s of [span_a, span_b]) {
          if (!s) continue;
          const involvesCurrent =
            String(s.from_pole?.pole?.id) === String(pole_id) ||
            String(s.to_pole?.pole?.id)   === String(pole_id);
          if (involvesCurrent) built.push(s);
        }
        const next = [...without, ...built];
        cacheSet(`spans_pole_${pole_id}`, next).catch(() => {});
        if (new_pole?.id) cacheSet(`spans_pole_${new_pole.id}`, null).catch(() => {});
        return next;
      });
    } catch (e: any) {
      const status = (e as any)?.response?.status;
      const msg    = (e as any)?.response?.data?.message ?? (e as any)?.message ?? "Unknown error";

      if (status === 409) {
        Alert.alert("Already Split", "This span was already split. Pull to refresh your span list.");
      } else if (!status) {
        // Network error — inform user they need internet for this operation
        Alert.alert(
          "Internet Required",
          "Adding a new pole creates server records that other operations depend on.\n\nPlease connect to the internet and try again.",
        );
      } else {
        Alert.alert("Failed to Add Pole", `${msg}`);
      }
    } finally {
      setSubmittingNewPole(false);
    }
  }

  const selectedDisplayPole = useMemo(() => {
    if (!selectedSpan) return null;
    return getDisplayPole(selectedSpan);
  }, [selectedSpan, getDisplayPole]);

  const spanCoords = useMemo(() => {
    if (!selectedSpan) {
      return {
        hasCoords: false,
        fromLat: null,
        fromLng: null,
        toLat: null,
        toLng: null,
      };
    }

    return getSpanCoords(selectedSpan, pole_id ?? "", from_pole_latitude, from_pole_longitude);
  }, [selectedSpan, from_pole_latitude, from_pole_longitude, pole_id]);

  const mapHtml = useMemo(() => {
    if (
      !selectedSpan ||
      !spanCoords.hasCoords ||
      spanCoords.fromLat == null ||
      spanCoords.fromLng == null ||
      spanCoords.toLat == null ||
      spanCoords.toLng == null
    ) {
      return null;
    }

    return buildSpanMapHtml(
      spanCoords.fromLat,
      spanCoords.fromLng,
      pole_code || "FROM",
      spanCoords.toLat,
      spanCoords.toLng,
      selectedDisplayPole?.pole_code || "TO",
      accentColor,
    );
  }, [selectedSpan, spanCoords, pole_code, selectedDisplayPole, accentColor]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" backgroundColor="#F4F6F8" />

      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.floatingHeader}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color="#111827" />
          </Pressable>

          <View style={styles.floatingHeaderText}>
            <Text style={styles.headerTitle}>Select Span</Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {pole_name || pole_code}
            </Text>
          </View>

          <Pressable
            style={[
              styles.headerAccentBadge,
              { backgroundColor: `${accentColor}14`, borderColor: `${accentColor}28` },
            ]}
            onPress={() =>
              router.push({
                pathname: "/teardowns/poles",
                params: { nodeId: node_id, nodeName: pole_name, accent },
              } as any)
            }
          >
            <View style={[styles.headerAccentDot, { backgroundColor: accentColor }]} />
            <Text style={[styles.headerAccentText, { color: accentColor }]}>
              Poles
            </Text>
          </Pressable>
        </View>

        {status === "loading" && (
          <View style={styles.center}>
            <View
              style={[
                styles.loadingOrb,
                { backgroundColor: `${accentColor}12` },
              ]}
            >
              <ActivityIndicator size="large" color={accentColor} />
            </View>
            <Text style={styles.centerTitle}>Loading available spans</Text>
            <Text style={styles.centerSub}>
              Checking nearby connections for this starting pole.
            </Text>
          </View>
        )}

        {status === "error" && (
          <View style={styles.center}>
            <View style={styles.stateIconWrap}>
              <Ionicons
                name="cloud-offline-outline"
                size={30}
                color="#B42318"
              />
            </View>
            <Text style={styles.centerTitle}>Could not load spans</Text>
            <Text style={styles.centerSub}>
              Check your connection and try again.
            </Text>

            <Pressable
              style={[styles.primaryButton, { backgroundColor: accentColor }]}
              onPress={retryFetch}
            >
              <Text style={styles.primaryButtonText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {status === "empty" && (
          <View style={styles.center}>
            <View style={[styles.stateIconWrap, allDone && { backgroundColor: "#ECFDF3" }]}>
              <MaterialCommunityIcons
                name={allDone ? "check-decagram" : "transmission-tower-off"}
                size={30}
                color={allDone ? "#067647" : "#667085"}
              />
            </View>
            <Text style={styles.centerTitle}>
              {allDone ? "All Spans Done!" : "No Span Available"}
            </Text>
            <Text style={styles.centerSub}>
              {allDone
                ? "All spans for this pole are completed. Returning to poles list…"
                : "This pole does not have any available span connections."}
            </Text>

            <Pressable
              style={[styles.primaryButton, { backgroundColor: allDone ? "#067647" : "#111827" }]}
              onPress={() =>
                router.replace({
                  pathname: "/teardowns/poles",
                  params: { nodeId: node_id, nodeName: pole_name, accent },
                } as any)
              }
            >
              <Text style={styles.primaryButtonText}>
                {allDone ? "Back to Poles" : "Back to Pole List"}
              </Text>
            </Pressable>
          </View>
        )}

        {status === "ok" && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
          >
            <Animated.View
              entering={FadeInUp.duration(350)}
              style={styles.heroWrap}
            >
              <View style={styles.heroCard}>
                <View style={styles.heroGlowOne} />
                <View style={styles.heroGlowTwo} />

                <Text style={styles.heroEyebrow}>Span Selection</Text>

                <Text style={styles.heroTitle}>
                  Choose the next pole to continue
                </Text>

                <Text style={styles.heroSub}>
                  Premium rework style na ito: tap the whole card to proceed, or
                  preview the route first using the vicinity action.
                </Text>

                <View style={styles.heroInfoRow}>
                  <View style={styles.heroInfoPill}>
                    <Ionicons
                      name="git-network-outline"
                      size={14}
                      color="#667085"
                    />
                    <Text style={styles.heroInfoPillText}>
                      {spans.length} spans found
                    </Text>
                  </View>

                  <View style={styles.heroInfoPill}>
                    <Ionicons name="radio-outline" size={14} color="#667085" />
                    <Text style={styles.heroInfoPillText}>
                      From {shortPole(pole_code)}
                    </Text>
                  </View>
                </View>
              </View>
            </Animated.View>

            <View style={styles.sectionWrap}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Available Connections</Text>
                <Text style={styles.sectionSub}>
                  Pick your destination pole
                </Text>
              </View>

              <View style={styles.listWrap}>
                {spans.map((item, index) => {
                  const displayPole = getDisplayPole(item);

                  return (
                    <View key={item.id}>
                      <SpanCard
                        fromCode={pole_code || ""}
                        poleCode={displayPole?.pole_code ?? "?"}
                        poleName={displayPole?.pole_code ?? "?"}
                        spanCode={item.span_code ?? ""}
                        expectedCable={getExpected(item, "cable")}
                        lengthMeters={item.strand_length}
                        runs={item.number_of_runs}
                        accentColor={accentColor}
                        index={index}
                        onCardPress={() => navigateToKabila(item)}
                        onVicinityPress={() => openVicinity(item)}
                      />
                      <Pressable
                        style={({ pressed }) => [
                          styles.newPoleBtn,
                          pressed && { opacity: 0.7 },
                        ]}
                        onPress={() => openNewPoleModal(item)}
                      >
                        <Text style={styles.newPoleBtnText}>
                          + Insert New Pole Here
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </View>
          </ScrollView>
        )}

        <Modal
          visible={showVicinityModal}
          animationType="slide"
          transparent={false}
          onRequestClose={() => setShowVicinityModal(false)}
        >
          <StatusBar barStyle="dark-content" backgroundColor="#F4F6F8" />

          <View style={styles.modalRoot}>
            <View style={styles.modalHeader}>
              <Pressable
                onPress={() => setShowVicinityModal(false)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={20} color="#111827" />
              </Pressable>

              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Vicinity Map</Text>
                <Text style={styles.modalSub} numberOfLines={1}>
                  {selectedSpan?.span_code || "Selected Span"}
                </Text>
              </View>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalScroll}
            >
              {mapHtml ? (
                <View style={styles.mapWrap}>
                  <WebView
                    source={{
                      html: mapHtml,
                      baseUrl: "https://local.telcovantage/",
                    }}
                    style={styles.mapView}
                    originWhitelist={["*"]}
                    javaScriptEnabled
                    domStorageEnabled
                    mixedContentMode="always"
                    cacheEnabled={false}
                  />
                </View>
              ) : (
                <View style={styles.noMapCard}>
                  <View style={styles.noMapIconWrap}>
                    <Ionicons name="map-outline" size={26} color="#98A2B3" />
                  </View>
                  <Text style={styles.noMapTitle}>
                    No vicinity map available
                  </Text>
                  <Text style={styles.noMapText}>
                    Missing GPS coordinates for one or both poles of this span.
                  </Text>
                </View>
              )}

              {selectedSpan && selectedDisplayPole ? (
                <>
                  <View style={styles.routePreviewCard}>
                    <Text style={styles.cardTitle}>Span Route</Text>

                    <View style={styles.routeRow}>
                      <View style={styles.routePoleBlock}>
                        <View style={[styles.routePoleDot, { backgroundColor: accentColor }]} />
                        <Text style={[styles.routePoleCode, { color: accentColor }]} numberOfLines={1} ellipsizeMode="tail">
                          {pole_name || pole_code || "FROM"}
                        </Text>
                      </View>

                      <View style={styles.routeCenter}>
                        <View style={[styles.routeLine, { borderColor: `${accentColor}55` }]} />
                        <View style={[styles.routeDistanceBadge, { backgroundColor: `${accentColor}12` }]}>
                          <Text style={[styles.routeDistanceText, { color: accentColor }]}>
                            {selectedSpan.strand_length}m
                          </Text>
                        </View>
                        <View style={[styles.routeLine, { borderColor: `${accentColor}55` }]} />
                      </View>

                      <View style={[styles.routePoleBlock, { justifyContent: "flex-end" }]}>
                        <View style={[styles.routePoleDot, { backgroundColor: "#6366F1" }]} />
                        <Text style={[styles.routePoleCode, { color: "#6366F1" }]} numberOfLines={1} ellipsizeMode="tail">
                          {selectedDisplayPole?.pole_code ?? "TO"}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.detailSectionCard}>
                    <View style={styles.detailSectionHeader}>
                      <Text style={styles.cardTitle}>
                        Collectable Components
                      </Text>
                      <Text style={styles.cardSub}>Span summary preview</Text>
                    </View>

                    <View style={styles.detailStatsGrid}>
                      <DetailStat
                        label="Span Length"
                        value={`${selectedSpan.strand_length}m`}
                      />
                      <DetailStat label="Runs" value={selectedSpan.number_of_runs} />
                      <DetailStat
                        label="Node"
                        value={getExpected(selectedSpan, "node")}
                      />
                      <DetailStat
                        label="Amplifier"
                        value={getExpected(selectedSpan, "amplifier")}
                      />
                      <DetailStat
                        label="Extender"
                        value={getExpected(selectedSpan, "extender")}
                      />
                      <DetailStat
                        label="TSC"
                        value={getExpected(selectedSpan, "tsc")}
                      />
                    </View>
                  </View>

                  <Pressable
                    style={[
                      styles.modalPrimaryBtn,
                      { backgroundColor: accentColor },
                    ]}
                    onPress={() => navigateToKabila(selectedSpan)}
                  >
                    <Text style={styles.modalPrimaryBtnText}>
                      Continue to Destination Pole
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </ScrollView>
          </View>
        </Modal>

        {/* ── Insert New Intermediate Pole Modal ── */}
        <Modal
          visible={showNewPoleModal}
          transparent
          animationType="slide"
          onRequestClose={() => !submittingNewPole && setShowNewPoleModal(false)}
        >
          <View style={styles.newPoleOverlay}>
            <View style={styles.newPoleCard}>

              {/* ── Header ── */}
              <View style={[styles.newPoleHeader, { backgroundColor: accentColor }]}>
                <Text style={styles.newPoleHeaderEmoji}>🪝</Text>
                <Text style={styles.newPoleHeaderTitle}>Insert New Pole</Text>
                <Text style={styles.newPoleHeaderSub}>
                  Split this span into two new connections
                </Text>
              </View>

              {/* ── Route visualization ── */}
              {newPoleTargetSpan && (() => {
                const fromLabel = newPoleTargetSpan.from_pole?.pole?.pole_code ?? "Pole 1";
                const toLabel   = newPoleTargetSpan.to_pole?.pole?.pole_code   ?? "Pole 2";
                return (
                  <View style={styles.newPoleRoute}>
                    {/* From */}
                    <View style={styles.newPoleRouteNode}>
                      <View style={[styles.newPoleRouteDot, { backgroundColor: accentColor }]} />
                      <Text style={styles.newPoleRouteLabel} numberOfLines={2}>{fromLabel}</Text>
                    </View>
                    {/* Line + arrow */}
                    <View style={styles.newPoleRouteConnector}>
                      <View style={[styles.newPoleRouteLine, { backgroundColor: accentColor + "55" }]} />
                      <Text style={[styles.newPoleRouteArrow, { color: accentColor }]}>›</Text>
                    </View>
                    {/* New pole (center) */}
                    <View style={styles.newPoleRouteNode}>
                      <View style={styles.newPoleRouteDotNew} />
                      <Text style={[styles.newPoleRouteNewLabel]}>New</Text>
                    </View>
                    {/* Line + arrow */}
                    <View style={styles.newPoleRouteConnector}>
                      <View style={[styles.newPoleRouteLine, { backgroundColor: accentColor + "55" }]} />
                      <Text style={[styles.newPoleRouteArrow, { color: accentColor }]}>›</Text>
                    </View>
                    {/* To */}
                    <View style={styles.newPoleRouteNode}>
                      <View style={[styles.newPoleRouteDot, { backgroundColor: accentColor }]} />
                      <Text style={styles.newPoleRouteLabel} numberOfLines={2}>{toLabel}</Text>
                    </View>
                  </View>
                );
              })()}

              {/* ── Input ── */}
              <View style={styles.newPoleInputWrap}>
                <Text style={styles.newPoleInputLabel}>New Pole Name</Text>
                <TextInput
                  style={styles.newPoleInput}
                  value={newPoleName}
                  onChangeText={setNewPoleName}
                  placeholder="e.g. P-015, NPT-003"
                  placeholderTextColor="#9CA3AF"
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (!submittingNewPole && newPoleName.trim()) handleReportNewPole();
                  }}
                  selectionColor={accentColor}
                />
              </View>

              {/* ── Actions ── */}
              <View style={styles.newPoleActions}>
                <Pressable
                  style={({ pressed }) => [styles.newPoleCancelBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => setShowNewPoleModal(false)}
                  disabled={submittingNewPole}
                >
                  <Text style={styles.newPoleCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.newPoleSaveBtn,
                    { backgroundColor: accentColor },
                    (submittingNewPole || !newPoleName.trim()) && { opacity: 0.45 },
                    pressed && { opacity: 0.75 },
                  ]}
                  onPress={handleReportNewPole}
                  disabled={submittingNewPole || !newPoleName.trim()}
                >
                  {submittingNewPole
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.newPoleSaveText}>Confirm Split</Text>
                  }
                </Pressable>
              </View>

            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F4F6F8",
  },

  floatingHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
    backgroundColor: "#F4F6F8",
    zIndex: 20,
  },

  backBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7ECF2",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#101828",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },

  floatingHeaderText: {
    flex: 1,
  },

  headerTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
  },

  headerSub: {
    marginTop: 2,
    fontSize: 12,
    color: "#667085",
    fontWeight: "600",
  },

  headerAccentBadge: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  headerAccentDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },

  headerAccentText: {
    fontSize: 11,
    fontWeight: "800",
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
  },

  loadingOrb: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },

  stateIconWrap: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7ECF2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },

  centerTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
  },

  centerSub: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: "#667085",
    textAlign: "center",
  },

  primaryButton: {
    marginTop: 18,
    height: 50,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },

  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 42,
    gap: 16,
  },

  heroWrap: {
    marginTop: 2,
  },

  heroCard: {
    borderRadius: 30,
    padding: 20,
    backgroundColor: "#13211C",
    overflow: "hidden",
  },

  heroGlowOne: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    top: -55,
    right: -10,
  },

  heroGlowTwo: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.04)",
    bottom: -20,
    left: -18,
  },

  heroEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    color: "rgba(255,255,255,0.72)",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
  },

  heroTitle: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: "900",
    color: "#FFFFFF",
    maxWidth: "92%",
  },

  heroSub: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 20,
    color: "rgba(255,255,255,0.72)",
    maxWidth: "95%",
  },

  heroInfoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 16,
  },

  heroInfoPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },

  heroInfoPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  sectionWrap: {
    gap: 12,
  },

  sectionHeader: {
    paddingHorizontal: 2,
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
  },

  sectionSub: {
    marginTop: 3,
    fontSize: 12,
    color: "#667085",
    fontWeight: "600",
  },

  listWrap: {
    gap: 14,
  },

  spanCard: {
    minHeight: 250,
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    borderWidth: 1,
    overflow: "hidden",
    padding: 16,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },

  spanCardGlowOne: {
    position: "absolute",
    right: -35,
    top: -25,
    width: 130,
    height: 130,
    borderRadius: 999,
  },

  spanCardGlowTwo: {
    position: "absolute",
    left: -18,
    bottom: -25,
    width: 90,
    height: 90,
    borderRadius: 999,
  },

  spanCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  destinationPill: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  destinationPillText: {
    fontSize: 11,
    fontWeight: "800",
  },

  iconGhostBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
  },

  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },

  routeMini: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    marginBottom: 10,
    gap: 4,
  },

  routeMiniPole: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
  },

  routeMiniDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },

  routeMiniCode: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9CA3AF",
    flexShrink: 1,
  },

  routeMiniCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 2,
    flexShrink: 0,
  },

  routeMiniLine: {
    width: 14,
    borderTopWidth: 1.5,
    borderStyle: "dashed",
  },

  spanPoleCode: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: "900",
  },

  spanPoleName: {
    marginTop: 4,
    fontSize: 14,
    color: "#344054",
    fontWeight: "700",
  },

  spanCodeText: {
    marginTop: 6,
    fontSize: 12,
    color: "#98A2B3",
    fontWeight: "700",
  },

  spanStatsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },

  statPill: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: "#F8FAFC",
    paddingVertical: 11,
    paddingHorizontal: 10,
  },

  statPillLabel: {
    fontSize: 10,
    color: "#98A2B3",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  statPillValue: {
    marginTop: 4,
    fontSize: 14,
    color: "#111827",
    fontWeight: "900",
  },

  bottomActions: {
    marginTop: 16,
    gap: 10,
  },

  secondaryAction: {
    minHeight: 48,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  secondaryActionText: {
    fontSize: 13,
    fontWeight: "900",
  },

  primaryHint: {
    minHeight: 42,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },

  primaryHintText: {
    fontSize: 12,
    fontWeight: "800",
  },

  modalRoot: {
    flex: 1,
    backgroundColor: "#F4F6F8",
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: "#F4F6F8",
    borderBottomWidth: 1,
    borderBottomColor: "#E9EDF2",
  },

  modalCloseBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E9EDF2",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  modalHeaderText: {
    flex: 1,
  },

  modalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
  },

  modalSub: {
    marginTop: 2,
    fontSize: 12,
    color: "#667085",
    fontWeight: "600",
  },

  modalScroll: {
    padding: 16,
    paddingBottom: 36,
    gap: 16,
  },

  mapWrap: {
    height: 320,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "#E5E7EB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },

  mapView: {
    flex: 1,
    backgroundColor: "#E5E7EB",
  },

  noMapCard: {
    borderRadius: 24,
    padding: 24,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E9EDF2",
    alignItems: "center",
    justifyContent: "center",
  },

  noMapIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#F2F4F7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },

  noMapTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 6,
  },

  noMapText: {
    fontSize: 13,
    lineHeight: 20,
    color: "#667085",
    textAlign: "center",
  },

  routePreviewCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E9EDF2",
    padding: 12,
    shadowColor: "#101828",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },

  cardTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 2,
  },

  cardSub: {
    fontSize: 12,
    color: "#667085",
    fontWeight: "600",
  },

  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 4,
  },

  routePoleBlock: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
  },

  routePoleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },

  routePoleCode: {
    fontSize: 12,
    fontWeight: "900",
    flexShrink: 1,
  },

  routePoleName: {
    fontSize: 10,
    fontWeight: "600",
    color: "#98A2B3",
    flexShrink: 1,
  },

  routeCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },

  routeLine: {
    width: 16,
    borderTopWidth: 1.5,
    borderStyle: "dashed",
  },

  routeDistanceBadge: {
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },

  routeDistanceText: {
    fontSize: 10,
    fontWeight: "800",
  },

  detailSectionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#E9EDF2",
    padding: 18,
    shadowColor: "#101828",
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },

  detailSectionHeader: {
    marginBottom: 14,
  },

  detailStatsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
  },

  detailStatCard: {
    width: "48.5%",
    backgroundColor: "#F8FAFC",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E8EDF3",
    paddingVertical: 14,
    paddingHorizontal: 12,
  },

  detailStatLabel: {
    fontSize: 11,
    color: "#98A2B3",
    fontWeight: "800",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  detailStatValue: {
    fontSize: 20,
    color: "#111827",
    fontWeight: "900",
  },

  modalPrimaryBtn: {
    minHeight: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#101828",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },

  modalPrimaryBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  newPoleBtn: {
    marginHorizontal: 16,
    marginTop: -4,
    marginBottom: 12,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderStyle: "dashed",
    alignItems: "center",
    backgroundColor: "#FAFAFA",
  },

  newPoleBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6B7280",
  },

  newPoleOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },

  newPoleCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    overflow: "hidden",
    marginHorizontal: 24,
    gap: 14,
    paddingBottom: 24,
    width: "100%",
    maxWidth: 400,
  },

  newPoleHeader: {
    paddingTop: 28,
    paddingBottom: 22,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 4,
  },

  newPoleHeaderEmoji: {
    fontSize: 36,
    marginBottom: 6,
  },

  newPoleHeaderTitle: {
    fontSize: 21,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },

  newPoleHeaderSub: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
    marginTop: 2,
  },

  newPoleRoute: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 24,
    paddingVertical: 4,
  },

  newPoleRouteNode: {
    alignItems: "center",
    width: 58,
    gap: 6,
  },

  newPoleRouteDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },

  newPoleRouteDotNew: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#9CA3AF",
    backgroundColor: "#F3F4F6",
  },

  newPoleRouteLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#374151",
    textAlign: "center",
  },

  newPoleRouteNewLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9CA3AF",
    textAlign: "center",
  },

  newPoleRouteConnector: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 6,
  },

  newPoleRouteLine: {
    flex: 1,
    height: 2,
  },

  newPoleRouteArrow: {
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 2,
    marginTop: -1,
  },

  newPoleInputWrap: {
    paddingHorizontal: 24,
    gap: 6,
  },

  newPoleInputLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#374151",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  newPoleTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.3,
  },

  newPoleSub: {
    fontSize: 13,
    color: "#6B7280",
    lineHeight: 18,
    marginTop: -6,
  },

  newPoleInput: {
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },

  newPoleActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
    paddingHorizontal: 24,
  },

  newPoleCancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#F3F4F6",
  },

  newPoleCancelText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#374151",
  },

  newPoleSaveBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },

  newPoleSaveText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
