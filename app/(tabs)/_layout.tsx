import { useAuth } from "@/context/auth-context";
import { refreshPendingCount, subscribePendingCount } from "@/lib/pending-store";
import * as NavigationBar from "expo-navigation-bar";
import { Redirect, Tabs } from "expo-router";
import { Clock, FileText, Home, Map, User } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  AppState,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ANDROID_BOTTOM_OFFSET = 12;

function CustomTabBar({ state, descriptors, navigation, pendingCount }: any) {
  const insets = useSafeAreaInsets();

  const bottom =
    Platform.OS === "android"
      ? ANDROID_BOTTOM_OFFSET
      : Math.max(insets.bottom, 12);

  return (
    <View style={[styles.tabBarContainer, { bottom }]}>
      {state.routes.map((route: any, index: number) => {
        const { options } = descriptors[route.key];
        const isFocused = state.index === index;

        let label = options.title !== undefined ? options.title : route.name;
        if (label === "index") label = "Home";

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        const onLongPress = () => {
          navigation.emit({
            type: "tabLongPress",
            target: route.key,
          });
        };

        let IconComponent = Home;
        if (route.name === "explore") IconComponent = Map;
        else if (route.name === "logs") IconComponent = FileText;
        else if (route.name === "queue") IconComponent = Clock;
        else if (route.name === "profile") IconComponent = User;

        const hasBadge = route.name === "queue" && pendingCount > 0;

        return (
          <TouchableOpacity
            key={route.key}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            testID={options.tabBarTestID}
            onPress={onPress}
            onLongPress={onLongPress}
            style={styles.tabButton}
          >
            <View style={styles.tabItem}>
              {/* 
                GUARANTEED ABSOLUTE PERFECT CIRCLE HIGHLIGHT:
                Dahil hiwalay itong background layer at walang laman sa loob,
                hinding-hindi ito mai-stretch ng text o badge para maging box.
                Garantisadong bilog na bilog (perfect circle) sa lahat ng tabs!
              */}
              {isFocused && <View style={styles.circleHighlightBg} />}

              <View style={styles.iconWrap}>
                <IconComponent
                  size={22}
                  color={isFocused ? "#0B7A5A" : "#FFFFFF"}
                />

                {hasBadge && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {pendingCount > 99 ? "99+" : pendingCount}
                    </Text>
                  </View>
                )}
              </View>

              <Text
                style={[
                  styles.tabLabel,
                  isFocused && styles.tabLabelActive,
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  const { isLoggedIn, mustChangePassword } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    refreshPendingCount().catch(() => { });
    const unsub = subscribePendingCount(setPendingCount);
    return unsub;
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    const hideAndroidNavbar = async () => {
      try {
        await NavigationBar.setVisibilityAsync("hidden");
      } catch { }
    };

    hideAndroidNavbar();

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        hideAndroidNavbar();
      }
    });

    return () => {
      appStateSub.remove();
    };
  }, []);

  if (!isLoggedIn) return <Redirect href="/login" />;
  if (mustChangePassword) return <Redirect href="/change-password" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
      }}
      tabBar={(props) => (
        <CustomTabBar {...props} pendingCount={pendingCount} />
      )}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="explore" options={{ title: "Explore" }} />
      <Tabs.Screen name="logs" options={{ title: "Logs" }} />
      <Tabs.Screen name="queue" options={{ title: "Queue" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarContainer: {
    position: "absolute",
    left: 16,
    right: 16,
    height: 72,
    backgroundColor: "#0B7A5A",
    borderRadius: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 6,
    paddingVertical: 5,
    shadowColor: "#0B7A5A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    overflow: "hidden",
  },

  tabButton: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },

  tabItem: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    position: "relative",
  },

  circleHighlightBg: {
    position: "absolute",
    top: 6,
    width: 36,
    height: 36,
    borderRadius: 18, // Garantisadong perfect circle
    backgroundColor: "#FFFFFF",
  },

  iconWrap: {
    position: "relative",
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    marginBottom: 1,
  },

  tabLabel: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    backgroundColor: "transparent",
  },

  tabLabelActive: {
    fontWeight: "900",
  },

  badge: {
    position: "absolute",
    top: -4,
    right: -6,
    backgroundColor: "#EF4444",
    borderRadius: 99,
    paddingHorizontal: 4,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#FFFFFF",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
  },

  badgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
  },
});