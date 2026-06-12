'use strict';

function authHeaders() {
  const key = localStorage.getItem('adminApiKey');
  return key ? { 'x-api-key': key } : {};
}

function promptForKey() {
  const key = window.prompt('Admin API key (set in config/auth.json):', localStorage.getItem('adminApiKey') || '');
  if (key !== null) localStorage.setItem('adminApiKey', key.trim());
  return localStorage.getItem('adminApiKey');
}

async function apiFetch(url, options = {}, retried = false) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...authHeaders() }
  });
  if (response.status === 401 && !retried) {
    promptForKey();
    return apiFetch(url, options, true);
  }
  return response;
}

async function postJson(url, payload) {
  const response = await apiFetch(url, {
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
  const [dashRes, unmatchedRes] = await Promise.all([
    apiFetch('/api/dashboard'),
    apiFetch('/api/sms/unmatched')
  ]);
  const data = await dashRes.json();
  const unmatchedData = await unmatchedRes.json();
  renderGateways(data.gateways);
  renderQueues(data.queues);
  renderRequests(data.requests);
  renderOutbox(data.smsOutbox);
  renderReplies(data.whatsappReplies, data.requests);
  renderUnmatched(unmatchedData.unmatched || [], data.requests);
  renderAudit(data.auditLogs);
}

function renderGateways(gateways) {
  document.querySelector('#gateways').innerHTML = gateways
    .map(
      (gw) => `
        <div class="card">
          <strong>${gw.operatorName}</strong>
          <p>${gw.id}</p>
          <span class="status">${gw.status}</span>
          <p>Gateway URL: ${gw.gatewayUrl || 'Mock mode'}</p>
          <p>Trusted senders: ${(gw.trustedSenders || []).join(', ') || 'None'}</p>
          <p>Last seen: ${gw.lastSeenAt || 'never'}</p>
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
          <p>Waiting: ${queue.waiting.map((r) => r.requestId).join(', ') || 'None'}</p>
        </div>
      `
    )
    .join('');
}

function statusClass(status) {
  if (status === 'COMPLETED') return 'status status-ok';
  if (status === 'FAILED' || status === 'TIMEOUT') return 'status status-err';
  if (status === 'NEEDS_MANUAL_REVIEW') return 'status status-warn';
  return 'status';
}

function renderRequests(requests) {
  document.querySelector('#requests').innerHTML = requests
    .map((req) => {
      const canReject = req.status === 'NEEDS_MANUAL_REVIEW';
      const canRetry = ['NEEDS_MANUAL_REVIEW', 'FAILED', 'TIMEOUT'].includes(req.status);
      const dispatches = (req.dispatches || [])
        .map((d) => `${d.operator}: ${d.status}`)
        .join(', ');
      return `
        <div class="card">
          <strong>${req.requestId}</strong>
          <span class="${statusClass(req.status)}">${req.status}</span>
          <p>${req.operator} ${req.requestType}: ${req.payload}</p>
          <p>Target: ${(req.targetOperators || []).join(', ')}</p>
          ${dispatches ? `<p>Dispatches: ${dispatches}</p>` : ''}
          <p>Requester: @${req.requesterName}${req.channel !== 'manual' ? ` (${req.channel})` : ''}</p>
          <p>SMS: ${req.formattedSmsText || 'Not sent yet'}</p>
          ${req.failedReason ? `<p class="error-text">Reason: ${req.failedReason}</p>` : ''}
          <div class="actions">
            ${canReject ? `<button class="btn-danger" data-reject="${req.requestId}">Reject</button>` : ''}
            ${canRetry ? `<button class="btn-retry" data-retry="${req.requestId}">Retry</button>` : ''}
          </div>
        </div>
      `;
    })
    .join('');

  document.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const reason = window.prompt('Rejection reason (optional):');
      if (reason === null) return;
      try {
        await postJson(`/api/requests/${encodeURIComponent(btn.dataset.reject)}/reject`, { reason });
      } catch (e) {
        alert(e.message);
      }
      await refresh();
    });
  });
  document.querySelectorAll('[data-retry]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await postJson(`/api/requests/${encodeURIComponent(btn.dataset.retry)}/retry`, {});
      } catch (e) {
        alert(e.message);
      }
      await refresh();
    });
  });
}

function renderReplies(replies, requests) {
  const requestById = new Map(requests.map((r) => [r.requestId, r]));
  document.querySelector('#replies').innerHTML = replies
    .map((reply) => {
      const request = requestById.get(reply.requestId);
      const canApprove = reply.sentStatus === 'DRAFT' && request?.status === 'NEEDS_MANUAL_REVIEW';
      return `
        <div class="card">
          <strong>${reply.requestId}</strong>
          <span class="status">${reply.sentStatus}</span>
          <pre>${reply.replyText}</pre>
          ${canApprove ? `<button data-approve="${reply.requestId}">Approve as Posted</button>` : ''}
        </div>
      `;
    })
    .join('');

  document.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await postJson(`/api/whatsapp-replies/${btn.dataset.approve}/approve`, {});
      await refresh();
    });
  });
}

function renderUnmatched(unmatched, requests) {
  const waitingRequests = requests.filter((r) => r.status === 'WAITING_OPERATOR_REPLY');
  const container = document.querySelector('#unmatched');
  if (!unmatched.length) {
    container.innerHTML = '<p>No unmatched SMS.</p>';
    return;
  }
  container.innerHTML = unmatched
    .map((inbox) => {
      const options = waitingRequests
        .map((r) => `<option value="${r.requestId}">${r.requestId} (${r.requestType} ${r.payload})</option>`)
        .join('');
      return `
        <div class="card">
          <strong>${inbox.gatewayId}</strong> from <strong>${inbox.senderNumber}</strong>
          <span class="status">UNMATCHED</span>
          <pre>${inbox.messageBody}</pre>
          <p>Received: ${inbox.receivedAt}</p>
          ${waitingRequests.length ? `
            <div class="match-form">
              <select data-inbox-id="${inbox.id}">${options}</select>
              <button class="btn-match" data-match-inbox="${inbox.id}">Match to Request</button>
            </div>
          ` : '<p>No waiting requests to match.</p>'}
        </div>
      `;
    })
    .join('');

  document.querySelectorAll('[data-match-inbox]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const inboxId = btn.dataset.matchInbox;
      const select = document.querySelector(`select[data-inbox-id="${inboxId}"]`);
      if (!select) return;
      try {
        await postJson('/api/manual-match', { inboxId, requestId: select.value });
      } catch (e) {
        alert(e.message);
      }
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
setInterval(refresh, 10000);
