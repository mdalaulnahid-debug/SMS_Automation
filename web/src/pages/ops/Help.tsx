import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

const COMMANDS = [
  { command: "LRL", identifier: "Mobile number", example: "LRL 01710000000" },
  { command: "LCL", identifier: "Mobile number", example: "LCL 01710000000" },
  { command: "MS-NID", identifier: "National ID (10/13/17 digits)", example: "MS-NID 1234567890123" },
  { command: "NID-MS", identifier: "Mobile number", example: "NID-MS 01710000000" },
  { command: "IMEI-MS", identifier: "IMEI (14/15 digits)", example: "IMEI-MS 353097824292150" },
];

export function Help() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Help</CardTitle>
        <CardDescription>Submitting a request via Telegram</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          Send a message to the Telegram bot in the operations group (or by DM, if authorized) using one of the
          commands below, followed by one or more identifiers separated by spaces. Up to 5 identifiers per message.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="border-b border-border px-3 py-2.5 text-left text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">Command</th>
                <th className="border-b border-border px-3 py-2.5 text-left text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">Identifier</th>
                <th className="border-b border-border px-3 py-2.5 text-left text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">Example</th>
              </tr>
            </thead>
            <tbody>
              {COMMANDS.map((row) => (
                <tr key={row.command}>
                  <td className="border-b border-border px-3 py-2.5 align-top"><code className="font-mono text-primary">{row.command}</code></td>
                  <td className="border-b border-border px-3 py-2.5 align-top">{row.identifier}</td>
                  <td className="border-b border-border px-3 py-2.5 align-top"><code className="font-mono text-primary">{row.example}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          The bot replies in-thread once the operator responds. If a request is rejected, the reply explains exactly
          why (wrong format, wrong identifier length, etc.) so it can be corrected and resent.
        </p>
      </CardContent>
    </Card>
  );
}
