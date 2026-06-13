'use strict';

const { OPERATORS, STATUSES, formatOperatorSms } = require('./domain');

class SmsGatewayClient {
  constructor(store, queue) {
    this.store = store;
    this.queue = queue;
  }

  async dispatchNext(operatorKey) {
    const results = [];
    let request;
    while ((request = this.queue.nextSendable(operatorKey))) {
      const result = await this._sendOne(request, operatorKey);
      results.push(result);
    }
    return results.length ? results : null;
  }

  async _sendOne(request, operatorKey) {
    const operator = OPERATORS[operatorKey];
    const messageBody = formatOperatorSms(request, operatorKey);
    this.store.setFormattedSms(request.requestId, messageBody);
    if (request.status === STATUSES.QUEUED) {
      this.store.updateRequestStatus(request.requestId, STATUSES.SMS_SENT);
    }

    const destinationNumber = request.testDestination || operator.shortcode;

    // Queue the job for the phone to pick up via polling (works from any network).
    const outbox = this.store.addSmsOutbox({
      requestId: request.requestId,
      gatewayId: operator.gatewayId,
      operator: operatorKey,
      silentReference: request.silentReference,
      destinationNumber,
      messageBody,
      sentStatus: 'PENDING_PICKUP',
      sendResult: { mode: 'queued' }
    });

    this.store.setDispatchSent(request.requestId, operatorKey, { outboxId: outbox.id, ok: true });
    this.queue.markDispatched(request.requestId, operatorKey);

    if (request.status === STATUSES.SMS_SENT) {
      this.store.updateRequestStatus(request.requestId, STATUSES.WAITING_OPERATOR_REPLY, {
        gatewayId: operator.gatewayId,
        shortcode: operator.shortcode
      });
    } else {
      this.store.audit('system', 'REQUEST_OPERATOR_SMS_QUEUED', request.requestId, {
        operator: operatorKey,
        gatewayId: operator.gatewayId
      });
    }

    this.store.audit('system', 'REQUEST_OPERATOR_TARGETED', request.requestId, {
      operator: operatorKey,
      gatewayId: operator.gatewayId,
      shortcode: operator.shortcode,
      silentReference: request.silentReference
    });

    return { request, outbox };
  }

  async dispatchAll() {
    const results = [];
    for (const operatorKey of Object.keys(OPERATORS)) {
      const result = await this.dispatchNext(operatorKey);
      if (result) results.push(result);
    }
    return results;
  }
}

module.exports = { SmsGatewayClient };
