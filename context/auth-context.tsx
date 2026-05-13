import { createContext, useContext, useEffect, useState } from "react";
import { loginGlobe, logoutGlobe, type GlobeUser } from "@/services/auth";
import { tokenStore } from "@/lib/token";
import { setBridgeToken } from "@/lib/token-bridge";
import { startNetSync, stopNetSync, setNetSyncToken } from "@/lib/net-sync";

type AuthContextType = {
  isLoggedIn: boolean;
  token: string | null;
  user: GlobeUser | null;
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<{ mustChangePassword: boolean }>;
  logout: () => Promise<void>;
  clearPasswordReset: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
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

  // Rehydrate token from persistent store on app start
  useEffect(() => {
    tokenStore.get().then(saved => {
      if (saved) {
        setToken(saved);
        setBridgeToken(saved);
        setNetSyncToken(saved);
        startNetSync();
      }
    });
    tokenStore.getUser().then(saved => {
      if (saved) {
        setUser(saved);
        if (saved.password_reset_required) setMustChangePassword(true);
      }
    });
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
    await tokenStore.set(res.token);
    await tokenStore.setUser(res.user);
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
    setNetSyncToken(null);
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
    setBridgeToken(null);
    await tokenStore.clear();
  }

  return (
    <AuthContext.Provider
      value={{ isLoggedIn: !!token, token, user, mustChangePassword, login, logout, clearPasswordReset }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
