import { createContext, useContext, useEffect, useState } from "react";
import { loginGlobe, logoutGlobe, type GlobeUser } from "@/services/auth";
import { tokenStore } from "@/lib/token";
import { setBridgeToken } from "@/lib/token-bridge";
import { startNetSync, stopNetSync, setNetSyncToken } from "@/lib/net-sync";
import { startLocationTracking, stopLocationTracking } from "@/lib/location-tracker";
import { clearAllCache, cacheSet } from "@/lib/cache";
import { clearAllQueues } from "@/lib/sync-queue";
import { getAreas } from "@/services/skycable";

// Prefetch teardown areas right after login/rehydration so the
// teardown screen always has data even on the very first navigation.
async function prefetchCoreData(token: string, user: GlobeUser) {
  try {
    const teamId = (user as any)?.team_id ?? null;
    const cacheKey = teamId ? `sitemap_areas_team_${teamId}` : "sitemap_areas";
    const areas = await getAreas(token, teamId);
    await cacheSet(cacheKey, areas);
  } catch {
    // Silent — prefetch is best-effort, screen will retry on mount
  }
}

type AuthContextType = {
  isReady: boolean;
  isLoggedIn: boolean;
  token: string | null;
  user: GlobeUser | null;
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<{ mustChangePassword: boolean }>;
  logout: () => Promise<void>;
  clearPasswordReset: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  isReady: false,
  isLoggedIn: false,
  token: null,
  user: null,
  mustChangePassword: false,
  login: async () => ({ mustChangePassword: false }),
  logout: async () => {},
  clearPasswordReset: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<GlobeUser | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // Rehydrate token from persistent store on app start.
  // On a fresh APK install the data directory may still exist from a previous
  // install (Android preserves app data on update-install).  If this is the
  // very first launch (no install.flag), wipe all credentials so the user
  // always starts at the login + onboarding flow on a new install.
  useEffect(() => {
    (async () => {
      const isNew = await tokenStore.isNewInstall();
      if (isNew) {
        await tokenStore.clear();
        await clearAllCache();
        await clearAllQueues();
        await tokenStore.markInstalled();
        setIsReady(true); // isLoggedIn stays false → redirected to login
        return;
      }

      const saved = await tokenStore.get();
      const savedUser = await tokenStore.getUser();

      if (saved) {
        setToken(saved);
        setBridgeToken(saved);
        setNetSyncToken(saved);
        startNetSync();
        startLocationTracking();
        if (savedUser) prefetchCoreData(saved, savedUser).catch(() => {});
      }

      if (savedUser) {
        setUser(savedUser);
        if (savedUser.password_reset_required) setMustChangePassword(true);
      }

      setIsReady(true);
    })();
  }, []);

  async function login(email: string, password: string) {
    const res = await loginGlobe(email, password);
    const needsReset = !!(res.password_reset_required || res.user.password_reset_required);
    setToken(res.token);
    setUser(res.user);
    setMustChangePassword(needsReset);
    setBridgeToken(res.token);
    setNetSyncToken(res.token);
    startNetSync();
    startLocationTracking();
    await tokenStore.set(res.token);
    await tokenStore.setUser(res.user);
    // Prefetch teardown areas immediately after login so cache is warm
    prefetchCoreData(res.token, res.user).catch(() => {});
    return { mustChangePassword: needsReset };
  }

  async function clearPasswordReset() {
    if (!user) return;
    const updated = { ...user, password_reset_required: false };
    setUser(updated);
    setMustChangePassword(false);
    await tokenStore.setUser(updated);
  }

  async function logout() {
    if (token) await logoutGlobe(token).catch(() => {});
    stopNetSync();
    stopLocationTracking();
    setNetSyncToken(null);
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
    setBridgeToken(null);
    await tokenStore.clear();
  }

  return (
    <AuthContext.Provider
      value={{ isReady, isLoggedIn: !!token, token, user, mustChangePassword, login, logout, clearPasswordReset }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
