import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, RotateCcw, Save } from "lucide-react-native";
import { useAuth } from "@/context/auth-context";
import { getNapBoxPorts, updatePort, type NapPort } from "@/services/nap-box";

type PortStatus = "active" | "inactive" | "free";

const STATUS_CYCLE: Record<PortStatus, PortStatus> = {
  active: "inactive",
  inactive: "free",
  free: "active",
};

const STATUS_CONFIG: Record<PortStatus, { label: string; body: string; ferrule: string; text: string; bg: string }> = {
  active:   { label: "Active",   body: "#dc2626", ferrule: "#fee2e2", text: "#dc2626", bg: "#FEE2E2" },
  inactive: { label: "Inactive", body: "#d97706", ferrule: "#fef3c7", text: "#d97706", bg: "#FEF3C7" },
  free:     { label: "Free",     body: "#16a34a", ferrule: "#bbf7d0", text: "#16a34a", bg: "#DCFCE7" },
};

export default function AuditScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const { napId, napTag, total } = useLocalSearchParams<{
    napId: string; napTag: string; total: string; used: string;
  }>();

  const totalPorts = parseInt(total ?? "8", 10);
  const boxId = parseInt(napId ?? "0", 10);

  const [ports, setPorts] = useState<NapPort[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // track status overrides: portNumber → new status
  const [overrides, setOverrides] = useState<Record<number, PortStatus>>({});

  useEffect(() => {
    setLoading(true);
    getNapBoxPorts(boxId, token!)
      .then(setPorts)
      .catch(() => Alert.alert("Error", "Failed to load port data."))
      .finally(() => setLoading(false));
  }, [boxId]);

  const getPortStatus = (portNum: number): PortStatus => {
    if (overrides[portNum] !== undefined) return overrides[portNum];
    const port = ports.find((p) => p.port_number === portNum);
    if (!port) return "free";
    return port.status as PortStatus;
  };

  const togglePort = (portNum: number) => {
    const current = getPortStatus(portNum);
    const next = STATUS_CYCLE[current];
    setOverrides((prev) => ({ ...prev, [portNum]: next }));
  };

  const resetOverrides = () => setOverrides({});

  const changedPorts = useMemo(() => {
    return Object.entries(overrides)
      .filter(([portNum, newStatus]) => {
        const port = ports.find((p) => p.port_number === Number(portNum));
        const original: PortStatus = port ? (port.status as PortStatus) : "free";
        return original !== newStatus;
      })
      .map(([portNum, newStatus]) => ({ portNum: Number(portNum), newStatus }));
  }, [overrides, ports]);

  const counts = useMemo(() => {
    const result = { active: 0, inactive: 0, free: 0 };
    for (let i = 1; i <= totalPorts; i++) {
      result[getPortStatus(i)]++;
    }
    return result;
  }, [overrides, ports, totalPorts]);

  const utilPct = Math.round(((counts.active + counts.inactive) / totalPorts) * 100);
  const cols = Math.ceil(totalPorts / 2);
  const slots = Array.from({ length: totalPorts }, (_, i) => i + 1);
  const row1 = slots.slice(0, cols);
  const row2 = slots.slice(cols);

  const handleSubmit = async () => {
    if (changedPorts.length === 0) {
      Alert.alert("No Changes", "You haven't changed any port statuses.");
      return;
    }
    Alert.alert(
      "Submit Audit",
      `Save changes to ${changedPorts.length} port(s)?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: async () => {
            setSubmitting(true);
            try {
              await Promise.all(
                changedPorts.map(({ portNum, newStatus }) => {
                  const port = ports.find((p) => p.port_number === portNum);
                  return updatePort(boxId, portNum, token!, {
                    status: newStatus,
                    subscriber_id: newStatus === "free" ? null : (port?.subscriber_id ?? null),
                    subscriber_name: newStatus === "free" ? null : (port?.subscriber_name ?? null),
                    account_number: newStatus === "free" ? null : (port?.account_number ?? null),
                  });
                })
              );
              // refresh ports
              const fresh = await getNapBoxPorts(boxId, token!);
              setPorts(fresh);
              setOverrides({});
              Alert.alert("Saved", "Port statuses updated successfully.");
            } catch (e: any) {
              Alert.alert("Error", e.message || "Failed to save changes.");
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color="#7C3AED" />
          <Text style={styles.loadingText}>Loading ports…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <ChevronLeft size={20} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Port Audit</Text>
          <Text style={styles.headerSub}>{napTag} · {totalPorts}-port</Text>
        </View>
        {changedPorts.length > 0 && (
          <TouchableOpacity style={styles.resetBtn} onPress={resetOverrides} activeOpacity={0.75}>
            <RotateCcw size={14} color="#64748B" />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting
            ? <ActivityIndicator size="small" color="#FFF" />
            : <Save size={16} color="#FFFFFF" />}
          <Text style={styles.submitBtnText}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Counter cards */}
        <View style={styles.counterRow}>
          {(["active", "inactive", "free"] as PortStatus[]).map((s) => {
            const cfg = STATUS_CONFIG[s];
            return (
              <View key={s} style={[styles.counterCard, { borderColor: cfg.bg }]}>
                <View style={styles.counterTop}>
                  <View style={[styles.counterDot, { backgroundColor: cfg.body }]} />
                  <Text style={styles.counterLabel}>{cfg.label}</Text>
                </View>
                <Text style={[styles.counterValue, { color: cfg.text }]}>{counts[s]}</Text>
              </View>
            );
          })}
        </View>

        {/* Dark NAP Box Panel */}
        <View style={styles.napPanel}>
          <View style={styles.napPanelHeader}>
            <Text style={styles.napPanelId}>{napTag}</Text>
            <Text style={styles.napPanelType}>{totalPorts}-PORT</Text>
          </View>

          <View style={styles.portRow}>
            {row1.map((num) => {
              const status = getPortStatus(num);
              const cfg = STATUS_CONFIG[status];
              const changed = overrides[num] !== undefined && overrides[num] !== (ports.find(p => p.port_number === num)?.status ?? "free");
              return (
                <TouchableOpacity
                  key={num}
                  style={styles.fiberPort}
                  onPress={() => togglePort(num)}
                  activeOpacity={0.7}
                >
                  <View style={styles.fiberPortInner}>
                    <View style={[styles.fiberPortCore, { backgroundColor: cfg.body, shadowColor: cfg.body }]}>
                      <View style={[styles.ferrule, { backgroundColor: cfg.ferrule }]} />
                    </View>
                  </View>
                  <Text style={styles.portNum}>{num}</Text>
                  {changed && <View style={styles.changedDot} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {row2.length > 0 && (
            <View style={styles.portRow}>
              {row2.map((num) => {
                const status = getPortStatus(num);
                const cfg = STATUS_CONFIG[status];
                const changed = overrides[num] !== undefined && overrides[num] !== (ports.find(p => p.port_number === num)?.status ?? "free");
                return (
                  <TouchableOpacity
                    key={num}
                    style={styles.fiberPort}
                    onPress={() => togglePort(num)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.fiberPortInner}>
                      <View style={[styles.fiberPortCore, { backgroundColor: cfg.body, shadowColor: cfg.body }]}>
                        <View style={[styles.ferrule, { backgroundColor: cfg.ferrule }]} />
                      </View>
                    </View>
                    <Text style={styles.portNum}>{num}</Text>
                    {changed && <View style={styles.changedDot} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Utilization bar */}
          <View style={styles.utilSection}>
            <View style={styles.utilLabelRow}>
              <Text style={styles.utilLabel}>UTILIZATION</Text>
              <Text style={styles.utilValue}>{counts.active + counts.inactive}/{totalPorts} ({utilPct}%)</Text>
            </View>
            <View style={styles.utilTrack}>
              {counts.active > 0 && (
                <View style={[styles.utilSegment, { width: `${(counts.active / totalPorts) * 100}%`, backgroundColor: "#dc2626" }]} />
              )}
              {counts.inactive > 0 && (
                <View style={[styles.utilSegment, { width: `${(counts.inactive / totalPorts) * 100}%`, backgroundColor: "#d97706" }]} />
              )}
            </View>
          </View>

          {/* Legend */}
          <View style={styles.legendRow}>
            {(["active", "inactive", "free"] as PortStatus[]).map((s) => (
              <View key={s} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: STATUS_CONFIG[s].body }]} />
                <Text style={styles.legendText}>{STATUS_CONFIG[s].label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Changed strip */}
        {changedPorts.length > 0 && (
          <View style={styles.changedStrip}>
            <View style={styles.changedBadge}>
              <Text style={styles.changedBadgeText}>{changedPorts.length}</Text>
            </View>
            <Text style={styles.changedLabel}>
              port{changedPorts.length > 1 ? "s" : ""} changed — tap Save to submit
            </Text>
          </View>
        )}

        {/* Port Table */}
        <View style={styles.portTableCard}>
          <View style={styles.portTableHeader}>
            <View>
              <Text style={styles.portTableTitle}>All Ports</Text>
              <Text style={styles.portTableSub}>Tap any row to cycle status</Text>
            </View>
            <View style={styles.portTableBadge}>
              <Text style={styles.portTableBadgeText}>{totalPorts} ports</Text>
            </View>
          </View>

          <View style={styles.portTableColHeader}>
            <Text style={[styles.portColLabel, { width: 42 }]}>#</Text>
            <Text style={[styles.portColLabel, { flex: 1 }]}>SUBSCRIBER</Text>
            <Text style={[styles.portColLabel, { width: 84, textAlign: "center" }]}>STATUS</Text>
          </View>

          {slots.map((num, idx) => {
            const status = getPortStatus(num);
            const cfg = STATUS_CONFIG[status];
            const port = ports.find((p) => p.port_number === num);
            const changed = overrides[num] !== undefined && overrides[num] !== ((port?.status as PortStatus) ?? "free");
            const isLast = idx === slots.length - 1;

            return (
              <TouchableOpacity
                key={num}
                style={[
                  styles.portTableRow,
                  changed && styles.portTableRowChanged,
                  isLast && { borderBottomWidth: 0 },
                ]}
                onPress={() => togglePort(num)}
                activeOpacity={0.7}
              >
                {/* Port number box */}
                <View style={[styles.portNumBox, { borderColor: cfg.body + "40" }]}>
                  <View style={[styles.portNumDot, { backgroundColor: cfg.body }]} />
                  <Text style={[styles.portNumLabel, { color: cfg.body }]}>{num}</Text>
                </View>

                {/* Subscriber info */}
                <View style={styles.portRowInfo}>
                  <Text style={[styles.portRowSub, !port?.subscriber_name && { color: "#CBD5E1", fontWeight: "500" }]}>
                    {port?.subscriber_name ?? "No subscriber"}
                  </Text>
                  <Text style={styles.portRowAcc}>
                    {port?.account_number ?? "—"}
                  </Text>
                </View>

                {/* Status pill + changed indicator */}
                <View style={styles.portRowRight}>
                  <View style={[styles.portStatusPill, { backgroundColor: cfg.bg, borderColor: cfg.body + "30" }]}>
                    <View style={[styles.portStatusDot, { backgroundColor: cfg.body }]} />
                    <Text style={[styles.portStatusLabel, { color: cfg.text }]}>{cfg.label}</Text>
                  </View>
                  {changed && <View style={styles.portChangedIndicator} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea:        { flex: 1, backgroundColor: "#F8FAFC" },
  loadingCenter:   { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText:     { fontSize: 13, fontWeight: "600", color: "#94A3B8" },

  header:          { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  backBtn:         { width: 38, height: 38, borderRadius: 12, backgroundColor: "#F8FAFC", alignItems: "center", justifyContent: "center", marginRight: 12 },
  headerCenter:    { flex: 1 },
  headerTitle:     { fontSize: 16, fontWeight: "800", color: "#0F172A" },
  headerSub:       { fontSize: 11, fontWeight: "600", color: "#94A3B8", marginTop: 1 },
  resetBtn:        { width: 38, height: 38, borderRadius: 12, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center", marginRight: 8 },
  submitBtn:       { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#7C3AED", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  submitBtnText:   { fontSize: 13, fontWeight: "800", color: "#FFFFFF" },

  scrollContent:   { padding: 16, paddingBottom: 60, gap: 14 },

  counterRow:      { flexDirection: "row", gap: 8 },
  counterCard:     { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 14, padding: 12, borderWidth: 1 },
  counterTop:      { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 6 },
  counterDot:      { width: 8, height: 8, borderRadius: 4 },
  counterLabel:    { fontSize: 9, fontWeight: "800", color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5 },
  counterValue:    { fontSize: 22, fontWeight: "900" },

  napPanel:        { backgroundColor: "#191919", borderRadius: 20, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.4, shadowRadius: 24, elevation: 8 },
  napPanelHeader:  { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  napPanelId:      { fontFamily: "monospace", fontSize: 10, fontWeight: "600", color: "rgba(255,255,255,0.4)", letterSpacing: 2, textTransform: "uppercase" },
  napPanelType:    { fontFamily: "monospace", fontSize: 10, fontWeight: "600", color: "rgba(255,255,255,0.3)", letterSpacing: 1 },

  portRow:         { flexDirection: "row", justifyContent: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" },
  fiberPort:       { width: 36, height: 36, borderRadius: 7, backgroundColor: "#101010", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  fiberPortInner:  { width: 28, height: 28, borderRadius: 5, backgroundColor: "#050505", alignItems: "center", justifyContent: "center" },
  fiberPortCore:   { width: 16, height: 16, borderRadius: 3, alignItems: "center", justifyContent: "center", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 5, elevation: 3 },
  ferrule:         { width: 7, height: 7, borderRadius: 4 },
  portNum:         { position: "absolute", bottom: 1, right: 3, fontFamily: "monospace", fontSize: 6, color: "rgba(255,255,255,0.3)" },
  changedDot:      { position: "absolute", top: -2, right: -2, width: 7, height: 7, borderRadius: 4, backgroundColor: "#FFFFFF", borderWidth: 1.5, borderColor: "#191919" },

  utilSection:     { marginTop: 16 },
  utilLabelRow:    { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  utilLabel:       { fontFamily: "monospace", fontSize: 9, fontWeight: "700", color: "rgba(255,255,255,0.3)", letterSpacing: 2 },
  utilValue:       { fontFamily: "monospace", fontSize: 9, fontWeight: "700", color: "rgba(147,197,253,0.7)" },
  utilTrack:       { height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", flexDirection: "row", overflow: "hidden" },
  utilSegment:     { height: "100%" },

  legendRow:       { flexDirection: "row", justifyContent: "center", gap: 16, marginTop: 12 },
  legendItem:      { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot:       { width: 8, height: 8, borderRadius: 4 },
  legendText:      { fontSize: 10, fontWeight: "600", color: "rgba(255,255,255,0.4)" },

  changedStrip:    { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#EDE9FE", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#DDD6FE" },
  changedBadge:    { width: 24, height: 24, borderRadius: 12, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" },
  changedBadgeText:{ fontSize: 11, fontWeight: "900", color: "#FFFFFF" },
  changedLabel:    { fontSize: 12, fontWeight: "600", color: "#7C3AED" },

  portTableCard:       { backgroundColor: "#FFFFFF", borderRadius: 22, overflow: "hidden", borderWidth: 1, borderColor: "#F1F5F9", shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2 },
  portTableHeader:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 18, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  portTableTitle:      { fontSize: 16, fontWeight: "900", color: "#0F172A" },
  portTableSub:        { fontSize: 11, fontWeight: "500", color: "#94A3B8", marginTop: 2 },
  portTableBadge:      { backgroundColor: "#EDE9FE", borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5 },
  portTableBadgeText:  { fontSize: 11, fontWeight: "800", color: "#7C3AED" },
  portTableColHeader:  { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 10, backgroundColor: "#F8FAFC", borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  portColLabel:        { fontSize: 9, fontWeight: "800", color: "#94A3B8", textTransform: "uppercase", letterSpacing: 1 },
  portTableRow:        { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#F8FAFC", gap: 12 },
  portTableRowChanged: { backgroundColor: "#FAFAFE" },
  portNumBox:          { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F8FAFC", alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  portNumDot:          { width: 5, height: 5, borderRadius: 3, position: "absolute", top: 4, right: 4 },
  portNumLabel:        { fontSize: 14, fontWeight: "900" },
  portRowInfo:         { flex: 1 },
  portRowSub:          { fontSize: 13, fontWeight: "700", color: "#0F172A" },
  portRowAcc:          { fontSize: 10, fontWeight: "600", color: "#94A3B8", marginTop: 2 },
  portRowRight:        { alignItems: "flex-end", gap: 4 },
  portStatusPill:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1 },
  portStatusDot:       { width: 6, height: 6, borderRadius: 3 },
  portStatusLabel:     { fontSize: 10, fontWeight: "800" },
  portChangedIndicator:{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#7C3AED" },
});
