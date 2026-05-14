import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { ChevronLeft, Send, CheckCircle2, Phone } from "lucide-react-native";
import { getTicketById, addMessageToTicket, updateTicketStatus, Ticket } from "@/lib/ticket-store";

const GREEN = "#0B7A5A";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";

export default function TicketConversationScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);

  const loadTicket = useCallback(() => {
    if (!id) return;
    getTicketById(id).then((t) => {
      setTicket(t);
      setLoading(false);
    });
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadTicket();
    }, [loadTicket])
  );

  async function handleSend() {
    if (!inputText.trim() || !ticket || sending) return;

    setSending(true);
    const sentText = inputText;
    setInputText("");

    const updated = await addMessageToTicket(ticket.id, sentText, "user");
    if (updated) {
      setTicket(updated);
      // Simulate automatic support bot reply after 1.5 seconds if ticket is open/in progress
      if (updated.status !== "Closed") {
        setTimeout(async () => {
          const autoReply = await addMessageToTicket(
            updated.id,
            "Admin: We have logged your latest update. Support engineers are cross-verifying the concern parameters.",
            "admin"
          );
          if (autoReply) setTicket(autoReply);
        }, 1500);
      }
    }
    setSending(false);
  }

  async function handleCloseTicket() {
    if (!ticket || ticket.status === "Closed") return;

    const updated = await updateTicketStatus(ticket.id, "Closed");
    if (updated) {
      setTicket(updated);
    }
  }

  function getStatusBadge(status?: Ticket["status"]) {
    switch (status) {
      case "Open":
        return { bg: "#ECFDF5", text: "#059669", label: "Open" };
      case "In Progress":
        return { bg: "#EFF6FF", text: "#2563EB", label: "In Progress" };
      case "Closed":
      default:
        return { bg: "#F3F4F6", text: "#6B7280", label: "Closed" };
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centerAll]}>
        <ActivityIndicator size="large" color={GREEN} />
      </SafeAreaView>
    );
  }

  if (!ticket) {
    return (
      <SafeAreaView style={[styles.container, styles.centerAll]}>
        <Text style={styles.errorText}>Ticket not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
          <Text style={styles.backLinkText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const badge = getStatusBadge(ticket.status);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* Main Top Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <ChevronLeft size={22} color={SLATE} />
            </TouchableOpacity>

            <View style={styles.headerTitleWrap}>
              <View style={styles.headerTopRow}>
                <Text style={styles.ticketId}>{ticket.id}</Text>
                <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                  <Text style={[styles.statusBadgeText, { color: badge.text }]}>
                    {badge.label}
                  </Text>
                </View>
              </View>
              <Text style={styles.concernTitle} numberOfLines={1}>
                {ticket.concern}
              </Text>
            </View>

            <View style={styles.headerActions}>
              {ticket.status !== "Closed" && (
                <TouchableOpacity
                  onPress={() =>
                    router.push(
                      `/tickets/call?id=${ticket.id}&concern=${encodeURIComponent(
                        ticket.concern
                      )}` as any
                    )
                  }
                  style={styles.callActionBtn}
                  activeOpacity={0.7}
                >
                  <Phone size={16} color="#FFFFFF" />
                </TouchableOpacity>
              )}

              {ticket.status !== "Closed" && (
                <TouchableOpacity
                  onPress={handleCloseTicket}
                  style={styles.closeActionBtn}
                  activeOpacity={0.7}
                >
                  <CheckCircle2 size={16} color={GREEN} />
                  <Text style={styles.closeActionText}>Close</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Conversation Chat Scroll Area */}
          <ScrollView
            contentContainerStyle={styles.chatScroll}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.dateStamp}>{ticket.createdAt}</Text>

            {ticket.messages.map((msg) => {
              const isUser = msg.sender === "user";
              return (
                <View
                  key={msg.id}
                  style={[
                    styles.messageRow,
                    isUser ? styles.rowRight : styles.rowLeft,
                  ]}
                >
                  <View
                    style={[
                      styles.bubble,
                      isUser ? styles.bubbleUser : styles.bubbleAdmin,
                    ]}
                  >
                    <Text
                      style={[
                        styles.bubbleText,
                        isUser ? styles.textUser : styles.textAdmin,
                      ]}
                    >
                      {msg.text}
                    </Text>
                    <Text
                      style={[
                        styles.timeText,
                        isUser ? styles.timeUser : styles.timeAdmin,
                      ]}
                    >
                      {msg.timestamp}
                    </Text>
                  </View>
                </View>
              );
            })}

            {ticket.status === "Closed" && (
              <View style={styles.systemNotice}>
                <Text style={styles.systemNoticeText}>
                  🔒 This support concern ticket is marked as Closed.
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Chat Input Dock */}
          {ticket.status !== "Closed" ? (
            <View style={styles.inputDock}>
              <TextInput
                style={styles.input}
                placeholder="Type your message reply..."
                placeholderTextColor="#94A3B8"
                value={inputText}
                onChangeText={setInputText}
                multiline
                maxLength={400}
              />
              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  (!inputText.trim() || sending) && { opacity: 0.5 },
                ]}
                activeOpacity={0.8}
                onPress={handleSend}
                disabled={!inputText.trim() || sending}
              >
                <Send size={16} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  centerAll: {
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: 16,
    fontWeight: "800",
    color: SLATE,
  },
  backLink: {
    marginTop: 12,
    padding: 8,
  },
  backLinkText: {
    fontSize: 14,
    fontWeight: "700",
    color: GREEN,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    elevation: 3,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  headerTitleWrap: {
    flex: 1,
    paddingRight: 8,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ticketId: {
    fontSize: 11,
    fontWeight: "900",
    color: GREEN,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  concernTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: SLATE,
    marginTop: 2,
  },

  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  callActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  closeActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 4,
  },
  closeActionText: {
    fontSize: 11,
    fontWeight: "800",
    color: GREEN,
  },

  chatScroll: {
    padding: 16,
    paddingBottom: 24,
  },
  dateStamp: {
    fontSize: 10,
    fontWeight: "800",
    color: MUTED,
    textAlign: "center",
    marginBottom: 16,
  },

  messageRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  rowRight: {
    justifyContent: "flex-end",
  },
  rowLeft: {
    justifyContent: "flex-start",
  },

  bubble: {
    maxWidth: "80%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  bubbleUser: {
    backgroundColor: GREEN,
    borderBottomRightRadius: 4,
  },
  bubbleAdmin: {
    backgroundColor: "#FFFFFF",
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: BORDER,
    elevation: 1,
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },

  bubbleText: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  textUser: {
    color: "#FFFFFF",
  },
  textAdmin: {
    color: SLATE,
  },

  timeText: {
    fontSize: 9,
    fontWeight: "700",
    marginTop: 6,
    textAlign: "right",
  },
  timeUser: {
    color: "rgba(255, 255, 255, 0.75)",
  },
  timeAdmin: {
    color: "#94A3B8",
  },

  systemNotice: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    alignItems: "center",
  },
  systemNoticeText: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED,
  },

  inputDock: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: BORDER,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: "#F1F5F9",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 100,
    fontSize: 14,
    fontWeight: "600",
    color: SLATE,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
});
