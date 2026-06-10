'use strict';

const { OPERATORS, STATUSES, formatOperatorSms } = require('./domain');

class SmsGatewayClient {
  constructor(store, queue) {
    this.store = store;
    this.queue = queue;
  }

  async dispatchNext(operatorKey) {
    const request = this.queue.nextSendable(operatorKey);
    if (!request) return null;

    const operator = OPERATORS[operatorKey];
    const gateway = this.store.getGatewayByOperator(operatorKey);
    const messageBody = formatOperatorSms(request, operatorKey);
    this.store.setFormattedSms(request.requestId, messageBody);
    if (request.status === STATUSES.QUEUED) {
      this.store.updateRequestStatus(request.requestId, STATUSES.SMS_SENT);
    }

    const sendResult = await this.sendViaGateway(gateway, {
      to: operator.shortcode,
      message: messageBody,
      requestId: request.requestId,
      operator: operatorKey
    });

    const outbox = this.store.addSmsOutbox({
      requestId: request.requestId,
      gatewayId: operator.gatewayId,
      operator: operatorKey,
      silentReference: request.silentReference,
      destinationNumber: operator.shortcode,
      messageBody,
      sentStatus: sendResult.ok ? 'SENT' : 'FAILED',
      sendResult
    });

    this.queue.markDispatched(request.requestId, operatorKey);

    if (!sendResult.ok) {
      this.store.updateRequestStatus(request.requestId, STATUSES.FAILED, {
        failedReason: sendResult.error || 'SMS gateway send failed.'
      });
      return { request: this.store.getRequest(request.requestId), outbox };
    }

    if (request.status === STATUSES.SMS_SENT) {
      this.store.updateRequestStatus(request.requestId, STATUSES.WAITING_OPERATOR_REPLY, {
        gatewayId: operator.gatewayId,
        shortcode: operator.shortcode
      });
    } else {
      this.store.audit('system', 'REQUEST_OPERATOR_SMS_SENT', request.requestId, {
        operator: operatorKey,
        gatewayId: operator.gatewayId,
        shortcode: operator.shortcode
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

  async sendViaGateway(gateway, payload) {
    if (!gateway.gatewayUrl) {
      return {
        ok: true,
        mode: 'mock',
        message: 'No gatewayUrl configured; SMS recorded in outbox only.'
      };
    }

    const url = `${gateway.gatewayUrl}${gateway.sendPath}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(gateway.apiKey ? { authorization: `Bearer ${gateway.apiKey}` } : {})
        },
        body: JSON.stringify({
          to: payload.to,
          message: payload.message,
          requestId: payload.requestId,
          operator: payload.operator
        })
      });
      const responseText = await response.text();
      return {
        ok: response.ok,
        mode: 'http',
        status: response.status,
        response: responseText
      };
    } catch (error) {
      return {
        ok: false,
        mode: 'http',
        error: error.message
      };
    }
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
