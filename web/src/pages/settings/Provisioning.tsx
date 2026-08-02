import { useState, type FormEvent } from "react";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { postJson } from "@/lib/api";

const GATEWAYS = ["GP_PHONE_01", "ROBI_PHONE_01", "BANGLALINK_PHONE_01"];

export function Provisioning() {
  const [gwId, setGwId] = useState(GATEWAYS[0]);
  const [url, setUrl] = useState(window.location.origin);
  const [pin, setPin] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<{ dataUrl: string; payload: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const onGenerate = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setQr(null);
    if (!gwId || !url || !pin) {
      setError("Gateway ID, backend URL, and PIN are required.");
      return;
    }
    try {
      const data = await postJson<{ dataUrl: string; payload: string }>("/api/admin/generate-qr", { gwId, url, pin, secret });
      setQr(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate QR code.");
    }
  };

  const onCopy = () => {
    if (!qr) return;
    navigator.clipboard.writeText(qr.payload).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <SettingsPage title="Provisioning" description="Generate a constrained setup payload for a device runtime phone.">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provision Gateway</CardTitle>
          <CardDescription>Device setup — admin/super-admin only.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onGenerate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gwId">Gateway ID</Label>
              <select
                id="gwId"
                value={gwId}
                onChange={(e) => setGwId(e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {GATEWAYS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provUrl">Backend URL</Label>
              <Input id="provUrl" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provPin">Admin PIN</Label>
              <Input id="provPin" type="password" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provSecret">Gateway secret</Label>
              <Input id="provSecret" value={secret} onChange={(e) => setSecret(e.target.value)} />
            </div>
            <button type="submit" className={cn(buttonVariants(), "w-fit")}>Generate provisioning QR</button>
            {error && <p className="text-[13px] text-destructive">{error}</p>}
            {qr && (
              <div className="flex flex-col items-start gap-3 rounded-lg border border-border p-4">
                <img src={qr.dataUrl} alt="Provisioning QR" className="size-44" />
                <button type="button" onClick={onCopy} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  {copied ? "Copied" : "Copy payload"}
                </button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </SettingsPage>
  );
}
