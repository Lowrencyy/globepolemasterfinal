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
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { ChevronLeft, ImagePlus, Send, Video, X, XCircle } from "lucide-react-native";
import * as WebBrowser from "expo-web-browser";
import * as ImagePicker from "expo-image-picker";
import { assetUrl } from "@/lib/api";
import {
  endSupportTicketSession,
  getSupportTicket,
  getSupportTicketSession,
  replySupportTicket,
  startOrJoinSupportTicketSession,
  type SupportTicketAttachmentInput,
  type SupportTicketDetail,
  type SupportTicketSession,
} from "@/lib/support-tickets";

const GREEN = "#0B7A5A";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";

export default function TicketConversationScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null);
  const [session, setSession] = useState<SupportTicketSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState("");
  const [attachments, setAttachments] = useState<SupportTicketAttachmentInput[]>([]);
  const [sending, setSending] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);

  const loadTicket = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [ticketData, sessionData] = await Promise.all([
        getSupportTicket(id),
        getSupportTicketSession(id).catch(() => null),
      ]);
      setTicket(ticketData);
      setSession(sessionData);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadTicket();
    }, [loadTicket])
  );

  async function pickAttachments() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: 4,
    });

    if (result.canceled) return;

    setAttachments(result.assets.map((asset, index) => ({
      uri: asset.uri,
      name: asset.fileName || `reply-${Date.now()}-${index}.jpg`,
      type: asset.mimeType || "image/jpeg",
    })));
  }

  async function handleSend() {
    if ((!inputText.trim() && attachments.length === 0) || !ticket || sending) return;

    setSending(true);
    const sentText = inputText.trim();
    setInputText("");

    try {
      await replySupportTicket(ticket.id, sentText || "Attached screenshot(s).", attachments);
      setAttachments([]);
      const refreshed = await getSupportTicket(ticket.id);
      setTicket(refreshed);
    } finally {
      setSending(false);
    }
  }

  async function handleJoinSession() {
    if (!ticket || sessionBusy) return;
    setSessionBusy(true);
    try {
      const nextSession = await startOrJoinSupportTicketSession(ticket.id);
      setSession(nextSession);
      if (nextSession.launch_url) {
        await WebBrowser.openBrowserAsync(nextSession.launch_url);
      }
      const refreshed = await getSupportTicket(ticket.id);
      setTicket(refreshed);
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleEndSession() {
    if (!session || sessionBusy) return;
    setSessionBusy(true);
    try {
      const nextSession = await endSupportTicketSession(session.id);
      setSession(nextSession);
      if (ticket) {
        const refreshed = await getSupportTicket(ticket.id);
        setTicket(refreshed);
      }
    } finally {
      setSessionBusy(false);
    }
  }

  function getStatusBadge(status?: string) {
    switch (String(status ?? "").toLowerCase()) {
      case "open":
        return { bg: "#ECFDF5", text: "#059669", label: "Open" };
      case "in_progress":
        return { bg: "#EEF2FF", text: "#4F46E5", label: "Active" };
      case "resolved":
        return { bg: "#FEF3C7", text: "#B45309", label: "Resolved" };
      case "closed":
      default:
        return { bg: "#F3F4F6", text: "#6B7280", label: "Closed" };
    }
  }

  function formatTimestamp(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  function isUserMessage(message: SupportTicketDetail["messages"][number]) {
    const senderCompany = String(message.sender?.company ?? "").toLowerCase();
    return senderCompany !== "telcovantage";
  }

  function userInitial(name?: string | null) {
    return (name || ticket?.subject || "S").trim().charAt(0).toUpperCase();
  }

  function renderAttachmentStrip(items?: Array<{ id: number; file_url?: string | null; file_path: string; file_name: string }>) {
    if (!items?.length) return null;
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.threadAttachmentsRow}>
        {items.map((file) => {
          const uri = file.file_url || assetUrl(file.file_path) || undefined;
          if (!uri) return null;
          return (
            <Image key={file.id} source={{ uri }} style={styles.threadAttachmentImage} />
          );
        })}
      </ScrollView>
    );
  }

  const badge = getStatusBadge(ticket?.status);

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

  const ticketClosed = ["closed", "resolved"].includes(String(ticket.status).toLowerCase());

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <ChevronLeft size={22} color={SLATE} />
            </TouchableOpacity>

            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{userInitial(ticket.subject)}</Text>
            </View>

            <View style={styles.headerTitleWrap}>
              <Text style={styles.concernTitle} numberOfLines={1}>
                {ticket.subject}
              </Text>
              <View style={styles.headerMetaRow}>
                <Text style={styles.ticketId}>{ticket.ticket_number || `#${ticket.id}`}</Text>
                <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                  <Text style={[styles.statusBadgeText, { color: badge.text }]}>
                    {badge.label}
                  </Text>
                </View>
              </View>
            </View>

            {!ticketClosed ? (
              <TouchableOpacity
                onPress={handleJoinSession}
                style={styles.videoActionBtn}
                activeOpacity={0.8}
                disabled={sessionBusy}
              >
                <Video size={17} color="#FFFFFF" />
              </TouchableOpacity>
            ) : null}
          </View>

          {!ticketClosed ? (
            <View style={styles.sessionBanner}>
              <View style={styles.sessionBannerCopy}>
                <Text style={styles.sessionBannerTitle}>
                  {session?.status === "active" ? "Video support room is active" : "Start a live video support call"}
                </Text>
                <Text style={styles.sessionBannerText}>
                  Daily room only runs when a real session is started.
                </Text>
              </View>
              <View style={styles.sessionBannerActions}>
                <TouchableOpacity
                  style={[styles.sessionPillBtn, sessionBusy && { opacity: 0.6 }]}
                  onPress={handleJoinSession}
                  disabled={sessionBusy}
                  activeOpacity={0.85}
                >
                  <Text style={styles.sessionPillBtnText}>
                    {sessionBusy ? "Opening..." : session?.status === "active" ? "Join" : "Start"}
                  </Text>
                </TouchableOpacity>
                {session?.status === "active" ? (
                  <TouchableOpacity
                    style={[styles.sessionPillEndBtn, sessionBusy && { opacity: 0.6 }]}
                    onPress={handleEndSession}
                    disabled={sessionBusy}
                    activeOpacity={0.85}
                  >
                    <XCircle size={14} color="#B91C1C" />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={styles.chatScroll}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.dateStamp}>{formatTimestamp(ticket.created_at)}</Text>

            <View style={[styles.messageRow, styles.rowLeft]}>
              <View style={styles.senderAvatarSmall}>
                <Text style={styles.senderAvatarText}>S</Text>
              </View>
              <View style={styles.leftMessageWrap}>
                <Text style={styles.senderName}>Support Ticket</Text>
                <View style={[styles.bubble, styles.bubbleAdmin]}>
                  <Text style={[styles.bubbleText, styles.textAdmin]}>
                    {ticket.description}
                  </Text>
                  {renderAttachmentStrip(ticket.attachments)}
                  <Text style={[styles.timeText, styles.timeAdmin]}>
                    Original ticket details
                  </Text>
                </View>
              </View>
            </View>

            {ticket.messages.map((msg) => {
              const isUser = isUserMessage(msg);
              return (
                <View
                  key={msg.id}
                  style={[
                    styles.messageRow,
                    isUser ? styles.rowRight : styles.rowLeft,
                  ]}
                >
                  {!isUser ? (
                    <View style={styles.senderAvatarSmall}>
                      <Text style={styles.senderAvatarText}>A</Text>
                    </View>
                  ) : null}

                  <View style={isUser ? styles.rightMessageWrap : styles.leftMessageWrap}>
                    {!isUser ? (
                      <Text style={styles.senderName}>
                        {msg.sender?.full_name || msg.sender?.first_name || "Admin Support"}
                      </Text>
                    ) : null}
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
                        {msg.message}
                      </Text>
                      {renderAttachmentStrip(msg.attachments)}
                      <Text
                        style={[
                          styles.timeText,
                          isUser ? styles.timeUser : styles.timeAdmin,
                        ]}
                      >
                        {formatTimestamp(msg.created_at)}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}

            {ticketClosed && (
              <View style={styles.systemNotice}>
                <Text style={styles.systemNoticeText}>
                  This conversation is locked because the ticket is {badge.label.toLowerCase()}.
                </Text>
              </View>
            )}
          </ScrollView>

          {!ticketClosed ? (
            <View style={styles.inputDock}>
              {attachments.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.composerAttachmentsRow}>
                  {attachments.map((file, index) => (
                    <View key={`${file.uri}-${index}`} style={styles.composerAttachmentCard}>
                      <Image source={{ uri: file.uri }} style={styles.composerAttachmentImage} />
                      <TouchableOpacity
                        style={styles.removeAttachmentBtn}
                        onPress={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <X size={12} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              ) : null}

              <TouchableOpacity style={styles.attachComposerBtn} onPress={pickAttachments}>
                <ImagePlus size={18} color="#475569" />
              </TouchableOpacity>
              <View style={styles.inputShell}>
                <TextInput
                  style={styles.input}
                  placeholder="Write a message..."
                  placeholderTextColor="#94A3B8"
                  value={inputText}
                  onChangeText={setInputText}
                  multiline
                  maxLength={400}
                />
              </View>
              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  ((!inputText.trim() && attachments.length === 0) || sending) && { opacity: 0.5 },
                ]}
                activeOpacity={0.85}
                onPress={handleSend}
                disabled={(!inputText.trim() && attachments.length === 0) || sending}
              >
                <Send size={17} color="#FFFFFF" />
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
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#1D4ED8",
  },
  headerTitleWrap: {
    flex: 1,
    paddingRight: 8,
  },
  concernTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: SLATE,
  },
  headerMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  ticketId: {
    fontSize: 11,
    fontWeight: "800",
    color: MUTED,
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  videoActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionBanner: {
    marginHorizontal: 12,
    marginTop: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sessionBannerCopy: {
    flex: 1,
  },
  sessionBannerTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: SLATE,
  },
  sessionBannerText: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 17,
    color: MUTED,
    fontWeight: "600",
  },
  sessionBannerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sessionPillBtn: {
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sessionPillBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  sessionPillEndBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  chatScroll: {
    paddingHorizontal: 12,
    paddingTop: 14,
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
    marginBottom: 14,
    alignItems: "flex-end",
  },
  rowRight: {
    justifyContent: "flex-end",
  },
  rowLeft: {
    justifyContent: "flex-start",
  },
  senderAvatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    marginBottom: 4,
  },
  senderAvatarText: {
    color: "#475569",
    fontSize: 11,
    fontWeight: "900",
  },
  leftMessageWrap: {
    maxWidth: "78%",
  },
  rightMessageWrap: {
    maxWidth: "78%",
    alignItems: "flex-end",
  },
  senderName: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED,
    marginBottom: 4,
    marginLeft: 4,
  },
  bubble: {
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 22,
  },
  bubbleUser: {
    backgroundColor: "#1D4ED8",
    borderBottomRightRadius: 8,
  },
  bubbleAdmin: {
    backgroundColor: "#FFFFFF",
    borderBottomLeftRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  threadAttachmentsRow: {
    gap: 8,
    marginTop: 10,
  },
  threadAttachmentImage: {
    width: 110,
    height: 110,
    borderRadius: 14,
    backgroundColor: "#E5E7EB",
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
  },
  timeUser: {
    color: "rgba(255,255,255,0.75)",
    textAlign: "right",
  },
  timeAdmin: {
    color: "#94A3B8",
  },
  systemNotice: {
    marginTop: 12,
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "#F1F5F9",
    borderRadius: 999,
  },
  systemNoticeText: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED,
  },
  inputDock: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: BORDER,
    gap: 8,
  },
  composerAttachmentsRow: {
    width: "100%",
    gap: 8,
    paddingBottom: 4,
  },
  composerAttachmentCard: {
    width: 68,
    height: 68,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#F1F5F9",
  },
  composerAttachmentImage: {
    width: "100%",
    height: "100%",
  },
  removeAttachmentBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
  attachComposerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  inputShell: {
    flex: 1,
    backgroundColor: "#F1F5F9",
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 2,
  },
  input: {
    maxHeight: 100,
    fontSize: 14,
    fontWeight: "600",
    color: SLATE,
    paddingVertical: 10,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
});
