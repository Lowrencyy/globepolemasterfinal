import { createContext, useContext, useEffect, useState } from "react";
import { loginGlobe, logoutGlobe, type GlobeUser } from "@/services/auth";
import { tokenStore } from "@/lib/token";
import { setBridgeToken } from "@/lib/token-bridge";
import { startNetSync, stopNetSync, setNetSyncToken } from "@/lib/net-sync";

type AuthContextType = {
  isLoggedIn: boolean;
  token: string | null;
  user: GlobeUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  isLoggedIn: false,
  token: null,
  user: null,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<GlobeUser | null>(null);

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
      if (saved) setUser(saved);
    });
  }, []);

  async function login(email: string, password: string) {
    const res = await loginGlobe(email, password);
    setToken(res.token);
    setUser(res.user);
    setBridgeToken(res.token);
    setNetSyncToken(res.token);
    startNetSync();
    await tokenStore.set(res.token);
    await tokenStore.setUser(res.user);
  }

  async function logout() {
    if (token) await logoutGlobe(token).catch(() => {});
    stopNetSync();
    setNetSyncToken(null);
    setToken(null);
    setUser(null);
    setBridgeToken(null);
    await tokenStore.clear();
  }

  return (
    <AuthContext.Provider
      value={{ isLoggedIn: !!token, token, user, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
