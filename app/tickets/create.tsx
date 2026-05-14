import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  TextInput,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { ChevronLeft, Send } from "lucide-react-native";
import { createTicket } from "@/lib/ticket-store";

const GREEN = "#0B7A5A";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";

export default function CreateTicketScreen() {
  const router = useRouter();
  const [concern, setConcern] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!concern.trim()) {
      Alert.alert("Missing Concern", "Please enter the title or subject of your concern.");
      return;
    }

    setSubmitting(true);
    await createTicket(concern, description);
    setSubmitting(false);

    router.back();
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" backgroundColor="#F4F6F8" />

      <SafeAreaView style={styles.container}>
        {/* Navigation Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Create Ticket</Text>
            <Text style={styles.subtitle}>Submit a new support concern</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={styles.label}>CONCERN / SUBJECT</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Uploading pole tags offline sync failure"
              placeholderTextColor="#94A3B8"
              value={concern}
              onChangeText={setConcern}
              maxLength={120}
            />

            <Text style={[styles.label, { marginTop: 16 }]}>
              DETAILED DESCRIPTION / MESSAGE
            </Text>
            <TextInput
              style={styles.textArea}
              placeholder="Provide specific details about your concern or site errors experienced..."
              placeholderTextColor="#94A3B8"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, submitting && { opacity: 0.7 }]}
            activeOpacity={0.85}
            onPress={handleSubmit}
            disabled={submitting}
          >
            <Send size={18} color="#FFFFFF" />
            <Text style={styles.submitBtnText}>
              {submitting ? "Submitting..." : "Submit Ticket"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
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

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 20,
  },
  label: {
    fontSize: 10,
    fontWeight: "900",
    color: MUTED,
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontWeight: "600",
    color: SLATE,
  },
  textArea: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontWeight: "600",
    color: SLATE,
    minHeight: 130,
  },

  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GREEN,
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#FFFFFF",
  },
});
