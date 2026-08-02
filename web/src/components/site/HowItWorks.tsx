import { Send, Smartphone, MessageSquare, ShieldCheck } from "lucide-react";

const steps = [
  {
    icon: Send,
    title: "Officer submits a request",
    text: "A formatted lookup command (LRL, LCL, MS-NID, NID-MS, IMEI-MS) is sent through Telegram by a registered officer.",
  },
  {
    icon: Smartphone,
    title: "Routed to the right gateway",
    text: "The backend routes it to the correct operator's dedicated gateway phone and sends the SMS exactly as formatted, with no manual copying.",
  },
  {
    icon: MessageSquare,
    title: "Operator replies, tagged by requester",
    text: "Only trusted sender replies from configured operator numbers are processed and matched back to the original request.",
  },
  {
    icon: ShieldCheck,
    title: "Reviewed before posting",
    text: "A human reviewer approves the reply draft before it's posted back to the requesting officer on Telegram.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-5xl border-t border-border px-6 py-16">
      <div className="mx-auto mb-10 max-w-xl text-center">
        <div className="text-xs font-extrabold tracking-[0.14em] text-muted-foreground uppercase">
          How it works
        </div>
        <h2 className="mt-2 text-2xl font-extrabold tracking-tight">
          Four steps, every one of them logged
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(({ icon: Icon, title, text }, i) => (
          <div
            key={title}
            className="stagger-item rounded-xl border border-border bg-card p-5"
            style={{ animationDelay: `${i * 100 + 50}ms` }}
          >
            <div className="flex size-11 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              <Icon className="size-5" />
            </div>
            <div className="mt-3.5 text-[15px] font-extrabold">{title}</div>
            <div className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
