import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiFetch, postJson } from "@/lib/api";
import { useAdminData } from "./useAdminData";
import { relativeTime } from "../ops/format";

type PhoneMessage = { address?: string; from?: string; date?: string; receivedAt?: string; body?: string };
type PhoneDump = { receivedAt: string; messages: PhoneMessage[] };

export function PhoneInbox() {
  const { overview } = useAdminData();
  const gateways = overview?.gatewayHealth || [];
  const [gatewayId, setGatewayId] = useState("");
  const [status, setStatus] = useState("");
  const [dump, setDump] = useState<PhoneDump | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!gatewayId && gateways.length) setGatewayId(gateways[0].id);
  }, [gateways, gatewayId]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const fetchDump = async (id: string): Promise<PhoneDump | null> => {
    try {
      const res = await apiFetch(`/api/admin/gateways/${encodeURIComponent(id)}/inbox`);
      return ((await res.json()) as { dump?: PhoneDump }).dump || null;
    } catch {
      return null;
    }
  };

  const refresh = async () => {
    if (!gatewayId) {
      setStatus("No gateway selected.");
      return;
    }
    const d = await fetchDump(gatewayId);
    if (!d) {
      setStatus('No inbox captured yet — click "Request live inbox".');
      setDump(null);
      return;
    }
    setDump(d);
    setStatus(`Last captured ${relativeTime(d.receivedAt)} · ${d.messages.length} message(s).`);
  };

  const requestInbox = async () => {
    if (!gatewayId) {
      setStatus("No gateway selected.");
      return;
    }
    setStatus(`Requesting inbox from ${gatewayId}… waiting for the phone to poll (a few seconds).`);
    const before = (await fetchDump(gatewayId))?.receivedAt || null;
    try {
      await postJson(`/api/admin/gateways/${encodeURIComponent(gatewayId)}/request-inbox`, { limit: 50 });
    } catch (error) {
      setStatus(`Request failed: ${error instanceof Error ? error.message : error}`);
      return;
    }
    let tries = 0;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      tries += 1;
      const d = await fetchDump(gatewayId);
      if (d && d.receivedAt !== before) {
        if (pollRef.current) clearInterval(pollRef.current);
        setDump(d);
        setStatus(`Received ${d.messages.length} message(s) ${relativeTime(d.receivedAt)}.`);
      } else if (tries > 20) {
        if (pollRef.current) clearInterval(pollRef.current);
        setStatus("No response yet — the phone may be offline, slow to poll, or on an app version without inbox support. Try Refresh shortly.");
      }
    }, 2000);
  };

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight">Phone Inbox</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Read a gateway phone's live SMS inbox on demand — check errors without the physical phone. The phone returns its inbox on its next poll (a few seconds).
        </p>
      </div>

      <Card className="grid gap-3.5 p-4.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <select value={gatewayId} onChange={(e) => setGatewayId(e.target.value)} className="max-w-[280px] rounded-lg border border-border bg-background px-3 py-1.5 text-[13px]">
            {gateways.map((g) => (
              <option key={g.id} value={g.id}>
                {g.operatorName || g.operator} · {g.id}
              </option>
            ))}
          </select>
          <button type="button" onClick={requestInbox} className={cn(buttonVariants())}>
            Request live inbox
          </button>
          <button type="button" onClick={refresh} className={cn(buttonVariants({ variant: "outline" }))}>
            Refresh
          </button>
          <span className="text-[12px] text-muted-foreground">{status}</span>
        </div>

        <div className="max-h-[600px] divide-y divide-border overflow-auto rounded-xl border border-border">
          {(dump?.messages || []).map((m, i) => (
            <div key={i} className="p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[13px] font-extrabold">{m.address || m.from || "unknown sender"}</div>
                <span className="text-[12px] text-muted-foreground">{m.date || m.receivedAt || ""}</span>
              </div>
              <div className="mt-1 text-[12px] whitespace-pre-wrap text-muted-foreground">{m.body || ""}</div>
            </div>
          ))}
          {!(dump?.messages || []).length && <div className="p-8 text-center text-[13px] text-muted-foreground">Phone inbox is empty.</div>}
        </div>
      </Card>
    </div>
  );
}
