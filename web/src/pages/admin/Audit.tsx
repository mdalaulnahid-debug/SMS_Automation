import { useMemo, useState } from "react";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAdminData } from "./useAdminData";
import { relativeTime } from "../ops/format";
import { statusTone, auditLogsToCsv, downloadCsv } from "./format";
import type { AuditLog } from "./types";

function auditDetails(log: AuditLog) {
  if (log.action !== "REQUEST_VALIDATION_FAILED") {
    return <div className="mt-2 font-mono text-[12px] break-words text-muted-foreground">{JSON.stringify(log.details || {})}</div>;
  }
  const details = (log.details || {}) as Record<string, unknown>;
  const lines: [string, string][] = [
    ["Reason", (Array.isArray(details.errors) ? (details.errors as string[]).join("; ") : "") || (details.errorCode as string) || "Validation rejected"],
    [
      "Request Context",
      [
        details.requesterName ? `Requester: ${details.requesterName}` : null,
        details.requesterId ? `ID: ${details.requesterId}` : null,
        details.channel ? `Channel: ${details.channel}` : null,
        details.chatId ? `Chat: ${details.chatId}` : null,
      ]
        .filter(Boolean)
        .join(" | ") || "No requester metadata",
    ],
    ["Raw Message", (details.rawText as string) || ""],
    ["Normalized Input", (details.normalizedText as string) || ""],
    ["Error Code", (details.errorCode as string) || ""],
  ];
  return (
    <div className="mt-2 grid gap-1.5">
      {lines.map(([label, value]) => (
        <div key={label}>
          <div className="text-[10px] font-extrabold tracking-wide text-muted-foreground uppercase">{label}</div>
          <div className="font-mono text-[12px] break-words whitespace-pre-wrap text-muted-foreground">{value}</div>
        </div>
      ))}
    </div>
  );
}

export function Audit() {
  const { auditLogs, integrity } = useAdminData();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "validation">("all");

  const validationRows = auditLogs.filter((l) => l.action === "REQUEST_VALIDATION_FAILED");
  const last24hCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const validationRecent = validationRows.filter((l) => Date.parse(l.timestamp) >= last24hCutoff);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return auditLogs.filter((log) => {
      if (filter === "validation" && log.action !== "REQUEST_VALIDATION_FAILED") return false;
      if (!term) return true;
      return `${log.action} ${log.actor || ""} ${log.requestId || ""} ${JSON.stringify(log.details || {})}`.toLowerCase().includes(term);
    });
  }, [auditLogs, filter, search]);

  const integrityText = integrity?.ok ? `${integrity.count} audit events verified` : `Audit chain issue at ${integrity?.brokenAt || "unknown row"}`;

  return (
    <div className="grid gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight">Audit Ledger</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Searchable compliance-grade event history with integrity posture.</p>
        </div>
        <button type="button" onClick={() => downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, auditLogsToCsv(auditLogs))} className={cn(buttonVariants({ variant: "outline" }))}>
          Export CSV
        </button>
      </div>

      <div className={cn("flex items-center gap-2.5 rounded-xl border px-4 py-3 text-[13px] font-semibold", integrity?.ok ? "border-[var(--success)]/25 bg-[var(--success)]/10 text-[var(--success)]" : "border-[var(--destructive)]/25 bg-[var(--destructive)]/10 text-[var(--destructive)]")}>
        {integrity?.ok ? <ShieldCheck className="size-4" /> : <TriangleAlert className="size-4" />}
        {integrityText}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-[22px] font-extrabold">{auditLogs.length}</div>
          <div className="mt-1 text-[12px] font-extrabold text-muted-foreground">Visible Events</div>
          <div className="mt-1.5 text-[12px] text-muted-foreground">Rows currently loaded into the admin audit feed.</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-[22px] font-extrabold text-[var(--destructive)]">{validationRows.length}</div>
          <div className="mt-1 text-[12px] font-extrabold text-muted-foreground">Validation Failures</div>
          <div className="mt-1.5 text-[12px] text-muted-foreground">Rejected requests blocked before queueing or dispatch.</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-[22px] font-extrabold">{validationRecent.length}</div>
          <div className="mt-1 text-[12px] font-extrabold text-muted-foreground">Recent 24h</div>
          <div className="mt-1.5 text-[12px] text-muted-foreground">Quick signal for training gaps, misuse, or probing attempts.</div>
        </div>
      </div>

      <Card className="grid gap-0 p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-3.5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, actor, request id, or details…"
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] outline-none"
          />
          <div className="flex gap-2">
            {(["all", "validation"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[11px] font-extrabold tracking-wide uppercase",
                  filter === f ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground",
                )}
              >
                {f === "all" ? "All Events" : "Validation Failures"}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[720px] divide-y divide-border overflow-auto">
          {rows
            .slice()
            .reverse()
            .map((log, i) => {
              const tone = statusTone(log.action);
              const border = { danger: "border-l-[var(--destructive)]", success: "border-l-[var(--success)]", warning: "border-l-[var(--warning)]", info: "border-l-border" }[tone];
              const isBlocked = log.action === "REQUEST_VALIDATION_FAILED";
              return (
                <div key={i} className={cn("border-l-[3px] px-4 py-3", border)}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-extrabold">{log.action.replaceAll("_", " ")}</div>
                      <div className="mt-0.5 font-mono text-[12px] text-muted-foreground">
                        {log.actor || "system"} · {log.requestId ? `${log.requestId} · ` : ""}
                        {relativeTime(log.timestamp)}
                      </div>
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold", isBlocked ? "bg-[var(--destructive)]/15 text-[var(--destructive)]" : "bg-muted text-muted-foreground")}>
                      {isBlocked ? "BLOCKED" : (log.actor || "system").toUpperCase()}
                    </span>
                  </div>
                  {auditDetails(log)}
                </div>
              );
            })}
          {!rows.length && <div className="p-8 text-center text-[13px] text-muted-foreground">No audit entries match the current search.</div>}
        </div>
      </Card>
    </div>
  );
}
