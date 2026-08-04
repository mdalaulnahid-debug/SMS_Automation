// Ported 1:1 from what buildOpsData() (src/app.js) returns for
// GET /api/ops/overview and GET /api/ops/activity — both admin-only
// server-side (security-hardening v1 access-tier model §4).

export type GatewayHealth = {
  operator: string;
  operatorName: string;
  online: boolean;
  state: "ONLINE" | "OFFLINE" | "MOCK";
  gatewayId: string;
  lastSeenAt: string | null;
};

export type OpsAlerts = {
  total: number;
  pendingApprovals: number;
  failedRequests: number;
  unmatchedSms: number;
  offlineGateways: number;
};

export type OpsActivityEvent = {
  type: string;
  severity: "critical" | "warning" | "success" | "info" | string;
  title: string;
  summary?: string;
  operator?: string;
  gatewayId?: string;
  occurredAt: string;
  meta?: { requestId?: string };
};

export type OpsOverview = {
  generatedAt: string;
  alerts: OpsAlerts;
  posture: { backendReachable: boolean; summary: string };
  operators: GatewayHealth[];
  stats: { todayRequests?: number; [key: string]: unknown };
  queuePressure: { operator: string; activeRequestId: string | null; waitingCount: number }[];
  activity: OpsActivityEvent[];
};
