import { useMemo, useState, type ReactNode } from "react";
import { SlidersHorizontal, Clock, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { postJson } from "@/lib/api";
import { useAdminData } from "./useAdminData";
import { relativeTime } from "../ops/format";
import { fmtElapsed, formatAbsoluteTime, requestImpact, REQ_STATUS_GROUPS, REQ_STATUS_LABELS, REQ_DATE_LABELS, QUEUE_TAB_STATUSES, withinDateRange } from "./format";
import type { AdminRequest, ReplyDraft } from "./types";

const IMPACT_BADGE: Record<string, string> = {
  warning: "text-[var(--warning)] border-[var(--warning)]/30 bg-[var(--warning)]/10",
  danger: "text-[var(--destructive)] border-[var(--destructive)]/30 bg-[var(--destructive)]/10",
  success: "text-[var(--success)] border-[var(--success)]/30 bg-[var(--success)]/10",
  info: "text-primary border-primary/30 bg-primary/10",
};

type Filters = { type: string; status: string; operator: string; channel: string; date: string; user: string };
const EMPTY_FILTERS: Filters = { type: "", status: "", operator: "", channel: "", date: "", user: "" };

function requestMatchesFilters(request: AdminRequest, reply: ReplyDraft | null, filters: Filters, search: string, exclude?: keyof Filters): boolean {
  if (search) {
    const haystack = `${request.requestId} ${request.requesterName} ${request.payload} ${request.requestType} ${reply?.replyText || ""}`.toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  if (exclude !== "user" && filters.user && request.requesterName !== filters.user) return false;
  if (exclude !== "type" && filters.type && request.requestType !== filters.type) return false;
  if (exclude !== "status" && filters.status) {
    const allowed = REQ_STATUS_GROUPS[filters.status] || [];
    if (!allowed.includes(request.status)) return false;
  }
  if (exclude !== "operator" && filters.operator) {
    const operators = (request.dispatches || []).map((d) => d.operator);
    if (!operators.includes(filters.operator)) return false;
  }
  if (exclude !== "channel" && filters.channel && (request.channel || "manual") !== filters.channel) return false;
  if (exclude !== "date" && filters.date && !withinDateRange(request.createdAt, filters.date)) return false;
  return true;
}

export function Approvals() {
  const { requests, replies, refresh } = useAdminData();
  const [search, setSearch] = useState("");
  const [queueTab, setQueueTab] = useState<"pending" | "resolved" | "archived">("pending");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [userSearch, setUserSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const replyByRequest = useMemo(() => new Map(replies.map((r) => [r.requestId, r])), [replies]);
  const allRows = useMemo(() => requests.map((request) => ({ request, reply: replyByRequest.get(request.requestId) || null })), [requests, replyByRequest]);

  const searchTerm = search.trim().toLowerCase();
  const tabStatuses = QUEUE_TAB_STATUSES[queueTab];
  const rows = useMemo(() => {
    let r = allRows.filter(({ request, reply }) => requestMatchesFilters(request, reply, filters, searchTerm));
    if (tabStatuses) r = r.filter(({ request }) => tabStatuses.includes(request.status));
    return r;
  }, [allRows, filters, searchTerm, tabStatuses]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const facetCount = (exclude: keyof Filters, matcher: (r: AdminRequest) => boolean) =>
    allRows.filter(({ request, reply }) => requestMatchesFilters(request, reply, filters, searchTerm, exclude) && matcher(request)).length;

  const selected = allRows.find(({ request }) => request.requestId === (selectedId || rows[0]?.request.requestId));

  const types = [...new Set(requests.map((r) => r.requestType).filter(Boolean))].sort();
  const users = [...new Set(requests.map((r) => r.requesterName).filter(Boolean))].sort();
  const visibleUsers = userSearch ? users.filter((u) => u.toLowerCase().includes(userSearch.toLowerCase())) : users;
  const operators = [...new Set(requests.flatMap((r) => (r.dispatches || []).map((d) => d.operator)).filter(Boolean))].sort();
  const channels = [...new Set(requests.map((r) => r.channel || "manual"))].sort();

  const setFilter = (key: keyof Filters, value: string) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight">Approvals Queue</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Pending reply drafts on the left, operational approval detail on the right.</p>
      </div>

      <div className={cn("grid gap-4", drawerOpen ? "lg:grid-cols-[220px_1.05fr_0.85fr]" : "lg:grid-cols-[1.35fr_0.95fr]")}>
        {drawerOpen && (
          <Card className="grid gap-3 self-start p-3.5 lg:sticky lg:top-4">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">Filters</span>
              <button
                type="button"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setUserSearch("");
                }}
                className="text-[11px] font-extrabold text-primary hover:underline"
              >
                Clear all
              </button>
            </div>

            <FilterGroup title="Request Type">
              <FilterOption label="All types" count={facetCount("type", () => true)} active={!filters.type} onClick={() => setFilter("type", "")} />
              {types.map((t) => (
                <FilterOption key={t} label={t} count={facetCount("type", (r) => r.requestType === t)} active={filters.type === t} onClick={() => setFilter("type", t)} />
              ))}
            </FilterGroup>

            <FilterGroup title="Requester">
              <input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search requesters…"
                className="mb-1.5 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] outline-none"
              />
              {!userSearch && <FilterOption label="All requesters" count={facetCount("user", () => true)} active={!filters.user} onClick={() => setFilter("user", "")} />}
              {visibleUsers.map((u) => (
                <FilterOption key={u} label={u} count={facetCount("user", (r) => r.requesterName === u)} active={filters.user === u} onClick={() => setFilter("user", u)} />
              ))}
            </FilterGroup>

            <FilterGroup title="Status">
              <FilterOption label="All statuses" count={facetCount("status", () => true)} active={!filters.status} onClick={() => setFilter("status", "")} />
              {Object.keys(REQ_STATUS_GROUPS).map((key) => (
                <FilterOption
                  key={key}
                  label={REQ_STATUS_LABELS[key]}
                  count={facetCount("status", (r) => REQ_STATUS_GROUPS[key].includes(r.status))}
                  active={filters.status === key}
                  onClick={() => setFilter("status", key)}
                />
              ))}
            </FilterGroup>

            <FilterGroup title="Operator">
              <FilterOption label="All operators" count={facetCount("operator", () => true)} active={!filters.operator} onClick={() => setFilter("operator", "")} />
              {operators.map((o) => (
                <FilterOption key={o} label={o} count={facetCount("operator", (r) => (r.dispatches || []).some((d) => d.operator === o))} active={filters.operator === o} onClick={() => setFilter("operator", o)} />
              ))}
            </FilterGroup>

            <FilterGroup title="Channel">
              <FilterOption label="All channels" count={facetCount("channel", () => true)} active={!filters.channel} onClick={() => setFilter("channel", "")} />
              {channels.map((c) => (
                <FilterOption key={c} label={c[0].toUpperCase() + c.slice(1)} count={facetCount("channel", (r) => (r.channel || "manual") === c)} active={filters.channel === c} onClick={() => setFilter("channel", c)} />
              ))}
            </FilterGroup>

            <FilterGroup title="Date" last>
              <FilterOption label="All time" count={facetCount("date", () => true)} active={!filters.date} onClick={() => setFilter("date", "")} />
              {Object.keys(REQ_DATE_LABELS).map((key) => (
                <FilterOption key={key} label={REQ_DATE_LABELS[key]} count={facetCount("date", (r) => withinDateRange(r.createdAt, key))} active={filters.date === key} onClick={() => setFilter("date", key)} />
              ))}
            </FilterGroup>
          </Card>
        )}

        <Card className="grid gap-0 self-start p-0">
          <div className="flex items-center justify-between gap-3 border-b border-border p-3.5">
            <div className="flex items-center gap-2 text-[14px] font-extrabold">
              <ShieldIconInline /> Approvals Queue
            </div>
            <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
              {(["pending", "resolved", "archived"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setQueueTab(tab);
                    setSelectedId(null);
                  }}
                  className={cn(
                    "rounded-md px-3 py-1 font-mono text-[11px] font-bold tracking-wide uppercase transition-colors",
                    queueTab === tab ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 border-b border-border p-3.5">
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-bold",
                drawerOpen || activeFilterCount ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground",
              )}
            >
              <SlidersHorizontal className="size-3.5" />
              Filter
              {activeFilterCount > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-extrabold text-primary-foreground">{activeFilterCount}</span>}
            </button>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ID, requester, payload…"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] outline-none"
            />
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {search || activeFilterCount ? `${rows.length} of ${allRows.length}` : rows.length}
            </span>
          </div>

          <div className="max-h-[720px] divide-y divide-border overflow-auto">
            {rows.map(({ request, reply }) => {
              const imp = requestImpact(request.status);
              const urgent = imp.tone === "warning" || imp.tone === "danger";
              const desc = reply?.replyText || request.payload;
              const isActive = (selectedId || rows[0]?.request.requestId) === request.requestId;
              return (
                <button
                  key={request.requestId}
                  type="button"
                  onClick={() => setSelectedId(request.requestId)}
                  className={cn("grid w-full gap-2.5 px-4 py-3.5 text-left transition-colors hover:bg-muted/40", isActive && "bg-primary/5")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded border border-border bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-bold text-muted-foreground">{request.requestId}</span>
                    <span className={cn("flex items-center gap-1 font-mono text-[12px] font-semibold text-muted-foreground", urgent && "text-[var(--warning)]")}>
                      <Clock className="size-3.5" />
                      {fmtElapsed(request.createdAt)}
                    </span>
                  </div>
                  <div>
                    <div className="text-[14.5px] font-extrabold">
                      {request.requestType} · {request.payload}
                    </div>
                    <div className="truncate text-[12.5px] text-muted-foreground">{desc}</div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-[12px] font-bold text-muted-foreground">
                      <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full border border-border bg-muted/50">
                        <User className="size-3.5" />
                      </span>
                      <span className="truncate">{request.requesterName}</span>
                    </span>
                    <span className={cn("shrink-0 rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide uppercase", IMPACT_BADGE[imp.tone])}>{imp.label}</span>
                  </div>
                </button>
              );
            })}
            {!rows.length && <div className="p-8 text-center text-[13px] text-muted-foreground">No requests in this queue.</div>}
          </div>
        </Card>

        <Card className="min-h-[620px] p-4.5">
          {selected ? (
            <RequestDetail request={selected.request} reply={selected.reply} onAction={refresh} />
          ) : (
            <div className="p-8 text-center text-[13px] text-muted-foreground">Select a request or draft to inspect details and act.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

function FilterGroup({ title, children, last }: { title: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={cn("grid gap-1", !last && "border-b border-border pb-2.5")}>
      <div className="px-1 py-1 text-[11px] font-extrabold tracking-wide text-foreground uppercase">{title}</div>
      {children}
    </div>
  );
}

function FilterOption({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors",
        active ? "bg-primary/10 font-bold text-primary" : "text-muted-foreground hover:bg-muted/40",
      )}
    >
      <span className="truncate">{label}</span>
      <span className={cn("shrink-0 text-[11px]", active ? "text-primary" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}

function ShieldIconInline() {
  return <span className="text-primary">◆</span>;
}

const ICON_TONE: Record<string, string> = {
  warning: "bg-[var(--warning)]/15 text-[var(--warning)]",
  danger: "bg-[var(--destructive)]/15 text-[var(--destructive)]",
  success: "bg-[var(--success)]/15 text-[var(--success)]",
  info: "bg-primary/15 text-primary",
};

function RequestDetail({ request, reply, onAction }: { request: AdminRequest; reply: ReplyDraft | null; onAction: () => void }) {
  const canApprove = reply && reply.sentStatus === "DRAFT" && request.status === "NEEDS_MANUAL_REVIEW";
  const canReject = request.status === "NEEDS_MANUAL_REVIEW";
  const canRetry = ["NEEDS_MANUAL_REVIEW", "FAILED", "TIMEOUT"].includes(request.status);
  const imp = requestImpact(request.status);
  const urgent = imp.tone === "warning" || imp.tone === "danger";
  const eyebrowTone = { danger: "text-[var(--destructive)]", warning: "text-[var(--warning)]", success: "text-[var(--success)]", info: "text-primary" }[imp.tone];
  const eyebrowText = canApprove ? "Operational approval required" : `${imp.label} · ${request.status.replaceAll("_", " ")}`;
  const dispatches = request.dispatches || [];

  const approve = async () => {
    await postJson(`/api/reply-drafts/${encodeURIComponent(request.requestId)}/approve`, {});
    await onAction();
  };
  const reject = async () => {
    const reason = window.prompt("Rejection reason (optional):");
    if (reason === null) return;
    await postJson(`/api/requests/${encodeURIComponent(request.requestId)}/reject`, { reason });
    await onAction();
  };
  const retry = async () => {
    await postJson(`/api/requests/${encodeURIComponent(request.requestId)}/retry`, {});
    await onAction();
  };

  return (
    <div className="grid gap-4.5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className={cn("font-mono text-[10px] font-bold tracking-wide uppercase", eyebrowTone)}>{eyebrowText}</div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">Created {formatAbsoluteTime(request.createdAt)}</div>
          <div className="mt-2.5 text-[22px] font-extrabold tracking-tight">
            {request.requestType} · {request.payload}
            <span className="mt-1 block font-mono text-[14px] font-bold text-muted-foreground">{request.requestId}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {canReject && (
            <button type="button" onClick={reject} className={cn(buttonVariants({ variant: "destructive" }))}>
              Deny
            </button>
          )}
          {canApprove && (
            <button type="button" onClick={approve} className={cn(buttonVariants())}>
              Approve
            </button>
          )}
          {canRetry && (
            <button type="button" onClick={retry} className={cn(buttonVariants({ variant: "outline" }))}>
              Retry
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-2.5 rounded-xl border border-border bg-card p-3.5">
          <div className="font-mono text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Requested by</div>
          <div className="flex items-center gap-2.5">
            <span className={cn("flex size-8 items-center justify-center rounded-lg", ICON_TONE.info)}>
              <User className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-extrabold">{request.requesterName}</div>
              <div className="text-[11px] text-muted-foreground">{request.channel || "manual"} channel</div>
            </div>
          </div>
        </div>
        <div className="grid gap-2.5 rounded-xl border border-border bg-card p-3.5">
          <div className="font-mono text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Impact analysis</div>
          <div className="flex items-center gap-2.5">
            <span className={cn("flex size-8 items-center justify-center rounded-lg", ICON_TONE[imp.tone])}>●</span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-extrabold">{imp.crit}</div>
              <div className="text-[11px] text-muted-foreground">{imp.critSub}</div>
            </div>
          </div>
        </div>
        <div className="grid gap-2.5 rounded-xl border border-border bg-card p-3.5">
          <div className="font-mono text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Time in review</div>
          <div className={cn("font-mono text-[19px] font-bold", urgent && "text-[var(--warning)]")}>{fmtElapsed(request.createdAt)}</div>
          <div className="text-[11px] text-muted-foreground">{urgent ? "Action needed" : "Within normal window"}</div>
        </div>
      </div>

      <div className="grid gap-3.5">
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
            <span className="text-[12px] font-extrabold">Reply Draft</span>
            <span className="font-mono text-[11px] text-muted-foreground">{reply ? reply.sentStatus : "none"}</span>
          </div>
          {reply ? (
            <div className="p-3.5 font-mono text-[12px]">{reply.replyText}</div>
          ) : (
            <div className="p-3.5 text-[12px] text-muted-foreground">No reply draft yet. The operator has not responded.</div>
          )}
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
            <span className="text-[12px] font-extrabold">Linked Operational Signals</span>
            <span className="font-mono text-[11px] text-muted-foreground">{dispatches.length} total</span>
          </div>
          {dispatches.length ? (
            <div className="divide-y divide-border">
              {dispatches.map((d, i) => {
                const meta = [d.gatewayId, d.shortcode ? `→ ${d.shortcode}` : "", d.sentAt ? relativeTime(d.sentAt) : ""].filter(Boolean).join(" · ");
                return (
                  <div key={i} className="p-3.5 font-mono text-[12px]">
                    <div className="font-semibold text-primary">
                      [{d.operator || "OP"}] {(d.status || d.sentStatus || "dispatch").toString().replaceAll("_", " ")}
                    </div>
                    <div className="mt-1 text-muted-foreground">{meta || "Queued"}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-3.5 text-[12px] text-muted-foreground">No dispatch signals recorded yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
