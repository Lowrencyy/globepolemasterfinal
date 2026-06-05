import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { queueReadAll } from "@/lib/sync-queue";

// ── Palette ───────────────────────────────────────────────────────────────────
const G = {
  green:   "#1A7C4E",
  greenBg: "#F0FAF4",
  ink:     "#0F172A",
  muted:   "#64748B",
  soft:    "#94A3B8",
  border:  "#E8EDF2",
  card:    "#FFFFFF",
  bg:      "#F5F7FA",
};

// Maps internal photo keys → display label + pole side
const PHOTO_SLOTS = [
  { key: "from_before",   pole: "from", label: "Before",    icon: "📷" },
  { key: "from_after",    pole: "from", label: "After",     icon: "📸" },
  { key: "from_pole_tag", pole: "from", label: "Pole Tag",  icon: "🏷️" },
  { key: "to_before",     pole: "to",   label: "Before",    icon: "📷" },
  { key: "to_after",      pole: "to",   label: "After",     icon: "📸" },
  { key: "to_pole_tag",   pole: "to",   label: "Pole Tag",  icon: "🏷️" },
  { key: "bunching",      pole: "span", label: "Bunching",  icon: "🔗" },
];

// ── Photo tile ────────────────────────────────────────────────────────────────
function PhotoTile({
  label, icon, uri, onPress,
}: { label: string; icon: string; uri: string | null; onPress: () => void }) {
  const [imgErr, setImgErr] = useState(false);
  const hasPhoto = !!uri && !imgErr;

  return (
    <TouchableOpacity
      style={pt.tile}
      activeOpacity={hasPhoto ? 0.8 : 1}
      onPress={hasPhoto ? onPress : undefined}
    >
      {uri && !imgErr ? (
        <Image
          source={{ uri }}
          style={pt.img}
          resizeMode="cover"
          onError={() => setImgErr(true)}
        />
      ) : (
        <View style={pt.empty}>
          <Text style={pt.emptyIcon}>📷</Text>
          <Text style={pt.emptyText}>{uri && imgErr ? "Load error" : "No photo"}</Text>
        </View>
      )}
      {/* pointer-events none so overlay never blocks the TouchableOpacity */}
      {hasPhoto && (
        <View style={pt.overlay} pointerEvents="none">
          <Text style={pt.overlayText}>VIEW</Text>
        </View>
      )}
      <View style={pt.label}>
        <Text style={pt.labelIcon}>{icon}</Text>
        <Text style={[pt.labelText, { color: hasPhoto ? G.green : G.soft }]}>{label}</Text>
        {hasPhoto && <View style={pt.check}><Text style={pt.checkText}>✓</Text></View>}
      </View>
    </TouchableOpacity>
  );
}
const pt = StyleSheet.create({
  tile:        { flex: 1, minWidth: "30%", maxWidth: "32%", borderRadius: 16, overflow: "hidden", backgroundColor: G.card, borderWidth: 1, borderColor: G.border, shadowColor: "#0F172A", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  img:         { width: "100%", aspectRatio: 0.8 },
  overlay:     { position: "absolute", top: 0, left: 0, right: 0, bottom: 32, backgroundColor: "rgba(0,0,0,0.12)", alignItems: "center", justifyContent: "center" },
  overlayText: { color: "#fff", fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  empty:       { aspectRatio: 0.8, alignItems: "center", justifyContent: "center", backgroundColor: "#F8FAFC", gap: 4 },
  emptyIcon:   { fontSize: 26 },
  emptyText:   { fontSize: 10, fontWeight: "700", color: G.soft },
  label:       { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: G.border },
  labelIcon:   { fontSize: 12 },
  labelText:   { flex: 1, fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 },
  check:       { width: 16, height: 16, borderRadius: 8, backgroundColor: G.green, alignItems: "center", justifyContent: "center" },
  checkText:   { fontSize: 8, fontWeight: "900", color: "#fff" },
});

// ── Screen ────────────────────────────────────────────────────────────────────
export default function QueueSpanScreen() {
  const router = useRouter();
  const { entryId } = useLocalSearchParams<{ entryId: string }>();

  const [entry,   setEntry]   = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewer,  setViewer]  = useState<{ uri: string; label: string } | null>(null);

  useEffect(() => {
    queueReadAll()
      .then(all => {
        const found = all.find(e => e.id === entryId);
        setEntry(found ?? null);
      })
      .finally(() => setLoading(false));
  }, [entryId]);

  if (loading) {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.center}><ActivityIndicator size="large" color={G.green} /></View>
      </SafeAreaView>
    );
  }

  if (!entry) {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.center}>
          <Text style={s.emptyTitle}>Span not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={s.backLinkBtn}>
            <Text style={s.backLinkText}>← Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const f         = entry.fields ?? {};
  const photos    = entry.photoPaths ?? {};
  const fromCode  = f.from_pole_code ?? f.pole_code ?? "—";
  const toCode    = f.to_pole_code ?? "—";
  const nodeName  = f.node_name ?? `Node #${f.node_id ?? "—"}`;

  const fromSlots = PHOTO_SLOTS.filter(sl => sl.pole === "from");
  const toSlots   = PHOTO_SLOTS.filter(sl => sl.pole === "to");
  const spanSlots = PHOTO_SLOTS.filter(sl => sl.pole === "span");

  const comps = [
    f.collected_cable     && `${f.collected_cable}m cable`,
    f.collected_node      && `${f.collected_node} node`,
    f.collected_amplifier && `${f.collected_amplifier} amp`,
    f.collected_extender  && `${f.collected_extender} ext`,
    f.collected_tsc       && `${f.collected_tsc} tsc`,
    f.collected_powersupply && `${f.collected_powersupply} psu`,
  ].filter(Boolean);

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={[s.backIcon, { color: G.green }]}>←</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={[s.headerEye, { color: G.green }]}>PENDING TEARDOWN  ·  {nodeName}</Text>
          <Text style={s.headerTitle}>{fromCode}   →   {toCode}</Text>
          {comps.length > 0 && (
            <Text style={s.headerSub} numberOfLines={1}>{comps.join("  ·  ")}</Text>
          )}
        </View>
        <View style={[s.statusBadge, { backgroundColor: G.greenBg, borderColor: "#A7F3D0" }]}>
          <View style={[s.statusDot, { backgroundColor: G.green }]} />
          <Text style={[s.statusText, { color: G.green }]}>PENDING</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* ── Collected Components ── */}
        <CollectedComponents f={f} />

        {/* ── From Pole ── */}
        <PoleSection
          title={`From Pole — ${fromCode}`}
          color={G.green}
          slots={fromSlots}
          photos={photos}
          onView={(uri, label) => setViewer({ uri, label })}
        />

        {/* ── To Pole ── */}
        <PoleSection
          title={`To Pole — ${toCode}`}
          color="#2563EB"
          slots={toSlots}
          photos={photos}
          onView={(uri, label) => setViewer({ uri, label })}
        />

        {/* ── Span photos (bunching etc) ── */}
        {spanSlots.some(sl => photos[sl.key]) && (
          <PoleSection
            title="Span Photos"
            color="#7C3AED"
            slots={spanSlots}
            photos={photos}
            onView={(uri, label) => setViewer({ uri, label })}
          />
        )}

        {/* ── Partial reason ── */}
        {f.did_collect_all_cable === "0" && f.unrecovered_reason && (
          <View style={s.reasonBox}>
            <Text style={s.reasonLabel}>⚠️  Reason for Partial Collection</Text>
            <Text style={s.reasonText}>{f.unrecovered_reason}</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Full-screen photo viewer ── */}
      <Modal visible={!!viewer} transparent={false} animationType="fade" statusBarTranslucent onRequestClose={() => setViewer(null)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          {viewer && (
            <Image source={{ uri: viewer.uri }} style={{ flex: 1 }} resizeMode="contain" />
          )}
          <View style={vw.topBar}>
            <View style={vw.labelBox}>
              <Text style={vw.label}>{viewer?.label}</Text>
            </View>
            <TouchableOpacity onPress={() => setViewer(null)} style={vw.closeBtn} activeOpacity={0.8}>
              <Text style={vw.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Collected Components ─────────────────────────────────────────────────────
const COMP_DEFS = [
  { key: "collected_cable",       label: "Cable",        unit: "m",  icon: "🔌", color: "#059669", bg: "#ECFDF5", border: "#A7F3D0" },
  { key: "collected_node",        label: "Node Box",     unit: "",   icon: "📦", color: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE" },
  { key: "collected_amplifier",   label: "Amplifier",    unit: "",   icon: "⚡", color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE" },
  { key: "collected_extender",    label: "Extender",     unit: "",   icon: "📡", color: "#0891B2", bg: "#ECFEFF", border: "#A5F3FC" },
  { key: "collected_tsc",         label: "TSC",          unit: "",   icon: "🎛️", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
  { key: "collected_powersupply", label: "Power Supply", unit: "",   icon: "🔋", color: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
] as const;

function CollectedComponents({ f }: { f: Record<string, string> }) {
  const items = COMP_DEFS.map(d => ({
    ...d,
    qty: Number(f[d.key] ?? 0),
  })).filter(d => d.qty > 0);

  if (!items.length) return null;

  return (
    <View style={{ marginBottom: 24 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <View style={{ width: 4, height: 20, borderRadius: 2, backgroundColor: G.green }} />
        <Text style={{ fontSize: 14, fontWeight: "900", color: G.green }}>Collected Components</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {items.map(item => (
          <View
            key={item.key}
            style={{ alignItems: "center", justifyContent: "center", paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, borderWidth: 1, minWidth: 80, backgroundColor: item.bg, borderColor: item.border }}
          >
            <Text style={{ fontSize: 20, marginBottom: 4 }}>{item.icon}</Text>
            <Text style={{ fontSize: 20, fontWeight: "900", color: item.color, letterSpacing: -0.5 }}>
              {item.unit === "m" ? `${item.qty}m` : item.qty}
            </Text>
            <Text style={{ fontSize: 10, fontWeight: "700", color: item.color, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.8, marginTop: 2 }}>
              {item.label}
            </Text>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 10, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, alignSelf: "flex-start",
        borderColor: f.did_collect_all_cable === "1" ? "#A7F3D0" : "#FDE68A",
        backgroundColor: f.did_collect_all_cable === "1" ? "#ECFDF5" : "#FFFBEB",
      }}>
        <Text style={{ fontSize: 12, fontWeight: "800", color: f.did_collect_all_cable === "1" ? "#059669" : "#B45309" }}>
          {f.did_collect_all_cable === "1" ? "✓  Full collection confirmed" : "⚠️  Partial collection"}
        </Text>
      </View>
    </View>
  );
}

// ── Pole Section ──────────────────────────────────────────────────────────────
function PoleSection({ title, color, slots, photos, onView }: {
  title: string; color: string;
  slots: typeof PHOTO_SLOTS;
  photos: Record<string, string>;
  onView: (uri: string, label: string) => void;
}) {
  return (
    <View style={ps.section}>
      <View style={ps.labelRow}>
        <View style={[ps.bar, { backgroundColor: color }]} />
        <Text style={[ps.title, { color }]}>{title}</Text>
      </View>
      <View style={ps.grid}>
        {slots.map(sl => (
          <PhotoTile
            key={sl.key}
            label={sl.label}
            icon={sl.icon}
            uri={photos[sl.key] ?? null}
            onPress={() => photos[sl.key] && onView(photos[sl.key], sl.label)}
          />
        ))}
      </View>
    </View>
  );
}
const ps = StyleSheet.create({
  section:  { marginBottom: 24 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  bar:      { width: 4, height: 20, borderRadius: 2 },
  title:    { fontSize: 14, fontWeight: "900", letterSpacing: 0.2 },
  grid:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: G.bg },
  content: { padding: 18, paddingBottom: 60 },
  center:  { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },

  header:       { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, backgroundColor: G.card, borderBottomWidth: 1, borderBottomColor: G.border },
  headerCenter: { flex: 1, minWidth: 0, gap: 3 },
  headerEye:    { fontSize: 10, fontWeight: "900", letterSpacing: 1.6 },
  headerTitle:  { fontSize: 22, fontWeight: "900", color: G.ink, fontFamily: "monospace" },
  headerSub:    { fontSize: 12, fontWeight: "600", color: G.muted },
  backBtn:      { width: 40, height: 40, borderRadius: 20, backgroundColor: G.greenBg, alignItems: "center", justifyContent: "center", marginTop: 2 },
  backIcon:     { fontSize: 20, fontWeight: "900" },

  statusBadge:  { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, borderWidth: 1, marginTop: 4 },
  statusDot:    { width: 6, height: 6, borderRadius: 3 },
  statusText:   { fontSize: 10, fontWeight: "900", letterSpacing: 0.6 },

  emptyTitle:   { fontSize: 18, fontWeight: "900", color: G.ink },
  backLinkBtn:  { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: G.greenBg, marginTop: 4 },
  backLinkText: { fontSize: 14, fontWeight: "800", color: G.green },

  reasonBox:    { backgroundColor: "#FFFBEB", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#FDE68A", gap: 6 },
  reasonLabel:  { fontSize: 12, fontWeight: "900", color: "#B45309" },
  reasonText:   { fontSize: 13, fontWeight: "600", color: "#374151", lineHeight: 20 },
});


const vw = StyleSheet.create({
  topBar:   { position: "absolute", top: 52, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18 },
  labelBox: { backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  label:    { color: "#fff", fontSize: 13, fontWeight: "800" },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  closeText:{ color: "#fff", fontSize: 18, fontWeight: "700" },
});
