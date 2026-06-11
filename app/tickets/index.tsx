import { cacheGet, cacheSet } from "@/lib/cache";
import { listSupportTickets } from "@/lib/support-tickets";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, MessageCircleMore, Plus, RefreshCw } from "lucide-react-native";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const GREEN = "#0B7A5A";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";
const WHITE = "#FFFFFF";

type Ticket = {
  id: number;
  ticket_number?: string;
  subject: string;
  status: string;
  created_at: string;
  last_reply_at?: string;
  last_activity_at?: string;
  has_unread_for_current?: boolean;
};

export default function TicketsListScreen() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const lastFetchRef = useRef<number>(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTickets = useCallback(async (silent = false) => {
    const CACHE_KEY = "support_tickets_cache";

    if (!silent) {
      const cached = await cacheGet<Ticket[]>(CACHE_KEY);
      if (cached) {
        setTickets(cached);
        setLoading(false);
      }
    }

    try {
      setError(null);
      const items = await listSupportTickets();
      setTickets(items);
      cacheSet(CACHE_KEY, items).catch(() => {});
    } catch (e: any) {
      if (!silent && tickets.length === 0) {
        setError(e.message || "Failed to load tickets");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tickets.length]);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFetchRef.current < 2 * 60 * 1000 && tickets.length > 0) return;
      lastFetchRef.current = now;
      fetchTickets(tickets.length > 0);
    }, [fetchTickets, tickets.length])
  );

  function getStatusBadge(status: string) {
    const s = status.toLowerCase();
    if (s === "open" || s === "pending") return { bg: "#E8FFF4", text: "#059669", label: "Open" };
    if (s === "closed" || s === "resolved") return { bg: "#F3F4F6", text: "#6B7280", label: "Closed" };
    return { bg: "#EEF2FF", text: "#4F46E5", label: "Active" };
  }

  function formatTime(value?: string) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString();
  }

  function getTicketInitial(ticket: Ticket) {
    return (ticket.subject || ticket.ticket_number || "T").trim().charAt(0).toUpperCase();
  }

  const unreadCount = tickets.filter((ticket) => ticket.has_unread_for_current).length;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

      <SafeAreaView style={styles.container}>
        <View style={styles.headerShell}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <ChevronLeft size={22} color={SLATE} />
            </TouchableOpacity>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.title}>Support Inbox</Text>
              <Text style={styles.subtitle}>Messenger-style ticket conversation</Text>
            </View>
          </View>

          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View>
                <Text style={styles.heroLabel}>YOUR THREADS</Text>
                <Text style={styles.heroHeadline}>Stay synced with support replies</Text>
              </View>
              <View style={styles.heroUnreadPill}>
                <Text style={styles.heroUnreadCount}>{unreadCount}</Text>
                <Text style={styles.heroUnreadText}>Unread</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.createBtn}
              activeOpacity={0.85}
              onPress={() => router.push("/tickets/create" as any)}
            >
              <Plus size={18} color="#FFFFFF" />
              <Text style={styles.createBtnText}>Create New Ticket</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading && tickets.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={GREEN} />
          </View>
        ) : error && tickets.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.errorTxt}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => fetchTickets()}>
              <RefreshCw size={16} color={WHITE} />
              <Text style={styles.retryBtnTxt}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchTickets(true); }} colors={[GREEN]} />
            }
          >
            {tickets.length === 0 ? (
              <View style={styles.emptyWrap}>
                <MessageCircleMore size={36} color="#CBD5E1" />
                <Text style={styles.emptyTitle}>No conversations yet</Text>
                <Text style={styles.emptySubtitle}>
                  Create a support ticket to start a message thread with internal support.
                </Text>
              </View>
            ) : (
              tickets.map((ticket) => {
                const badge = getStatusBadge(ticket.status);
                return (
                  <Pressable
                    key={ticket.id}
                    style={({ pressed }) => [
                      styles.ticketCard,
                      pressed && styles.cardPressed,
                    ]}
                    onPress={() => router.push(`/tickets/${ticket.id}` as any)}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{getTicketInitial(ticket)}</Text>
                    </View>

                    <View style={styles.cardBody}>
                      <View style={styles.cardHeader}>
                        <View style={styles.headerTextBlock}>
                          <Text style={styles.concernTitle} numberOfLines={1}>
                            {ticket.subject}
                          </Text>
                          <Text style={styles.ticketId}>{ticket.ticket_number || `#${ticket.id}`}</Text>
                        </View>
                        <View style={styles.rightMeta}>
                          <Text style={styles.dateText}>
                            {formatTime(ticket.last_activity_at || ticket.last_reply_at || ticket.created_at)}
                          </Text>
                          {ticket.has_unread_for_current ? <View style={styles.unreadDot} /> : null}
                        </View>
                      </View>

                      <View style={styles.previewRow}>
                        <Text
                          style={[
                            styles.previewText,
                            ticket.has_unread_for_current && styles.previewUnread,
                          ]}
                          numberOfLines={1}
                        >
                          {ticket.has_unread_for_current ? "New reply in this conversation" : "Open thread to continue the discussion"}
                        </Text>
                        <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                          <Text style={[styles.statusBadgeText, { color: badge.text }]}>
                            {badge.label}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  headerShell: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: BORDER,
  },
  headerTitleWrap: { flex: 1 },
  title: { fontSize: 26, fontWeight: "900", color: SLATE },
  subtitle: { fontSize: 12, color: MUTED, fontWeight: "600", marginTop: 2 },
  heroCard: {
    backgroundColor: "#0F172A",
    borderRadius: 26,
    padding: 18,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  heroLabel: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.3,
    color: "#93C5FD",
  },
  heroHeadline: {
    marginTop: 6,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
    color: "#FFFFFF",
    maxWidth: 220,
  },
  heroUnreadPill: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
    minWidth: 78,
  },
  heroUnreadCount: {
    fontSize: 20,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  heroUnreadText: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "800",
    color: "#CBD5E1",
  },
  createBtn: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GREEN,
    paddingVertical: 15,
    borderRadius: 18,
    gap: 8,
  },
  createBtnText: { fontSize: 15, fontWeight: "900", color: WHITE },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48 },
  emptyWrap: {
    alignItems: "center", justifyContent: "center", paddingVertical: 48,
    backgroundColor: WHITE, borderRadius: 24, borderWidth: 1, borderColor: BORDER,
  },
  emptyTitle: { fontSize: 16, fontWeight: "900", color: SLATE, marginTop: 12 },
  emptySubtitle: { fontSize: 12, color: MUTED, marginTop: 4, textAlign: "center", paddingHorizontal: 24 },
  ticketCard: {
    backgroundColor: WHITE,
    borderRadius: 24,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  cardPressed: { opacity: 0.9, transform: [{ scale: 0.992 }] },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#E0F2FE",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#0369A1",
    fontSize: 18,
    fontWeight: "900",
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  headerTextBlock: { flex: 1, minWidth: 0 },
  concernTitle: { fontSize: 16, fontWeight: "900", color: SLATE },
  ticketId: { marginTop: 2, fontSize: 11, fontWeight: "800", color: GREEN },
  rightMeta: { alignItems: "flex-end", gap: 6 },
  dateText: { fontSize: 11, fontWeight: "700", color: "#94A3B8" },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#2563EB",
  },
  previewRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  previewText: {
    flex: 1,
    fontSize: 12,
    color: MUTED,
    fontWeight: "600",
  },
  previewUnread: {
    color: SLATE,
    fontWeight: "800",
  },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  statusBadgeText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorTxt: { color: "#EF4444", marginBottom: 16, fontWeight: "600" },
  retryBtn: { backgroundColor: GREEN, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  retryBtnTxt: { color: WHITE, fontWeight: "800" },
});
