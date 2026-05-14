import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  Hash,
  Image as ImageIcon,
  MapPin,
  RefreshCcw,
  Route,
  Server,
  UserRound,
  UsersRound,
  Wifi,
  X,
  Zap,
} from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BASE_URL } from "@/lib/api";
import { getBridgeToken } from "@/lib/token-bridge";
import { tokenStore } from "@/lib/token";

const TEARDOWN_LOGS_ENDPOINT = `${BASE_URL}/skycable/teardowns`;

const REQUEST_TIMEOUT_MS = 15000;
const RETRY_INTERVAL_MS = 30000;

const GREEN = "#0B7A5A";
const GREEN_DARK = "#064E3B";
const GREEN_SOFT = "#E8F7F1";
const BLUE = "#4F46E5";
const BLUE_SOFT = "#EEF2FF";
const AMBER = "#D97706";
const AMBER_SOFT = "#FFF7ED";
const RED = "#DC2626";
const RED_SOFT = "#FEF2F2";
const SLATE = "#101828";
const MUTED = "#667085";
const LIGHT_MUTED = "#98A2B3";
const BORDER = "#E4E7EC";
const BG = "#F6F8FB";
const WHITE = "#FFFFFF";

type TeardownLog = {
  id?: number | string;
  status?: string;
  actual_cable?: number | string;
  nodes_collected?: number | string;
  amplifiers_collected?: number | string;
  extenders_collected?: number | string;
  tsc_collected?: number | string;
  start_time?: string;
  end_time?: string;
  captured_lat?: number | string;
  captured_lng?: number | string;
  from_lat?: number | string;
  from_lng?: number | string;
  to_lat?: number | string;
  to_lng?: number | string;
  from_latitude?: number | string;
  from_longitude?: number | string;
  to_latitude?: number | string;
  to_longitude?: number | string;
  from_pole_code?: string;
  to_pole_code?: string;
  node_name?: string;
  team_name?: string;
  lineman_name?: string;
  team?: {
    name?: string;
  };
  lineman?: {
    first_name?: string;
    last_name?: string;
    name?: string;
  };
  node?: {
    name?: string;
  };
  span?: {
    node?: {
      name?: string;
    };
    fromPole?: {
      pole?: {
        pole_code?: string;
        lat?: number | string;
        lng?: number | string;
        latitude?: number | string;
        longitude?: number | string;
      };
    };
    toPole?: {
      pole?: {
        pole_code?: string;
        lat?: number | string;
        lng?: number | string;
        latitude?: number | string;
        longitude?: number | string;
      };
    };
  };
  [key: string]: any;
};

const PHOTO_KEYS = {
  before: [
    "before_photo",
    "before_photo_url",
    "before_image",
    "before_image_url",
    "before_teardown_photo",
    "before_teardown_photo_url",
    "pre_teardown_photo",
    "pre_teardown_photo_url",
    "photo_before",
    "photo_before_url",
    "before_uri",
    "before",
  ],
  after: [
    "after_photo",
    "after_photo_url",
    "after_image",
    "after_image_url",
    "after_teardown_photo",
    "after_teardown_photo_url",
    "post_teardown_photo",
    "post_teardown_photo_url",
    "photo_after",
    "photo_after_url",
    "after_uri",
    "after",
  ],
  fromTag: [
    "from_pole_photo",
    "from_pole_photo_url",
    "from_pole_tag",
    "from_pole_tag_url",
    "from_tag_photo",
    "from_tag_photo_url",
    "from_tag_uri",
  ],
  toTag: [
    "to_pole_photo",
    "to_pole_photo_url",
    "to_pole_tag",
    "to_pole_tag_url",
    "to_tag_photo",
    "to_tag_photo_url",
    "to_tag_uri",
  ],
};

function asRecord(value: unknown) {
  return value as Record<string, any>;
}

function toNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toSafeText(value: unknown, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function safeDate(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: unknown) {
  const date = safeDate(value);
  if (!date) return "--";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function formatTime(value: unknown) {
  const date = safeDate(value);
  if (!date) return "--";

  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeRange(start: unknown, end: unknown) {
  if (!start && !end) return "--";
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function formatMeters(value: unknown) {
  const meters = toNumber(value);
  return `${meters.toLocaleString()}m`;
}

function formatCoord(lat: unknown, lng: unknown) {
  const safeLat = toNumber(lat);
  const safeLng = toNumber(lng);

  if (!safeLat && !safeLng) return "--";
  return `${safeLat.toFixed(5)}, ${safeLng.toFixed(5)}`;
}

function getNestedImageUrl(value: unknown): string {
  if (!value) return "";

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found: string = getNestedImageUrl(item);
      if (found) return found;
    }
  }

  if (typeof value === "object") {
    const record = asRecord(value);

    const possible = [
      record.url,
      record.uri,
      record.path,
      record.src,
      record.image_url,
      record.photo_url,
      record.file_url,
    ];

    for (const item of possible) {
      if (typeof item === "string" && item.trim()) return item.trim();
    }
  }

  return "";
}

function getPhotoUri(log: TeardownLog, keys: string[]) {
  const record = asRecord(log);

  for (const key of keys) {
    const found = getNestedImageUrl(record[key]);
    if (found) return found;
  }

  return "";
}

function extractLogsFromResponse(payload: unknown): TeardownLog[] {
  if (Array.isArray(payload)) return payload as TeardownLog[];

  if (!payload || typeof payload !== "object") return [];

  const record = asRecord(payload);

  const candidates = [
    record.data,
    record.logs,
    record.teardown_logs,
    record.teardownLogs,
    record.records,
    record.items,
    record.results,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as TeardownLog[];

    if (candidate && typeof candidate === "object") {
      const nested = extractLogsFromResponse(candidate);
      if (nested.length) return nested;
    }
  }

  return [];
}

function getLogDetails(log: TeardownLog) {
  const item = asRecord(log);

  const fromCode =
    item.span?.fromPole?.pole?.pole_code ??
    item.from_pole_code ??
    item.fromPoleCode ??
    "--";

  const toCode =
    item.span?.toPole?.pole?.pole_code ??
    item.to_pole_code ??
    item.toPoleCode ??
    "--";

  const nodeName =
    item.span?.node?.name ?? item.node?.name ?? item.node_name ?? "Unknown Node";

  const teamName = item.team?.name ?? item.team_name ?? "Unassigned Team";

  const linemanName = item.lineman?.name
    ? item.lineman.name
    : item.lineman
      ? `${item.lineman.first_name ?? ""} ${item.lineman.last_name ?? ""}`.trim()
      : item.lineman_name ?? "Unassigned Lineman";

  const fromLat =
    item.from_lat ??
    item.from_latitude ??
    item.span?.fromPole?.pole?.lat ??
    item.span?.fromPole?.pole?.latitude ??
    item.captured_lat;

  const fromLng =
    item.from_lng ??
    item.from_longitude ??
    item.span?.fromPole?.pole?.lng ??
    item.span?.fromPole?.pole?.longitude ??
    item.captured_lng;

  const toLat =
    item.to_lat ??
    item.to_latitude ??
    item.span?.toPole?.pole?.lat ??
    item.span?.toPole?.pole?.latitude ??
    fromLat;

  const toLng =
    item.to_lng ??
    item.to_longitude ??
    item.span?.toPole?.pole?.lng ??
    item.span?.toPole?.pole?.longitude ??
    fromLng;

  return {
    id: item.id ?? "--",
    status: item.status ?? "Completed",
    fromCode,
    toCode,
    nodeName,
    teamName,
    linemanName: linemanName || "Unassigned Lineman",
    fromLat: toNumber(fromLat),
    fromLng: toNumber(fromLng),
    toLat: toNumber(toLat),
    toLng: toNumber(toLng),
    startTime: item.start_time,
    endTime: item.end_time,
    actualCable: item.actual_cable ?? 0,
    nodes: item.nodes_collected ?? 0,
    amplifiers: item.amplifiers_collected ?? 0,
    extenders: item.extenders_collected ?? 0,
    tsc: item.tsc_collected ?? 0,
    capturedLat: item.captured_lat,
    capturedLng: item.captured_lng,
  };
}

function ServerConnectionAttempting({
  onBack,
  lastError,
  endpoint,
}: {
  onBack: () => void;
  lastError?: string | null;
  endpoint: string;
}) {
  const blink = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(blink, {
          toValue: 0,
          duration: 650,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [blink]);

  const opacity = blink.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 1],
  });

  const scale = blink.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.1],
  });

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" backgroundColor={BG} />

      <SafeAreaView style={s.container}>
        <View style={s.connectionTopBar}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onBack}
            style={s.connectionBackBtn}
          >
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={s.connectionTopTitle}>Teardown Logs</Text>
            <Text style={s.connectionTopSub}>Checking backend availability</Text>
          </View>
        </View>

        <View style={s.connectionBody}>
          <View style={s.connectionCard}>
            <Animated.View
              style={[
                s.wifiCircle,
                {
                  opacity,
                  transform: [{ scale }],
                },
              ]}
            >
              <Wifi size={54} color={GREEN} />
            </Animated.View>

            <Text style={s.connectionTitle}>Server connection attempting</Text>

            <Text style={s.connectionText}>
              Trying to reach the backend. Whole teardown logs will load
              automatically once the server responds.
            </Text>

            <View style={s.connectionStatusPill}>
              <RefreshCcw size={13} color={GREEN} />
              <Text style={s.connectionStatusText}>Retrying connection</Text>
            </View>

            <View style={s.endpointBox}>
              <Text style={s.endpointLabel}>Endpoint</Text>
              <Text selectable style={s.endpointText} numberOfLines={2}>
                {endpoint}
              </Text>
            </View>

            {lastError ? (
              <Text selectable style={s.connectionError}>
                {lastError}
              </Text>
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    </>
  );
}

function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={s.statPill}>
      <View style={s.statIcon}>{icon}</View>

      <View style={{ flex: 1 }}>
        <Text style={s.statLabel}>{label}</Text>
        <Text selectable style={s.statValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function SummaryTile({
  label,
  value,
  tone = "green",
}: {
  label: string;
  value: string;
  tone?: "green" | "blue" | "amber" | "red";
}) {
  const tileStyle =
    tone === "blue"
      ? s.summaryBlue
      : tone === "amber"
        ? s.summaryAmber
        : tone === "red"
          ? s.summaryRed
          : s.summaryGreen;

  return (
    <View style={[s.summaryTile, tileStyle]}>
      <Text style={s.summaryLabel}>{label}</Text>
      <Text selectable style={s.summaryValue}>
        {value}
      </Text>
    </View>
  );
}

function ComponentChip({
  label,
  value,
  tone = "green",
}: {
  label: string;
  value: number;
  tone?: "green" | "blue" | "amber" | "red";
}) {
  const chipStyle =
    tone === "blue"
      ? s.componentBlue
      : tone === "amber"
        ? s.componentAmber
        : tone === "red"
          ? s.componentRed
          : s.componentGreen;

  return (
    <View style={[s.componentChip, chipStyle]}>
      <Text selectable style={s.componentValue}>
        {value}
      </Text>
      <Text style={s.componentLabel}>{label}</Text>
    </View>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={s.detailRow}>
      <View style={s.detailIcon}>{icon}</View>

      <View style={{ flex: 1 }}>
        <Text style={s.detailLabel}>{label}</Text>
        <Text selectable style={s.detailValue} numberOfLines={2}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function MiniSpanMap({
  fromCode,
  toCode,
  nodeName,
  fromLat,
  fromLng,
  toLat,
  toLng,
}: {
  fromCode: string;
  toCode: string;
  nodeName: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}) {
  return (
    <View style={s.miniMap}>
      <View style={s.mapGridLineA} />
      <View style={s.mapGridLineB} />
      <View style={s.mapGridLineC} />

      <View style={s.mapNodeBadge}>
        <MapPin size={13} color={GREEN} />
        <Text selectable style={s.mapNodeText} numberOfLines={1}>
          {nodeName}
        </Text>
      </View>

      <View style={s.mapRouteLine} />

      <View style={[s.mapPin, s.mapPinFrom]}>
        <Text style={s.mapPinLabel}>FROM</Text>
        <Text selectable style={s.mapPinCode} numberOfLines={1}>
          {fromCode}
        </Text>
      </View>

      <View style={[s.mapPin, s.mapPinTo]}>
        <Text style={s.mapPinLabel}>TO</Text>
        <Text selectable style={s.mapPinCode} numberOfLines={1}>
          {toCode}
        </Text>
      </View>

      <View style={s.mapCoordStrip}>
        <Text selectable style={s.mapCoordText} numberOfLines={1}>
          {formatCoord(fromLat, fromLng)}
        </Text>
        <Text style={s.mapCoordArrow}>→</Text>
        <Text selectable style={s.mapCoordText} numberOfLines={1}>
          {formatCoord(toLat, toLng)}
        </Text>
      </View>
    </View>
  );
}

function PhotoThumb({
  label,
  uri,
  onPress,
}: {
  label: string;
  uri: string;
  onPress: () => void;
}) {
  const hasPhoto = !!uri;

  return (
    <Pressable
      disabled={!hasPhoto}
      onPress={onPress}
      style={({ pressed }) => [
        s.photoThumb,
        pressed &&
        hasPhoto && {
          opacity: 0.85,
          transform: [{ scale: 0.985 }],
        },
      ]}
    >
      {hasPhoto ? (
        <Image source={{ uri }} style={s.photoImage} resizeMode="cover" />
      ) : (
        <View style={s.photoPlaceholder}>
          <Camera size={26} color={LIGHT_MUTED} />
          <Text style={s.photoPlaceholderText}>No photo</Text>
        </View>
      )}

      {hasPhoto ? <View style={s.photoShade} /> : null}

      <View style={s.photoBadge}>
        <ImageIcon size={12} color={hasPhoto ? WHITE : MUTED} />
        <Text
          style={[s.photoBadgeText, !hasPhoto && { color: MUTED }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>

      {hasPhoto ? (
        <View style={s.viewBadge}>
          <Text style={s.viewBadgeText}>VIEW</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function TeardownLogCard({
  log,
  index,
  onViewPhoto,
}: {
  log: TeardownLog;
  index: number;
  onViewPhoto: (uri: string, title: string) => void;
}) {
  const details = getLogDetails(log);

  const beforePhoto = getPhotoUri(log, PHOTO_KEYS.before);
  const afterPhoto = getPhotoUri(log, PHOTO_KEYS.after);
  const fromTagPhoto = getPhotoUri(log, PHOTO_KEYS.fromTag);
  const toTagPhoto = getPhotoUri(log, PHOTO_KEYS.toTag);

  const componentTotal =
    toNumber(details.nodes) +
    toNumber(details.amplifiers) +
    toNumber(details.extenders) +
    toNumber(details.tsc);

  return (
    <View style={s.logCard}>
      <View style={s.logHeader}>
        <View style={s.logHeaderLeft}>
          <View style={s.logNumberBadge}>
            <Hash size={13} color={GREEN} />
            <Text selectable style={s.logNumberText}>
              {String(index + 1).padStart(2, "0")}
            </Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text style={s.logEyebrow}>TEARDOWN LOG</Text>
            <Text selectable style={s.logTitle} numberOfLines={1}>
              Report #{details.id}
            </Text>
          </View>
        </View>

        <View style={s.statusPill}>
          <CheckCircle2 size={13} color={GREEN} />
          <Text selectable style={s.statusText}>
            {toSafeText(details.status)}
          </Text>
        </View>
      </View>

      <View style={s.routePanel}>
        <View style={s.routeHeaderRow}>
          <View style={s.routeIconCircle}>
            <Route size={16} color={GREEN} />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={s.routeLabel}>SPAN ROUTE</Text>
            <Text selectable style={s.routeTitle} numberOfLines={1}>
              {details.fromCode} → {details.toCode}
            </Text>
          </View>
        </View>

        <View style={s.poleTrack}>
          <View style={s.poleBlock}>
            <View style={[s.poleDot, { backgroundColor: GREEN }]} />
            <Text style={s.poleLabel}>FROM</Text>
            <Text selectable style={s.poleCode} numberOfLines={1}>
              {details.fromCode}
            </Text>
          </View>

          <View style={s.connectorLine}>
            <View style={s.connectorDot} />
          </View>

          <View style={s.poleBlock}>
            <View style={[s.poleDot, { backgroundColor: BLUE }]} />
            <Text style={s.poleLabel}>TO</Text>
            <Text selectable style={s.poleCode} numberOfLines={1}>
              {details.toCode}
            </Text>
          </View>
        </View>

        <View style={s.nodeStrip}>
          <MapPin size={13} color={GREEN} />
          <Text selectable style={s.nodeText} numberOfLines={1}>
            {details.nodeName}
          </Text>
        </View>
      </View>

      <View style={s.detailGrid}>
        <DetailRow
          icon={<Clock3 size={15} color={GREEN} />}
          label="Schedule"
          value={`${formatDate(details.startTime)} · ${formatTimeRange(
            details.startTime,
            details.endTime
          )}`}
        />

        <DetailRow
          icon={<UsersRound size={15} color={BLUE} />}
          label="Team"
          value={details.teamName}
        />

        <DetailRow
          icon={<UserRound size={15} color={AMBER} />}
          label="Lineman"
          value={details.linemanName}
        />

        <DetailRow
          icon={<MapPin size={15} color={RED} />}
          label="Captured GPS"
          value={formatCoord(details.capturedLat, details.capturedLng)}
        />
      </View>

      <View style={s.metricStrip}>
        <View style={s.primaryMetric}>
          <Text style={s.primaryMetricLabel}>Cable Collected</Text>
          <Text selectable style={s.primaryMetricValue}>
            {formatMeters(details.actualCable)}
          </Text>
        </View>

        <View style={s.secondaryMetric}>
          <Text style={s.secondaryMetricLabel}>Components</Text>
          <Text selectable style={s.secondaryMetricValue}>
            {componentTotal}
          </Text>
        </View>
      </View>

      <View style={s.componentsRow}>
        <ComponentChip label="Nodes" value={toNumber(details.nodes)} />
        <ComponentChip
          label="Amps"
          value={toNumber(details.amplifiers)}
          tone="blue"
        />
        <ComponentChip
          label="Exts"
          value={toNumber(details.extenders)}
          tone="amber"
        />
        <ComponentChip label="TSC" value={toNumber(details.tsc)} tone="red" />
      </View>

      <View style={s.mediaHeader}>
        <View style={s.mediaTitleRow}>
          <Camera size={15} color={SLATE} />
          <Text style={s.mediaTitle}>Captured Field Photos</Text>
        </View>
        <Text style={s.mediaCaption}>Before, after, and pole tag proof</Text>
      </View>

      <View style={s.photoGrid}>
        <PhotoThumb
          label="Before"
          uri={beforePhoto}
          onPress={() =>
            onViewPhoto(beforePhoto, `Report #${details.id} · Before Teardown`)
          }
        />

        <PhotoThumb
          label="After"
          uri={afterPhoto}
          onPress={() =>
            onViewPhoto(afterPhoto, `Report #${details.id} · After Teardown`)
          }
        />

        <PhotoThumb
          label={`From ${details.fromCode}`}
          uri={fromTagPhoto}
          onPress={() =>
            onViewPhoto(fromTagPhoto, `Report #${details.id} · From Pole Tag`)
          }
        />

        <PhotoThumb
          label={`To ${details.toCode}`}
          uri={toTagPhoto}
          onPress={() =>
            onViewPhoto(toTagPhoto, `Report #${details.id} · To Pole Tag`)
          }
        />
      </View>
    </View>
  );
}

export default function LogsScreen() {
  const [logs, setLogs] = useState<TeardownLog[]>([]);
  const [isAttempting, setIsAttempting] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState("");

  const router = useRouter();
  const { id } = useLocalSearchParams();

  const endpointUrl = TEARDOWN_LOGS_ENDPOINT;

  useEffect(() => {
    let mounted = true;
    let activeController: AbortController | null = null;

    async function loadLogs() {
      const controller = new AbortController();
      activeController = controller;

      const timeout = setTimeout(() => {
        controller.abort();
      }, REQUEST_TIMEOUT_MS);

      try {
        setIsAttempting(true);

        const token = getBridgeToken() ?? await tokenStore.get();
        const response = await fetch(endpointUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "ngrok-skip-browser-warning": "true",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`Backend responded with HTTP ${response.status}`);
        }

        const payload = await response.json();
        const nextLogs = extractLogsFromResponse(payload);

        if (!mounted) return;

        if (nextLogs.length > 0) {
          setLogs(nextLogs);
          setLastError(null);
          setLastSyncedAt(new Date());
          setIsAttempting(false);
        } else {
          setLastError("Backend reached, but no teardown logs returned yet.");
          setIsAttempting(true);
        }
      } catch (error) {
        clearTimeout(timeout);

        if (!mounted) return;

        const message =
          error instanceof Error
            ? error.name === "AbortError"
              ? "Connection timeout. Backend did not respond within 3 seconds."
              : error.message
            : "Unable to reach backend.";

        setLastError(message);
        setIsAttempting(true);
      }
    }

    loadLogs();

    const interval = setInterval(() => {
      loadLogs();
    }, RETRY_INTERVAL_MS);

    return () => {
      mounted = false;
      activeController?.abort();
      clearInterval(interval);
    };
  }, [endpointUrl]);

  const sortedLogs = useMemo(() => {
    return [...logs].sort((a, b) => {
      const aTime = safeDate(asRecord(a).start_time)?.getTime() ?? 0;
      const bTime = safeDate(asRecord(b).start_time)?.getTime() ?? 0;
      return bTime - aTime;
    });
  }, [logs]);

  const selectedId = Array.isArray(id) ? Number(id[0]) : Number(id);

  const featuredLog = useMemo(() => {
    if (!sortedLogs.length) return null;

    if (Number.isFinite(selectedId)) {
      return (
        sortedLogs.find((item) => toNumber(asRecord(item).id) === selectedId) ??
        sortedLogs[0]
      );
    }

    return sortedLogs[0];
  }, [sortedLogs, selectedId]);

  const totals = useMemo(() => {
    const teamNames = new Set<string>();

    return sortedLogs.reduce(
      (acc, log) => {
        const details = getLogDetails(log);

        teamNames.add(details.teamName);

        acc.totalCable += toNumber(details.actualCable);
        acc.nodes += toNumber(details.nodes);
        acc.amplifiers += toNumber(details.amplifiers);
        acc.extenders += toNumber(details.extenders);
        acc.tsc += toNumber(details.tsc);
        acc.teams = teamNames.size;

        return acc;
      },
      {
        totalCable: 0,
        nodes: 0,
        amplifiers: 0,
        extenders: 0,
        tsc: 0,
        teams: 0,
      }
    );
  }, [sortedLogs]);

  const featured = featuredLog ? getLogDetails(featuredLog) : null;

  const openViewer = (uri: string, title: string) => {
    if (!uri) return;

    setViewerUri(uri);
    setViewerTitle(title);
  };

  if (!featuredLog || !featured) {
    return (
      <ServerConnectionAttempting
        onBack={() => router.back()}
        lastError={lastError}
        endpoint={endpointUrl}
      />
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="light-content" backgroundColor={GREEN_DARK} />

      <SafeAreaView edges={["top", "left", "right"]} style={s.container}>
        <View style={s.hero}>
          <View style={s.heroTop}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.back()}
              style={s.backBtn}
            >
              <ChevronLeft size={23} color={WHITE} />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={s.heroEyebrow}>FIELD OPERATIONS</Text>
              <Text selectable style={s.heroTitle}>
                Whole Teardown Logs
              </Text>
              <Text style={s.heroSubtitle}>
                Backend data view · {sortedLogs.length} total reports
              </Text>
            </View>

            <View style={s.heroIcon}>
              <Zap size={22} color={WHITE} />
            </View>
          </View>

          <View style={s.heroStats}>
            <StatPill
              icon={<Hash size={15} color={WHITE} />}
              label="Logs"
              value={String(sortedLogs.length)}
            />

            <StatPill
              icon={<UsersRound size={15} color={WHITE} />}
              label="Teams"
              value={String(totals.teams)}
            />

            <StatPill
              icon={<Server size={15} color={WHITE} />}
              label="Server"
              value={isAttempting ? "Retrying" : "Online"}
            />
          </View>
        </View>

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
        >
          {isAttempting ? (
            <View style={s.reconnectBanner}>
              <Wifi size={16} color={AMBER} />
              <View style={{ flex: 1 }}>
                <Text style={s.reconnectTitle}>Server connection attempting</Text>
                <Text style={s.reconnectText}>
                  Showing last synced logs while retrying backend connection.
                </Text>
              </View>
            </View>
          ) : null}

          <View style={s.summaryCard}>
            <View style={s.sectionHeader}>
              <View>
                <Text style={s.sectionEyebrow}>SUMMARY</Text>
                <Text style={s.sectionTitle}>Collected Overview</Text>
              </View>

              <View style={s.connectedBadge}>
                <CheckCircle2 size={14} color={GREEN} />
                <Text style={s.connectedBadgeText}>
                  {lastSyncedAt ? formatTime(lastSyncedAt.toISOString()) : "Live"}
                </Text>
              </View>
            </View>

            <View style={s.summaryGrid}>
              <SummaryTile
                label="Cable"
                value={`${totals.totalCable.toLocaleString()}m`}
              />
              <SummaryTile
                label="Nodes"
                value={String(totals.nodes)}
                tone="blue"
              />
              <SummaryTile
                label="Amps"
                value={String(totals.amplifiers)}
                tone="amber"
              />
              <SummaryTile label="TSC" value={String(totals.tsc)} tone="red" />
            </View>
          </View>

          <View style={s.mapCard}>
            <View style={s.sectionHeader}>
              <View>
                <Text style={s.sectionEyebrow}>GIS PREVIEW</Text>
                <Text selectable style={s.sectionTitle}>
                  {featured.fromCode} → {featured.toCode}
                </Text>
              </View>

              <View style={s.mapBadge}>
                <MapPin size={13} color={GREEN} />
                <Text selectable style={s.mapBadgeText} numberOfLines={1}>
                  {featured.nodeName}
                </Text>
              </View>
            </View>

            <MiniSpanMap
              fromLat={featured.fromLat}
              fromLng={featured.fromLng}
              toLat={featured.toLat}
              toLng={featured.toLng}
              fromCode={featured.fromCode}
              toCode={featured.toCode}
              nodeName={featured.nodeName}
            />
          </View>

          <View style={s.logsHeader}>
            <View>
              <Text style={s.sectionEyebrow}>WHOLE TEARDOWN LOGS</Text>
              <Text style={s.logsTitle}>All Field Reports</Text>
            </View>

            <View style={s.countBadge}>
              <Text selectable style={s.countBadgeText}>
                {sortedLogs.length}
              </Text>
            </View>
          </View>

          {sortedLogs.map((log, index) => {
            const key = toSafeText(asRecord(log).id, String(index));

            return (
              <TeardownLogCard
                key={`${key}-${index}`}
                log={log}
                index={index}
                onViewPhoto={openViewer}
              />
            );
          })}
        </ScrollView>

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
                <View style={s.viewerTitleWrap}>
                  <ImageIcon size={16} color={GREEN} />
                  <Text selectable style={s.viewerTitle} numberOfLines={1}>
                    {viewerTitle}
                  </Text>
                </View>

                <Pressable
                  onPress={() => setViewerUri(null)}
                  style={({ pressed }) => [
                    s.viewerClose,
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <X size={18} color={SLATE} />
                </Pressable>
              </View>

              {viewerUri ? (
                <Image
                  source={{ uri: viewerUri }}
                  style={s.viewerImage}
                  resizeMode="contain"
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
    backgroundColor: BG,
  },

  connectionTopBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: WHITE,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  connectionBackBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#F2F4F7",
    alignItems: "center",
    justifyContent: "center",
  },

  connectionTopTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: SLATE,
  },

  connectionTopSub: {
    fontSize: 12,
    fontWeight: "700",
    color: MUTED,
    marginTop: 1,
  },

  connectionBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },

  connectionCard: {
    width: "100%",
    backgroundColor: WHITE,
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 4,
  },

  wifiCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: GREEN_SOFT,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#BDEAD8",
  },

  connectionTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: SLATE,
    textAlign: "center",
    marginTop: 20,
  },

  connectionText: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
    color: MUTED,
    textAlign: "center",
    marginTop: 8,
  },

  connectionStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: GREEN_SOFT,
  },

  connectionStatusText: {
    fontSize: 12,
    fontWeight: "900",
    color: GREEN,
  },

  endpointBox: {
    width: "100%",
    marginTop: 16,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: BORDER,
  },

  endpointLabel: {
    fontSize: 10,
    fontWeight: "900",
    color: LIGHT_MUTED,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  endpointText: {
    fontSize: 12,
    fontWeight: "800",
    color: SLATE,
    marginTop: 4,
  },

  connectionError: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    color: RED,
    textAlign: "center",
    marginTop: 12,
  },

  hero: {
    backgroundColor: GREEN_DARK,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 18,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: "#075B44",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 5,
  },

  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },

  heroEyebrow: {
    fontSize: 10,
    fontWeight: "900",
    color: "rgba(255,255,255,0.7)",
    letterSpacing: 1.2,
  },

  heroTitle: {
    fontSize: 25,
    fontWeight: "900",
    color: WHITE,
    letterSpacing: -0.4,
    marginTop: 1,
  },

  heroSubtitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255,255,255,0.72)",
    marginTop: 2,
  },

  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },

  heroStats: {
    flexDirection: "row",
    gap: 9,
    marginTop: 16,
  },

  statPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.13)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },

  statIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },

  statLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "rgba(255,255,255,0.62)",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },

  statValue: {
    fontSize: 15,
    fontWeight: "900",
    color: WHITE,
    fontVariant: ["tabular-nums"],
  },

  scroll: {
    padding: 16,
    paddingBottom: 44,
    gap: 16,
  },

  reconnectBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 13,
    borderRadius: 18,
    backgroundColor: AMBER_SOFT,
    borderWidth: 1,
    borderColor: "#FED7AA",
  },

  reconnectTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: AMBER,
  },

  reconnectText: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED,
    marginTop: 1,
  },

  summaryCard: {
    backgroundColor: WHITE,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 14,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },

  sectionEyebrow: {
    fontSize: 10,
    fontWeight: "900",
    color: LIGHT_MUTED,
    letterSpacing: 1.1,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: SLATE,
    letterSpacing: -0.2,
    marginTop: 2,
  },

  connectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: GREEN_SOFT,
  },

  connectedBadgeText: {
    fontSize: 11,
    fontWeight: "900",
    color: GREEN,
  },

  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  summaryTile: {
    width: "47.8%",
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
  },

  summaryGreen: {
    backgroundColor: GREEN_SOFT,
    borderColor: "#BDEAD8",
  },

  summaryBlue: {
    backgroundColor: BLUE_SOFT,
    borderColor: "#C7D2FE",
  },

  summaryAmber: {
    backgroundColor: AMBER_SOFT,
    borderColor: "#FED7AA",
  },

  summaryRed: {
    backgroundColor: RED_SOFT,
    borderColor: "#FECACA",
  },

  summaryLabel: {
    fontSize: 10,
    fontWeight: "900",
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  summaryValue: {
    fontSize: 24,
    fontWeight: "900",
    color: SLATE,
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },

  mapCard: {
    backgroundColor: WHITE,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 14,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },

  mapBadge: {
    maxWidth: 150,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: GREEN_SOFT,
  },

  mapBadgeText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "900",
    color: GREEN,
  },

  miniMap: {
    height: 230,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#EAF2EF",
    position: "relative",
  },

  mapGridLineA: {
    position: "absolute",
    left: -30,
    top: 48,
    width: 360,
    height: 1,
    backgroundColor: "rgba(11,122,90,0.18)",
    transform: [{ rotate: "-12deg" }],
  },

  mapGridLineB: {
    position: "absolute",
    left: -30,
    top: 132,
    width: 360,
    height: 1,
    backgroundColor: "rgba(11,122,90,0.16)",
    transform: [{ rotate: "9deg" }],
  },

  mapGridLineC: {
    position: "absolute",
    left: 92,
    top: -40,
    width: 1,
    height: 330,
    backgroundColor: "rgba(11,122,90,0.14)",
    transform: [{ rotate: "18deg" }],
  },

  mapNodeBadge: {
    position: "absolute",
    top: 14,
    left: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "rgba(228,231,236,0.9)",
  },

  mapNodeText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "900",
    color: GREEN,
  },

  mapRouteLine: {
    position: "absolute",
    left: "25%",
    right: "25%",
    top: "53%",
    height: 4,
    borderRadius: 4,
    backgroundColor: GREEN,
    transform: [{ rotate: "-10deg" }],
  },

  mapPin: {
    position: "absolute",
    minWidth: 96,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },

  mapPinFrom: {
    left: 20,
    bottom: 54,
  },

  mapPinTo: {
    right: 20,
    top: 82,
  },

  mapPinLabel: {
    fontSize: 9,
    fontWeight: "900",
    color: LIGHT_MUTED,
    letterSpacing: 0.9,
  },

  mapPinCode: {
    fontSize: 13,
    fontWeight: "900",
    color: SLATE,
    marginTop: 2,
  },

  mapCoordStrip: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: "rgba(16, 24, 40, 0.86)",
  },

  mapCoordText: {
    flex: 1,
    fontSize: 10,
    fontWeight: "800",
    color: WHITE,
    fontVariant: ["tabular-nums"],
  },

  mapCoordArrow: {
    fontSize: 14,
    fontWeight: "900",
    color: "rgba(255,255,255,0.72)",
  },

  logsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  logsTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: SLATE,
    letterSpacing: -0.3,
    marginTop: 2,
  },

  countBadge: {
    minWidth: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: SLATE,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },

  countBadgeText: {
    color: WHITE,
    fontSize: 16,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },

  logCard: {
    backgroundColor: WHITE,
    borderRadius: 26,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 14,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 2,
  },

  logHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  logHeaderLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  logNumberBadge: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: GREEN_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  logNumberText: {
    fontSize: 12,
    fontWeight: "900",
    color: GREEN,
    fontVariant: ["tabular-nums"],
  },

  logEyebrow: {
    fontSize: 10,
    fontWeight: "900",
    color: LIGHT_MUTED,
    letterSpacing: 1,
  },

  logTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: SLATE,
    marginTop: 1,
  },

  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: GREEN_SOFT,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },

  statusText: {
    fontSize: 11,
    fontWeight: "900",
    color: GREEN,
  },

  routePanel: {
    backgroundColor: "#F8FAFC",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#EEF2F6",
    padding: 14,
    gap: 12,
  },

  routeHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  routeIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: GREEN_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  routeLabel: {
    fontSize: 10,
    fontWeight: "900",
    color: LIGHT_MUTED,
    letterSpacing: 0.9,
  },

  routeTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: SLATE,
    marginTop: 1,
  },

  poleTrack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  poleBlock: {
    flex: 1,
    minHeight: 82,
    borderRadius: 18,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  poleDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginBottom: 7,
  },

  poleLabel: {
    fontSize: 9,
    fontWeight: "900",
    color: LIGHT_MUTED,
    letterSpacing: 1,
  },

  poleCode: {
    fontSize: 15,
    fontWeight: "900",
    color: SLATE,
    marginTop: 2,
  },

  connectorLine: {
    width: 32,
    height: 2,
    backgroundColor: BORDER,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  connectorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GREEN,
  },

  nodeStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: GREEN_SOFT,
  },

  nodeText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "900",
    color: GREEN,
  },

  detailGrid: {
    gap: 10,
  },

  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "#FCFCFD",
    borderWidth: 1,
    borderColor: "#EEF2F6",
  },

  detailIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },

  detailLabel: {
    fontSize: 10,
    fontWeight: "900",
    color: LIGHT_MUTED,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  detailValue: {
    fontSize: 13,
    fontWeight: "800",
    color: SLATE,
    marginTop: 2,
  },

  metricStrip: {
    flexDirection: "row",
    gap: 10,
  },

  primaryMetric: {
    flex: 1.4,
    padding: 14,
    borderRadius: 20,
    backgroundColor: GREEN,
  },

  primaryMetricLabel: {
    fontSize: 10,
    fontWeight: "900",
    color: "rgba(255,255,255,0.72)",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },

  primaryMetricValue: {
    fontSize: 26,
    fontWeight: "900",
    color: WHITE,
    marginTop: 3,
    fontVariant: ["tabular-nums"],
  },

  secondaryMetric: {
    flex: 1,
    padding: 14,
    borderRadius: 20,
    backgroundColor: SLATE,
  },

  secondaryMetricLabel: {
    fontSize: 10,
    fontWeight: "900",
    color: "rgba(255,255,255,0.66)",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },

  secondaryMetricValue: {
    fontSize: 26,
    fontWeight: "900",
    color: WHITE,
    marginTop: 3,
    fontVariant: ["tabular-nums"],
  },

  componentsRow: {
    flexDirection: "row",
    gap: 8,
  },

  componentChip: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
  },

  componentGreen: {
    backgroundColor: GREEN_SOFT,
    borderColor: "#BDEAD8",
  },

  componentBlue: {
    backgroundColor: BLUE_SOFT,
    borderColor: "#C7D2FE",
  },

  componentAmber: {
    backgroundColor: AMBER_SOFT,
    borderColor: "#FED7AA",
  },

  componentRed: {
    backgroundColor: RED_SOFT,
    borderColor: "#FECACA",
  },

  componentValue: {
    fontSize: 18,
    fontWeight: "900",
    color: SLATE,
    fontVariant: ["tabular-nums"],
  },

  componentLabel: {
    fontSize: 9,
    fontWeight: "900",
    color: MUTED,
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  mediaHeader: {
    gap: 3,
  },

  mediaTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  mediaTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: SLATE,
  },

  mediaCaption: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED,
  },

  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  photoThumb: {
    width: "48.3%",
    height: 132,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#EAECF0",
    borderWidth: 1,
    borderColor: BORDER,
  },

  photoImage: {
    width: "100%",
    height: "100%",
  },

  photoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
  },

  photoPlaceholderText: {
    fontSize: 11,
    fontWeight: "800",
    color: LIGHT_MUTED,
    marginTop: 6,
  },

  photoShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.18)",
  },

  photoBadge: {
    position: "absolute",
    left: 9,
    bottom: 9,
    right: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },

  photoBadgeText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "900",
    color: WHITE,
  },

  viewBadge: {
    position: "absolute",
    top: 9,
    right: 9,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.88)",
  },

  viewBadgeText: {
    fontSize: 9,
    fontWeight: "900",
    color: SLATE,
    letterSpacing: 0.6,
  },

  viewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.86)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },

  viewerCard: {
    width: "100%",
    maxHeight: "82%",
    backgroundColor: WHITE,
    borderRadius: 24,
    overflow: "hidden",
  },

  viewerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  viewerTitleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  viewerTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "900",
    color: SLATE,
  },

  viewerClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F2F4F7",
    alignItems: "center",
    justifyContent: "center",
  },

  viewerImage: {
    width: "100%",
    height: 430,
    backgroundColor: "#0F172A",
  },
});