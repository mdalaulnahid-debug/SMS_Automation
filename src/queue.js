'use strict';

const { OPERATORS, STATUSES } = require('./domain');

class OperatorQueue {
  constructor(store) {
    this.store = store;
    this.queues = new Map(Object.keys(OPERATORS).map((operator) => [operator, []]));
  }

  enqueue(request) {
    const targetOperators = request.targetOperators || [request.operator];
    this.store.updateRequestStatus(request.requestId, STATUSES.VALIDATED);
    this.store.updateRequestStatus(request.requestId, STATUSES.QUEUED);
    targetOperators.forEach((operatorKey) => {
      const queue = this.queues.get(operatorKey);
      if (!queue) throw new Error(`No queue configured for operator: ${operatorKey}`);
      queue.push(request.requestId);
    });
    return targetOperators.map((operatorKey) => this.describe(operatorKey));
  }

  enqueueExisting(request) {
    const targetOperators = request.targetOperators || [request.operator];
    targetOperators.forEach((operatorKey) => {
      const queue = this.queues.get(operatorKey);
      if (!queue) throw new Error(`No queue configured for operator: ${operatorKey}`);
      if (!queue.includes(request.requestId)) queue.push(request.requestId);
    });
  }

  nextSendable(operatorKey) {
    const queue = this.queues.get(operatorKey);
    if (!queue || queue.length === 0) return null;
    return this.store.getRequest(queue[0]);
  }

  markDispatched(requestId, operatorKey) {
    const queue = this.queues.get(operatorKey);
    if (queue?.[0] === requestId) queue.shift();
  }

  activePending(operatorKey) {
    const operator = OPERATORS[operatorKey];
    if (!operator) return null;
    return this.store
      .listRequests()
      .find((request) => {
        if (!(request.targetOperators || [request.operator]).includes(operatorKey)) return false;
        const sentForOperator = this.store.smsOutbox.find((row) => {
          return row.requestId === request.requestId && row.operator === operatorKey;
        });
        if (!sentForOperator) return false;
        return [
          STATUSES.SMS_SENT,
          STATUSES.WAITING_OPERATOR_REPLY,
          STATUSES.REPLY_RECEIVED,
          STATUSES.NEEDS_MANUAL_REVIEW
        ].includes(request.status);
      });
  }

  describe(operatorKey) {
    const queue = this.queues.get(operatorKey) || [];
    return {
      operator: operatorKey,
      active: this.activePending(operatorKey) || null,
      waiting: queue.map((requestId) => this.store.getRequest(requestId))
    };
  }

  // Rebuild the in-memory waiting lists after a restart from persisted state. Requests still
  // in QUEUED (validated but not yet sent for a given operator) are re-queued in FIFO order;
  // WAITING_OPERATOR_REPLY requests are not re-queued — activePending() recognizes them as
  // in-flight from the restored outbox, so they keep their slot and original reply window.
  rebuild() {
    for (const operatorKey of this.queues.keys()) this.queues.set(operatorKey, []);
    const queued = this.store
      .listRequests()
      .filter((request) => request.status === STATUSES.QUEUED)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const request of queued) {
      for (const operatorKey of request.targetOperators || [request.operator]) {
        const alreadySent = this.store.smsOutbox.find(
          (row) => row.requestId === request.requestId && row.operator === operatorKey
        );
        if (!alreadySent && this.queues.has(operatorKey)) {
          this.queues.get(operatorKey).push(request.requestId);
        }
      }
    }
  }

  snapshot() {
    return Object.keys(OPERATORS).map((operator) => this.describe(operator));
  }
}

module.exports = { OperatorQueue };
