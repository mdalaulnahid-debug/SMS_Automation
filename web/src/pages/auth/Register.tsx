import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useSearchParams } from "react-router-dom";
import { Lock, MailCheck, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const schema = z
  .object({
    password: z.string().min(10, "Password must be at least 10 characters."),
    confirm: z.string().min(1, "Confirm your password."),
  })
  .refine((fields) => fields.password === fields.confirm, {
    message: "Passwords do not match.",
    path: ["confirm"],
  });
type Fields = z.infer<typeof schema>;

type InviteStatus = "loading" | "denied" | "valid";

export function Register() {
  const [params] = useSearchParams();
  const invitationToken = params.get("token") || "";
  const [status, setStatus] = useState<InviteStatus>("loading");
  const [invitee, setInvitee] = useState<{ email: string; name: string } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm<Fields>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!invitationToken) {
      setStatus("denied");
      return;
    }
    fetch(`/api/auth/invite-status?token=${encodeURIComponent(invitationToken)}`)
      .then((res) => res.json())
      .then((data: { valid: boolean; email?: string; name?: string }) => {
        if (!data.valid || !data.email) {
          setStatus("denied");
          return;
        }
        setInvitee({ email: data.email, name: data.name || data.email });
        setStatus("valid");
      })
      .catch(() => setStatus("denied"));
  }, [invitationToken]);

  const onSubmit = async (fields: Fields) => {
    setServerError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invitationToken, password: fields.password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Registration failed.");
      setDone(true);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Registration failed.");
    }
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
          <Link to="/login" className="flex items-center gap-3 no-underline">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[15px] font-bold text-foreground">SMS Automation</span>
              <span className="block text-xs text-muted-foreground">LIC Barishal</span>
            </span>
          </Link>
        </CardHeader>

        <CardContent>
          {status === "loading" && (
            <p className="py-6 text-center text-[13px] text-muted-foreground">Checking your invitation…</p>
          )}

          {status === "denied" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <Lock className="size-6" aria-hidden="true" />
              </span>
              <h1 className="text-xl font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                You are not authorized for Registration
              </h1>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Accounts are created by invitation only. If you were expecting access, ask a super-admin to send you a
                registration link.
              </p>
              <Link to="/login" className="mt-2 text-[13px] font-semibold text-primary no-underline hover:underline">
                Go to sign in →
              </Link>
            </div>
          )}

          {status === "valid" && invitee && !done && (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                Create your account
              </h1>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                You've been invited to join SMS Automation. Set a password to finish setting up your account.
              </p>
              <div className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                <p className="text-[13.5px] font-bold text-foreground">{invitee.name}</p>
                <p className="text-[12px] text-muted-foreground">{invitee.email}</p>
              </div>

              <form onSubmit={form.handleSubmit(onSubmit)} className="mt-5 flex flex-col gap-4" noValidate>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    aria-invalid={Boolean(form.formState.errors.password)}
                    {...form.register("password")}
                  />
                  <p className="text-[11px] text-muted-foreground">At least 10 characters.</p>
                  {form.formState.errors.password && (
                    <p className="text-[12px] text-destructive">{form.formState.errors.password.message}</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    aria-invalid={Boolean(form.formState.errors.confirm)}
                    {...form.register("confirm")}
                  />
                  {form.formState.errors.confirm && (
                    <p className="text-[12px] text-destructive">{form.formState.errors.confirm.message}</p>
                  )}
                </div>

                {serverError && (
                  <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                    {serverError}
                  </p>
                )}

                <Button type="submit" size="lg" disabled={form.formState.isSubmitting} className="mt-1 h-11 w-full">
                  {form.formState.isSubmitting ? "Creating account…" : "Create account"}
                </Button>
              </form>
            </>
          )}

          {done && invitee && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
                <MailCheck className="size-6" aria-hidden="true" />
              </span>
              <h1 className="text-xl font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                Check your email
              </h1>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                A verification link was sent to <strong className="text-foreground">{invitee.email}</strong>. Click it
                to activate your account, then sign in.
              </p>
              <Link to="/login" className="mt-2 text-[13px] font-semibold text-primary no-underline hover:underline">
                Go to sign in →
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
