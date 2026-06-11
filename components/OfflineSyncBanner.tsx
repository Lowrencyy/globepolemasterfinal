import { getPendingCount, subscribePendingCount } from "@/lib/pending-store";
import { getNetSyncState, subscribeNetSyncState } from "@/lib/net-sync";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function OfflineSyncBanner() {
  const insets = useSafeAreaInsets();
  const [pendingCount, setPendingCount] = useState(getPendingCount());
  const [syncState, setSyncState] = useState(getNetSyncState());

  useEffect(() => {
    const unsubPending = subscribePendingCount(setPendingCount);
    const unsubSync = subscribeNetSyncState(setSyncState);
    return () => {
      unsubPending();
      unsubSync();
    };
  }, []);

  const visible = !syncState.online || syncState.flushing || pendingCount > 0 || !!syncState.lastError;
  if (!visible) return null;

  let bg = "#FFF7ED";
  let border = "#FDBA74";
  let text = "#C2410C";
  let label = "Offline mode";

  if (syncState.flushing) {
    bg = "#EFF6FF";
    border = "#93C5FD";
    text = "#1D4ED8";
    label = pendingCount > 0 ? `Syncing ${pendingCount} pending item${pendingCount !== 1 ? "s" : ""}` : "Syncing queued updates";
  } else if (syncState.online && pendingCount > 0) {
    bg = "#FEFCE8";
    border = "#FDE047";
    text = "#A16207";
    label = `${pendingCount} pending item${pendingCount !== 1 ? "s" : ""} waiting to sync`;
  } else if (syncState.lastError) {
    bg = "#FEF2F2";
    border = "#FCA5A5";
    text = "#B91C1C";
    label = "Some queued items need retry";
  }

  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 6 }]}>
      <View style={[styles.banner, { backgroundColor: bg, borderColor: border }]}>
        <Text style={[styles.text, { color: text }]} numberOfLines={2}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 50,
  },
  banner: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  text: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
});
