import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { AdminOverview, AdminRequest, ReplyDraft, UnmatchedRow, RejectedRow, AuditLog } from "./types";

// Ported from public/admin.js's refreshAdmin()/boot() — same six endpoints,
// same 15s poll interval.
export function useAdminData() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [replies, setReplies] = useState<ReplyDraft[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [rejected, setRejected] = useState<RejectedRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [integrity, setIntegrity] = useState<{ ok: boolean; count?: number; brokenAt?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [overviewRes, requestsRes, repliesRes, unmatchedRes, rejectedRes, auditRes] = await Promise.all([
        apiFetch("/api/admin/overview"),
        apiFetch("/api/admin/requests"),
        apiFetch("/api/admin/replies"),
        apiFetch("/api/admin/unmatched"),
        apiFetch("/api/admin/rejected-messages"),
        apiFetch("/api/admin/audit"),
      ]);
      setOverview((await overviewRes.json()) as AdminOverview);
      setRequests(((await requestsRes.json()) as { requests?: AdminRequest[] }).requests || []);
      setReplies(((await repliesRes.json()) as { replyDrafts?: ReplyDraft[] }).replyDrafts || []);
      setUnmatched(((await unmatchedRes.json()) as { unmatched?: UnmatchedRow[] }).unmatched || []);
      setRejected(((await rejectedRes.json()) as { rejected?: RejectedRow[] }).rejected || []);
      const auditBody = (await auditRes.json()) as { auditLogs?: AuditLog[]; integrity?: { ok: boolean; count?: number; brokenAt?: string } };
      setAuditLogs(auditBody.auditLogs || []);
      setIntegrity(auditBody.integrity || null);
    } catch (error) {
      console.error("Failed to refresh admin data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { overview, requests, replies, unmatched, rejected, auditLogs, integrity, loading, refresh };
}
