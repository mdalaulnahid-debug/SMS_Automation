import { useEffect, useState, type FormEvent } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiFetch, postJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { TeamUser, Invite } from "./types";

function Result({ text, isError }: { text: string | null; isError?: boolean }) {
  if (!text) return null;
  return <p className={cn("text-[12.5px]", isError ? "text-[var(--destructive)]" : "text-[var(--success)]")}>{text}</p>;
}

export function Team() {
  const { user } = useAuth();

  const [gateUrl, setGateUrl] = useState("");
  const [gateResult, setGateResult] = useState<{ text: string; isError: boolean } | null>(null);

  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteForm, setInviteForm] = useState({ email: "", name: "", phone: "", designation: "", unit: "", role: "admin" });
  const [inviteResult, setInviteResult] = useState<{ text: string; isError: boolean; link?: string } | null>(null);

  const [directForm, setDirectForm] = useState({ email: "", name: "", phone: "", designation: "", unit: "", role: "admin", password: "" });
  const [directResult, setDirectResult] = useState<{ text: string; isError: boolean } | null>(null);

  const [users, setUsers] = useState<TeamUser[]>([]);
  const [teamResult, setTeamResult] = useState<{ text: string; isError: boolean } | null>(null);

  const loadGateUrl = async () => {
    const res = await apiFetch("/api/admin/super-admin-gate");
    if (!res.ok) return;
    setGateUrl(((await res.json()) as { url: string }).url);
  };
  const loadInvites = async () => {
    const res = await apiFetch("/api/admin/invites");
    if (!res.ok) return;
    setInvites(((await res.json()) as { invites: Invite[] }).invites || []);
  };
  const loadTeam = async () => {
    const res = await apiFetch("/api/admin/users");
    if (!res.ok) return;
    setUsers(((await res.json()) as { users: TeamUser[] }).users || []);
  };

  useEffect(() => {
    loadGateUrl();
    loadInvites();
    loadTeam();
  }, []);

  const copyGateUrl = async () => {
    try {
      await navigator.clipboard.writeText(gateUrl);
      setGateResult({ text: "Copied.", isError: false });
    } catch {
      setGateResult({ text: "Could not copy — select and copy manually.", isError: true });
    }
  };

  const rotateGateUrl = async () => {
    if (!confirm("Rotate the super-admin sign-in URL? The current link stops working immediately.")) return;
    try {
      const body = await postJson<{ url: string }>("/api/admin/super-admin-gate/regenerate", {});
      setGateUrl(body.url);
      setGateResult({ text: "URL rotated. The old link no longer works.", isError: false });
    } catch (error) {
      setGateResult({ text: error instanceof Error ? error.message : "Failed to rotate the URL.", isError: true });
    }
  };

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const body = await postJson<{ registrationLink: string }>("/api/admin/invites", inviteForm);
      setInviteResult({ text: "Invite created. Send this link:", isError: false, link: body.registrationLink });
      setInviteForm({ email: "", name: "", phone: "", designation: "", unit: "", role: "admin" });
      await loadInvites();
    } catch (error) {
      setInviteResult({ text: error instanceof Error ? error.message : "Failed to create invite.", isError: true });
    }
  };

  const submitDirect = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const body = await postJson<{ email: string }>("/api/admin/accounts", directForm);
      setDirectResult({ text: `Account created for ${body.email}.`, isError: false });
      setDirectForm({ email: "", name: "", phone: "", designation: "", unit: "", role: "admin", password: "" });
      await loadTeam();
    } catch (error) {
      setDirectResult({ text: error instanceof Error ? error.message : "Failed to create account.", isError: true });
    }
  };

  const changeRole = async (userId: string, newRole: "officer" | "admin") => {
    try {
      await postJson(`/api/admin/users/${encodeURIComponent(userId)}/role`, { role: newRole });
      setTeamResult({ text: `Role updated to ${newRole}.`, isError: false });
      await loadTeam();
    } catch (error) {
      setTeamResult({ text: error instanceof Error ? error.message : "Failed to update role.", isError: true });
    }
  };

  const pendingInvites = invites.filter((i) => !i.consumed_at && new Date(i.expires_at).getTime() > Date.now());

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight">Team</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Website access is admin/super-admin only, invite-only. Create an account directly, or send an invite link for someone to complete themselves. Super-admin only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Super-admin sign-in URL</CardTitle>
          <CardDescription>Super-admin accounts can only sign in through this hidden URL — never through the normal sign-in page. Keep it private; rotating it invalidates the old link immediately.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 font-mono text-[12.5px] break-all">{gateUrl}</div>
          <div className="flex gap-2">
            <button type="button" onClick={copyGateUrl} className={cn(buttonVariants({ variant: "outline" }))}>Copy</button>
            <button type="button" onClick={rotateGateUrl} className={cn(buttonVariants({ variant: "outline" }))}>Rotate URL</button>
          </div>
          <Result text={gateResult?.text ?? null} isError={gateResult?.isError} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite a new admin</CardTitle>
          <CardDescription>Generates a one-time registration link (valid 7 days) — copy it and hand it to them yourself.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form onSubmit={submitInvite} className="grid gap-3">
            <Input type="email" placeholder="Email" required value={inviteForm.email} onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))} />
            <Input type="text" placeholder="Full name" required value={inviteForm.name} onChange={(e) => setInviteForm((f) => ({ ...f, name: e.target.value }))} />
            <Input type="tel" placeholder="Phone (optional)" value={inviteForm.phone} onChange={(e) => setInviteForm((f) => ({ ...f, phone: e.target.value }))} />
            <Input type="text" placeholder="Designation (optional)" value={inviteForm.designation} onChange={(e) => setInviteForm((f) => ({ ...f, designation: e.target.value }))} />
            <Input type="text" placeholder="Unit (optional)" value={inviteForm.unit} onChange={(e) => setInviteForm((f) => ({ ...f, unit: e.target.value }))} />
            <select value={inviteForm.role} onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value }))} className="rounded-lg border border-border bg-background px-3 py-2 text-[13px]">
              <option value="admin">admin</option>
              <option value="super_admin">super_admin</option>
            </select>
            <button type="submit" className={cn(buttonVariants(), "w-fit")}>Generate invite link</button>
          </form>
          {inviteResult && (
            <div className={cn("text-[12.5px]", inviteResult.isError ? "text-[var(--destructive)]" : "text-[var(--success)]")}>
              {inviteResult.text}
              {inviteResult.link && <div className="mt-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-[12px] break-all select-all">{inviteResult.link}</div>}
            </div>
          )}
          <div className="grid gap-2 border-t border-border pt-3">
            {pendingInvites.length ? (
              pendingInvites.map((invite) => (
                <div key={invite.email} className="flex items-center justify-between gap-2 border-b border-border py-2 text-[13px] last:border-0">
                  <span>{invite.name || invite.email}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {invite.email} · {invite.role} · expires {new Date(invite.expires_at).toLocaleDateString()}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-[13px] text-muted-foreground">No pending invites.</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create account directly</CardTitle>
          <CardDescription>No invite round trip — the account is active immediately with the password you set here. Hand it to them out of band.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitDirect} className="grid gap-3">
            <Input type="email" placeholder="Email" required value={directForm.email} onChange={(e) => setDirectForm((f) => ({ ...f, email: e.target.value }))} />
            <Input type="text" placeholder="Full name" required value={directForm.name} onChange={(e) => setDirectForm((f) => ({ ...f, name: e.target.value }))} />
            <Input type="tel" placeholder="Phone (optional)" value={directForm.phone} onChange={(e) => setDirectForm((f) => ({ ...f, phone: e.target.value }))} />
            <Input type="text" placeholder="Designation (optional)" value={directForm.designation} onChange={(e) => setDirectForm((f) => ({ ...f, designation: e.target.value }))} />
            <Input type="text" placeholder="Unit (optional)" value={directForm.unit} onChange={(e) => setDirectForm((f) => ({ ...f, unit: e.target.value }))} />
            <select value={directForm.role} onChange={(e) => setDirectForm((f) => ({ ...f, role: e.target.value }))} className="rounded-lg border border-border bg-background px-3 py-2 text-[13px]">
              <option value="admin">admin</option>
              <option value="super_admin">super_admin</option>
            </select>
            <Input type="password" placeholder="Password (min 8 characters)" required minLength={8} value={directForm.password} onChange={(e) => setDirectForm((f) => ({ ...f, password: e.target.value }))} />
            <button type="submit" className={cn(buttonVariants(), "w-fit")}>Create account</button>
          </form>
          <Result text={directResult?.text ?? null} isError={directResult?.isError} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Existing accounts</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Result text={teamResult?.text ?? null} isError={teamResult?.isError} />
          {users.length ? (
            users.map((u) => {
              const isSelf = u.id === user?.id;
              const roleTone = u.role === "super_admin" ? "text-primary" : u.role === "admin" ? "text-primary" : "text-muted-foreground";
              return (
                <div key={u.id} className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-[13px] last:border-0">
                  <div>
                    <div>
                      {u.name} {isSelf && <span className="font-mono text-[11px] text-muted-foreground">(you)</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {u.email} · <span className={roleTone}>{u.role}</span> · {u.status}
                    </div>
                  </div>
                  {!isSelf && u.role !== "super_admin" && (
                    <button
                      type="button"
                      onClick={() => changeRole(u.id, u.role === "officer" ? "admin" : "officer")}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      {u.role === "officer" ? "Promote to admin" : "Demote to officer"}
                    </button>
                  )}
                </div>
              );
            })
          ) : (
            <div className="text-[13px] text-muted-foreground">No accounts yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
