import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { ChevronLeft, Plus, MessageSquare } from "lucide-react-native";
import { getTickets, Ticket } from "@/lib/ticket-store";

const GREEN = "#0B7A5A";
const SLATE = "#111827";
const MUTED = "#667085";
const BORDER = "#E7ECF2";

export default function TicketsListScreen() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTickets = useCallback(() => {
    getTickets().then((list) => {
      setTickets(list);
      setLoading(false);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTickets();
    }, [loadTickets])
  );

  function getStatusBadge(status: Ticket["status"]) {
    switch (status) {
      case "Open":
        return { bg: "#ECFDF5", text: "#059669", label: "Open" };
      case "In Progress":
        return { bg: "#EFF6FF", text: "#2563EB", label: "In Progress" };
      case "Closed":
        return { bg: "#F3F4F6", text: "#6B7280", label: "Closed" };
    }
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
            <Text style={styles.title}>Support Tickets</Text>
            <Text style={styles.subtitle}>Report issues & concern requests</Text>
          </View>
        </View>

        {/* Core Actions Top Banner */}
        <View style={styles.bannerWrap}>
          <TouchableOpacity
            style={styles.createBtn}
            activeOpacity={0.85}
            onPress={() => router.push("/tickets/create" as any)}
          >
            <Plus size={20} color="#FFFFFF" />
            <Text style={styles.createBtnText}>Create New Ticket</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionTitle}>YOUR TICKETS</Text>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={GREEN} />
            </View>
          ) : tickets.length === 0 ? (
            <View style={styles.emptyWrap}>
              <MessageSquare size={36} color="#CBD5E1" />
              <Text style={styles.emptyTitle}>No tickets found</Text>
              <Text style={styles.emptySubtitle}>
                Tap &quot;Create New Ticket&quot; above to report a concern.
              </Text>
            </View>
          ) : (
            tickets.map((ticket) => {
              const badge = getStatusBadge(ticket.status);
              const lastMsg =
                ticket.messages[ticket.messages.length - 1]?.text ||
                ticket.concern;

              return (
                <Pressable
                  key={ticket.id}
                  style={({ pressed }) => [
                    styles.ticketCard,
                    pressed && styles.cardPressed,
                  ]}
                  onPress={() => router.push(`/tickets/${ticket.id}` as any)}
                >
                  <View style={styles.cardHeader}>
                    <Text style={styles.ticketId}>{ticket.id}</Text>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: badge.bg },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusBadgeText,
                          { color: badge.text },
                        ]}
                      >
                        {badge.label}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.concernTitle} numberOfLines={2}>
                    {ticket.concern}
                  </Text>

                  <Text style={styles.snippetText} numberOfLines={1}>
                    {lastMsg}
                  </Text>

                  <View style={styles.cardFooter}>
                    <Text style={styles.dateText}>{ticket.createdAt}</Text>
                    <Text style={styles.actionPrompt}>View Messages →</Text>
                  </View>
                </Pressable>
              );
            })
          )}
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

  bannerWrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  createBtn: {
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
  createBtnText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  scroll: {
    padding: 16,
    paddingBottom: 60,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "900",
    color: "#98A2B3",
    letterSpacing: 1.2,
    marginBottom: 12,
  },

  loadingWrap: {
    paddingTop: 40,
    alignItems: "center",
  },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: SLATE,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 12,
    color: MUTED,
    marginTop: 4,
    textAlign: "center",
    paddingHorizontal: 24,
  },

  ticketCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  ticketId: {
    fontSize: 12,
    fontWeight: "900",
    color: GREEN,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  concernTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: SLATE,
    marginBottom: 4,
  },
  snippetText: {
    fontSize: 13,
    color: MUTED,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  dateText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94A3B8",
  },
  actionPrompt: {
    fontSize: 11,
    fontWeight: "800",
    color: GREEN,
  },
});
