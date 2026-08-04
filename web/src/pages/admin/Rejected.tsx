import { useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAdminData } from "./useAdminData";
import { relativeTime } from "../ops/format";
import { formatAbsoluteTime } from "./format";

export function Rejected() {
  const { rejected } = useAdminData();
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const rows = rejected.filter((item) => {
    if (!search) return true;
    return `${item.requesterName || ""} ${item.rawText || ""}`.toLowerCase().includes(search.toLowerCase());
  });
  const activeIndex = selectedIndex !== null && rows[selectedIndex] ? selectedIndex : rows.length ? 0 : null;
  const selected = activeIndex !== null ? rows[activeIndex] : null;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight">Rejected Messages</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Every message in the group that wasn't a valid formatted request, with the exact text that was rejected — not subject to the audit feed's row limit.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.95fr]">
        <Card className="grid gap-0 self-start p-0">
          <div className="border-b border-border p-3.5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search requester or rejected text…"
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] outline-none"
            />
          </div>
          <div className="max-h-[720px] divide-y divide-border overflow-auto">
            {rows.map((item, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setSelectedIndex(index)}
                className={cn(
                  "grid w-full gap-1.5 border-l-[3px] px-4 py-3 text-left transition-colors hover:bg-muted/40",
                  activeIndex === index ? "border-l-[var(--destructive)] bg-primary/5" : "border-l-transparent",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[13px] font-extrabold">{item.requesterName || "Unknown sender"}</div>
                    <div className="mt-0.5 font-mono text-[12px] text-muted-foreground">
                      {item.errorCode || ""} · {relativeTime(item.timestamp)}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--destructive)]/15 px-2 py-0.5 text-[10px] font-extrabold text-[var(--destructive)]">Rejected</span>
                </div>
                <div className="truncate font-mono text-[12px] text-muted-foreground">{(item.rawText || "").slice(0, 140)}</div>
              </button>
            ))}
            {!rows.length && <div className="p-8 text-center text-[13px] text-muted-foreground">No rejected messages.</div>}
          </div>
        </Card>

        <Card className="min-h-[620px] p-4.5">
          {selected ? (
            <div className="grid gap-4">
              <div className="text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">Rejected — {selected.errorCode || ""}</div>
              <div className="text-[22px] font-extrabold tracking-tight">{selected.requesterName || "Unknown sender"}</div>
              <div className="border-t border-border pt-3.5">
                <div className="text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">Full original text</div>
                <div className="mt-2 rounded-xl border border-border bg-card p-3.5 font-mono text-[12px] whitespace-pre-wrap">{selected.rawText || ""}</div>
              </div>
              <div className="border-t border-border pt-3.5">
                <div className="text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">Metadata</div>
                <div className="mt-2 text-[13px]">
                  Chat {selected.chatId || "n/a"} · {formatAbsoluteTime(selected.timestamp)}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-[13px] text-muted-foreground">Select a rejected message to see its full original text.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
