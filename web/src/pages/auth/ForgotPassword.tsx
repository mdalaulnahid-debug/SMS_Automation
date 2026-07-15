import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "react-router-dom";
import { ArrowLeft, MailCheck, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const schema = z.object({
  email: z.string().min(1, "Email is required.").email("Enter a valid email address."),
});
type Fields = z.infer<typeof schema>;

export function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const form = useForm<Fields>({ resolver: zodResolver(schema) });

  const onSubmit = async (fields: Fields) => {
    // Deliberately ignores response shape beyond ok/not-ok — the backend
    // always returns 200 with a generic message so this page can't be used
    // to enumerate which emails have accounts either.
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    });
    setSent(true);
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
          {sent ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
                <MailCheck className="size-6" aria-hidden="true" />
              </span>
              <h1 className="text-xl font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                Check your email
              </h1>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                If an account exists for that email, a reset link has been sent. It expires in 1 hour.
              </p>
              <Link
                to="/login"
                className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-primary no-underline hover:underline"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                Reset your password
              </h1>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                Enter your account email and we'll send you a link to set a new password.
              </p>

              <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-4" noValidate>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="officer@example.com"
                    aria-invalid={Boolean(form.formState.errors.email)}
                    {...form.register("email")}
                  />
                  {form.formState.errors.email && (
                    <p className="text-[12px] text-destructive">{form.formState.errors.email.message}</p>
                  )}
                </div>

                <Button type="submit" size="lg" disabled={form.formState.isSubmitting} className="h-11 w-full">
                  {form.formState.isSubmitting ? "Sending…" : "Send reset link"}
                </Button>
              </form>

              <Link
                to="/login"
                className="mt-5 flex items-center justify-center gap-1.5 text-[13px] font-medium text-muted-foreground no-underline hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Back to sign in
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
