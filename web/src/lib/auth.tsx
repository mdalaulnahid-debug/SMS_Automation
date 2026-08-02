import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setOnAuthRequired } from "@/lib/api";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "officer" | "admin" | "super_admin";
  status: string;
  designation?: string | null;
  unit?: string | null;
  phone?: string | null;
  telegramLinked?: boolean;
};

type AuthState = {
  user: SessionUser | null;
  // True if either a real session with admin/super_admin role, OR the
  // legacy shared admin key is present — ported verbatim from shared.js's
  // isAdminUnlocked() precedence (key always satisfies this, for now).
  isAdmin: boolean;
  isSuperAdmin: boolean;
  logout: () => Promise<void>;
  setSession: (token: string, user: SessionUser) => void;
};

// Every role lands on the shared Welcome page after login — it's the
// common lobby, not an officer-exclusive area. Admin/super_admin get a
// visible way to jump into the console from there (see Welcome.tsx),
// rather than being auto-redirected past it.
export function resolveHomeRoute(_user: SessionUser): string {
  return "/welcome";
}

const AuthContext = createContext<AuthState | null>(null);

function readSessionUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem("sessionUser");
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => readSessionUser());
  const [hasLegacyKey, setHasLegacyKey] = useState(() => Boolean(localStorage.getItem("adminApiKey")));

  const logout = async () => {
    const token = localStorage.getItem("sessionToken");
    if (token) {
      try {
        await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      } catch {
        // Same swallow-and-clear-anyway behavior as sessionLogout() in shared.js.
      }
    }
    localStorage.removeItem("sessionToken");
    localStorage.removeItem("sessionUser");
    setUser(null);
    location.replace("/login.html");
  };

  useEffect(() => {
    setOnAuthRequired(() => {
      logout();
    });
    return () => setOnAuthRequired(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Storage events fire on OTHER tabs' changes, not this one — matches
    // the vanilla app's assumption that within one tab, code paths that
    // mutate these keys (login, logout, key entry) call setUser directly.
    const onStorage = () => {
      setUser(readSessionUser());
      setHasLegacyKey(Boolean(localStorage.getItem("adminApiKey")));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isAdmin = hasLegacyKey || user?.role === "admin" || user?.role === "super_admin";
  const isSuperAdmin = hasLegacyKey || user?.role === "super_admin";

  const setSession = (token: string, nextUser: SessionUser) => {
    localStorage.setItem("sessionToken", token);
    localStorage.setItem("sessionUser", JSON.stringify(nextUser));
    setUser(nextUser);
  };

  return (
    <AuthContext.Provider value={{ user, isAdmin, isSuperAdmin, logout, setSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
