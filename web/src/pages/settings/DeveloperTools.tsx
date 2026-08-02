import { useState, type FormEvent } from "react";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { postJson } from "@/lib/api";

export function DeveloperTools() {
  const [requestForm, setRequestForm] = useState({
    requesterName: "Officer Rahim",
    requesterId: "8801700000000",
    chatId: "operations-group",
    text: "LRL 01712345678",
  });
  const [smsForm, setSmsForm] = useState({ gatewayId: "GP_PHONE_01", from: "12345", body: "LRL cell location" });
  const [result, setResult] = useState<{ message: string; isError: boolean } | null>(null);

  const submitRequest = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await postJson("/api/requests", requestForm);
      setResult({ message: "Request queued and dispatched.", isError: false });
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : "Failed to queue request.", isError: true });
    }
  };

  const submitSms = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await postJson("/api/sms/inbound", smsForm);
      setResult({ message: "Inbound reply injected.", isError: false });
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : "Failed to inject reply.", isError: true });
    }
  };

  return (
    <SettingsPage
      title="Developer Tools"
      description="Generate requests and simulated replies without leaving the command center. Deliberately kept separate from production configuration."
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Controlled Backend Tests</CardTitle>
          <CardDescription>Queue a real test request against the live backend.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitRequest} className="flex flex-col gap-4">
            {(
              [
                ["requesterName", "Requester name"],
                ["requesterId", "Requester Telegram ID"],
                ["chatId", "Chat ID"],
              ] as const
            ).map(([field, label]) => (
              <div key={field} className="flex flex-col gap-1.5">
                <Label htmlFor={field}>{label}</Label>
                <Input
                  id={field}
                  value={requestForm[field]}
                  onChange={(e) => setRequestForm((f) => ({ ...f, [field]: e.target.value }))}
                />
              </div>
            ))}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="text">Request text</Label>
              <textarea
                id="text"
                className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                value={requestForm.text}
                onChange={(e) => setRequestForm((f) => ({ ...f, text: e.target.value }))}
              />
            </div>
            <button type="submit" className={cn(buttonVariants(), "w-fit")}>Queue and dispatch</button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inject inbound reply</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitSms} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gatewayId">Gateway ID</Label>
              <Input id="gatewayId" value={smsForm.gatewayId} onChange={(e) => setSmsForm((f) => ({ ...f, gatewayId: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="from">From shortcode</Label>
              <Input id="from" value={smsForm.from} onChange={(e) => setSmsForm((f) => ({ ...f, from: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="smsBody">SMS body</Label>
              <textarea
                id="smsBody"
                className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                value={smsForm.body}
                onChange={(e) => setSmsForm((f) => ({ ...f, body: e.target.value }))}
              />
            </div>
            <button type="submit" className={cn(buttonVariants({ variant: "outline" }), "w-fit")}>Inject inbound reply</button>
          </form>
        </CardContent>
      </Card>

      {result && (
        <p className={cn("text-[13px]", result.isError ? "text-destructive" : "text-[color:var(--success)]")}>
          {result.message}
        </p>
      )}
    </SettingsPage>
  );
}
