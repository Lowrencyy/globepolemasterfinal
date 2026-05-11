import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  ActivityIndicator,
  Animated,
  Easing,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/context/auth-context";
import {
  User,
  Settings,
  Shield,
  Bell,
  ChevronRight,
  LogOut,
  Wifi,
  WifiOff,
  X,
  Activity,
  Download,
  Radio,
  RefreshCw,
  CheckCircle,
} from "lucide-react-native";
import { BASE_URL } from "@/lib/api";
import { queueReadAll, imageQueueReadAll, processSyncQueue, processImageQueue } from "@/lib/sync-queue";
import { gpsQueueReadAll, gpsQueueFlush } from "@/lib/gps-queue";
import { simpleQueueReadAll, processSimpleQueue } from "@/lib/simple-queue";
import { isOnline } from "@/lib/net-sync";

// ── Network test helpers ───────────────────────────────────────────────────

const PING_URL = `${BASE_URL}/ping`;

async function measurePing(): Promise<number> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(PING_URL, {
      method: "GET",
      signal: controller.signal,
      headers: { "ngrok-skip-browser-warning": "true", Accept: "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
  return Date.now() - start;
}

async function measureDownload(): Promise<{ mbps: number; bytes: number; ms: number }> {
  // Fetch a meaningful endpoint — paginated poles returns a decent-sized JSON blob
  const url = `${BASE_URL}/skycable/poles?per_page=100`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "ngrok-skip-browser-warning": "true", Accept: "application/json" },
    });
    const text = await res.text();
    const ms = Date.now() - start;
    const bytes = new TextEncoder().encode(text).length;
    const mbps = bytes / ms / 125; // bytes → bits → megabits  (1 Mbps = 125 000 B/s)
    return { mbps: Math.max(mbps, 0.01), bytes, ms };
  } finally {
    clearTimeout(timer);
  }
}

type Quality = "excellent" | "good" | "fair" | "poor" | "offline";

function qualityFromPing(ms: number): Quality {
  if (ms < 80)  return "excellent";
  if (ms < 200) return "good";
  if (ms < 500) return "fair";
  return "poor";
}

function qualityFromMbps(mbps: number): Quality {
  if (mbps >= 5)   return "excellent";
  if (mbps >= 1)   return "good";
  if (mbps >= 0.1) return "fair";
  return "poor";
}

const QUALITY_COLOR: Record<Quality, string> = {
  excellent: "#16A34A",
  good:      "#22C55E",
  fair:      "#F59E0B",
  poor:      "#EF4444",
  offline:   "#94A3B8",
};

const QUALITY_LABEL: Record<Quality, string> = {
  excellent: "Excellent",
  good:      "Good",
  fair:      "Fair",
  poor:      "Poor",
  offline:   "Offline",
};

// ── Animated ring ─────────────────────────────────────────────────────────

function PulseRing({ color, running }: { color: string; running: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!running) {
      scale.setValue(1);
      opacity.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.8, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1,   duration: 0,   useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.35, duration: 100, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0,    duration: 800, useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [running]);

  return (
    <Animated.View
      style={[
        nd.pulseRing,
        { borderColor: color, transform: [{ scale }], opacity },
      ]}
    />
  );
}

// ── Main NetworkTestModal ──────────────────────────────────────────────────

type TestState = "idle" | "pinging" | "downloading" | "done" | "error";

type Results = {
  ping: number;
  pingQuality: Quality;
  mbps: number;
  dlQuality: Quality;
  bytes: number;
  dlMs: number;
  online: boolean;
};

function NetworkTestModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [state, setState] = useState<TestState>("idle");
  const [results, setResults] = useState<Results | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pingStep, setPingStep] = useState(0); // 0-5 pings done

  async function runTest() {
    setState("pinging");
    setResults(null);
    setErrorMsg(null);
    setPingStep(0);

    try {
      // Run 5 pings, track progress
      const pings: number[] = [];
      for (let i = 0; i < 5; i++) {
        const ms = await measurePing();
        pings.push(ms);
        setPingStep(i + 1);
      }
      const avgPing = pings.reduce((a, b) => a + b, 0) / pings.length;

      setState("downloading");
      const { mbps, bytes, ms: dlMs } = await measureDownload();

      setResults({
        ping: Math.round(avgPing),
        pingQuality: qualityFromPing(avgPing),
        mbps,
        dlQuality: qualityFromMbps(mbps),
        bytes,
        dlMs,
        online: true,
      });
      setState("done");
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setErrorMsg("Request timed out. Check your connection.");
      } else {
        setErrorMsg(e?.message ?? "Network unreachable.");
      }
      setState("error");
    }
  }

  function reset() {
    setState("idle");
    setResults(null);
    setErrorMsg(null);
    setPingStep(0);
  }

  const running = state === "pinging" || state === "downloading";
  const statusColor = results
    ? QUALITY_COLOR[results.pingQuality]
    : state === "error"
    ? "#EF4444"
    : "#3B82F6";

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={nd.overlay}>
        <View style={nd.sheet}>
          {/* Handle */}
          <View style={nd.handle} />

          {/* Header */}
          <View style={nd.headerRow}>
            <View style={nd.headerLeft}>
              <View style={[nd.headerIcon, { backgroundColor: "#EFF6FF" }]}>
                <Wifi size={20} color="#3B82F6" />
              </View>
              <Text style={nd.headerTitle}>Network Diagnostics</Text>
            </View>
            <Pressable style={nd.closeBtn} onPress={() => { reset(); onClose(); }}>
              <X size={20} color="#64748B" />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={nd.body} showsVerticalScrollIndicator={false}>

            {/* Status orb */}
            <View style={nd.orbWrap}>
              <PulseRing color={statusColor} running={running} />
              <View style={[nd.orb, { backgroundColor: statusColor + "18", borderColor: statusColor + "40" }]}>
                {running ? (
                  <ActivityIndicator color={statusColor} size="large" />
                ) : state === "error" ? (
                  <WifiOff size={36} color="#EF4444" />
                ) : results ? (
                  <Wifi size={36} color={statusColor} />
                ) : (
                  <Activity size={36} color="#3B82F6" />
                )}
              </View>
            </View>

            {/* Status label */}
            <Text style={[nd.statusLabel, { color: statusColor }]}>
              {state === "idle"       ? "Ready to test"
               : state === "pinging" ? `Pinging… (${pingStep}/5)`
               : state === "downloading" ? "Measuring speed…"
               : state === "error"   ? "Connection Error"
               : results             ? QUALITY_LABEL[results.pingQuality] + " Connection"
               : ""}
            </Text>

            {/* Result cards */}
            {results && (
              <View style={nd.cards}>
                {/* Latency card */}
                <View style={nd.card}>
                  <View style={[nd.cardIcon, { backgroundColor: QUALITY_COLOR[results.pingQuality] + "15" }]}>
                    <Radio size={18} color={QUALITY_COLOR[results.pingQuality]} />
                  </View>
                  <Text style={nd.cardLabel}>Latency</Text>
                  <Text style={[nd.cardValue, { color: QUALITY_COLOR[results.pingQuality] }]}>
                    {results.ping}
                    <Text style={nd.cardUnit}> ms</Text>
                  </Text>
                  <View style={[nd.qualityBadge, { backgroundColor: QUALITY_COLOR[results.pingQuality] + "18" }]}>
                    <Text style={[nd.qualityText, { color: QUALITY_COLOR[results.pingQuality] }]}>
                      {QUALITY_LABEL[results.pingQuality]}
                    </Text>
                  </View>
                </View>

                {/* Download card */}
                <View style={nd.card}>
                  <View style={[nd.cardIcon, { backgroundColor: QUALITY_COLOR[results.dlQuality] + "15" }]}>
                    <Download size={18} color={QUALITY_COLOR[results.dlQuality]} />
                  </View>
                  <Text style={nd.cardLabel}>Download</Text>
                  <Text style={[nd.cardValue, { color: QUALITY_COLOR[results.dlQuality] }]}>
                    {results.mbps >= 1
                      ? results.mbps.toFixed(2)
                      : (results.mbps * 1000).toFixed(0)}
                    <Text style={nd.cardUnit}>
                      {results.mbps >= 1 ? " Mbps" : " Kbps"}
                    </Text>
                  </Text>
                  <View style={[nd.qualityBadge, { backgroundColor: QUALITY_COLOR[results.dlQuality] + "18" }]}>
                    <Text style={[nd.qualityText, { color: QUALITY_COLOR[results.dlQuality] }]}>
                      {QUALITY_LABEL[results.dlQuality]}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Extra details */}
            {results && (
              <View style={nd.detailBox}>
                <View style={nd.detailRow}>
                  <Text style={nd.detailKey}>Avg ping (5 samples)</Text>
                  <Text style={nd.detailVal}>{results.ping} ms</Text>
                </View>
                <View style={nd.detailRow}>
                  <Text style={nd.detailKey}>Data received</Text>
                  <Text style={nd.detailVal}>{(results.bytes / 1024).toFixed(1)} KB</Text>
                </View>
                <View style={nd.detailRow}>
                  <Text style={nd.detailKey}>Transfer time</Text>
                  <Text style={nd.detailVal}>{(results.dlMs / 1000).toFixed(2)} s</Text>
                </View>
                <View style={nd.detailRow}>
                  <Text style={nd.detailKey}>Server</Text>
                  <Text style={[nd.detailVal, { fontSize: 11, color: "#94A3B8" }]} numberOfLines={1}>
                    ngrok endpoint
                  </Text>
                </View>
              </View>
            )}

            {/* Error message */}
            {state === "error" && errorMsg && (
              <View style={nd.errorBox}>
                <Text style={nd.errorText}>{errorMsg}</Text>
              </View>
            )}

            {/* CTA */}
            <Pressable
              style={[nd.runBtn, running && nd.runBtnDisabled]}
              onPress={running ? undefined : state === "done" || state === "error" ? reset : runTest}
              disabled={running}
            >
              {running ? (
                <ActivityIndicator color="#fff" size="small" style={{ marginRight: 8 }} />
              ) : null}
              <Text style={nd.runBtnText}>
                {running
                  ? state === "pinging" ? "Pinging server…" : "Measuring speed…"
                  : state === "done" || state === "error"
                  ? "Run Again"
                  : "Run Speed Test"}
              </Text>
            </Pressable>

            <Text style={nd.disclaimer}>
              Tests connect to your configured backend endpoint. Results reflect connection to the server, not general internet speed.
            </Text>

          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Profile Screen ─────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { logout, user, token } = useAuth();
  const [netModalOpen, setNetModalOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<"ok" | "error" | null>(null);

  const firstName = user?.first_name ?? "—";
  const lastName  = user?.last_name  ?? "";
  const role      = user?.role       ?? "Field Staff";
  const initials  = firstName.charAt(0).toUpperCase();

  const loadPendingCount = useCallback(async () => {
    const [td, imgs, gps, simple] = await Promise.all([
      queueReadAll().catch(() => []),
      imageQueueReadAll().catch(() => []),
      gpsQueueReadAll().catch(() => []),
      simpleQueueReadAll().catch(() => []),
    ]);
    const count =
      td.filter((i: any) => i.status !== "synced").length +
      imgs.filter((i: any) => i.status !== "synced").length +
      gps.length +
      simple.length;
    setPendingCount(count);
  }, []);

  useFocusEffect(useCallback(() => { loadPendingCount(); }, [loadPendingCount]));

  async function handleSyncAll() {
    const online = await isOnline();
    if (!online) {
      setLastSynced("error");
      return;
    }
    setSyncing(true);
    setLastSynced(null);
    try {
      await Promise.allSettled([
        processSyncQueue(),
        processSimpleQueue(),
        gpsQueueFlush(),
        processImageQueue(),
        token ? import("@/services/offline").then(m => m.syncQueue(token)) : Promise.resolve(),
      ]);
      setLastSynced("ok");
    } catch {
      setLastSynced("error");
    } finally {
      setSyncing(false);
      await loadPendingCount();
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <NetworkTestModal visible={netModalOpen} onClose={() => setNetModalOpen(false)} />

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* Profile Header */}
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.name}>{firstName} {lastName}</Text>
          <Text style={styles.role}>{role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</Text>
          <Pressable style={styles.editButton}>
            <Text style={styles.editButtonText}>Edit Profile</Text>
          </Pressable>
        </View>

        {/* Settings List */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Settings</Text>

          <Pressable style={styles.menuItem}>
            <View style={[styles.menuIconBox, { backgroundColor: "#EFF6FF" }]}>
              <User size={20} color="#3B82F6" />
            </View>
            <Text style={styles.menuText}>Personal Information</Text>
            <ChevronRight size={20} color="#CBD5E1" />
          </Pressable>

          <Pressable style={styles.menuItem}>
            <View style={[styles.menuIconBox, { backgroundColor: "#F3F4F6" }]}>
              <Settings size={20} color="#4B5563" />
            </View>
            <Text style={styles.menuText}>Preferences</Text>
            <ChevronRight size={20} color="#CBD5E1" />
          </Pressable>

          <Pressable style={styles.menuItem}>
            <View style={[styles.menuIconBox, { backgroundColor: "#FEF2F2" }]}>
              <Shield size={20} color="#EF4444" />
            </View>
            <Text style={styles.menuText}>Security & Privacy</Text>
            <ChevronRight size={20} color="#CBD5E1" />
          </Pressable>

          <Pressable style={styles.menuItem}>
            <View style={[styles.menuIconBox, { backgroundColor: "#FFFBEB" }]}>
              <Bell size={20} color="#F59E0B" />
            </View>
            <Text style={styles.menuText}>Notifications</Text>
            <ChevronRight size={20} color="#CBD5E1" />
          </Pressable>
        </View>

        {/* Sync Bar */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Offline Sync</Text>
          <Pressable
            style={[styles.syncBar, syncing && { opacity: 0.7 }]}
            onPress={handleSyncAll}
            disabled={syncing}
          >
            <View style={styles.syncBarLeft}>
              <View style={[styles.syncBarIcon, {
                backgroundColor: lastSynced === "ok" ? "#F0FDF4" : lastSynced === "error" ? "#FEF2F2" : "#EFF6FF",
              }]}>
                {syncing
                  ? <ActivityIndicator size="small" color="#3B82F6" />
                  : lastSynced === "ok"
                  ? <CheckCircle size={20} color="#16A34A" />
                  : lastSynced === "error"
                  ? <WifiOff size={20} color="#EF4444" />
                  : <RefreshCw size={20} color="#3B82F6" />}
              </View>
              <View>
                <Text style={styles.menuText}>
                  {syncing ? "Syncing…" : lastSynced === "ok" ? "All Synced" : lastSynced === "error" ? "Offline — Retry Later" : "Sync Pending Data"}
                </Text>
                <Text style={styles.menuSub}>
                  {pendingCount === 0 ? "No offline data to sync" : `${pendingCount} item${pendingCount !== 1 ? "s" : ""} pending upload`}
                </Text>
              </View>
            </View>
            {pendingCount > 0 && !syncing && (
              <View style={styles.syncBadge}>
                <Text style={styles.syncBadgeText}>{pendingCount}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Network Diagnostics */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Diagnostics</Text>
          <Pressable style={styles.menuItem} onPress={() => setNetModalOpen(true)}>
            <View style={[styles.menuIconBox, { backgroundColor: "#F0FDF4" }]}>
              <Wifi size={20} color="#16A34A" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuText}>Network Speed Test</Text>
              <Text style={styles.menuSub}>Check ping & download speed</Text>
            </View>
            <ChevronRight size={20} color="#CBD5E1" />
          </Pressable>
        </View>

        {/* Logout */}
        <Pressable style={styles.logoutButton} onPress={logout}>
          <LogOut size={20} color="#EF4444" style={{ marginRight: 8 }} />
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea:        { flex: 1, backgroundColor: "#F8FAFC" },
  container:       { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 100 },
  header:          { alignItems: "center", marginBottom: 40 },
  avatarContainer: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: "#0F172A", alignItems: "center", justifyContent: "center",
    marginBottom: 16,
    shadowColor: "#0F172A", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1, shadowRadius: 16, elevation: 4,
  },
  avatarText:      { fontSize: 36, fontWeight: "900", color: "#FFFFFF" },
  name:            { fontSize: 24, fontWeight: "800", color: "#0F172A", marginBottom: 4 },
  role:            { fontSize: 14, fontWeight: "600", color: "#64748B", marginBottom: 16 },
  editButton:      { backgroundColor: "#EFF6FF", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 100 },
  editButtonText:  { fontSize: 14, fontWeight: "700", color: "#3B82F6" },
  section:         { marginBottom: 32 },
  sectionTitle:    { fontSize: 16, fontWeight: "800", color: "#0F172A", marginBottom: 16 },
  menuItem: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#FFFFFF", padding: 16, borderRadius: 20, marginBottom: 12,
    shadowColor: "#0F172A", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03, shadowRadius: 12, elevation: 2,
    borderWidth: 1, borderColor: "#F1F5F9",
  },
  menuIconBox: {
    width: 44, height: 44, borderRadius: 14,
    alignItems: "center", justifyContent: "center", marginRight: 16,
  },
  menuText:  { flex: 1, fontSize: 15, fontWeight: "600", color: "#0F172A" },
  menuSub:   { fontSize: 12, color: "#94A3B8", fontWeight: "500", marginTop: 2 },
  logoutButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#FEF2F2", paddingVertical: 16, borderRadius: 20,
    borderWidth: 1, borderColor: "#FEE2E2",
  },
  logoutText: { fontSize: 16, fontWeight: "700", color: "#EF4444" },

  syncBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#FFFFFF", padding: 16, borderRadius: 20,
    shadowColor: "#0F172A", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03, shadowRadius: 12, elevation: 2,
    borderWidth: 1, borderColor: "#F1F5F9",
  },
  syncBarLeft:  { flexDirection: "row", alignItems: "center", gap: 16, flex: 1 },
  syncBarIcon:  { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  syncBadge:    { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  syncBadgeText:{ fontSize: 11, fontWeight: "800", color: "#fff" },
});

const nd = StyleSheet.create({
  overlay: {
    flex: 1, justifyContent: "flex-end",
    backgroundColor: "rgba(15,23,42,0.55)",
  },
  sheet: {
    backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingBottom: 40, maxHeight: "90%",
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: "#E2E8F0", alignSelf: "center", marginBottom: 20,
  },
  headerRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 20, marginBottom: 4,
  },
  headerLeft:  { flex: 1, flexDirection: "row", alignItems: "center" },
  headerIcon:  { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  closeBtn:    { padding: 4 },
  body:        { paddingHorizontal: 20, paddingTop: 16 },

  orbWrap: { alignItems: "center", justifyContent: "center", marginVertical: 24, height: 110 },
  pulseRing: {
    position: "absolute", width: 100, height: 100, borderRadius: 50,
    borderWidth: 2,
  },
  orb: {
    width: 100, height: 100, borderRadius: 50,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2,
  },
  statusLabel: { textAlign: "center", fontSize: 18, fontWeight: "800", marginBottom: 20 },

  cards: { flexDirection: "row", gap: 12, marginBottom: 16 },
  card: {
    flex: 1, backgroundColor: "#F8FAFC", borderRadius: 20,
    padding: 16, alignItems: "center", borderWidth: 1, borderColor: "#F1F5F9",
  },
  cardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  cardLabel: { fontSize: 11, fontWeight: "600", color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  cardValue: { fontSize: 28, fontWeight: "900", marginBottom: 8 },
  cardUnit:  { fontSize: 14, fontWeight: "600" },
  qualityBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  qualityText: { fontSize: 12, fontWeight: "700" },

  detailBox: {
    backgroundColor: "#F8FAFC", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "#F1F5F9", marginBottom: 16,
    gap: 10,
  },
  detailRow: { flexDirection: "row", justifyContent: "space-between" },
  detailKey: { fontSize: 13, color: "#64748B", fontWeight: "500" },
  detailVal: { fontSize: 13, color: "#0F172A", fontWeight: "700" },

  errorBox: {
    backgroundColor: "#FEF2F2", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "#FEE2E2", marginBottom: 16,
  },
  errorText: { fontSize: 14, color: "#DC2626", fontWeight: "600", textAlign: "center" },

  runBtn: {
    backgroundColor: "#0F172A", borderRadius: 20, paddingVertical: 16,
    alignItems: "center", justifyContent: "center",
    flexDirection: "row", marginBottom: 12,
  },
  runBtnDisabled: { backgroundColor: "#334155" },
  runBtnText: { fontSize: 16, fontWeight: "800", color: "#FFFFFF" },

  disclaimer: {
    fontSize: 11, color: "#94A3B8", textAlign: "center",
    lineHeight: 16, paddingHorizontal: 8,
  },
});
