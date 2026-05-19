/**
 * Request Pickup — create a pickup request to transfer items to another warehouse.
 * Accessible by: Project Manager, Warehouse In-Charge, Admin, Executive.
 */
import { useAuth } from "@/context/auth-context";
import {
  createPickupRequest,
  getWarehouses,
  type Warehouse,
} from "@/services/skycable";
import { Stack, useRouter } from "expo-router";
import {
  ArrowRight, Building2, ChevronDown, ChevronLeft,
  FileText, SendHorizonal,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal,
  ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G = "#0B7A5A", SLATE = "#111827", MUTED = "#667085", BORDER = "#E7ECF2", WHITE = "#FFFFFF";

export default function PickupRequestScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [warehouses,   setWarehouses]   = useState<Warehouse[]>([]);
  const [fromWh,       setFromWh]       = useState<Warehouse | null>(null);
  const [toWh,         setToWh]         = useState<Warehouse | null>(null);
  const [notes,        setNotes]        = useState("");
  const [loading,      setLoading]      = useState(true);
  const [submitting,   setSubmitting]   = useState(false);
  const [pickerTarget, setPickerTarget] = useState<"from" | "to" | null>(null);

  useEffect(() => {
    if (!token) return;
    getWarehouses(token)
      .then(list => { setWarehouses(list); if (list.length) setFromWh(list[0]); })
      .finally(() => setLoading(false));
  }, [token]);

  async function submit() {
    if (!fromWh || !toWh) { Alert.alert("Required", "Select both source and destination warehouse."); return; }
    if (fromWh.id === toWh.id) { Alert.alert("Invalid", "Source and destination must be different."); return; }
    if (!token) return;
    setSubmitting(true);
    try {
      await createPickupRequest(token, {
        from_warehouse_id: fromWh.id,
        to_warehouse_id:   toWh.id,
        notes: notes.trim() || undefined,
      });
      Alert.alert("✅ Request Sent", "Pickup request submitted. Awaiting approval.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to submit pickup request.");
    } finally {
      setSubmitting(false);
    }
  }

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
            <Text style={s.title}>Request Pickup</Text>
            <Text style={s.subtitle}>Transfer items to another warehouse</Text>
          </View>
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={G} /></View>
        ) : (
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

            {/* From warehouse */}
            <Text style={s.label}>FROM WAREHOUSE</Text>
            <TouchableOpacity style={s.selector} onPress={() => setPickerTarget("from")}>
              <Building2 size={18} color={fromWh ? G : MUTED} />
              <Text style={[s.selectorTxt, !fromWh && { color: MUTED }]}>
                {fromWh?.name ?? "Select source warehouse…"}
              </Text>
              <ChevronDown size={16} color={MUTED} />
            </TouchableOpacity>

            {/* Arrow */}
            <View style={s.arrowRow}>
              <View style={s.arrowLine} />
              <View style={s.arrowCircle}><ArrowRight size={16} color={G} /></View>
              <View style={s.arrowLine} />
            </View>

            {/* To warehouse */}
            <Text style={s.label}>TO WAREHOUSE</Text>
            <TouchableOpacity style={s.selector} onPress={() => setPickerTarget("to")}>
              <Building2 size={18} color={toWh ? "#2563EB" : MUTED} />
              <Text style={[s.selectorTxt, !toWh && { color: MUTED }]}>
                {toWh?.name ?? "Select destination warehouse…"}
              </Text>
              <ChevronDown size={16} color={MUTED} />
            </TouchableOpacity>

            {/* Notes */}
            <Text style={[s.label, { marginTop: 20 }]}>NOTES (OPTIONAL)</Text>
            <View style={s.notesWrap}>
              <FileText size={16} color={MUTED} style={{ marginTop: 2 }} />
              <TextInput
                style={s.notesInput}
                placeholder="Add notes about this transfer…"
                placeholderTextColor="#94A3B8"
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            {/* Summary */}
            {fromWh && toWh && fromWh.id !== toWh.id && (
              <View style={s.summaryCard}>
                <Text style={s.summaryTitle}>Transfer Summary</Text>
                <View style={s.summaryRow}>
                  <Text style={s.summaryLbl}>From</Text>
                  <Text style={s.summaryVal}>{fromWh.name}</Text>
                </View>
                <View style={s.summaryRow}>
                  <Text style={s.summaryLbl}>To</Text>
                  <Text style={[s.summaryVal, { color: "#2563EB" }]}>{toWh.name}</Text>
                </View>
                <View style={s.summaryRow}>
                  <Text style={s.summaryLbl}>Status after</Text>
                  <Text style={s.summaryVal}>Pending approval</Text>
                </View>
              </View>
            )}

            {/* Submit */}
            <TouchableOpacity
              style={[s.submitBtn, submitting && { opacity: 0.6 }]}
              onPress={submit}
              disabled={submitting || !fromWh || !toWh}
              activeOpacity={0.85}
            >
              {submitting
                ? <ActivityIndicator size="small" color={WHITE} />
                : <SendHorizonal size={18} color={WHITE} />}
              <Text style={s.submitTxt}>{submitting ? "Submitting…" : "Submit Pickup Request"}</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* Warehouse picker modal */}
        <Modal
          visible={!!pickerTarget}
          transparent
          animationType="slide"
          onRequestClose={() => setPickerTarget(null)}
        >
          <View style={s.modalOverlay}>
            <View style={s.modalSheet}>
              <View style={s.modalHandle} />
              <Text style={s.modalTitle}>
                {pickerTarget === "from" ? "Select Source Warehouse" : "Select Destination Warehouse"}
              </Text>
              <FlatList
                data={warehouses}
                keyExtractor={w => String(w.id)}
                contentContainerStyle={{ gap: 8, paddingBottom: 24 }}
                renderItem={({ item }) => {
                  const isSelected = pickerTarget === "from"
                    ? fromWh?.id === item.id
                    : toWh?.id === item.id;
                  return (
                    <TouchableOpacity
                      style={[s.whOption, isSelected && s.whOptionActive]}
                      onPress={() => {
                        if (pickerTarget === "from") setFromWh(item);
                        else setToWh(item);
                        setPickerTarget(null);
                      }}
                    >
                      <Building2 size={18} color={isSelected ? G : MUTED} />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.whName, isSelected && { color: G }]}>{item.name}</Text>
                        {item.location && <Text style={s.whLoc}>{item.location}</Text>}
                      </View>
                      {isSelected && <View style={s.whCheck} />}
                    </TouchableOpacity>
                  );
                }}
              />
              <TouchableOpacity style={s.modalCancel} onPress={() => setPickerTarget(null)}>
                <Text style={s.modalCancelTxt}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#F8FAFC" },
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 10 },
  backBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerText:  { flex: 1 },
  title:       { fontSize: 19, fontWeight: "900", color: SLATE },
  subtitle:    { fontSize: 12, color: MUTED, fontWeight: "600", marginTop: 1 },
  center:      { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll:      { padding: 20, paddingBottom: 60 },
  label:       { fontSize: 10, fontWeight: "800", color: MUTED, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 },
  selector:    { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: WHITE, borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: BORDER, shadowColor: "#0F172A", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  selectorTxt: { flex: 1, fontSize: 15, fontWeight: "700", color: SLATE },
  arrowRow:    { flexDirection: "row", alignItems: "center", marginVertical: 16, gap: 10 },
  arrowLine:   { flex: 1, height: 1.5, backgroundColor: BORDER },
  arrowCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#ECFDF5", borderWidth: 1.5, borderColor: G + "40", alignItems: "center", justifyContent: "center" },
  notesWrap:   { flexDirection: "row", gap: 10, backgroundColor: WHITE, borderRadius: 16, padding: 14, borderWidth: 1.5, borderColor: BORDER },
  notesInput:  { flex: 1, fontSize: 14, color: SLATE, minHeight: 80, fontWeight: "500" },
  summaryCard: { marginTop: 20, backgroundColor: WHITE, borderRadius: 18, padding: 16, borderWidth: 1.5, borderColor: G + "30", gap: 10 },
  summaryTitle:{ fontSize: 12, fontWeight: "900", color: G, marginBottom: 4 },
  summaryRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryLbl:  { fontSize: 12, fontWeight: "600", color: MUTED },
  summaryVal:  { fontSize: 13, fontWeight: "800", color: SLATE },
  submitBtn:   { marginTop: 28, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: G, borderRadius: 18, paddingVertical: 16, shadowColor: G, shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  submitTxt:   { fontSize: 15, fontWeight: "900", color: WHITE },
  // Modal
  modalOverlay:{ flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  modalSheet:  { backgroundColor: WHITE, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 36, maxHeight: "70%" },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: "center", marginBottom: 16 },
  modalTitle:  { fontSize: 16, fontWeight: "900", color: SLATE, marginBottom: 16 },
  modalCancel: { marginTop: 12, paddingVertical: 14, alignItems: "center", backgroundColor: "#F1F5F9", borderRadius: 14 },
  modalCancelTxt:{ fontSize: 14, fontWeight: "700", color: MUTED },
  whOption:    { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: BORDER },
  whOptionActive:{ backgroundColor: "#ECFDF5", borderColor: G + "40" },
  whName:      { fontSize: 14, fontWeight: "800", color: SLATE },
  whLoc:       { fontSize: 11, color: MUTED, fontWeight: "600", marginTop: 2 },
  whCheck:     { width: 10, height: 10, borderRadius: 5, backgroundColor: G },
});
