import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Bell, CheckCheck, Package, Warehouse, Truck, AlertCircle } from "lucide-react-native";
import { getBridgeToken } from "@/lib/token-bridge";
import {
  getNotifications,
  markNotificationsRead,
  type AppNotification,
} from "@/services/skycable";
import { setUnreadCount } from "@/lib/notification-store";

const G     = "#006241";
const GDARK = "#004d30";
const MUTED = "#667085";
const BG    = "#F4F8F5";
const WHITE = "#FFFFFF";
const BORDER = "#E7ECF2";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function notifIcon(type: string) {
  if (type.includes("approved") || type.includes("verify")) return <CheckCheck size={18} color="#10b981" />;
  if (type.includes("delivery") || type.includes("receipt")) return <Package size={18} color={G} />;
  if (type.includes("warehouse")) return <Warehouse size={18} color="#2563eb" />;
  if (type.includes("driver") || type.includes("transit")) return <Truck size={18} color="#f59e0b" />;
  return <Bell size={18} color={MUTED} />;
}

function notifAccent(type: string): string {
  if (type.includes("approved") || type.includes("verify")) return "#10b981";
  if (type.includes("delivery") || type.includes("receipt")) return G;
  if (type.includes("warehouse")) return "#2563eb";
  if (type.includes("driver") || type.includes("transit")) return "#f59e0b";
  return MUTED;
}

function NotifItem({ item }: { item: AppNotification }) {
  const isUnread = !item.read_at;
  const accent = notifAccent(item.type);
  return (
    <View style={[s.notifCard, isUnread && s.notifCardUnread]}>
      {isUnread && <View style={[s.unreadBar, { backgroundColor: accent }]} />}
      <View style={[s.iconWrap, { backgroundColor: accent + "15" }]}>
        {notifIcon(item.type)}
      </View>
      <View style={s.notifBody}>
        <View style={s.notifTopRow}>
          <Text style={[s.notifTitle, isUnread && s.notifTitleUnread]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={s.notifTime}>{timeAgo(item.created_at)}</Text>
        </View>
        <Text style={s.notifMsg} numberOfLines={2}>{item.body}</Text>
      </View>
    </View>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const token = getBridgeToken() ?? "";
    const data = await getNotifications(token);
    setItems(data);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const token = getBridgeToken() ?? "";
    markNotificationsRead(token).then(() => setUnreadCount(0));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const unreadCount = items.filter(n => !n.read_at).length;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <ChevronLeft size={22} color={GDARK} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={s.unreadBadge}>
              <Text style={s.unreadBadgeTxt}>{unreadCount} new</Text>
            </View>
          )}
        </View>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={G} />
          <Text style={s.loadingTxt}>Loading notifications…</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={s.center}>
          <View style={s.emptyIconWrap}>
            <Bell size={36} color={G + "60"} />
          </View>
          <Text style={s.emptyTitle}>No notifications yet</Text>
          <Text style={s.emptyMsg}>You'll see delivery updates and approvals here.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={n => String(n.id)}
          renderItem={({ item }) => <NotifItem item={item} />}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[G]} tintColor={G} />
          }
          ListHeaderComponent={
            <Text style={s.listHeader}>Latest {items.length} notification{items.length !== 1 ? "s" : ""}</Text>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: WHITE,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    gap: 8,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: GDARK,
  },
  unreadBadge: {
    backgroundColor: G,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  unreadBadgeTxt: {
    fontSize: 11,
    fontWeight: "800",
    color: WHITE,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 32,
  },
  loadingTxt: { fontSize: 13, color: MUTED, fontWeight: "600" },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: G + "12",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: GDARK },
  emptyMsg:  { fontSize: 13, color: MUTED, textAlign: "center", lineHeight: 20 },

  list: { padding: 16, gap: 10 },
  listHeader: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },

  notifCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: WHITE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    gap: 12,
    overflow: "hidden",
  },
  notifCardUnread: {
    borderColor: G + "40",
    backgroundColor: G + "07",
  },
  unreadBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  notifBody: { flex: 1, gap: 4 },
  notifTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  notifTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: "#374151",
  },
  notifTitleUnread: {
    color: GDARK,
    fontWeight: "900",
  },
  notifTime: {
    fontSize: 11,
    color: MUTED,
    fontWeight: "500",
    flexShrink: 0,
  },
  notifMsg: {
    fontSize: 12,
    color: MUTED,
    lineHeight: 18,
  },
});
