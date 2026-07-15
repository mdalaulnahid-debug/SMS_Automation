import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { resolveHomeRoute, useAuth, type SessionUser } from "@/lib/auth";

const passwordSchema = z.object({
  email: z.string().min(1, "Email is required.").email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});
type PasswordFields = z.infer<typeof passwordSchema>;

const mfaSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
});
type MfaFields = z.infer<typeof mfaSchema>;

type Step = "password" | "mfa";

// The two auth endpoints legitimately return 401 for "wrong password" /
// "wrong code" — that's a normal form error here, not a signed-out signal,
// so this deliberately uses plain fetch instead of lib/api's apiFetch
// (which treats any 401 as "redirect to login"). Same reasoning the
// vanilla public/login.html's hand-written fetch calls already encode.
async function rawPost<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export function Login() {
  const [step, setStep] = useState<Step>("password");
  const [serverError, setServerError] = useState<string | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [emailForHint, setEmailForHint] = useState("");
  const { setSession, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const params = new URLSearchParams(location.search);
  const isStepUp = params.get("stepup") === "1";
  const returnPath = params.get("return") || (location.state as { returnTo?: string } | null)?.returnTo || null;

  useEffect(() => {
    if (!isStepUp && user) {
      navigate(returnPath || resolveHomeRoute(user), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const passwordForm = useForm<PasswordFields>({ resolver: zodResolver(passwordSchema) });
  const mfaForm = useForm<MfaFields>({ resolver: zodResolver(mfaSchema), defaultValues: { code: "" } });

  const onSubmitPassword = async (fields: PasswordFields) => {
    setServerError(null);
    try {
      const data = await rawPost<{ pendingToken: string }>("/api/auth/login", fields);
      setPendingToken(data.pendingToken);
      setEmailForHint(fields.email);
      setStep("mfa");
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Login failed.");
    }
  };

  const onSubmitMfa = async (fields: MfaFields) => {
    setServerError(null);
    try {
      const data = await rawPost<{ token: string; user: SessionUser }>("/api/auth/mfa/verify", {
        pendingToken,
        code: fields.code,
      });
      setSession(data.token, data.user);
      navigate(returnPath || resolveHomeRoute(data.user), { replace: true });
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Incorrect code.");
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

      <Card className="relative z-10 w-full max-w-[400px] border-border/80 shadow-xl shadow-black/20">
        <CardHeader className="gap-4">
          <Link to="/welcome" className="flex items-center gap-3 no-underline">
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
          {step === "password" ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                {isStepUp ? "Re-enter your password" : "Sign in"}
              </h1>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {isStepUp
                  ? "For super-admin console access, sign in again to confirm it's really you."
                  : "Use your officer account email and password."}
              </p>

              <form onSubmit={passwordForm.handleSubmit(onSubmitPassword)} className="mt-6 flex flex-col gap-4" noValidate>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="officer@example.com"
                    aria-invalid={Boolean(passwordForm.formState.errors.email)}
                    {...passwordForm.register("email")}
                  />
                  {passwordForm.formState.errors.email && (
                    <p className="text-[12px] text-destructive">{passwordForm.formState.errors.email.message}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link to="/forgot-password" className="text-[12px] font-semibold text-primary no-underline hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    aria-invalid={Boolean(passwordForm.formState.errors.password)}
                    {...passwordForm.register("password")}
                  />
                  {passwordForm.formState.errors.password && (
                    <p className="text-[12px] text-destructive">{passwordForm.formState.errors.password.message}</p>
                  )}
                </div>

                {serverError && (
                  <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                    {serverError}
                  </p>
                )}

                <Button type="submit" size="lg" disabled={passwordForm.formState.isSubmitting} className="mt-1 h-11 w-full">
                  {passwordForm.formState.isSubmitting ? "Sending code…" : "Continue"}
                </Button>
              </form>

              {!isStepUp && (
                <p className="mt-5 text-center text-[13px] text-muted-foreground">
                  No account?{" "}
                  <Link to="/register" className="font-semibold text-primary no-underline hover:underline">
                    Register
                  </Link>
                </p>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setStep("password");
                  setServerError(null);
                  mfaForm.reset();
                }}
                className="mb-4 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Back
              </button>
              <h1 className="text-2xl font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                Verification code
              </h1>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                A 6-digit code was emailed to <strong className="text-foreground">{emailForHint}</strong>. Check your inbox
                (and spam).
              </p>

              <form onSubmit={mfaForm.handleSubmit(onSubmitMfa)} className="mt-6 flex flex-col gap-4" noValidate>
                <div className="flex flex-col items-center gap-1.5">
                  <Label htmlFor="code" className="self-start">
                    6-digit code
                  </Label>
                  <InputOTP
                    maxLength={6}
                    value={mfaForm.watch("code")}
                    onChange={(value) => mfaForm.setValue("code", value, { shouldValidate: true })}
                  >
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                  {mfaForm.formState.errors.code && (
                    <p className="self-start text-[12px] text-destructive">{mfaForm.formState.errors.code.message}</p>
                  )}
                </div>

                {serverError && (
                  <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                    {serverError}
                  </p>
                )}

                <Button type="submit" size="lg" disabled={mfaForm.formState.isSubmitting} className="h-11 w-full">
                  {mfaForm.formState.isSubmitting ? "Verifying…" : "Verify and sign in"}
                </Button>
              </form>
              <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
                Code expires in 10 minutes. Click Back to resend.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
