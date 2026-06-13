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
    const gateway = this.store.getGatewayByOperator(operatorKey);
    const messageBody = formatOperatorSms(request, operatorKey);
    this.store.setFormattedSms(request.requestId, messageBody);
    if (request.status === STATUSES.QUEUED) {
      this.store.updateRequestStatus(request.requestId, STATUSES.SMS_SENT);
    }

    const destinationNumber = request.testDestination || operator.shortcode;
    const sendResult = await this.sendViaGateway(gateway, {
      to: destinationNumber,
      message: messageBody,
      requestId: request.requestId,
      operator: operatorKey
    });

    const outbox = this.store.addSmsOutbox({
      requestId: request.requestId,
      gatewayId: operator.gatewayId,
      operator: operatorKey,
      silentReference: request.silentReference,
      destinationNumber,
      messageBody,
      sentStatus: sendResult.ok ? 'SENT' : 'FAILED',
      sendResult
    });

    this.store.setDispatchSent(request.requestId, operatorKey, {
      outboxId: outbox.id,
      ok: sendResult.ok
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
    const body = JSON.stringify({
      to: payload.to,
      message: payload.message,
      requestId: payload.requestId,
      operator: payload.operator
    });
    const headers = {
      'content-type': 'application/json',
      ...(gateway.apiKey ? { 'x-gateway-secret': gateway.apiKey } : {})
    };

    const MAX_ATTEMPTS = 3;
    const BASE_DELAY_MS = 2000;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(url, { method: 'POST', headers, body });
        const responseText = await response.text();
        if (response.ok) {
          return { ok: true, mode: 'http', status: response.status, response: responseText, attempt };
        }
        // 4xx = permanent failure (bad request / auth) — don't retry
        if (response.status >= 400 && response.status < 500) {
          return { ok: false, mode: 'http', status: response.status, response: responseText, attempt };
        }
        // 5xx — retry after backoff
        if (attempt < MAX_ATTEMPTS) await delay(BASE_DELAY_MS * attempt);
      } catch (error) {
        if (attempt < MAX_ATTEMPTS) await delay(BASE_DELAY_MS * attempt);
        else return { ok: false, mode: 'http', error: error.message, attempt };
      }
    }
    return { ok: false, mode: 'http', error: 'Max retries exceeded', attempt: MAX_ATTEMPTS };
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { SmsGatewayClient };
