// Ported from public/admin.js's request-impact / status-group / audit-CSV
// helpers. relativeTime/operatorTone/ECG live in ../ops/format since the
// Ops UI port already established them and both surfaces need the same
// output — no reason to fork a second copy.

export const REQ_STATUS_GROUPS: Record<string, string[]> = {
  review: ["NEEDS_MANUAL_REVIEW", "APPROVED_FOR_POST", "APPROVED_FOR_EDIT"],
  live: ["QUEUED", "WAITING_OPERATOR_REPLY", "DISPATCHING"],
  done: ["COMPLETED", "POSTED", "REPLY_RECEIVED", "REPLY_POSTED"],
  failed: ["FAILED", "TIMEOUT"],
};
export const REQ_STATUS_LABELS: Record<string, string> = {
  review: "Needs Review",
  live: "In Progress",
  done: "Completed",
  failed: "Failed",
};
export const REQ_DATE_LABELS: Record<string, string> = {
  today: "Today",
  week: "Last 7 days",
  month: "Last 30 days",
};

export const QUEUE_TAB_STATUSES: Record<string, string[]> = {
  pending: [...REQ_STATUS_GROUPS.review, ...REQ_STATUS_GROUPS.live],
  resolved: [...REQ_STATUS_GROUPS.done],
  archived: [...REQ_STATUS_GROUPS.failed],
};

// Elapsed HH:MM:SS since a request was created — the queue "time in review" clock.
export function fmtElapsed(iso?: string | null): string {
  if (!iso) return "—";
  let s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export type Impact = { tone: "danger" | "warning" | "info" | "success"; label: string; icon: string; crit: string; critSub: string };

export function requestImpact(status: string): Impact {
  if (REQ_STATUS_GROUPS.failed.includes(status)) {
    return { tone: "danger", label: "Failed", icon: "error", crit: "High criticality", critSub: "Dispatch failed or timed out" };
  }
  if (REQ_STATUS_GROUPS.review.includes(status)) {
    return { tone: "warning", label: "Review", icon: "rate_review", crit: "Needs review", critSub: "Operator reply awaiting approval" };
  }
  if (REQ_STATUS_GROUPS.live.includes(status)) {
    return { tone: "info", label: "In flight", icon: "bolt", crit: "In progress", critSub: "Dispatched, awaiting operator" };
  }
  return { tone: "success", label: "Sent", icon: "check_circle", crit: "Delivered", critSub: "Reply posted to requester" };
}

export function withinDateRange(iso: string | null | undefined, range: string): boolean {
  if (!iso) return false;
  const created = new Date(iso);
  const now = new Date();
  if (range === "today") return created.toDateString() === now.toDateString();
  if (range === "week") return now.getTime() - created.getTime() < 7 * 86_400_000;
  if (range === "month") return now.getTime() - created.getTime() < 30 * 86_400_000;
  return true;
}

export function formatAbsoluteTime(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

export function statusTone(status: string): "danger" | "success" | "warning" | "info" {
  if (["FAILED", "TIMEOUT", "REPLY_POSTED"].includes(status)) return "danger";
  if (["COMPLETED", "POSTED", "REPLY_RECEIVED"].includes(status)) return "success";
  if (["NEEDS_MANUAL_REVIEW", "APPROVED_FOR_POST", "APPROVED_FOR_EDIT"].includes(status)) return "warning";
  return "info";
}

export function auditLogsToCsv(logs: { timestamp: string; actor?: string; action: string; requestId?: string; details?: unknown }[]): string {
  const header = "timestamp,actor,action,requestId,detail\n";
  const rows = logs
    .map((log) =>
      (["timestamp", "actor", "action", "requestId"] as const)
        .map((key) => `"${String((log as Record<string, unknown>)[key] || "").replace(/"/g, '""')}"`)
        .concat(`"${JSON.stringify(log.details || {}).replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");
  return header + rows;
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
