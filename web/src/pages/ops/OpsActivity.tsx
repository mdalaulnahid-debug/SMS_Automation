import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useOpsData } from "./useOpsData";
import { relativeTime, operatorTone, gatewayState, ECG_PATH_D } from "./format";
import type { OpsActivityEvent } from "./types";

const SEVERITY_TONE: Record<string, string> = {
  critical: "border-l-[var(--destructive)]",
  warning: "border-l-[var(--warning)]",
  success: "border-l-[var(--success)]",
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical" },
  { id: "warning", label: "Warnings" },
  { id: "success", label: "Success" },
  { id: "info", label: "Info" },
] as const;

const ATTENTION_ITEMS = [
  { key: "pendingApprovals" as const, icon: "📝", title: "reply drafts to review", detail: "Supervisor review queue" },
  { key: "failedRequests" as const, icon: "⚠️", title: "failed / timed-out dispatches", detail: "Requests needing intervention" },
  { key: "unmatchedSms" as const, icon: "🔗", title: "unmatched inbound replies", detail: "Exception desk work" },
  { key: "offlineGateways" as const, icon: "📵", title: "offline gateways", detail: "Fleet availability concern" },
];

export function OpsActivity() {
  const { overview, activity, refresh } = useOpsData();
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return activity.filter((event) => {
      if (filter !== "all" && event.severity !== filter) return false;
      if (!term) return true;
      const haystack = `${event.title} ${event.summary || ""} ${event.meta?.requestId || ""} ${event.gatewayId || ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [activity, filter, search]);

  const totals = useMemo(
    () => ({
      sent: activity.filter((e) => e.type === "dispatch_sent").length,
      replies: activity.filter((e) => e.type === "reply_received").length,
      failed: activity.filter((e) => e.severity === "critical").length,
      system: activity.filter((e) => e.type === "audit" || e.type === "gateway_offline").length,
    }),
    [activity],
  );

  const alerts = overview?.alerts;
  const warn = Boolean(alerts?.total);

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
      <div className="grid gap-3.5 lg:sticky lg:top-4">
        <Card>
          <CardContent className="grid gap-3 pt-4">
            <div className="flex items-center gap-3">
              <span className={cn("flex size-9 items-center justify-center rounded-full", warn ? "bg-[var(--warning)]/15" : "bg-[var(--success)]/15")}>
                <span className={cn("size-2.5 rounded-full", warn ? "bg-[var(--warning)]" : "bg-[var(--success)]")} />
              </span>
              <div>
                <div className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
                  Operational posture · {overview ? relativeTime(overview.generatedAt) : "—"}
                </div>
                <div className="text-[17px] font-extrabold tracking-tight">{overview?.posture?.summary || "Monitoring nominal"}</div>
              </div>
            </div>
            <p className="text-[13px] text-muted-foreground">
              {warn
                ? `${alerts?.total} item${alerts?.total === 1 ? "" : "s"} need attention — work the queue below.`
                : "Audit chain verified · Telegram bridge connected · no failed dispatches recently."}
            </p>
            <button type="button" onClick={() => refresh()} className="w-fit rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
              Refresh
            </button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fleet Status</CardTitle>
            <CardDescription>Live posture by operator</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border p-0">
            {(overview?.operators || []).map((gateway) => {
              const state = gatewayState(gateway);
              const tone = { online: "text-[var(--success)]", delayed: "text-[var(--warning)]", offline: "text-[var(--destructive)]" }[state];
              const dot = { online: "bg-[var(--success)]", delayed: "bg-[var(--warning)]", offline: "bg-[var(--destructive)]" }[state];
              const stroke = {
                online: "stroke-[var(--success)]",
                delayed: "stroke-[var(--warning)] opacity-85",
                offline: "stroke-[var(--destructive)] opacity-55",
              }[state];
              return (
                <div key={gateway.gatewayId} className="relative flex items-center gap-3 py-3 pr-3.5 pl-4">
                  <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: operatorTone(gateway.operator) }} />
                  <div className="w-[74px] shrink-0">
                    <div className="text-[12px] font-extrabold tracking-wide uppercase">{gateway.operatorName}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{gateway.gatewayId}</div>
                  </div>
                  <svg viewBox="0 0 180 40" preserveAspectRatio="none" className="h-[30px] min-w-0 flex-1" aria-hidden="true">
                    <path d={ECG_PATH_D} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("[stroke-dasharray:300]", stroke)} />
                  </svg>
                  <div className="shrink-0 text-right">
                    <div className={cn("flex items-center justify-end gap-1.5 text-[12px] font-extrabold", tone)}>
                      <span className={cn("size-[7px] rounded-full", dot)} />
                      {{ online: "Online", delayed: "Delayed", offline: "Offline" }[state]}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{relativeTime(gateway.lastSeenAt)}</div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Needs Attention</CardTitle>
            <CardDescription>Pending approvals, failures, and exception load</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border p-0">
            {ATTENTION_ITEMS.map((item) => {
              const value = alerts?.[item.key] ?? 0;
              const active = value > 0;
              return (
                <div key={item.key} className="flex items-center gap-3 py-3">
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg text-[16px]", active ? "bg-[var(--warning)]/15" : "bg-[var(--success)]/15")}>
                    {active ? item.icon : "✅"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-extrabold">{value} {item.title}</div>
                    <div className="text-[11.5px] text-muted-foreground">{active ? item.detail : "All clear"}</div>
                  </div>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-wide uppercase", active ? "bg-[var(--warning)]/15 text-[var(--warning)]" : "bg-muted text-muted-foreground")}>
                    {active ? "Act" : "OK"}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity Console</CardTitle>
          <CardDescription>Live event stream — searchable and filterable by severity</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events, requests, senders, operators…"
              className="w-full rounded-xl border border-border bg-background py-2.5 pr-3 pl-9 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                  filter === f.id ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-xl border border-border bg-card p-3">
              <div className="text-[16px] font-extrabold">{totals.sent}</div>
              <div className="mt-1 text-[10px] font-extrabold tracking-wide text-muted-foreground uppercase">Sent</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <div className="text-[16px] font-extrabold text-[var(--success)]">{totals.replies}</div>
              <div className="mt-1 text-[10px] font-extrabold tracking-wide text-muted-foreground uppercase">Replies</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <div className={cn("text-[16px] font-extrabold", totals.failed && "text-[var(--destructive)]")}>{totals.failed}</div>
              <div className="mt-1 text-[10px] font-extrabold tracking-wide text-muted-foreground uppercase">Critical</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <div className="text-[16px] font-extrabold">{totals.system}</div>
              <div className="mt-1 text-[10px] font-extrabold tracking-wide text-muted-foreground uppercase">System</div>
            </div>
          </div>

          <div className="grid gap-2.5 pt-1">
            {filtered.length ? (
              filtered.map((event, i) => <ActivityRow key={`${event.occurredAt}-${i}`} event={event} />)
            ) : (
              <div className="py-8 text-center text-[13px] text-muted-foreground">No events match the current filters.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ActivityRow({ event }: { event: OpsActivityEvent }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 rounded-lg border-l-[3px] bg-card px-3.5 py-3", SEVERITY_TONE[event.severity] || "border-l-border")}>
      <div className="min-w-0">
        <div className="text-[13px] font-bold">{event.title}</div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">{event.summary || "—"}</div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">
          {event.operator ? `${event.operator} · ` : ""}
          {event.gatewayId ? `${event.gatewayId} · ` : ""}
          {event.meta?.requestId || ""}
        </div>
      </div>
      <div className="shrink-0 text-[12px] text-muted-foreground">{relativeTime(event.occurredAt)}</div>
    </div>
  );
}
