import { SettingsPage } from "@/components/settings/SettingsPage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function Release() {
  return (
    <SettingsPage title="Release" description="Keep high-risk actions visually isolated from daily review work.">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">APK publishing</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-start gap-2 rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 p-3 text-[13px]">
            <Badge variant="outline" className="border-[color:var(--warning)]/40 text-[color:var(--warning)]">
              Controlled
            </Badge>
            <span>APK publishing remains controlled through the existing admin release flow and backend endpoint.</span>
          </div>
          <div className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
            <div>
              Use <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">/api/app/publish-apk</code> for OTA release publication.
            </div>
            <div>Use this console for provisioning, review, exception handling, and audit supervision.</div>
          </div>
        </CardContent>
      </Card>
    </SettingsPage>
  );
}
