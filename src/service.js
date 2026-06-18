'use strict';

const { OPERATORS, STATUSES, DISPATCH_STATUSES, TERMINAL_DISPATCH_STATUSES } = require('./domain');
const { parseRequestText } = require('./parser');
const { analyzeOperatorReply, saveMatchedReplyKeywords } = require('./replyAnalyzer');

const DEFAULT_REPLY_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_SEND_CONFIRMATION_GRACE_MS = 15 * 60 * 1000;
const DEFAULT_DUPLICATE_REQUEST_WINDOW_MS = 30 * 60 * 1000;

// Grace period before posting the first partial live reply for a fan-out request.
// Holds the draft for this many ms so replies that arrive close together are batched
// into one post rather than causing immediate partial posts followed by rapid edits.
const LIVE_POST_HOLD_MS = 5 * 1000;

class AutomationService {
  constructor({
    store,
    queue,
    smsGateway,
    replyWindowMs = DEFAULT_REPLY_WINDOW_MS,
    sendConfirmationGraceMs = DEFAULT_SEND_CONFIRMATION_GRACE_MS,
    duplicateRequestWindowMs = DEFAULT_DUPLICATE_REQUEST_WINDOW_MS,
    denyUnknownRequesters = false,
    autoApproveChannels = []
  }) {
    this.store = store;
    this.queue = queue;
    this.smsGateway = smsGateway;
    this.replyWindowMs = replyWindowMs;
    this.sendConfirmationGraceMs = sendConfirmationGraceMs;
    this.duplicateRequestWindowMs = duplicateRequestWindowMs;
    this.denyUnknownRequesters = denyUnknownRequesters;
    // Channels whose replies are auto-approved (skips manual review gate).
    // e.g. ['telegram'] — the reply goes straight to APPROVED_FOR_POST.
    this.autoApproveChannels = autoApproveChannels;
  }

  async submitRequest(input) {
    const parsed = parseRequestText(input.text);
    if (!parsed.ok) {
      this.store.audit('system', 'REQUEST_VALIDATION_FAILED', null, {
        requesterId: input.requesterId || null,
        requesterName: input.requesterName || null,
        channel: input.channel || 'manual',
        chatId: input.chatId || null,
        sourceMessageId: input.sourceMessageId || null,
        rawText: input.text,
        normalizedText: parsed.normalizedText,
        requestType: parsed.requestType,
        errorCode: parsed.errorCode,
        errors: parsed.errors
      });
      return {
        ok: false,
        errorCode: parsed.errorCode,
        errors: parsed.errors,
        replyText: parsed.replyText
      };
    }

    const existingUser = this.store.getUser(input.requesterId);
    if (existingUser && existingUser.status === 'DISABLED') {
      this.store.audit('system', 'REQUEST_DENIED_DISABLED_USER', null, {
        requesterId: input.requesterId
      });
      return {
        ok: false,
        errors: ['Requester account is disabled.'],
        replyText: 'Your account is disabled. Contact the administrator.'
      };
    }
    if (this.denyUnknownRequesters && !existingUser) {
      this.store.audit('system', 'REQUEST_DENIED_UNKNOWN_USER', null, {
        requesterId: input.requesterId
      });
      return {
        ok: false,
        errors: ['Requester is not authorized.'],
        replyText: 'You are not an authorized requester. Contact the administrator to be added.'
      };
    }

    const requester = this.store.upsertUser({
      telegramId: input.requesterId,
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

    const duplicate = this.store.findRecentDuplicateRequest({
      requestType: parsed.requestType,
      payload: parsed.canonicalPayload,
      targetOperators: parsed.targetOperators,
      windowMs: this.duplicateRequestWindowMs
    });
    if (duplicate) {
      this.store.audit('system', 'REQUEST_DUPLICATE_BLOCKED', duplicate.requestId, {
        requesterId: input.requesterId || null,
        requesterName: input.requesterName || null,
        channel: input.channel || 'manual',
        rawText: input.text,
        canonicalRequestText: parsed.canonicalRequestText,
        duplicateRequestId: duplicate.requestId,
        duplicateStatus: duplicate.status
      });
      return {
        ok: false,
        errorCode: 'DUPLICATE_ACTIVE_REQUEST',
        errors: [`A similar request is already active as ${duplicate.requestId}.`],
        replyText: `A similar request is already active as ${duplicate.requestId}. Wait for that result or use retry from admin.`,
        duplicateRequestId: duplicate.requestId
      };
    }

    const request = this.store.createRequest({
      requesterId: input.requesterId,
      requesterName: input.requesterName,
      channel: input.channel,
      chatId: input.chatId,
      sourceMessageId: input.sourceMessageId,
      operator: parsed.targetOperators[0],
      targetOperators: parsed.targetOperators,
      requestType: parsed.requestType,
      payload: parsed.canonicalPayload,
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
        return {
          request,
          analysis: a,
          score: confidenceRank(a.confidence),
          payloadMatches: a.payloadMatchCount || 0,
          createdAt: new Date(request.createdAt).getTime()
        };
      });
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.payloadMatches !== a.payloadMatches) return b.payloadMatches - a.payloadMatches;
        return b.createdAt - a.createdAt;
      });
      const hasUniqueTopScore = scored.length < 2 || scored[0].score > scored[1].score;
      const hasUniqueTopPayload = scored.length < 2 || scored[0].payloadMatches > scored[1].payloadMatches;
      if (scored[0].score > 0 && (hasUniqueTopScore || hasUniqueTopPayload)) {
        matchedRequest = scored[0].request;
        analysis = scored[0].analysis;
      } else {
        this.store.audit('system', 'SMS_REPLY_AMBIGUOUS', null, {
          gatewayId: input.gatewayId,
          senderNumber: input.from,
          candidateCount: scored.length,
          scores: scored.map((s) => ({
            requestId: s.request.requestId,
            confidence: s.analysis.confidence,
            payloadMatches: s.payloadMatches
          }))
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
      saveMatchedReplyKeywords(matchedRequest.requestType, operatorKey, input.body);
    }

    // Multi-operator live posting (NID-MS, IMEI-MS): post a partial summary immediately when
    // some operators are still pending, then edit the same Telegram message as more come in.
    if (!this.store.allDispatchesTerminal(matchedRequest.requestId)) {
      const request = this.store.getRequest(matchedRequest.requestId);
      if ((request.targetOperators || []).length > 1) {
        const updatedText = formatCombinedReply(request, this.store);
        const autoApprove = request.channel && this.autoApproveChannels.includes(request.channel);
        const existingDraft = this._getActiveDraftForRequest(matchedRequest.requestId);

        let reply;
        if (!existingDraft) {
          reply = this.store.addReplyDraft({
            requestId: matchedRequest.requestId,
            replyText: updatedText,
            sentStatus: autoApprove ? 'APPROVED_FOR_POST' : 'DRAFT',
            holdUntil: Date.now() + LIVE_POST_HOLD_MS,
            channel: request.channel,
            chatId: request.chatId,
            sourceMessageId: request.sourceMessageId,
            requesterName: request.requesterName,
            requesterId: request.requesterId
          });
          if (autoApprove) {
            this.store.audit('system', 'REPLY_AUTO_APPROVED', matchedRequest.requestId, {
              replyId: reply.id, channel: request.channel
            });
          }
        } else if (existingDraft.sentStatus === 'POSTED_LIVE') {
          this.store.updateReplyDraft(existingDraft.id, { replyText: updatedText, sentStatus: 'APPROVED_FOR_EDIT' });
          reply = existingDraft;
        } else {
          // DRAFT or APPROVED_FOR_POST — bridge hasn't posted it yet; just update text
          this.store.updateReplyDraft(existingDraft.id, { replyText: updatedText });
          reply = existingDraft;
        }

        this.store.audit('system', 'REQUEST_PARTIAL_OPERATOR_REPLY', matchedRequest.requestId, {
          operator: operatorKey, inboxId: inbox.id, analysis,
          repliedOperators: (request.dispatches || [])
            .filter((d) => d.status === DISPATCH_STATUSES.REPLY_RECEIVED).map((d) => d.operator),
          pendingOperators: (request.dispatches || [])
            .filter((d) => !TERMINAL_DISPATCH_STATUSES.includes(d.status)).map((d) => d.operator)
        });
        return { ok: true, inbox, request, replyDraft: reply };
      }
    }

    // Reply arrived after the request timed out (phone was offline during reply window).
    // Revive the dispatch so the reply is captured and a combined draft is assembled.
    const currentRequest = this.store.getRequest(matchedRequest.requestId);
    if (currentRequest.status === STATUSES.TIMEOUT) {
      // Reset the timed-out dispatch back to REPLY_RECEIVED so _finalizeIfTerminal
      // can reassemble a proper combined reply including this late data.
      if (operatorKey) {
        const dispatch = this.store.getDispatch(matchedRequest.requestId, operatorKey);
        if (dispatch && dispatch.status === DISPATCH_STATUSES.TIMEOUT) {
          dispatch.status = DISPATCH_STATUSES.REPLY_RECEIVED;
          dispatch.inboxId = inbox.id;
          dispatch.repliedAt = new Date().toISOString();
          if (this.store.persistence) this.store.persistence.upsertDispatch(dispatch);
        }
      }
      // Revive the request to WAITING_OPERATOR_REPLY so status transitions are valid,
      // then let _finalizeIfTerminal move it to NEEDS_MANUAL_REVIEW with a combined draft.
      this.store.updateRequestStatus(matchedRequest.requestId, STATUSES.WAITING_OPERATOR_REPLY);
      this.store.audit('system', 'REQUEST_REVIVED_AFTER_TIMEOUT', matchedRequest.requestId, {
        operator: operatorKey, inboxId: inbox.id
      });
      const outcome = this._finalizeIfTerminal(matchedRequest.requestId);
      return { ok: true, inbox, request: outcome.request, replyDraft: outcome.reply };
    }

    // Late reply: request already finalized (NEEDS_MANUAL_REVIEW). Re-generate the combined
    // reply with the new operator data and re-approve for posting instead of re-finalizing.
    if (currentRequest.status === STATUSES.NEEDS_MANUAL_REVIEW) {
      const updatedText = formatCombinedReply(currentRequest, this.store);
      const autoApprove = currentRequest.channel && this.autoApproveChannels.includes(currentRequest.channel);
      const allReplies = this.store.listReplyDrafts().filter((r) => r.requestId === matchedRequest.requestId);
      const latestReply = allReplies[allReplies.length - 1];

      let reply;
      const alreadyDelivered = ['POSTED', 'POSTED_LIVE', 'APPROVED_FOR_EDIT'];
      if (latestReply && !alreadyDelivered.includes(latestReply.sentStatus)) {
        this.store.updateReplyDraft(latestReply.id, {
          replyText: updatedText,
          sentStatus: autoApprove ? 'APPROVED_FOR_POST' : 'DRAFT'
        });
        reply = latestReply;
      } else {
        reply = this.store.addReplyDraft({
          requestId: matchedRequest.requestId,
          replyText: updatedText,
          sentStatus: autoApprove ? 'APPROVED_FOR_POST' : 'DRAFT',
          channel: currentRequest.channel,
          chatId: currentRequest.chatId,
          sourceMessageId: currentRequest.sourceMessageId,
          requesterName: currentRequest.requesterName,
          requesterId: currentRequest.requesterId
        });
      }

      this.store.audit('system', 'REQUEST_LATE_OPERATOR_REPLY', matchedRequest.requestId, {
        operator: operatorKey, inboxId: inbox.id
      });
      return { ok: true, inbox, request: currentRequest, replyDraft: reply };
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
      replyDraft: outcome.reply
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
      const replyText = formatCombinedReply(request, this.store);

      // If any active draft exists (partial reply or live Telegram message), update it in place
      // with the final combined content. Otherwise create a normal draft.
      const existingDraft = this._getActiveDraftForRequest(requestId);
      let reply;
      if (existingDraft) {
        const nextStatus = existingDraft.sentStatus === 'POSTED_LIVE' ? 'APPROVED_FOR_EDIT' : existingDraft.sentStatus;
        this.store.updateReplyDraft(existingDraft.id, { replyText, sentStatus: nextStatus });
        reply = existingDraft;
      } else {
        const autoApprove = request.channel && this.autoApproveChannels.includes(request.channel);
        reply = this.store.addReplyDraft({
          requestId,
          replyText,
          sentStatus: autoApprove ? 'APPROVED_FOR_POST' : 'DRAFT',
          channel: request.channel,
          chatId: request.chatId,
          sourceMessageId: request.sourceMessageId,
          requesterName: request.requesterName,
          requesterId: request.requesterId
        });
        if (autoApprove) {
          this.store.audit('system', 'REPLY_AUTO_APPROVED', requestId, {
            replyId: reply.id, channel: request.channel
          });
        }
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

  async approveReply(requestId) {
    const request = this.store.getRequest(requestId);
    if (request.status !== STATUSES.NEEDS_MANUAL_REVIEW) {
      throw new Error(`Request ${requestId} is not ready for reply approval.`);
    }
    const latestReply = [...this.store.replyDrafts]
      .reverse()
      .find((reply) => reply.requestId === requestId);
    if (!latestReply) throw new Error(`No reply draft found for ${requestId}`);

    // Automated channels (e.g. telegram) defer posting to the bridge: approval only marks
    // the draft APPROVED_FOR_POST. The request stays NEEDS_MANUAL_REVIEW until the bridge
    // confirms the post via markReplyPosted, so an unposted reply never looks completed.
    if (request.channel && request.channel !== 'manual') {
      const reply = this.store.updateReplyDraft(latestReply.id, { sentStatus: 'APPROVED_FOR_POST' });
      this.store.audit('operator', 'REPLY_APPROVED_FOR_POST', requestId, {
        replyId: latestReply.id,
        channel: request.channel
      });
      return { ...request, reply };
    }

    // Manual channel: the reviewer copy/pastes to the group themselves, so approval
    // completes the request in one step (unchanged legacy behavior).
    this.store.updateReplyDraft(latestReply.id, {
      sentStatus: 'POSTED',
      sentAt: new Date().toISOString()
    });
    this.store.updateRequestStatus(requestId, STATUSES.REPLY_POSTED);
    const completed = this.store.updateRequestStatus(requestId, STATUSES.COMPLETED);
    return completed;
  }

  // Called by the posting bridge after it has actually delivered the reply to the chat.
  // For a live multi-op post (request still WAITING_OPERATOR_REPLY), stores the Telegram
  // message ID for future edits and sets POSTED_LIVE without completing the request.
  // For a regular (final) post, moves to POSTED and completes the request.
  async markReplyPosted(replyId, { postedMessageId } = {}) {
    const reply = this.store.getReplyDraft(replyId);
    if (!reply) throw new Error(`Reply draft not found: ${replyId}`);
    if (reply.sentStatus !== 'APPROVED_FOR_POST') {
      throw new Error(`Reply ${replyId} is not approved for posting (status ${reply.sentStatus}).`);
    }

    const request = this.store.getRequest(reply.requestId);
    if (request.status !== STATUSES.NEEDS_MANUAL_REVIEW) {
      // Live initial post — keep request open, store Telegram message ID for edits
      this.store.updateReplyDraft(reply.id, {
        sentStatus: 'POSTED_LIVE',
        postedMessageId: postedMessageId || null,
        sentAt: new Date().toISOString()
      });
      this.store.audit('bridge', 'REPLY_LIVE_POSTED', reply.requestId, { replyId, postedMessageId });
      return request;
    }

    this.store.updateReplyDraft(reply.id, {
      sentStatus: 'POSTED',
      postedMessageId: postedMessageId || null,
      sentAt: new Date().toISOString()
    });
    this.store.updateRequestStatus(reply.requestId, STATUSES.REPLY_POSTED);
    const completed = this.store.updateRequestStatus(reply.requestId, STATUSES.COMPLETED);
    this.store.audit('bridge', 'REPLY_POSTED', reply.requestId, {
      replyId,
      channel: reply.channel,
      postedMessageId: postedMessageId || null
    });
    return completed;
  }

  // Called by the bridge after it has edited the live Telegram message.
  // Advances APPROVED_FOR_EDIT → POSTED_LIVE for intermediate edits, or completes
  // the request (POSTED → COMPLETED) when all operators are done.
  async markReplyEdited(replyId) {
    const reply = this.store.getReplyDraft(replyId);
    if (!reply) throw new Error(`Reply draft not found: ${replyId}`);
    if (reply.sentStatus !== 'APPROVED_FOR_EDIT') {
      throw new Error(`Reply ${replyId} is not pending edit (status: ${reply.sentStatus}).`);
    }
    this.store.audit('bridge', 'REPLY_EDITED', reply.requestId, { replyId });

    const request = this.store.getRequest(reply.requestId);
    const isFinal = request.status === STATUSES.NEEDS_MANUAL_REVIEW
      && this.store.allDispatchesTerminal(reply.requestId);

    if (isFinal) {
      this.store.updateReplyDraft(reply.id, { sentStatus: 'POSTED', sentAt: new Date().toISOString() });
      this.store.updateRequestStatus(reply.requestId, STATUSES.REPLY_POSTED);
      const completed = this.store.updateRequestStatus(reply.requestId, STATUSES.COMPLETED);
      this.store.audit('bridge', 'REPLY_POSTED', reply.requestId, {
        replyId, channel: reply.channel, postedMessageId: reply.postedMessageId
      });
      return completed;
    }

    this.store.updateReplyDraft(reply.id, { sentStatus: 'POSTED_LIVE' });
    return request;
  }

  // Find any active (non-posted) reply draft for a fan-out request, for partial-reply updates.
  _getActiveDraftForRequest(requestId) {
    return [...this.store.replyDrafts]
      .reverse()
      .find((r) => r.requestId === requestId && r.sentStatus !== 'POSTED') || null;
  }

  // Find an in-progress live reply (POSTED_LIVE or APPROVED_FOR_EDIT) for a fan-out request.
  _getLiveReplyForRequest(requestId) {
    return [...this.store.replyDrafts]
      .reverse()
      .find((r) => r.requestId === requestId
        && (r.sentStatus === 'POSTED_LIVE' || r.sentStatus === 'APPROVED_FOR_EDIT')) || null;
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
      replyDraft: outcome.reply
    };
  }

  // Time out each waiting dispatch independently from ITS OWN send time (not the request's),
  // so a request that queued for a while still gets a full reply window per operator, and a
  // fan-out where some operators replied is finalized to NEEDS_MANUAL_REVIEW rather than TIMEOUT.
  async timeoutWaitingRequests() {
    const now = Date.now();
    const finalized = [];

    for (const request of this.store.listRequests()) {
      if (request.status !== STATUSES.WAITING_OPERATOR_REPLY) continue;

      let changed = false;
      for (const dispatch of request.dispatches || []) {
        if (dispatch.status !== DISPATCH_STATUSES.WAITING_REPLY) continue;
        const timeout = this.dispatchTimeoutState(request.requestId, dispatch);
        if (timeout.timeoutAt !== null && timeout.timeoutAt < now) {
          this.store.markDispatchTimeout(request.requestId, dispatch.operator);
          this.store.audit('system', 'DISPATCH_TIMEOUT', request.requestId, {
            operator: dispatch.operator,
            phase: timeout.phase,
            anchorAt: timeout.anchorAt,
            outboxStatus: timeout.outboxStatus
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

  // Effective send time for a dispatch: prefer claimedAt (when the gateway phone actually
  // picked the job up and sent it), so a phone/network outage between queueing and pickup
  // doesn't eat into the operator's reply window. Falls back to the outbox row's creation
  // time (sentAt) for jobs never claimed at all, so a gateway that's permanently offline
  // still eventually times out instead of waiting forever.
  dispatchSentAt(requestId, dispatch) {
    const outbox = this.getDispatchOutbox(requestId, dispatch);
    if (!outbox) return null;
    const effective = outbox.sendResult?.confirmedAt || outbox.claimedAt || outbox.sentAt;
    return effective ? new Date(effective).getTime() : null;
  }

  dispatchTimeoutState(requestId, dispatch) {
    const outbox = this.getDispatchOutbox(requestId, dispatch);
    if (!outbox) {
      return { timeoutAt: null, phase: 'missing_outbox', anchorAt: null, outboxStatus: null };
    }

    const confirmedAt = outbox.sendResult?.confirmedAt ? new Date(outbox.sendResult.confirmedAt).getTime() : null;
    const provisionalAt = outbox.claimedAt ? new Date(outbox.claimedAt).getTime() : (outbox.sentAt ? new Date(outbox.sentAt).getTime() : null);

    if (outbox.sentStatus === 'SENT') {
      const anchorAt = confirmedAt ?? provisionalAt;
      return {
        timeoutAt: anchorAt === null ? null : anchorAt + this.replyWindowMs,
        phase: 'operator_reply',
        anchorAt: anchorAt === null ? null : new Date(anchorAt).toISOString(),
        outboxStatus: outbox.sentStatus
      };
    }

    return {
      timeoutAt: provisionalAt === null ? null : provisionalAt + this.sendConfirmationGraceMs,
      phase: 'gateway_confirmation',
      anchorAt: provisionalAt === null ? null : new Date(provisionalAt).toISOString(),
      outboxStatus: outbox.sentStatus
    };
  }

  getDispatchOutbox(requestId, dispatch) {
    return this.store.getOutboxById(dispatch.outboxId) || this.store.getOutboxForGateway(requestId, dispatch.gatewayId);
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
      const inboxMessages = collectDispatchReplyMessages(request, dispatch, store);
      lines.push(`— ${name}:`);
      if (!inboxMessages.length) {
        lines.push('(reply captured)');
      } else {
        inboxMessages.forEach((messageBody, index) => {
          if (index > 0) lines.push('');
          lines.push(messageBody);
        });
      }
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

function collectDispatchReplyMessages(request, dispatch, store) {
  const matchedMessages = store.smsInbox
    .filter((row) => row.matchedRequestId === request.requestId && row.gatewayId === dispatch.gatewayId)
    .sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt))
    .map((row) => row.messageBody);

  if (!matchedMessages.length && dispatch.inboxId) {
    const inbox = store.smsInbox.find((row) => row.id === dispatch.inboxId);
    if (inbox?.messageBody) matchedMessages.push(inbox.messageBody);
  }

  return matchedMessages.filter((messageBody, index, messages) => {
    return messages.indexOf(messageBody) === index;
  });
}

const CONFIDENCE_RANKS = { HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };
function confidenceRank(confidence) {
  return CONFIDENCE_RANKS[confidence] || 0;
}

module.exports = {
  AutomationService,
  DEFAULT_REPLY_WINDOW_MS,
  DEFAULT_SEND_CONFIRMATION_GRACE_MS,
  DEFAULT_DUPLICATE_REQUEST_WINDOW_MS,
  formatCombinedReply
};
