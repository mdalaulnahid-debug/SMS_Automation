import { Building2, Phone, Mail, Send, MessageCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

const ROWS = [
  { icon: Building2, content: <span>LIC Barishal</span> },
  {
    icon: Phone,
    content: (
      <span>
        <a href="tel:+8801320151103" className="text-primary hover:underline">01320-151103</a>,{" "}
        <a href="tel:+8801320151450" className="text-primary hover:underline">01320-151450</a>
      </span>
    ),
  },
  {
    icon: Mail,
    content: (
      <a href="mailto:support@opsbarishal.com" className="text-primary hover:underline">
        support@opsbarishal.com
      </a>
    ),
  },
  { icon: Send, content: <span>Telegram: 01320-151103, 01320-151450</span> },
  { icon: MessageCircle, content: <span>WhatsApp: 01320-151103, 01320-151450</span> },
];

export function Contact() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contact</CardTitle>
        <CardDescription>LIC Barishal</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3.5 text-[13.5px]">
        {ROWS.map(({ icon: Icon, content }, i) => (
          <div key={i} className="flex items-center gap-3">
            <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
            {content}
          </div>
        ))}
        <p className="pt-1 leading-relaxed text-muted-foreground">
          For access requests or technical issues, reach the system administrator through any of the channels above,
          or use the <a href="/admin" className="text-primary hover:underline">admin console</a> if you already hold
          credentials.
        </p>
      </CardContent>
    </Card>
  );
}
