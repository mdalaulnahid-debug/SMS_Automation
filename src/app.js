'use strict';

const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { AutomationStore } = require('./store');
const { OperatorQueue } = require('./queue');
const { SmsGatewayClient } = require('./smsGateway');
const { AutomationService } = require('./service');
const { loadGatewayConfig } = require('./config');

function createApp() {
  const gatewayConfig = loadGatewayConfig();
  const store = new AutomationStore(gatewayConfig);
  const queue = new OperatorQueue(store);
  const smsGateway = new SmsGatewayClient(store, queue);
  const service = new AutomationService({ store, queue, smsGateway });

  async function handle(req, res) {
    try {
      if (req.method === 'GET' && req.url === '/') {
        return serveFile(res, 'index.html', 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/app.js') {
        return serveFile(res, 'app.js', 'text/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/api/dashboard') {
        return json(res, 200, {
          ...store.snapshot(),
          queues: queue.snapshot()
        });
      }
      if (req.method === 'POST' && req.url === '/api/requests') {
        const body = await readJson(req);
        const result = await service.submitWhatsAppRequest(body);
        return json(res, result.ok ? 201 : 400, result);
      }
      if (req.method === 'POST' && req.url === '/api/sms/inbound') {
        const body = await readJson(req);
        const result = service.receiveSmsWebhook(body);
        return json(res, result.ok ? 200 : 202, result);
      }
      if (req.method === 'POST' && req.url.startsWith('/api/whatsapp-replies/')) {
        const requestId = decodeURIComponent(req.url.split('/').at(-2) || '');
        const action = req.url.split('/').at(-1);
        if (action !== 'approve') return json(res, 404, { error: 'Not found' });
        return json(res, 200, { request: await service.approveWhatsAppReply(requestId) });
      }
      if (req.method === 'POST' && req.url === '/api/timeouts/run') {
        return json(res, 200, { timedOut: service.timeoutWaitingRequests() });
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }

  return { handle, store, queue, smsGateway, service };
}

async function serveFile(res, fileName, contentType) {
  const content = await readFile(join(__dirname, '..', 'public', fileName), 'utf8');
  res.writeHead(200, { 'content-type': contentType });
  res.end(content);
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

module.exports = { createApp };
