// Ported from what buildAdminData() (src/app.js) returns across the various
// /api/admin/* endpoints admin.js consumes. Loosely typed to the fields the
// UI actually reads, matching the pragmatic style of ../ops/types.ts.

export type Dispatch = {
  operator: string;
  requestId: string;
  gatewayId?: string;
  shortcode?: string;
  sentAt?: string | null;
  status?: string;
  sentStatus?: string;
};

export type AdminRequest = {
  requestId: string;
  requestType: string;
  payload: string;
  status: string;
  requesterName: string;
  channel?: string;
  createdAt: string;
  dispatches?: Dispatch[];
};

export type ReplyDraft = {
  requestId: string;
  replyText: string;
  sentStatus: string;
};

export type UnmatchedRow = {
  id: string;
  senderNumber: string;
  gatewayId: string;
  messageBody: string;
  receivedAt: string;
};

export type RejectedRow = {
  timestamp: string;
  requesterName: string | null;
  requesterId: string | null;
  chatId: string | null;
  errorCode: string | null;
  rawText: string | null;
};

export type AuditLog = {
  timestamp: string;
  actor?: string;
  action: string;
  requestId?: string;
  details?: Record<string, unknown>;
};

export type GatewayHealth = {
  id: string;
  operator: string;
  operatorName: string;
  online: boolean;
  status: string;
  lastSeenAt: string | null;
  gatewayUrl?: string;
  phoneNumber?: string;
  shortcode?: string;
  trustedSendersCount?: number;
};

export type AdminStats = {
  activeRequests?: number;
  pendingApprovals?: number;
  failedOrTimedOut?: number;
  unmatchedInbound?: number;
  onlineGateways?: number;
  delayedConfirmations?: number;
  ambiguousReplies24h?: number;
  duplicateRiskGroups?: number;
  telegramChatMismatches24h?: number;
  telegramUnauthorizedAttempts24h?: number;
  todayRequests?: number;
};

export type AdminAlerts = {
  pendingApprovals?: number;
  failedRequests?: number;
  unmatchedSms?: number;
  offlineGateways?: number;
};

export type QueueRow = {
  operator: string;
  active: { requestId: string } | null;
  waiting: unknown[];
  delayedSendCount?: number;
};

export type ActivityEvent = {
  title: string;
  summary?: string;
  severity: string;
  occurredAt: string;
};

export type AdminOverview = {
  environment?: string;
  alerts: AdminAlerts;
  queues: QueueRow[];
  stats: AdminStats;
  diagnostics: { delayedConfirmations?: { gatewayId: string }[]; recentDuplicateBlocks?: number };
  activity: ActivityEvent[];
  gatewayHealth: GatewayHealth[];
};

export type MatchCandidate = {
  requestId: string;
  requestType: string;
  payload: string;
  status: string;
  createdAt: string;
  score: number;
  typeScore: number;
  confidence: string;
};

export type TeamUser = {
  id: string;
  name: string;
  email: string;
  role: "officer" | "admin" | "super_admin";
  status: string;
};

export type Invite = {
  email: string;
  name: string;
  role: string;
  consumed_at: string | null;
  expires_at: string;
};
