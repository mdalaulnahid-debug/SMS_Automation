'use strict';

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok && response.status !== 202) {
    throw new Error(body.error || JSON.stringify(body));
  }
  return body;
}

async function refresh() {
  const response = await fetch('/api/dashboard');
  const data = await response.json();
  renderGateways(data.gateways);
  renderQueues(data.queues);
  renderRequests(data.requests);
  renderOutbox(data.smsOutbox);
  renderReplies(data.whatsappReplies, data.requests);
  renderAudit(data.auditLogs);
}

function renderGateways(gateways) {
  document.querySelector('#gateways').innerHTML = gateways
    .map(
      (gateway) => `
        <div class="card">
          <strong>${gateway.operatorName}</strong>
          <p>${gateway.id}</p>
          <span class="status">${gateway.status}</span>
          <p>Gateway URL: ${gateway.gatewayUrl || 'Mock mode'}</p>
          <p>Trusted senders: ${(gateway.trustedSenders || []).join(', ') || 'None'}</p>
          <p>Last seen: ${gateway.lastSeenAt || 'never'}</p>
        </div>
      `
    )
    .join('');
}

function renderOutbox(rows) {
  document.querySelector('#outbox').innerHTML = rows
    .slice()
    .reverse()
    .map(
      (row) => `
        <div class="card">
          <strong>${row.requestId}</strong>
          <span class="status">${row.sentStatus}</span>
          <p>${row.gatewayId} -> ${row.destinationNumber}</p>
          <pre>${row.messageBody}</pre>
          <p>Mode: ${row.sendResult?.mode || 'unknown'}</p>
          ${row.sendResult?.error ? `<p>Error: ${row.sendResult.error}</p>` : ''}
        </div>
      `
    )
    .join('');
}

function renderQueues(queues) {
  document.querySelector('#queues').innerHTML = queues
    .map(
      (queue) => `
        <div class="card">
          <strong>${queue.operator}</strong>
          <p>Active: ${queue.active ? queue.active.requestId : 'None'}</p>
          <p>Waiting: ${queue.waiting.map((request) => request.requestId).join(', ') || 'None'}</p>
        </div>
      `
    )
    .join('');
}

function renderRequests(requests) {
  document.querySelector('#requests').innerHTML = requests
    .map(
      (request) => `
        <div class="card">
          <strong>${request.requestId}</strong>
          <span class="status">${request.status}</span>
          <p>${request.operator} ${request.requestType}: ${request.payload}</p>
          <p>Target operators: ${(request.targetOperators || [request.operator]).join(', ')}</p>
          <p>Requester: @${request.requesterName}</p>
          <p>SMS: ${request.formattedSmsText || 'Not sent yet'}</p>
        </div>
      `
    )
    .join('');
}

function renderReplies(replies, requests) {
  const requestById = new Map(requests.map((request) => [request.requestId, request]));
  document.querySelector('#replies').innerHTML = replies
    .map((reply) => {
      const request = requestById.get(reply.requestId);
      const canApprove = reply.sentStatus === 'DRAFT' && request?.status === 'NEEDS_MANUAL_REVIEW';
      return `
        <div class="card">
          <strong>${reply.requestId}</strong>
          <span class="status">${reply.sentStatus}</span>
          <pre>${reply.replyText}</pre>
          ${
            canApprove
              ? `<button data-approve="${reply.requestId}">Approve as Posted</button>`
              : ''
          }
        </div>
      `;
    })
    .join('');

  document.querySelectorAll('[data-approve]').forEach((button) => {
    button.addEventListener('click', async () => {
      await postJson(`/api/whatsapp-replies/${button.dataset.approve}/approve`, {});
      await refresh();
    });
  });
}

function renderAudit(logs) {
  document.querySelector('#audit').innerHTML = logs
    .slice()
    .reverse()
    .map((log) => `<div class="card"><strong>${log.action}</strong><p>${log.timestamp}</p></div>`)
    .join('');
}

document.querySelector('#requestForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  await postJson('/api/requests', Object.fromEntries(form.entries()));
  await refresh();
});

document.querySelector('#smsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  await postJson('/api/sms/inbound', Object.fromEntries(form.entries()));
  await refresh();
});

refresh();
