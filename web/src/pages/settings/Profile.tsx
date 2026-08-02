import { useState, type FormEvent } from "react";
import { SettingsPage, FormResult } from "@/components/settings/SettingsPage";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { postJson } from "@/lib/api";

export function Profile() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [result, setResult] = useState<{ message: string; isError: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      await postJson("/api/auth/change-password", { currentPassword, newPassword });
      setResult({ message: "Password changed.", isError: false });
      setCurrentPassword("");
      setNewPassword("");
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : "Failed to change password.", isError: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SettingsPage title="Profile" description="Change your own login password. Requires your current password.">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change password</CardTitle>
          <CardDescription>Applies to your own account only.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newPassword">New password (min 8 characters)</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={submitting} className={cn(buttonVariants(), "w-fit")}>
                {submitting ? "Changing…" : "Change password"}
              </button>
              <FormResult message={result?.message ?? null} isError={result?.isError} />
            </div>
          </form>
        </CardContent>
      </Card>
    </SettingsPage>
  );
}
