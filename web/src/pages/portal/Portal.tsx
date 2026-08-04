import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Send, ShieldCheck, LogOut } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Officer Portal access (2026-08-04): no separate officer account or
// registration -- identity comes straight from the Telegram Login Widget
// (name/username are what Telegram itself hands back), and authorization is
// simply membership in the existing authorizedUsers DM allowlist that
// already gates private-DM access to the bot (see src/telegramLoginAuth.js).
// Deliberately isolated from the admin/officer userAuth session in lib/auth
// -- separate storage keys, separate endpoints, no shared state.

const BOT_USERNAME = "sms_automation_bd_bot";
const PORTAL_TOKEN_KEY = "portalSessionToken";
const PORTAL_USER_KEY = "portalSessionUser";

type PortalUser = {
  telegramUserId: string;
  name: string;
  username: string;
  firstName: string;
  lastName: string;
  photoUrl: string;
};

type TelegramAuthPayload = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthPayload) => void;
  }
}

async function rawPost<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(data.message || data.error || "Something went wrong.");
  return data;
}

function readStoredUser(): PortalUser | null {
  try {
    const raw = localStorage.getItem(PORTAL_USER_KEY);
    return raw ? (JSON.parse(raw) as PortalUser) : null;
  } catch {
    return null;
  }
}

export function Portal() {
  const [user, setUser] = useState<PortalUser | null>(() => readStoredUser());
  const [status, setStatus] = useState<"checking" | "signedOut" | "signedIn">("checking");
  const [error, setError] = useState<string | null>(null);
  const widgetHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = localStorage.getItem(PORTAL_TOKEN_KEY);
    if (!token) {
      setStatus("signedOut");
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/auth/portal-me", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error("expired");
        const body = (await res.json()) as { user: PortalUser };
        localStorage.setItem(PORTAL_USER_KEY, JSON.stringify(body.user));
        setUser(body.user);
        setStatus("signedIn");
      } catch {
        localStorage.removeItem(PORTAL_TOKEN_KEY);
        localStorage.removeItem(PORTAL_USER_KEY);
        setUser(null);
        setStatus("signedOut");
      }
    })();
  }, []);

  useEffect(() => {
    window.onTelegramAuth = async (telegramUser) => {
      setError(null);
      try {
        const data = await rawPost<{ token: string; user: PortalUser }>("/api/auth/telegram-login", telegramUser);
        localStorage.setItem(PORTAL_TOKEN_KEY, data.token);
        localStorage.setItem(PORTAL_USER_KEY, JSON.stringify(data.user));
        setUser(data.user);
        setStatus("signedIn");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign-in failed.");
      }
    };
    return () => {
      delete window.onTelegramAuth;
    };
  }, []);

  // The Telegram widget script self-replaces with an iframe wherever it's
  // inserted, so it's injected imperatively rather than as JSX -- only once
  // we're actually showing the signed-out state.
  useEffect(() => {
    if (status !== "signedOut" || !widgetHostRef.current) return;
    widgetHostRef.current.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "10");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    widgetHostRef.current.appendChild(script);
  }, [status]);

  const logout = async () => {
    const token = localStorage.getItem(PORTAL_TOKEN_KEY);
    if (token) {
      try {
        await fetch("/api/auth/portal-logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      } catch {
        // Sign out locally regardless of whether the server call succeeded.
      }
    }
    localStorage.removeItem(PORTAL_TOKEN_KEY);
    localStorage.removeItem(PORTAL_USER_KEY);
    setUser(null);
    setStatus("signedOut");
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6 py-12">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, color-mix(in srgb, var(--primary) 12%, transparent), transparent 32%), radial-gradient(circle at 82% 78%, color-mix(in srgb, var(--gp) 8%, transparent), transparent 30%)",
        }}
        aria-hidden="true"
      />

      <Card className="relative z-10 w-full max-w-[420px] border-border/80 shadow-xl shadow-black/20">
        <CardHeader className="gap-4">
          <Link to="/welcome" className="flex items-center gap-3 no-underline">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[15px] font-bold text-foreground">SMS Automation</span>
              <span className="block text-xs text-muted-foreground">LIC Barishal · Officer Portal</span>
            </span>
          </Link>
        </CardHeader>

        <CardContent>
          {status === "checking" && (
            <p className="py-8 text-center text-[13px] text-muted-foreground">Checking your session…</p>
          )}

          {status === "signedOut" && (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                Sign in with Telegram
              </h1>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                No separate account or password — access is granted to officers already authorized for the
                Telegram bot. If you can DM the bot, you can sign in here with the same account.
              </p>

              <div className="mt-6 flex min-h-11 items-center justify-center" ref={widgetHostRef} />

              {error && (
                <p className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-center text-[13px] text-destructive">
                  {error}
                </p>
              )}

              <a
                href={`https://t.me/${BOT_USERNAME}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-muted px-4 py-3 text-[13px] font-semibold text-foreground no-underline transition-colors hover:bg-muted/70"
              >
                <Send className="size-4" aria-hidden="true" />
                Message the bot on Telegram
              </a>

              <p className="mt-4 text-center text-[12px] text-muted-foreground">
                Not authorized yet?{" "}
                <a href="mailto:opsbarishal@gmail.com" className="font-semibold text-primary no-underline hover:underline">
                  Contact administration
                </a>
                .
              </p>
            </>
          )}

          {status === "signedIn" && user && (
            <>
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                  Your account
                </h1>
                <Badge variant="secondary">Active</Badge>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                Requests are made through Telegram, where every message is logged, reviewed, and tied to your
                account. This page is for account status only.
              </p>

              <div className="mt-6 grid grid-cols-2 gap-4 rounded-xl border border-border/80 p-4">
                <Field label="Name" value={user.name} />
                <Field label="Telegram" value={user.username ? `@${user.username}` : user.firstName} />
              </div>

              <a
                href={`https://t.me/${BOT_USERNAME}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-[13px] font-semibold text-primary-foreground no-underline transition-colors hover:bg-primary/90"
              >
                <Send className="size-4" aria-hidden="true" />
                Message the bot on Telegram
              </a>

              <Button variant="outline" className="mt-3 w-full" onClick={logout}>
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-[14px] font-semibold ${value ? "text-foreground" : "text-muted-foreground"}`}>
        {value || "—"}
      </div>
    </div>
  );
}
