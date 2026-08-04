// Ported from public/shared.js's relativeTime()/operatorTone() — same
// output format, kept scoped to the Ops surface since nothing else in
// web/ needs them yet.

export function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return `${Math.max(1, Math.floor(diffMs / 1000))}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString();
}

export function operatorTone(operator?: string): string {
  if (operator === "GP") return "var(--gp)";
  if (operator === "ROBI") return "var(--robi)";
  if (operator === "BANGLALINK") return "var(--banglalink)";
  return "var(--primary)";
}

// Ported from public/app.js's gatewayState() — MOCK gateways read as
// "delayed" (test fixtures, not a real offline signal); a real gateway
// that's gone silent for under 30 minutes also reads as "delayed" rather
// than jumping straight to "offline".
export function gatewayState(operator: { state: string; online: boolean; lastSeenAt: string | null }): "online" | "delayed" | "offline" {
  if (operator.state === "MOCK") return "delayed";
  if (operator.online) return "online";
  const lastSeenMs = operator.lastSeenAt ? new Date(operator.lastSeenAt).getTime() : 0;
  const silentForMs = Date.now() - lastSeenMs;
  if (lastSeenMs && silentForMs < 30 * 60 * 1000) return "delayed";
  return "offline";
}

export const ECG_PATH_D = "M0 20 L40 20 L48 8 L56 32 L64 4 L72 20 L110 20 L118 12 L126 28 L134 20 L180 20";
