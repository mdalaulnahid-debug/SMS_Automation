import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiFetch, postJson } from "@/lib/api";
import { useAdminData } from "./useAdminData";
import { relativeTime } from "../ops/format";
import { formatAbsoluteTime } from "./format";
import type { MatchCandidate, UnmatchedRow } from "./types";

export function Unmatched() {
  const { unmatched, refresh } = useAdminData();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = unmatched.filter((item) => {
    if (!search) return true;
    return `${item.senderNumber} ${item.gatewayId} ${item.messageBody}`.toLowerCase().includes(search.toLowerCase());
  });
  const selected = rows.find((r) => r.id === (selectedId || rows[0]?.id));

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight">Exception Desk</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Investigate unmatched inbound SMS and perform guided manual match.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.95fr]">
        <Card className="grid gap-0 self-start p-0">
          <div className="border-b border-border p-3.5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sender, gateway, or reply content…"
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] outline-none"
            />
          </div>
          <div className="max-h-[720px] divide-y divide-border overflow-auto">
            {rows.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  "grid w-full gap-1.5 border-l-[3px] px-4 py-3 text-left transition-colors hover:bg-muted/40",
                  (selectedId || rows[0]?.id) === item.id ? "border-l-[var(--warning)] bg-primary/5" : "border-l-transparent",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[13px] font-extrabold">{item.senderNumber}</div>
                    <div className="mt-0.5 font-mono text-[12px] text-muted-foreground">
                      {item.gatewayId} · {relativeTime(item.receivedAt)}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--warning)]/15 px-2 py-0.5 text-[10px] font-extrabold text-[var(--warning)]">Unmatched</span>
                </div>
                <div className="truncate font-mono text-[12px] text-muted-foreground">{item.messageBody}</div>
              </button>
            ))}
            {!rows.length && <div className="p-8 text-center text-[13px] text-muted-foreground">No unmatched SMS currently.</div>}
          </div>
        </Card>

        <Card className="min-h-[620px] p-4.5">
          {selected ? (
            <UnmatchedDetail key={selected.id} inbox={selected} onAction={refresh} />
          ) : (
            <div className="p-8 text-center text-[13px] text-muted-foreground">Select an unmatched reply to review likely request candidates.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

function UnmatchedDetail({ inbox, onAction }: { inbox: UnmatchedRow; onAction: () => void }) {
  const [candidates, setCandidates] = useState<MatchCandidate[] | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCandidates(null);
    setError(null);
    (async () => {
      try {
        const res = await apiFetch(`/api/admin/unmatched/${encodeURIComponent(inbox.id)}/candidates`);
        const body = (await res.json()) as { candidates?: MatchCandidate[] };
        if (cancelled) return;
        const list = body.candidates || [];
        setCandidates(list);
        setSelectedRequestId(list[0]?.requestId || "");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load candidates.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inbox.id]);

  const match = async () => {
    if (!candidates) return;
    const candidate = candidates.find((c) => c.requestId === selectedRequestId);
    const endpoint = candidate && candidate.status === "COMPLETED" ? "/api/admin/correct-match" : "/api/manual-match";
    await postJson(endpoint, { inboxId: inbox.id, requestId: selectedRequestId });
    await onAction();
  };

  return (
    <div className="grid gap-4">
      <div className="text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">Exception review</div>
      <div className="text-[22px] font-extrabold tracking-tight">{inbox.senderNumber}</div>

      <div className="border-t border-border pt-3.5">
        <div className="text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">Raw inbound SMS</div>
        <div className="mt-2 rounded-xl border border-border bg-card p-3.5 font-mono text-[12px] whitespace-pre-wrap">{inbox.messageBody}</div>
      </div>

      <div className="border-t border-border pt-3.5">
        <div className="text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">Gateway metadata</div>
        <div className="mt-2 text-[13px]">
          {inbox.gatewayId} · {formatAbsoluteTime(inbox.receivedAt)}
        </div>
      </div>

      <div className="border-t border-border pt-3.5">
        <div className="text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">Guided manual match — ranked by the same logic as live auto-matching</div>
        {error && <div className="mt-2 text-[13px] text-[var(--destructive)]">Failed to load candidates: {error}</div>}
        {!error && candidates === null && <div className="mt-2 text-[13px] text-muted-foreground">Loading ranked candidates…</div>}
        {!error && candidates && candidates.length === 0 && <div className="mt-2 text-[13px] text-muted-foreground">No requests on this gateway are eligible for match.</div>}
        {!error && candidates && candidates.length > 0 && (
          <>
            <select
              value={selectedRequestId}
              onChange={(e) => setSelectedRequestId(e.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px]"
            >
              {candidates.map((c) => (
                <option key={c.requestId} value={c.requestId}>
                  {c.requestId} · {c.requestType} {c.payload} · {c.status}
                  {c.status === "COMPLETED" ? " (correction)" : ""} · score {c.score}
                </option>
              ))}
            </select>
            <div className="mt-1.5 text-[12px] text-muted-foreground">
              Higher score = stronger match. A COMPLETED candidate means re-attaching will issue a correction message instead of a fresh reply.
            </div>
            <button type="button" onClick={match} className={cn(buttonVariants(), "mt-3")}>
              Match to selected request
            </button>
          </>
        )}
      </div>
    </div>
  );
}
