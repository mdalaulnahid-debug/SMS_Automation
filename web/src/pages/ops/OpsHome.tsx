import { Send } from "lucide-react";
import { useOpsData } from "./useOpsData";
import { relativeTime, gatewayState, ECG_PATH_D } from "./format";
import type { GatewayHealth, OpsActivityEvent } from "./types";

const STATE_LABELS = { online: "Online", delayed: "Delayed", offline: "Offline" } as const;
const STATE_TONE = {
  online: "text-[var(--success)]",
  delayed: "text-[var(--warning)]",
  offline: "text-[var(--destructive)]",
} as const;
const STATE_STROKE = {
  online: "stroke-[var(--success)]",
  delayed: "stroke-[var(--warning)] opacity-85 [animation-duration:4s]",
  offline: "stroke-[var(--destructive)] opacity-55 [animation:none]",
} as const;
const STATE_DOT = {
  online: "bg-[var(--success)]",
  delayed: "bg-[var(--warning)]",
  offline: "bg-[var(--destructive)]",
} as const;

function GatewayCard({ gateway }: { gateway: GatewayHealth }) {
  const state = gatewayState(gateway);
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-border bg-card p-4 text-center">
      <div className="text-[12px] font-extrabold tracking-wider text-muted-foreground uppercase">{gateway.operatorName}</div>
      <svg viewBox="0 0 180 40" preserveAspectRatio="none" className="h-10 w-full max-w-[180px]" aria-hidden="true">
        <path
          d={ECG_PATH_D}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`[stroke-dasharray:300] motion-safe:animate-[ecg-travel_2.2s_linear_infinite] ${STATE_STROKE[state]}`}
        />
      </svg>
      <div className={`flex items-center gap-1.5 text-[13px] font-extrabold ${STATE_TONE[state]}`}>
        <span className={`size-2 rounded-full ${STATE_DOT[state]}`} />
        {STATE_LABELS[state]}
      </div>
      <div className="text-[11px] text-muted-foreground">{relativeTime(gateway.lastSeenAt)}</div>
      <style>{"@keyframes ecg-travel { to { stroke-dashoffset: -300; } }"}</style>
    </div>
  );
}

function Ticker({ events }: { events: OpsActivityEvent[] }) {
  const latest = events[0];
  if (!latest) return null;
  return (
    <div className="flex items-center justify-center gap-2 py-1 text-center text-[12px] text-muted-foreground">
      <span aria-hidden="true">⚡</span>
      {latest.title}
      {latest.operator ? ` · ${latest.operator}` : ""} · {relativeTime(latest.occurredAt)}
    </div>
  );
}

export function OpsHome() {
  const { overview, loading } = useOpsData();
  const alerts = overview?.alerts;

  return (
    <div className="mx-auto grid max-w-[720px] gap-7 pt-2">
      <div className="text-center">
        <div className="text-[11px] font-extrabold tracking-[0.14em] text-muted-foreground uppercase">Live Status</div>
        <div className={`mt-2.5 text-[22px] font-extrabold tracking-tight ${alerts?.total ? "text-[var(--warning)]" : ""}`}>
          {loading ? "Checking systems…" : overview?.posture?.summary || "Monitoring nominal"}
        </div>
        <div className="mt-1.5 text-[12.5px] text-muted-foreground">
          {overview ? `Updated ${relativeTime(overview.generatedAt)}` : ""}
        </div>
      </div>

      <a
        href="https://t.me/sms_automation_bd_bot"
        target="_blank"
        rel="noopener noreferrer"
        className="mx-auto flex w-fit items-center justify-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-5 py-3 text-[13px] font-extrabold text-primary no-underline"
      >
        <Send className="size-4" aria-hidden="true" />
        Message the bot on Telegram
      </a>

      <div className="grid gap-3.5 sm:grid-cols-3">
        {(overview?.operators || []).map((gateway) => (
          <GatewayCard key={gateway.gatewayId} gateway={gateway} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="text-[18px] font-extrabold">{overview?.stats?.todayRequests ?? 0}</div>
          <div className="mt-1 text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase">Today</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3">
          <div className={`text-[18px] font-extrabold ${alerts?.pendingApprovals ? "text-[var(--warning)]" : ""}`}>
            {alerts?.pendingApprovals ?? 0}
          </div>
          <div className="mt-1 text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase">Needs Review</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3">
          <div className={`text-[18px] font-extrabold ${alerts?.failedRequests ? "text-[var(--destructive)]" : ""}`}>
            {alerts?.failedRequests ?? 0}
          </div>
          <div className="mt-1 text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase">Failed</div>
        </div>
      </div>

      <Ticker events={overview?.activity || []} />
    </div>
  );
}
