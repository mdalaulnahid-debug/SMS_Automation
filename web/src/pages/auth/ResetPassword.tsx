import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const schema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters."),
});
type Fields = z.infer<typeof schema>;

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();
  const form = useForm<Fields>({ resolver: zodResolver(schema) });

  const onSubmit = async (fields: Fields) => {
    setServerError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword: fields.password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not reset password.");
      setDone(true);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Could not reset password.");
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
          {!token ? (
            <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              This reset link is missing its token. Request a new one from the sign-in page.
            </p>
          ) : done ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
                <CheckCircle2 className="size-6" aria-hidden="true" />
              </span>
              <h1 className="text-xl font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                Password updated
              </h1>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Any sessions you had open elsewhere have been signed out. You can sign in now with your new password.
              </p>
              <Button size="lg" className="mt-2 h-11 w-full" onClick={() => navigate("/login", { replace: true })}>
                Go to sign in
              </Button>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                Set a new password
              </h1>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                Choose a new password for your account.
              </p>

              <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-4" noValidate>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    aria-invalid={Boolean(form.formState.errors.password)}
                    {...form.register("password")}
                  />
                  {form.formState.errors.password && (
                    <p className="text-[12px] text-destructive">{form.formState.errors.password.message}</p>
                  )}
                </div>

                {serverError && (
                  <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                    {serverError}
                  </p>
                )}

                <Button type="submit" size="lg" disabled={form.formState.isSubmitting} className="h-11 w-full">
                  {form.formState.isSubmitting ? "Updating…" : "Update password"}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
