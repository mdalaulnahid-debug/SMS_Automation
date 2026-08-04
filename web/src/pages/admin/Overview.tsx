import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAdminData } from "./useAdminData";
import { relativeTime, operatorTone, ECG_PATH_D } from "../ops/format";

type Tone = "" | "warning" | "danger" | "success";
const TONE_TEXT: Record<Tone, string> = {
  "": "",
  warning: "text-[var(--warning)]",
  danger: "text-[var(--destructive)]",
  success: "text-[var(--success)]",
};

export function Overview() {
  const { overview, loading } = useAdminData();
  const stats = overview?.stats || {};
  const diagnostics = overview?.diagnostics || {};
  const alerts = overview?.alerts || {};

  const delayedByGateway = new Map<string, number>();
  for (const row of diagnostics.delayedConfirmations || []) {
    delayedByGateway.set(row.gatewayId, (delayedByGateway.get(row.gatewayId) || 0) + 1);
  }

  const kpis: [string, number, Tone][] = [
    ["Active requests", stats.activeRequests || 0, ""],
    ["Pending approvals", stats.pendingApprovals || 0, "warning"],
    ["Failed / timed out", stats.failedOrTimedOut || 0, stats.failedOrTimedOut ? "danger" : ""],
    ["Unmatched inbound", stats.unmatchedInbound || 0, stats.unmatchedInbound ? "warning" : ""],
    ["Online gateways", stats.onlineGateways || 0, "success"],
    ["Delayed sends", stats.delayedConfirmations || 0, stats.delayedConfirmations ? "danger" : "success"],
    ["Ambiguous replies", stats.ambiguousReplies24h || 0, stats.ambiguousReplies24h ? "warning" : "success"],
    ["Duplicate risks", stats.duplicateRiskGroups || 0, stats.duplicateRiskGroups ? "warning" : "success"],
    ["Telegram chat mismatches", stats.telegramChatMismatches24h || 0, stats.telegramChatMismatches24h ? "danger" : "success"],
    ["Unauthorized attempts", stats.telegramUnauthorizedAttempts24h || 0, stats.telegramUnauthorizedAttempts24h ? "danger" : "success"],
  ];

  const alertItems: [string, number, Tone][] = [
    ["Pending approvals", alerts.pendingApprovals || 0, "warning"],
    ["Failed requests", alerts.failedRequests || 0, alerts.failedRequests ? "danger" : "success"],
    ["Unmatched inbound", alerts.unmatchedSms || 0, alerts.unmatchedSms ? "warning" : "success"],
    ["Offline gateways", alerts.offlineGateways || 0, alerts.offlineGateways ? "danger" : "success"],
    ["Delayed sends", stats.delayedConfirmations || 0, stats.delayedConfirmations ? "danger" : "success"],
    ["Ambiguous replies (24h)", stats.ambiguousReplies24h || 0, stats.ambiguousReplies24h ? "warning" : "success"],
    ["Duplicate blocks (24h)", diagnostics.recentDuplicateBlocks || 0, diagnostics.recentDuplicateBlocks ? "warning" : "success"],
    ["Telegram chat mismatches (24h)", stats.telegramChatMismatches24h || 0, stats.telegramChatMismatches24h ? "danger" : "success"],
    ["Unauthorized attempts (24h)", stats.telegramUnauthorizedAttempts24h || 0, stats.telegramUnauthorizedAttempts24h ? "danger" : "success"],
  ];

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight">System Overview</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">High-signal posture, queue pressure, and recent incidents.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map(([label, value, tone]) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-4">
            <div className={cn("text-[22px] font-extrabold", TONE_TEXT[tone])}>{loading ? "—" : value}</div>
            <div className="mt-1 text-[11px] font-bold text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Gateway Fleet</CardTitle>
              <CardDescription>Live operator posture and heartbeat visibility</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              {(overview?.gatewayHealth || []).map((gw) => {
                const state = gw.status === "MOCK" ? "delayed" : gw.online ? "online" : "offline";
                const stroke = {
                  online: "stroke-[var(--success)]",
                  delayed: "stroke-[var(--warning)] opacity-85",
                  offline: "stroke-[var(--destructive)] opacity-50",
                }[state];
                const chip = {
                  online: "bg-[var(--success)]/15 text-[var(--success)]",
                  delayed: "bg-muted text-muted-foreground",
                  offline: "bg-[var(--destructive)]/15 text-[var(--destructive)]",
                }[state];
                const label = gw.status === "MOCK" ? "MOCK" : gw.online ? "ONLINE" : "OFFLINE";
                return (
                  <div key={gw.id} className="overflow-hidden rounded-xl border border-border bg-card">
                    <div className="h-1" style={{ background: operatorTone(gw.operator) }} />
                    <div className="grid gap-2.5 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-[12px] font-extrabold tracking-wide uppercase">{gw.operatorName}</div>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold", chip)}>{label}</span>
                      </div>
                      <div className="break-all font-mono text-[13px] font-semibold">{gw.id}</div>
                      <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="h-[30px] w-full" aria-hidden="true">
                        <path d={ECG_PATH_D} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("[stroke-dasharray:300]", stroke)} />
                      </svg>
                      <div className="text-[12px] text-muted-foreground">
                        {gw.gatewayUrl || "No URL registered"}
                        <br />
                        Last seen {relativeTime(gw.lastSeenAt)} · Delayed sends {delayedByGateway.get(gw.id) || 0}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Incidents</CardTitle>
              <CardDescription>Failures, replies, and health drift</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2.5">
              {(overview?.activity || []).slice(0, 8).map((event, i) => (
                <div key={i} className="flex items-center justify-between gap-3 border-b border-border pb-2.5 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold">{event.title}</div>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">{event.summary || ""}</div>
                  </div>
                  <div className="shrink-0 text-[12px] text-muted-foreground">{relativeTime(event.occurredAt)}</div>
                </div>
              ))}
              {!(overview?.activity || []).length && <div className="text-[13px] text-muted-foreground">No recent incidents.</div>}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Queue Pressure</CardTitle>
              <CardDescription>Per-operator active and waiting load</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] font-extrabold text-muted-foreground uppercase">
                    <th className="px-4 py-2">Operator</th>
                    <th className="px-4 py-2">Active</th>
                    <th className="px-4 py-2">Waiting</th>
                    <th className="px-4 py-2">Lag</th>
                  </tr>
                </thead>
                <tbody>
                  {(overview?.queues || []).map((q) => (
                    <tr key={q.operator} className="border-t border-border">
                      <td className="px-4 py-2.5 font-bold">{q.operator}</td>
                      <td className="px-4 py-2.5 font-mono">{q.active ? q.active.requestId : "—"}</td>
                      <td className="px-4 py-2.5">{q.waiting.length}</td>
                      <td className="px-4 py-2.5">{q.delayedSendCount ? `${q.delayedSendCount} delayed` : "Clear"}</td>
                    </tr>
                  ))}
                  {!(overview?.queues || []).length && (
                    <tr>
                      <td colSpan={4} className="px-4 py-4 text-center text-muted-foreground">No queue data.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Alert State</CardTitle>
              <CardDescription>What needs immediate supervisor attention</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {alertItems.map(([label, value, tone]) => (
                <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-[13px]">
                  <span>{label}</span>
                  <strong className={TONE_TEXT[tone]}>{value}</strong>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
