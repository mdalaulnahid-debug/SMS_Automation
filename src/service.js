'use strict';

const { OPERATORS, STATUSES } = require('./domain');
const { parseRequestText, INVALID_FORMAT_MESSAGE } = require('./parser');
const { analyzeOperatorReply } = require('./replyAnalyzer');

const DEFAULT_REPLY_WINDOW_MS = 5 * 60 * 1000;

class AutomationService {
  constructor({ store, queue, smsGateway, replyWindowMs = DEFAULT_REPLY_WINDOW_MS }) {
    this.store = store;
    this.queue = queue;
    this.smsGateway = smsGateway;
    this.replyWindowMs = replyWindowMs;
  }

  async submitWhatsAppRequest(input) {
    const parsed = parseRequestText(input.text);
    if (!parsed.ok) {
      return {
        ok: false,
        errors: parsed.errors,
        replyText: INVALID_FORMAT_MESSAGE
      };
    }

    const requester = this.store.upsertUser({
      whatsappId: input.requesterWhatsappId,
      displayName: input.requesterName
    });

    const unauthorizedOperator = parsed.targetOperators.find((operator) => {
      return !requester.allowedOperators.includes(operator);
    });
    if (unauthorizedOperator) {
      return {
        ok: false,
        errors: [`Requester is not authorized for ${unauthorizedOperator}.`],
        replyText: 'You are not authorized to submit this operator request.'
      };
    }

    const request = this.store.createRequest({
      whatsappGroupId: input.whatsappGroupId,
      requesterWhatsappId: input.requesterWhatsappId,
      requesterName: input.requesterName,
      operator: parsed.targetOperators[0],
      targetOperators: parsed.targetOperators,
      requestType: parsed.requestType,
      payload: parsed.payload,
      rawRequestText: input.text
    });

    this.queue.enqueue(request);
    await Promise.all(parsed.targetOperators.map((operator) => this.smsGateway.dispatchNext(operator)));

    return { ok: true, request: this.store.getRequest(request.requestId) };
  }

  receiveSmsWebhook(input) {
    if (!this.store.isTrustedSenderForGateway(input.gatewayId, input.from)) {
      const inbox = this.store.addSmsInbox({
        gatewayId: input.gatewayId,
        senderNumber: input.from,
        messageBody: input.body,
        matchedRequestId: null,
        analysis: {
          ignored: true,
          reason: 'Sender is not configured as a push-pull, hotline, or network sender for this gateway.'
        },
        receivedAt: input.receivedAt
      });
      this.store.audit('system', 'SMS_IGNORED_UNTRUSTED_SENDER', null, {
        gatewayId: input.gatewayId,
        senderNumber: input.from
      });
      return {
        ok: false,
        ignored: true,
        inbox,
        reason: 'SMS ignored because sender is not trusted for this gateway.'
      };
    }

    const matchedRequest = this.store.findActiveRequestForGateway(
      input.gatewayId,
      input.from,
      this.replyWindowMs,
      input.body
    );
    const analysis = matchedRequest
      ? analyzeOperatorReply({ request: matchedRequest, messageBody: input.body })
      : null;

    const inbox = this.store.addSmsInbox({
      gatewayId: input.gatewayId,
      senderNumber: input.from,
      messageBody: input.body,
      matchedRequestId: matchedRequest?.requestId || null,
      analysis,
      receivedAt: input.receivedAt
    });

    if (!matchedRequest) {
      this.store.audit('system', 'SMS_REPLY_UNMATCHED', null, input);
      return {
        ok: false,
        inbox,
        needsManualReview: true,
        reason: 'No unique pending request matched this gateway, sender, and time window.'
      };
    }

    const operatorKey = this.store.operatorForGateway(input.gatewayId);
    if (operatorKey) this.store.markOperatorReplyReceived(matchedRequest.requestId, operatorKey);

    const updatedRequest = this.store.getRequest(matchedRequest.requestId);
    const allRepliesReceived = updatedRequest.targetOperators.every((operator) => {
      return updatedRequest.receivedOperators.includes(operator);
    });
    if (allRepliesReceived) {
      this.store.updateRequestStatus(matchedRequest.requestId, STATUSES.REPLY_RECEIVED);
      this.store.updateRequestStatus(matchedRequest.requestId, STATUSES.NEEDS_MANUAL_REVIEW, {
        inboxId: inbox.id,
        analysis
      });
    } else {
      this.store.audit('system', 'REQUEST_PARTIAL_OPERATOR_REPLY', matchedRequest.requestId, {
        operator: operatorKey,
        inboxId: inbox.id,
        analysis,
        receivedOperators: updatedRequest.receivedOperators,
        pendingOperators: updatedRequest.targetOperators.filter((operator) => {
          return !updatedRequest.receivedOperators.includes(operator);
        })
      });
    }

    const reply = this.store.addWhatsAppReply({
      requestId: matchedRequest.requestId,
      replyText: formatWhatsAppReply(updatedRequest, input.body, {
        operatorKey,
        analysis,
        allRepliesReceived
      }),
      sentStatus: 'DRAFT'
    });

    return {
      ok: true,
      inbox,
      request: this.store.getRequest(matchedRequest.requestId),
      whatsappReply: reply
    };
  }

  async approveWhatsAppReply(requestId) {
    const latestReply = [...this.store.whatsappReplies]
      .reverse()
      .find((reply) => reply.requestId === requestId);
    if (!latestReply) throw new Error(`No WhatsApp reply draft found for ${requestId}`);
    const request = this.store.getRequest(requestId);
    if (request.status !== STATUSES.NEEDS_MANUAL_REVIEW) {
      throw new Error(`Request ${requestId} is not ready for WhatsApp reply approval.`);
    }
    latestReply.sentStatus = 'POSTED';
    latestReply.sentAt = new Date().toISOString();
    this.store.updateRequestStatus(requestId, STATUSES.WHATSAPP_REPLY_POSTED);
    const completed = this.store.updateRequestStatus(requestId, STATUSES.COMPLETED);
    await Promise.all(request.targetOperators.map((operator) => this.smsGateway.dispatchNext(operator)));
    return completed;
  }

  timeoutWaitingRequests() {
    const cutoff = Date.now() - this.replyWindowMs;
    return this.store
      .listRequests()
      .filter((request) => request.status === STATUSES.WAITING_OPERATOR_REPLY)
      .filter((request) => new Date(request.createdAt).getTime() < cutoff)
      .map((request) =>
        this.store.updateRequestStatus(request.requestId, STATUSES.TIMEOUT, {
          failedReason: 'Operator reply timed out.'
        })
      );
  }
}

function formatWhatsAppReply(request, operatorResponse, options = {}) {
  const operatorName = options.operatorKey ? OPERATORS[options.operatorKey].name : OPERATORS[request.operator].name;
  const reviewNote = options.analysis?.confidence === 'UNKNOWN'
    ? 'Review note: reply pattern was not recognized; verify manually before posting.'
    : `Review confidence: ${options.analysis?.confidence || 'UNKNOWN'}`;

  return [
    `@${request.requesterName}`,
    `Reply for Request ID: ${request.requestId}`,
    `Request Type: ${request.requestType}`,
    `Operator: ${operatorName}`,
    `Request: ${request.payload}`,
    'Operator Response:',
    operatorResponse,
    reviewNote,
    options.allRepliesReceived === false ? 'Status: waiting for other operator replies.' : 'Status: ready for manual review.',
    `Processed at: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}`
  ].join('\n');
}

module.exports = {
  AutomationService,
  DEFAULT_REPLY_WINDOW_MS,
  formatWhatsAppReply
};
