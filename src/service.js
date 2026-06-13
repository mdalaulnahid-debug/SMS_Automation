'use strict';

const { OPERATORS, STATUSES, DISPATCH_STATUSES, TERMINAL_DISPATCH_STATUSES } = require('./domain');
const { parseRequestText, INVALID_FORMAT_MESSAGE } = require('./parser');
const { analyzeOperatorReply, saveMatchedReplyKeywords } = require('./replyAnalyzer');

const DEFAULT_REPLY_WINDOW_MS = 5 * 60 * 1000;

class AutomationService {
  constructor({ store, queue, smsGateway, replyWindowMs = DEFAULT_REPLY_WINDOW_MS, denyUnknownRequesters = false, autoApproveChannels = [] }) {
    this.store = store;
    this.queue = queue;
    this.smsGateway = smsGateway;
    this.replyWindowMs = replyWindowMs;
    this.denyUnknownRequesters = denyUnknownRequesters;
    // Channels whose replies are auto-approved (skips manual review gate).
    // e.g. ['telegram'] — the reply goes straight to APPROVED_FOR_POST.
    this.autoApproveChannels = autoApproveChannels;
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

    const existingUser = this.store.getUser(input.requesterWhatsappId);
    if (existingUser && existingUser.status === 'DISABLED') {
      this.store.audit('system', 'REQUEST_DENIED_DISABLED_USER', null, {
        requesterWhatsappId: input.requesterWhatsappId
      });
      return {
        ok: false,
        errors: ['Requester account is disabled.'],
        replyText: 'Your account is disabled. Contact the administrator.'
      };
    }
    if (this.denyUnknownRequesters && !existingUser) {
      this.store.audit('system', 'REQUEST_DENIED_UNKNOWN_USER', null, {
        requesterWhatsappId: input.requesterWhatsappId
      });
      return {
        ok: false,
        errors: ['Requester is not authorized.'],
        replyText: 'You are not an authorized requester. Contact the administrator to be added.'
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
      channel: input.channel,
      chatId: input.chatId,
      sourceMessageId: input.sourceMessageId,
      operator: parsed.targetOperators[0],
      targetOperators: parsed.targetOperators,
      requestType: parsed.requestType,
      payload: parsed.payload,
      rawRequestText: input.text,
      testDestination: input.testDestination || null
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

    const matchResult = this.store.findActiveRequestForGateway(
      input.gatewayId,
      input.from,
      this.replyWindowMs,
      input.body
    );

    let matchedRequest = null;
    let analysis = null;

    if (matchResult && matchResult.ambiguous) {
      // Multiple pending requests on this gateway — score each with the reply analyzer
      // and pick the best match. If none score above UNKNOWN or there's a tie, fall through
      // to manual review (matchedRequest stays null).
      const scored = matchResult.candidates.map((request) => {
        const a = analyzeOperatorReply({ request, messageBody: input.body });
        return { request, analysis: a, score: confidenceRank(a.confidence) };
      });
      scored.sort((a, b) => b.score - a.score);
      if (scored[0].score > 0 && (scored.length < 2 || scored[0].score > scored[1].score)) {
        matchedRequest = scored[0].request;
        analysis = scored[0].analysis;
      } else {
        this.store.audit('system', 'SMS_REPLY_AMBIGUOUS', null, {
          gatewayId: input.gatewayId,
          senderNumber: input.from,
          candidateCount: scored.length,
          scores: scored.map((s) => ({ requestId: s.request.requestId, confidence: s.analysis.confidence }))
        });
      }
    } else if (matchResult && !matchResult.ambiguous) {
      matchedRequest = matchResult;
      analysis = analyzeOperatorReply({ request: matchedRequest, messageBody: input.body });
    }

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
    if (operatorKey) {
      this.store.markOperatorReplyReceived(matchedRequest.requestId, operatorKey);
      this.store.markDispatchReplied(matchedRequest.requestId, operatorKey, { inboxId: inbox.id });
      // Auto-save reply keywords to training data for future matching improvement
      saveMatchedReplyKeywords(matchedRequest.requestType, operatorKey, input.body);
    }

    // Request status is derived from per-operator dispatches: only finalize (NEEDS_MANUAL_REVIEW
    // + combined draft) once every dispatch is terminal. A fan-out still waits for the other
    // operators (which may later reply or time out) before a draft is assembled.
    const outcome = this._finalizeIfTerminal(matchedRequest.requestId);
    if (!outcome.finalized) {
      const request = outcome.request;
      this.store.audit('system', 'REQUEST_PARTIAL_OPERATOR_REPLY', matchedRequest.requestId, {
        operator: operatorKey,
        inboxId: inbox.id,
        analysis,
        repliedOperators: (request.dispatches || [])
          .filter((d) => d.status === DISPATCH_STATUSES.REPLY_RECEIVED)
          .map((d) => d.operator),
        pendingOperators: (request.dispatches || [])
          .filter((d) => !TERMINAL_DISPATCH_STATUSES.includes(d.status))
          .map((d) => d.operator)
      });
    }

    return {
      ok: true,
      inbox,
      request: outcome.request,
      whatsappReply: outcome.reply
    };
  }

  // Derive request status from its dispatches. When all dispatches are terminal: if any reply
  // arrived, move to NEEDS_MANUAL_REVIEW and assemble ONE combined draft (per-operator sections,
  // missing operators marked); otherwise TIMEOUT (all timed out) or FAILED. Returns the (possibly
  // unchanged) request and the created draft, if any.
  _finalizeIfTerminal(requestId) {
    if (!this.store.allDispatchesTerminal(requestId)) {
      return { finalized: false, request: this.store.getRequest(requestId), reply: null };
    }

    if (this.store.anyDispatchReplied(requestId)) {
      if (this.store.getRequest(requestId).status === STATUSES.WAITING_OPERATOR_REPLY) {
        this.store.updateRequestStatus(requestId, STATUSES.REPLY_RECEIVED);
      }
      this.store.updateRequestStatus(requestId, STATUSES.NEEDS_MANUAL_REVIEW);
      const request = this.store.getRequest(requestId);
      const autoApprove = request.channel && this.autoApproveChannels.includes(request.channel);
      const reply = this.store.addWhatsAppReply({
        requestId,
        replyText: formatCombinedReply(request, this.store),
        sentStatus: autoApprove ? 'APPROVED_FOR_POST' : 'DRAFT',
        channel: request.channel,
        chatId: request.chatId,
        sourceMessageId: request.sourceMessageId,
        requesterName: request.requesterName,
        requesterId: request.requesterWhatsappId
      });
      if (autoApprove) {
        this.store.audit('system', 'WHATSAPP_REPLY_AUTO_APPROVED', requestId, {
          replyId: reply.id,
          channel: request.channel
        });
      }
      return { finalized: true, request, reply };
    }

    // No replies at all — distinguish all-timed-out from a send failure.
    const dispatches = this.store.getRequest(requestId).dispatches || [];
    const allTimeout = dispatches.every((d) => d.status === DISPATCH_STATUSES.TIMEOUT);
    this.store.updateRequestStatus(requestId, allTimeout ? STATUSES.TIMEOUT : STATUSES.FAILED, {
      failedReason: allTimeout ? 'Operator reply timed out.' : 'Operator dispatch failed.'
    });
    return { finalized: true, request: this.store.getRequest(requestId), reply: null };
  }

  async approveWhatsAppReply(requestId) {
    const request = this.store.getRequest(requestId);
    if (request.status !== STATUSES.NEEDS_MANUAL_REVIEW) {
      throw new Error(`Request ${requestId} is not ready for WhatsApp reply approval.`);
    }
    const latestReply = [...this.store.whatsappReplies]
      .reverse()
      .find((reply) => reply.requestId === requestId);
    if (!latestReply) throw new Error(`No WhatsApp reply draft found for ${requestId}`);

    // Automated channels (e.g. telegram) defer posting to the bridge: approval only marks
    // the draft APPROVED_FOR_POST. The request stays NEEDS_MANUAL_REVIEW until the bridge
    // confirms the post via markReplyPosted, so an unposted reply never looks completed.
    if (request.channel && request.channel !== 'manual') {
      const reply = this.store.updateWhatsAppReply(latestReply.id, { sentStatus: 'APPROVED_FOR_POST' });
      this.store.audit('operator', 'WHATSAPP_REPLY_APPROVED_FOR_POST', requestId, {
        replyId: latestReply.id,
        channel: request.channel
      });
      return { ...request, reply };
    }

    // Manual channel: the reviewer copy/pastes to the group themselves, so approval
    // completes the request in one step (unchanged legacy behavior).
    this.store.updateWhatsAppReply(latestReply.id, {
      sentStatus: 'POSTED',
      sentAt: new Date().toISOString()
    });
    this.store.updateRequestStatus(requestId, STATUSES.WHATSAPP_REPLY_POSTED);
    const completed = this.store.updateRequestStatus(requestId, STATUSES.COMPLETED);
    return completed;
  }

  // Called by the posting bridge after it has actually delivered the reply to the chat.
  // Moves the approved draft to POSTED and completes the request.
  async markReplyPosted(replyId, { postedMessageId } = {}) {
    const reply = this.store.getWhatsAppReply(replyId);
    if (!reply) throw new Error(`WhatsApp reply not found: ${replyId}`);
    if (reply.sentStatus !== 'APPROVED_FOR_POST') {
      throw new Error(`Reply ${replyId} is not approved for posting (status ${reply.sentStatus}).`);
    }
    this.store.updateWhatsAppReply(reply.id, {
      sentStatus: 'POSTED',
      postedMessageId: postedMessageId || null,
      sentAt: new Date().toISOString()
    });
    this.store.updateRequestStatus(reply.requestId, STATUSES.WHATSAPP_REPLY_POSTED);
    const completed = this.store.updateRequestStatus(reply.requestId, STATUSES.COMPLETED);
    this.store.audit('bridge', 'WHATSAPP_REPLY_POSTED', reply.requestId, {
      replyId,
      channel: reply.channel,
      postedMessageId: postedMessageId || null
    });
    return completed;
  }

  async rejectRequest(requestId, { reason } = {}) {
    const request = this.store.getRequest(requestId);
    if (request.status !== STATUSES.NEEDS_MANUAL_REVIEW) {
      throw new Error(`Request ${requestId} is not in NEEDS_MANUAL_REVIEW (current: ${request.status}).`);
    }
    const failed = this.store.updateRequestStatus(requestId, STATUSES.FAILED, {
      failedReason: reason || 'Rejected by reviewer.'
    });
    this.store.audit('admin', 'REQUEST_REJECTED', requestId, { reason });
    return failed;
  }

  async retryRequest(requestId) {
    const request = this.store.getRequest(requestId);
    if (request.status !== STATUSES.NEEDS_MANUAL_REVIEW && request.status !== STATUSES.FAILED && request.status !== STATUSES.TIMEOUT) {
      throw new Error(`Request ${requestId} cannot be retried (current: ${request.status}).`);
    }
    // Reset dispatches to QUEUED so they re-enter the per-operator pipeline.
    for (const dispatch of request.dispatches || []) {
      if (TERMINAL_DISPATCH_STATUSES.includes(dispatch.status)) {
        dispatch.status = DISPATCH_STATUSES.QUEUED;
        dispatch.outboxId = null;
        dispatch.inboxId = null;
        dispatch.sentAt = null;
        dispatch.repliedAt = null;
        if (this.store.persistence) this.store.persistence.upsertDispatch(dispatch);
      }
    }
    request.receivedOperators = [];
    request.completedAt = null;
    request.failedReason = null;
    this.store.updateRequestStatus(requestId, STATUSES.QUEUED);
    this.store.audit('admin', 'REQUEST_RETRIED', requestId);
    this.queue.enqueueExisting(request);
    await Promise.all(request.targetOperators.map((op) => this.smsGateway.dispatchNext(op)));
    return this.store.getRequest(requestId);
  }

  manualMatch(inboxId, requestId) {
    const inbox = this.store.smsInbox.find((row) => row.id === inboxId);
    if (!inbox) throw new Error(`Inbox entry not found: ${inboxId}`);
    const request = this.store.getRequest(requestId);
    if (request.status !== STATUSES.WAITING_OPERATOR_REPLY) {
      throw new Error(`Request ${requestId} is not waiting for a reply (current: ${request.status}).`);
    }

    inbox.matchedRequestId = requestId;
    const analysis = analyzeOperatorReply({ request, messageBody: inbox.messageBody });
    inbox.analysis = analysis;
    if (this.store.persistence) this.store.persistence.insertInbox(inbox);

    const operatorKey = this.store.operatorForGateway(inbox.gatewayId);
    if (operatorKey) {
      this.store.markOperatorReplyReceived(requestId, operatorKey);
      this.store.markDispatchReplied(requestId, operatorKey, { inboxId: inbox.id });
    }

    this.store.audit('admin', 'MANUAL_MATCH', requestId, { inboxId, operator: operatorKey });

    const outcome = this._finalizeIfTerminal(requestId);
    return {
      ok: true,
      request: outcome.request,
      whatsappReply: outcome.reply
    };
  }

  // Time out each waiting dispatch independently from ITS OWN send time (not the request's),
  // so a request that queued for a while still gets a full reply window per operator, and a
  // fan-out where some operators replied is finalized to NEEDS_MANUAL_REVIEW rather than TIMEOUT.
  async timeoutWaitingRequests() {
    const cutoff = Date.now() - this.replyWindowMs;
    const finalized = [];

    for (const request of this.store.listRequests()) {
      if (request.status !== STATUSES.WAITING_OPERATOR_REPLY) continue;

      let changed = false;
      for (const dispatch of request.dispatches || []) {
        if (dispatch.status !== DISPATCH_STATUSES.WAITING_REPLY) continue;
        const sentAt = this.dispatchSentAt(request.requestId, dispatch);
        if (sentAt !== null && sentAt < cutoff) {
          this.store.markDispatchTimeout(request.requestId, dispatch.operator);
          this.store.audit('system', 'DISPATCH_TIMEOUT', request.requestId, {
            operator: dispatch.operator
          });
          changed = true;
        }
      }
      if (!changed) continue;

      const outcome = this._finalizeIfTerminal(request.requestId);
      if (outcome.finalized) finalized.push(outcome.request);
    }

    return finalized;
  }

  // Effective send time for a dispatch, read from its linked outbox row (the source of truth
  // for when the carrier accepted the send).
  dispatchSentAt(requestId, dispatch) {
    const outbox =
      this.store.smsOutbox.find((row) => row.id === dispatch.outboxId) ||
      this.store.getOutboxForGateway(requestId, dispatch.gatewayId);
    return outbox && outbox.sentAt ? new Date(outbox.sentAt).getTime() : null;
  }
}

// Assemble a single review draft for a request. For fan-out, each target operator gets its own
// section: the matched reply (with confidence) if it replied, or a clear "no reply"/"failed"
// marker otherwise. The raw operator text is always preserved verbatim for the reviewer.
function formatCombinedReply(request, store) {
  const lines = [
    `@${request.requesterName}`,
    `${request.requestType}: ${request.payload}`,
    ''
  ];

  for (const dispatch of request.dispatches || []) {
    const name = OPERATORS[dispatch.operator]?.name || dispatch.operator;
    if (dispatch.status === DISPATCH_STATUSES.REPLY_RECEIVED) {
      const inbox = store.smsInbox.find((row) => row.id === dispatch.inboxId);
      lines.push(`— ${name}:`);
      lines.push(inbox?.messageBody || '(reply captured)');
    } else if (dispatch.status === DISPATCH_STATUSES.TIMEOUT) {
      lines.push(`— ${name}: no reply (timed out)`);
    } else if (dispatch.status === DISPATCH_STATUSES.FAILED) {
      lines.push(`— ${name}: send failed`);
    } else {
      lines.push(`— ${name}: pending`);
    }
  }

  lines.push('');
  lines.push(`Processed at: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}`);
  return lines.join('\n');
}

const CONFIDENCE_RANKS = { HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };
function confidenceRank(confidence) {
  return CONFIDENCE_RANKS[confidence] || 0;
}

module.exports = {
  AutomationService,
  DEFAULT_REPLY_WINDOW_MS,
  formatCombinedReply
};
