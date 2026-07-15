import { useEffect, useRef, useState, type FormEvent } from "react";
import { SettingsPage, FormResult } from "@/components/settings/SettingsPage";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiFetch, getJson, postJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type RegistryRecord = { id: string; name: string; designation?: string; unit?: string; phone: string; email: string };

export function PersonnelRegistry() {
  const { isSuperAdmin } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<RegistryRecord[]>([]);
  const [count, setCount] = useState(0);
  const [result, setResult] = useState<{ message: string; isError: boolean } | null>(null);
  const [addForm, setAddForm] = useState({ name: "", designation: "", unit: "", phone: "", email: "" });

  const load = async () => {
    const data = await getJson<{ records: RegistryRecord[]; count: number }>("/api/admin/personnel-registry");
    setRecords(data.records);
    setCount(data.count);
  };

  useEffect(() => {
    load();
  }, []);

  const onImport = async (event: FormEvent) => {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setResult({ message: "Choose a .xlsx file first.", isError: true });
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const res = await apiFetch("/api/admin/personnel-registry/import", { method: "POST", body: buffer });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed.");
      setResult({ message: `Imported ${data.count} record(s) — roster replaced.`, isError: false });
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : "Import failed.", isError: true });
    }
  };

  const onAdd = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const body = await postJson<{ record: RegistryRecord }>("/api/admin/personnel-registry/add", addForm);
      setResult({ message: `Added ${body.record.name} to the registry.`, isError: false });
      setAddForm({ name: "", designation: "", unit: "", phone: "", email: "" });
      await load();
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : "Failed to add record.", isError: true });
    }
  };

  return (
    <SettingsPage
      title="Personnel Registry"
      description="The roster registration is validated against — phone + email must match a record here."
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bulk import</CardTitle>
          <CardDescription>Re-importing replaces the entire roster — the file should contain everyone, not just changes.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onImport} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="registryFile">Roster spreadsheet (.xlsx)</Label>
              <Input id="registryFile" ref={fileInputRef} type="file" accept=".xlsx" />
            </div>
            <button type="submit" className={cn(buttonVariants(), "w-fit")}>Import spreadsheet</button>
          </form>
        </CardContent>
      </Card>

      {isSuperAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add one officer</CardTitle>
            <CardDescription>Without a full re-import. Super-admin only.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onAdd} className="grid grid-cols-2 gap-4">
              {(["name", "designation", "unit", "phone", "email"] as const).map((field) => (
                <div key={field} className="flex flex-col gap-1.5 first:col-span-2">
                  <Label htmlFor={field} className="capitalize">{field}</Label>
                  <Input
                    id={field}
                    required={field !== "designation" && field !== "unit"}
                    type={field === "email" ? "email" : "text"}
                    value={addForm[field]}
                    onChange={(e) => setAddForm((f) => ({ ...f, [field]: e.target.value }))}
                  />
                </div>
              ))}
              <button type="submit" className={cn(buttonVariants({ variant: "outline" }), "col-span-2 w-fit")}>
                Add to registry
              </button>
            </form>
          </CardContent>
        </Card>
      )}

      <FormResult message={result?.message ?? null} isError={result?.isError} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current roster ({count})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col divide-y divide-border">
            {records.map((r) => (
              <div key={r.id} className="py-2 text-[12.5px]">
                <span className="font-semibold">{r.name}</span>{" "}
                <span className="text-muted-foreground">
                  {[r.designation, r.unit].filter(Boolean).join(", ")} &middot; {r.phone} &middot; {r.email}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </SettingsPage>
  );
}
