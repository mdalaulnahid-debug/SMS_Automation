import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export function About() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">About</CardTitle>
        <CardDescription>What this system does</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-[13.5px] leading-relaxed text-muted-foreground">
        <p>
          <strong className="text-foreground">SMS Automation</strong> is an auditable bridge between authorized
          officers and mobile operator lookup services (LRL, LCL, MS-NID, NID-MS, IMEI-MS), built to reduce manual
          copying, wrong routing, and wrong-recipient risk in lawful operator push-pull requests.
        </p>
        <p>
          An authorized officer submits a formatted request through Telegram. The backend routes it to the correct
          operator's dedicated gateway phone, sends the SMS exactly as formatted, waits for the operator's reply, and
          prepares a tagged response — identified by requester — for review before it is posted back.
        </p>
        <p>
          Every step is recorded in a tamper-evident, hash-chained audit log. Operator SMS commands are never
          modified, and only trusted sender replies from configured operator numbers are processed.
        </p>
      </CardContent>
    </Card>
  );
}
