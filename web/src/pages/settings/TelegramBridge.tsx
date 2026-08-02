import { useEffect, useState, type FormEvent } from "react";
import { SettingsPage, FormResult } from "@/components/settings/SettingsPage";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiFetch, postJson } from "@/lib/api";

type AuthorizedUser = { telegramUserId: string; name: string };
type SettingsData = {
  telegramGroupChatId?: string;
  operators?: Record<string, { shortcode?: string }>;
  authorizedUsers?: AuthorizedUser[];
};

const OPERATORS = [
  { id: "GP", label: "GP", cls: "op-gp" },
  { id: "ROBI", label: "Robi", cls: "op-robi" },
  { id: "BANGLALINK", label: "Banglalink", cls: "op-banglalink" },
] as const;

export function TelegramBridge() {
  const [groupChatId, setGroupChatId] = useState("");
  const [operator, setOperator] = useState("GP");
  const [shortcode, setShortcode] = useState("");
  const [authorizedUsers, setAuthorizedUsers] = useState<AuthorizedUser[]>([]);
  const [newUserId, setNewUserId] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [result, setResult] = useState<{ message: string; isError: boolean } | null>(null);

  const load = async () => {
    const res = await apiFetch("/api/admin/settings");
    if (!res.ok) return;
    const data = (await res.json()) as SettingsData;
    setGroupChatId(data.telegramGroupChatId || "");
    setShortcode(data.operators?.[operator]?.shortcode || "");
    setAuthorizedUsers(data.authorizedUsers || []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operator]);

  const saveGroup = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const body = await postJson<{ note?: string }>("/api/admin/settings/telegram-group", { groupChatId });
      setResult({ message: `Saved. ${body.note || ""}`, isError: false });
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : "Failed to update group chat ID.", isError: true });
    }
  };

  const saveOperator = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const body = await postJson<{ operator: string }>("/api/admin/settings/operator-contact", { operator, shortcode });
      setResult({ message: `Saved ${body.operator} hotline number — applied immediately.`, isError: false });
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : "Failed to update operator number.", isError: true });
    }
  };

  const addUser = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const body = await postJson<{ name: string; note?: string }>("/api/admin/settings/authorized-users", {
        telegramUserId: newUserId,
        name: newUserName,
      });
      setResult({ message: `Added ${body.name}. ${body.note || ""}`, isError: false });
      setNewUserId("");
      setNewUserName("");
      await load();
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : "Failed to add authorized user.", isError: true });
    }
  };

  const removeUser = async (telegramUserId: string) => {
    try {
      await postJson("/api/admin/settings/authorized-users/remove", { telegramUserId });
      setResult({ message: `Removed ${telegramUserId}. Restart the Telegram bridge for this to take effect.`, isError: false });
      await load();
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : "Failed to remove authorized user.", isError: true });
    }
  };

  return (
    <SettingsPage
      title="Telegram Bridge"
      description="Runtime configuration for the group chat, operator hotline numbers, and private-DM authorization."
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Group chat</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveGroup} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="groupChatId">Telegram group chat ID</Label>
              <Input id="groupChatId" placeholder="-1004316326579" value={groupChatId} onChange={(e) => setGroupChatId(e.target.value)} />
              <p className="text-[12px] text-muted-foreground">Restart the Telegram bridge process after changing this — it reads this once at startup.</p>
            </div>
            <button type="submit" className={cn(buttonVariants(), "w-fit")}>Save group chat ID</button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operator hotline numbers</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveOperator} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Operator</Label>
              <div className="flex gap-2" role="tablist" aria-label="Operator">
                {OPERATORS.map((op) => {
                  const active = operator === op.id;
                  return (
                    <button
                      key={op.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setOperator(op.id)}
                      className={cn(
                        "operator-tab flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition-colors",
                        op.cls,
                        active ? "is-active bg-muted" : "border-border text-muted-foreground",
                      )}
                    >
                      <span className={cn("operator-dot size-2 rounded-full", op.cls)} />
                      {op.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shortcode">Hotline / shortcode number</Label>
              <Input id="shortcode" placeholder="01714054239" value={shortcode} onChange={(e) => setShortcode(e.target.value)} />
              <p className="text-[12px] text-muted-foreground">Applies immediately to this backend — no restart needed.</p>
            </div>
            <button type="submit" className={cn(buttonVariants({ variant: "outline" }), "w-fit")}>Save operator number</button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Authorized Telegram users</CardTitle>
          <CardDescription>Gates the private-DM intake. Group membership still gates the group unless an allowlist is set there too.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {authorizedUsers.length ? (
              authorizedUsers.map((user) => (
                <div key={user.telegramUserId} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="font-mono text-[12.5px]">
                    {user.telegramUserId} &mdash; {user.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeUser(user.telegramUserId)}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <div className="px-3 py-4 text-[13px] text-muted-foreground">
                No authorized users yet — group is open to any member, private DMs are closed to everyone.
              </div>
            )}
          </div>
          <form onSubmit={addUser} className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newUserId">Telegram user ID</Label>
              <Input id="newUserId" placeholder="777888999" value={newUserId} onChange={(e) => setNewUserId(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newUserName">Display name</Label>
              <Input id="newUserName" placeholder="Officer Rahim" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} />
            </div>
            <button type="submit" className={cn(buttonVariants({ variant: "outline" }), "w-fit")}>Add authorized user</button>
            <p className="text-[12px] text-muted-foreground">
              Get a user's numeric ID via @userinfobot on Telegram, not their @username. Restart the bridge after adding/removing.
            </p>
          </form>
        </CardContent>
      </Card>

      <FormResult message={result?.message ?? null} isError={result?.isError} />
    </SettingsPage>
  );
}
