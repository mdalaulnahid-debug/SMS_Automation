'use strict';

const { OPERATORS, STATUSES, assertTransition, createRequestId } = require('./domain');

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

class AutomationStore {
  constructor(gatewayConfig = {}) {
    this.sequence = 0;
    this.referenceSequence = 0;
    this.users = new Map();
    this.gateways = new Map();
    this.requests = new Map();
    this.smsOutbox = [];
    this.smsInbox = [];
    this.whatsappReplies = [];
    this.auditLogs = [];

    Object.entries(OPERATORS).forEach(([operatorKey, operator]) => {
      const config = gatewayConfig[operatorKey] || {};
      this.gateways.set(operator.gatewayId, {
        id: operator.gatewayId,
        operator: operatorKey,
        operatorName: operator.name,
        shortcode: operator.shortcode,
        gatewayUrl: config.gatewayUrl || '',
        sendPath: config.sendPath || '/send-sms',
        trustedSenders: config.trustedSenders?.length ? config.trustedSenders : operator.trustedSenders,
        status: config.gatewayUrl ? 'CONFIGURED' : 'MOCK',
        lastSeenAt: nowIso()
      });
    });
  }

  upsertUser({ whatsappId, displayName, role = 'REQUESTER', allowedOperators = Object.keys(OPERATORS) }) {
    const existing = this.users.get(whatsappId);
    const user = {
      id: existing?.id || randomId('user'),
      whatsappId,
      displayName,
      role,
      allowedOperators,
      status: 'ACTIVE',
      createdAt: existing?.createdAt || nowIso()
    };
    this.users.set(whatsappId, user);
    return user;
  }

  nextRequestId() {
    this.sequence += 1;
    return createRequestId(new Date(), this.sequence);
  }

  nextSilentReference() {
    this.referenceSequence += 1;
    return `SR${Date.now().toString(36).toUpperCase()}${String(this.referenceSequence).padStart(4, '0')}`;
  }

  createRequest(input) {
    const request = {
      id: randomId('request'),
      requestId: input.requestId || this.nextRequestId(),
      whatsappGroupId: input.whatsappGroupId,
      requesterWhatsappId: input.requesterWhatsappId,
      requesterName: input.requesterName,
      operator: input.operator,
      targetOperators: input.targetOperators || [input.operator],
      requestType: input.requestType,
      payload: input.payload,
      silentReference: input.silentReference || this.nextSilentReference(),
      rawRequestText: input.rawRequestText,
      formattedSmsText: input.formattedSmsText || null,
      receivedOperators: [],
      status: STATUSES.RECEIVED,
      createdAt: nowIso(),
      completedAt: null,
      failedReason: null
    };
    this.requests.set(request.requestId, request);
    this.audit('system', 'REQUEST_RECEIVED', request.requestId, input);
    return request;
  }

  updateRequestStatus(requestId, nextStatus, details = {}) {
    const request = this.getRequest(requestId);
    assertTransition(request.status, nextStatus);
    request.status = nextStatus;
    if ([STATUSES.COMPLETED, STATUSES.FAILED, STATUSES.TIMEOUT].includes(nextStatus)) {
      request.completedAt = nowIso();
    }
    if (details.failedReason) request.failedReason = details.failedReason;
    this.audit('system', `REQUEST_${nextStatus}`, requestId, details);
    return request;
  }

  setFormattedSms(requestId, message) {
    const request = this.getRequest(requestId);
    request.formattedSmsText = message;
    return request;
  }

  addSmsOutbox(entry) {
    const row = {
      id: randomId('outbox'),
      requestId: entry.requestId,
      gatewayId: entry.gatewayId,
      operator: entry.operator,
      silentReference: entry.silentReference,
      destinationNumber: entry.destinationNumber,
      messageBody: entry.messageBody,
      sentStatus: entry.sentStatus,
      sendResult: entry.sendResult || null,
      sentAt: entry.sentAt || nowIso()
    };
    this.smsOutbox.push(row);
    this.audit('sms-gateway', 'SMS_OUTBOUND', entry.requestId, row);
    return row;
  }

  addSmsInbox(entry) {
    const row = {
      id: randomId('inbox'),
      gatewayId: entry.gatewayId,
      senderNumber: entry.senderNumber,
      messageBody: entry.messageBody,
      matchedRequestId: entry.matchedRequestId || null,
      analysis: entry.analysis || null,
      receivedAt: entry.receivedAt || nowIso()
    };
    this.smsInbox.push(row);
    this.audit('sms-gateway', 'SMS_INBOUND', row.matchedRequestId, row);
    return row;
  }

  addWhatsAppReply(entry) {
    const row = {
      id: randomId('whatsapp'),
      requestId: entry.requestId,
      replyText: entry.replyText,
      sentStatus: entry.sentStatus,
      sentAt: entry.sentAt || nowIso()
    };
    this.whatsappReplies.push(row);
    this.audit('operator', 'WHATSAPP_REPLY_DRAFTED', entry.requestId, row);
    return row;
  }

  getRequest(requestId) {
    const request = this.requests.get(requestId);
    if (!request) throw new Error(`Request not found: ${requestId}`);
    return request;
  }

  listRequests() {
    return Array.from(this.requests.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listGateways() {
    return Array.from(this.gateways.values());
  }

  getGatewayByOperator(operatorKey) {
    const operator = OPERATORS[operatorKey];
    if (!operator) throw new Error(`Unknown operator: ${operatorKey}`);
    const gateway = this.gateways.get(operator.gatewayId);
    if (!gateway) throw new Error(`Gateway not configured: ${operator.gatewayId}`);
    return gateway;
  }

  getGateway(gatewayId) {
    const gateway = this.gateways.get(gatewayId);
    if (!gateway) throw new Error(`Gateway not configured: ${gatewayId}`);
    return gateway;
  }

  operatorForGateway(gatewayId) {
    return this.gateways.get(gatewayId)?.operator || null;
  }

  isTrustedSenderForGateway(gatewayId, sender) {
    const gateway = this.gateways.get(gatewayId);
    if (!gateway) return false;
    const normalizedSender = String(sender || '').trim().toUpperCase();
    return gateway.trustedSenders.some((trustedSender) => {
      return normalizedSender === String(trustedSender).trim().toUpperCase();
    });
  }

  findActiveRequestForGateway(gatewayId, senderNumber, windowMs, messageBody = '') {
    const reference = extractSilentReference(messageBody);
    if (reference) {
      const byReference = this.listRequests().find((request) => {
        if (![STATUSES.WAITING_OPERATOR_REPLY, STATUSES.REPLY_RECEIVED].includes(request.status)) {
          return false;
        }
        const sent = this.smsOutbox.find((row) => {
          return row.requestId === request.requestId && row.gatewayId === gatewayId;
        });
        return request.silentReference === reference && sent;
      });
      if (byReference) return byReference;
    }

    const cutoff = Date.now() - windowMs;
    const pending = this.listRequests()
      .filter((request) => request.status === STATUSES.WAITING_OPERATOR_REPLY)
      .filter((request) => {
        const sent = this.smsOutbox.find((row) => {
          return row.requestId === request.requestId && row.gatewayId === gatewayId;
        });
        return sent && sent.gatewayId === gatewayId && sent.destinationNumber === senderNumber;
      })
      .filter((request) => new Date(request.createdAt).getTime() >= cutoff);

    return pending.length === 1 ? pending[0] : null;
  }

  markOperatorReplyReceived(requestId, operatorKey) {
    const request = this.getRequest(requestId);
    if (!request.receivedOperators.includes(operatorKey)) {
      request.receivedOperators.push(operatorKey);
    }
    return request;
  }

  audit(actor, action, requestId, details = {}) {
    const row = {
      id: randomId('audit'),
      actor,
      action,
      requestId: requestId || null,
      timestamp: nowIso(),
      details
    };
    this.auditLogs.push(row);
    return row;
  }

  snapshot() {
    return {
      gateways: this.listGateways(),
      requests: this.listRequests(),
      smsOutbox: this.smsOutbox.slice(-50),
      smsInbox: this.smsInbox.slice(-50),
      whatsappReplies: this.whatsappReplies.slice(-50),
      auditLogs: this.auditLogs.slice(-100)
    };
  }
}

function extractSilentReference(messageBody) {
  return String(messageBody || '').match(/\b(?:REF|SR)[:\s-]*(SR[A-Z0-9]+)\b/i)?.[1]?.toUpperCase() || null;
}

module.exports = { AutomationStore, extractSilentReference };
