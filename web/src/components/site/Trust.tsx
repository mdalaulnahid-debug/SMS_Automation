import { Link, Badge, ShieldQuestion, Lock } from "lucide-react";

const points = [
  {
    icon: Link,
    title: "Tamper-evident audit log",
    text: "Every step (submission, dispatch, reply, review) is recorded in a hash-chained log. Nothing can be quietly edited after the fact.",
  },
  {
    icon: Badge,
    title: "Registered officers only",
    text: "Access is validated against the real Personnel Registry: phone and email have to match a genuine record before an account is ever created.",
  },
  {
    icon: ShieldQuestion,
    title: "Human review, every time",
    text: "No operator reply reaches a requester without a reviewer approving it first. The system assists, it doesn't decide.",
  },
  {
    icon: Lock,
    title: "Layered access control",
    text: "Officers, admins, and the super-admin each see only what their role needs, enforced by the server, not just hidden in the interface.",
  },
];

export function Trust() {
  return (
    <section className="mx-auto max-w-5xl border-t border-border px-6 py-16">
      <div className="mx-auto mb-10 max-w-xl text-center">
        <div className="text-xs font-extrabold tracking-[0.14em] text-muted-foreground uppercase">
          Why officers trust it
        </div>
        <h2 className="mt-2 text-2xl font-extrabold tracking-tight">
          Built for accountability, not just speed
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {points.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex gap-3.5 rounded-xl border border-border bg-card p-5">
            <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <div className="text-sm font-extrabold">{title}</div>
              <div className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{text}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
