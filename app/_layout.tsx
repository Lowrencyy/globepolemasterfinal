import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";

// Suppress non-fatal "Unable to activate keep awake" errors thrown by
// expo-camera's internal expo-keep-awake call on some Android devices.
// The error appears as an unhandled rejection but does NOT affect functionality.
if (typeof global !== "undefined") {
  const _gu = (global as any).ErrorUtils;
  if (_gu) {
    const _prev = _gu.getGlobalHandler?.();
    _gu.setGlobalHandler?.((err: any, isFatal: boolean) => {
      if (err?.message?.toLowerCase().includes("keep awake")) return;
      _prev?.(err, isFatal);
    });
  }
}

import { AuthProvider, useAuth } from "@/context/auth-context";
import { useColorScheme } from "@/hooks/use-color-scheme";

SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: "(tabs)",
};

// Runs inside the navigator — imperatively redirects based on auth state.
function AuthGate() {
  const { isReady, isLoggedIn, mustChangePassword } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!isReady) return;

    const root = segments[0] as string | undefined;
    const onLogin = root === "login";
    const onChangePw = root === "change-password";

    if (!isLoggedIn && !onLogin) {
      router.replace("/login");
    } else if (isLoggedIn && mustChangePassword && !onChangePw) {
      router.replace("/change-password");
    } else if (isLoggedIn && !mustChangePassword && (onLogin || onChangePw)) {
      router.replace("/(tabs)");
    }
  }, [isReady, isLoggedIn, mustChangePassword, segments]);

  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts(MaterialCommunityIcons.font);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="change-password" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="teardowns" options={{ headerShown: false }} />
            <Stack.Screen name="naps" options={{ headerShown: false }} />
            <Stack.Screen name="delivery" options={{ headerShown: false }} />
            <Stack.Screen name="warehouse" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: "modal", title: "Modal" }} />
          </Stack>
          <AuthGate />
          <StatusBar style="auto" />
        </ThemeProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
