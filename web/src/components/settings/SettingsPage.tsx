import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function FormResult({ message, isError }: { message: string | null; isError?: boolean }) {
  if (!message) return null;
  return (
    <div className={cn("text-[13px]", isError ? "text-destructive" : "text-[color:var(--success)]")}>
      {message}
    </div>
  );
}
