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
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { ChevronLeft, ImagePlus, Send, X } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { createSupportTicket, type SupportTicketAttachmentInput } from "@/lib/support-tickets";

const GREEN = "#0B7A5A";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";

export default function CreateTicketScreen() {
  const router = useRouter();
  const [concern, setConcern] = useState("");
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<SupportTicketAttachmentInput[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function pickAttachments() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Allow photo library access to attach screenshots.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: 4,
    });

    if (result.canceled) return;

    const next = result.assets.map((asset, index) => ({
      uri: asset.uri,
      name: asset.fileName || `attachment-${Date.now()}-${index}.jpg`,
      type: asset.mimeType || "image/jpeg",
    }));

    setAttachments(next);
  }

  async function handleSubmit() {
    if (!concern.trim()) {
      Alert.alert("Missing Concern", "Please enter the title or subject of your concern.");
      return;
    }

    setSubmitting(true);
    try {
      const ticket = await createSupportTicket({
        subject: concern.trim(),
        description: description.trim() || concern.trim(),
        attachments,
      });
      router.replace(`/tickets/${ticket.id}` as any);
    } catch (e: any) {
      Alert.alert("Submit Failed", e?.message || "Could not create ticket.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
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

            <View style={styles.attachmentsHeader}>
              <Text style={[styles.label, { marginBottom: 0 }]}>ATTACH SCREENSHOTS</Text>
              <TouchableOpacity style={styles.attachBtn} onPress={pickAttachments}>
                <ImagePlus size={14} color={GREEN} />
                <Text style={styles.attachBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            {attachments.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachmentsRow}>
                {attachments.map((file, index) => (
                  <View key={`${file.uri}-${index}`} style={styles.attachmentCard}>
                    <Image source={{ uri: file.uri }} style={styles.attachmentImage} />
                    <TouchableOpacity
                      style={styles.removeAttachmentBtn}
                      onPress={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <X size={12} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.attachHint}>Optional. Attach screenshots so admin can review the issue faster.</Text>
            )}
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
  attachmentsHeader: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  attachBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  },
  attachBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: GREEN,
  },
  attachHint: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    fontWeight: "600",
  },
  attachmentsRow: {
    gap: 10,
    paddingTop: 12,
  },
  attachmentCard: {
    width: 92,
    height: 92,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#F8FAFC",
  },
  attachmentImage: {
    width: "100%",
    height: "100%",
  },
  removeAttachmentBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    alignItems: "center",
    justifyContent: "center",
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
