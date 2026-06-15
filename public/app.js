'use strict';

/* ── Auth ── */
function authHeaders() {
  const key = localStorage.getItem('adminApiKey');
  return key ? { 'x-api-key': key } : {};
}

function showAuthDialog() {
  const overlay = document.getElementById('authOverlay');
  const input = document.getElementById('authKeyInput');
  input.value = localStorage.getItem('adminApiKey') || '';
  overlay.classList.add('visible');
  input.focus();
}

function submitAuthKey() {
  const val = document.getElementById('authKeyInput').value.trim();
  if (val) localStorage.setItem('adminApiKey', val);
  document.getElementById('authOverlay').classList.remove('visible');
  refresh();
}

// Allow Enter key to submit auth dialog
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('authKeyInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAuthKey();
    if (e.key === 'Escape') document.getElementById('authOverlay').classList.remove('visible');
  });
});

async function apiFetch(url, options = {}, retried = false) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...authHeaders() }
  });
  if (response.status === 401 && !retried) {
    showAuthDialog();
    // Resolve only after user saves their key (overlay close triggers refresh)
    return new Promise(() => {}); // intentionally pending — refresh() re-runs after auth
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

/* ── Tabs ── */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    localStorage.setItem('activeTab', btn.dataset.tab);
  });
});

// Restore last active tab
(function () {
  const saved = localStorage.getItem('activeTab');
  if (saved) {
    const btn = document.querySelector(`.tab-btn[data-tab="${saved}"]`);
    if (btn) btn.click();
  }
})();

/* ── Sub-tabs (SMS Monitor) ── */
document.querySelectorAll('.sub-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sub-tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.subpanel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`subpanel-${btn.dataset.sub}`).classList.add('active');
  });
});

/* ── Refresh ── */
async function refresh() {
  try {
    const [dashRes, unmatchedRes, gatewayRes] = await Promise.all([
      apiFetch('/api/dashboard'),
      apiFetch('/api/sms/unmatched'),
      apiFetch('/api/gateways')
    ]);
    const data = await dashRes.json();
    const unmatchedData = await unmatchedRes.json();
    const gatewayData = gatewayRes.ok ? await gatewayRes.json() : { gateways: data.gateways };
    const unmatched = unmatchedData.unmatched || [];

    window._lastAuditLogs = data.auditLogs || [];

    renderStats(data.requests || []);
    renderGateways(gatewayData.gateways || []);
    renderQueues(data.queues || []);
    renderRequests(data.requests || []);
    renderOutbox(data.smsOutbox || []);
    renderInbox(data.smsInbox || [], unmatched);
    renderReplies(data.whatsappReplies || [], data.requests || []);
    renderUnmatched(unmatched, data.requests || []);
    renderAudit(data.auditLogs || []);

    document.getElementById('lastRefresh').textContent = `Refreshed ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.error('refresh failed:', err);
  }
}

/* ── Stats Row ── */
function renderStats(requests) {
  const today = new Date().toDateString();
  const todayCount = requests.filter((r) => new Date(r.createdAt).toDateString() === today).length;
  const activeStatuses = ['RECEIVED', 'VALIDATED', 'QUEUED', 'SMS_SENT', 'WAITING_OPERATOR_REPLY', 'NEEDS_MANUAL_REVIEW'];
  const active = requests.filter((r) => activeStatuses.includes(r.status)).length;
  const completed = requests.filter((r) => r.status === 'COMPLETED').length;
  const failed = requests.filter((r) => ['FAILED', 'TIMEOUT'].includes(r.status)).length;

  document.getElementById('statsRow').innerHTML = `
    <div class="stat-card">
      <div class="stat-num">${todayCount}</div>
      <div class="stat-label">Today</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:var(--accent)">${active}</div>
      <div class="stat-label">Active</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:var(--success)">${completed}</div>
      <div class="stat-label">Completed</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:${failed > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${failed}</div>
      <div class="stat-label">Failed / Timeout</div>
    </div>
  `;
}

/* ── Helpers ── */
function relativeTime(iso) {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
  return new Date(iso).toLocaleString();
}

function statusClass(status) {
  if (status === 'COMPLETED') return 'status status-ok';
  if (['FAILED', 'TIMEOUT'].includes(status)) return 'status status-err';
  if (status === 'NEEDS_MANUAL_REVIEW') return 'status status-warn';
  return 'status';
}

function renderDispatches(dispatches) {
  if (!dispatches || !dispatches.length) return '';
  const badges = dispatches.map((d) => {
    const cls = d.status === 'REPLY_RECEIVED' ? 'dispatch-ok'
      : ['TIMEOUT', 'FAILED'].includes(d.status) ? 'dispatch-err'
      : 'dispatch-pending';
    const icon = d.status === 'REPLY_RECEIVED' ? '✓'
      : ['TIMEOUT', 'FAILED'].includes(d.status) ? '✗'
      : '…';
    return `<span class="dispatch-badge ${cls}">${d.operator} ${icon}</span>`;
  }).join('');
  return `<div class="dispatch-row">${badges}</div>`;
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Gateways ── */
function renderGateways(gateways) {
  document.querySelector('#gateways').innerHTML = gateways.map((gw) => {
    const isMock = gw.status === 'MOCK';
    const stateKey = isMock ? 'mock' : (gw.online ? 'online' : 'offline');
    const statusLabel = isMock ? 'MOCK' : (gw.online ? 'ONLINE' : 'OFFLINE');
    const statusCls = isMock ? '' : (gw.online ? 'status-ok' : 'status-err');
    const lastSeen = gw.lastSeenAt ? relativeTime(gw.lastSeenAt) : 'never';
    return `
      <div class="card card-gw ${stateKey}">
        <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
          <span class="gw-dot ${stateKey}"></span>
          <strong>${esc(gw.operatorName)}</strong>
          <span class="status ${statusCls}">${statusLabel}</span>
        </div>
        <p style="font-family:monospace;font-size:12px;margin-top:6px;color:var(--text-muted)">${esc(gw.id)}</p>
        <p>Last seen: <strong>${lastSeen}</strong></p>
        ${gw.gatewayUrl ? `<p style="font-size:12px">URL: ${esc(gw.gatewayUrl)}</p>` : '<p style="font-size:12px;color:var(--text-muted)">Mock — no phone configured</p>'}
        <p style="font-size:12px">Trusted: ${(gw.trustedSenders || []).join(', ') || 'None'}</p>
      </div>`;
  }).join('') || '<p class="empty">No gateways registered.</p>';
}

/* ── Queues ── */
function renderQueues(queues) {
  document.querySelector('#queues').innerHTML = queues.map((queue) => `
    <div class="card">
      <strong>${esc(queue.operator)}</strong>
      <p>Active: ${queue.active ? `<code>${esc(queue.active.requestId)}</code>` : 'None'}</p>
      <p>Waiting: ${queue.waiting.length ? queue.waiting.map((r) => `<code>${esc(r.requestId)}</code>`).join(', ') : 'None'}</p>
    </div>
  `).join('') || '<p class="empty">No queues.</p>';
}

/* ── Requests ── */
function renderRequests(requests) {
  document.querySelector('#requests').innerHTML = requests.slice().reverse().map((req) => {
    const canReject = req.status === 'NEEDS_MANUAL_REVIEW';
    const canRetry = ['NEEDS_MANUAL_REVIEW', 'FAILED', 'TIMEOUT'].includes(req.status);
    return `
      <div class="card">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">
          <strong>${esc(req.requestId)}</strong>
          <span class="${statusClass(req.status)}">${req.status}</span>
        </div>
        <p>${esc(req.requestType)}: <strong>${esc(req.payload)}</strong>
          ${(req.targetOperators || []).length ? ` → ${req.targetOperators.join(', ')}` : ''}</p>
        ${renderDispatches(req.dispatches)}
        <p>Requester: <strong>@${esc(req.requesterName)}</strong>${req.channel !== 'manual' ? ` via ${req.channel}` : ''}</p>
        <p style="font-size:12px;color:var(--text-muted)">${relativeTime(req.createdAt)}</p>
        ${req.failedReason ? `<p class="error-text">Reason: ${esc(req.failedReason)}</p>` : ''}
        <div class="actions">
          ${canReject ? `<button class="btn-danger" data-reject="${esc(req.requestId)}">Reject</button>` : ''}
          ${canRetry  ? `<button class="btn-retry"  data-retry="${esc(req.requestId)}">Retry</button>`  : ''}
        </div>
      </div>`;
  }).join('') || '<p class="empty">No requests yet.</p>';

  document.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const reason = window.prompt('Rejection reason (optional):');
      if (reason === null) return;
      try { await postJson(`/api/requests/${encodeURIComponent(btn.dataset.reject)}/reject`, { reason }); }
      catch (e) { alert(e.message); }
      await refresh();
    });
  });
  document.querySelectorAll('[data-retry]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try { await postJson(`/api/requests/${encodeURIComponent(btn.dataset.retry)}/retry`, {}); }
      catch (e) { alert(e.message); }
      await refresh();
    });
  });
}

/* ── Outbox ── */
function renderOutbox(rows) {
  document.querySelector('#outbox').innerHTML = rows.slice().reverse().map((row) => `
    <div class="card">
      <strong>${esc(row.requestId)}</strong>
      <span class="status">${esc(row.sentStatus)}</span>
      <p>${esc(row.gatewayId)} → <code>${esc(row.destinationNumber)}</code></p>
      <pre>${esc(row.messageBody)}</pre>
      <p style="font-size:12px;color:var(--text-muted)">Mode: ${esc(row.sendResult?.mode || 'unknown')}
        ${row.sentAt ? ` · ${relativeTime(row.sentAt)}` : ''}</p>
      ${row.sendResult?.error ? `<p class="error-text">${esc(row.sendResult.error)}</p>` : ''}
    </div>
  `).join('') || '<p class="empty">No outbound SMS yet.</p>';
}

/* ── Inbox ── */
function renderInbox(inbox, unmatched) {
  const unmatchedIds = new Set((unmatched || []).map((u) => u.id));
  document.querySelector('#inbox').innerHTML = inbox.slice().reverse().map((entry) => {
    const isUnmatched = unmatchedIds.has(entry.id);
    return `
      <div class="card">
        <strong>${esc(entry.senderNumber || entry.from || '?')}</strong>
        <span class="status ${isUnmatched ? 'status-warn' : 'status-ok'}">${isUnmatched ? 'UNMATCHED' : 'MATCHED'}</span>
        <p style="font-size:12px;color:var(--text-muted)">${esc(entry.gatewayId)}</p>
        <pre>${esc(entry.messageBody)}</pre>
        <p style="font-size:12px;color:var(--text-muted)">${relativeTime(entry.receivedAt)}</p>
        ${entry.requestId ? `<p>Matched to: <code>${esc(entry.requestId)}</code></p>` : ''}
      </div>`;
  }).join('') || '<p class="empty">No received SMS yet.</p>';
}

/* ── Reply Drafts ── */
function renderReplies(replies, requests) {
  const requestById = new Map(requests.map((r) => [r.requestId, r]));
  document.querySelector('#replies').innerHTML = replies.slice().reverse().map((reply) => {
    const request = requestById.get(reply.requestId);
    const canApprove = reply.sentStatus === 'DRAFT' && request?.status === 'NEEDS_MANUAL_REVIEW';
    const isLive = ['POSTED_LIVE', 'APPROVED_FOR_EDIT'].includes(reply.sentStatus);
    return `
      <div class="card">
        <strong>${esc(reply.requestId)}</strong>
        <span class="status ${reply.sentStatus === 'POSTED' ? 'status-ok' : isLive ? 'status-warn' : ''}">${esc(reply.sentStatus)}</span>
        <pre>${esc(reply.replyText)}</pre>
        ${reply.postedMessageId ? `<p style="font-size:12px;color:var(--text-muted)">Telegram msg: ${esc(reply.postedMessageId)}</p>` : ''}
        ${canApprove ? `<button data-approve="${esc(reply.requestId)}">Approve &amp; Post</button>` : ''}
      </div>`;
  }).join('') || '<p class="empty">No reply drafts.</p>';

  document.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try { await postJson(`/api/whatsapp-replies/${encodeURIComponent(btn.dataset.approve)}/approve`, {}); }
      catch (e) { alert(e.message); }
      await refresh();
    });
  });
}

/* ── Unmatched SMS ── */
function renderUnmatched(unmatched, requests) {
  const waitingRequests = requests.filter((r) =>
    ['WAITING_OPERATOR_REPLY', 'NEEDS_MANUAL_REVIEW', 'TIMEOUT'].includes(r.status)
  );
  const container = document.querySelector('#unmatched');
  if (!unmatched.length) {
    container.innerHTML = '<p class="empty">No unmatched SMS.</p>';
    return;
  }
  container.innerHTML = unmatched.map((inbox) => {
    const options = waitingRequests.map((r) =>
      `<option value="${esc(r.requestId)}">${esc(r.requestId)} (${esc(r.requestType)} ${esc(r.payload)})</option>`
    ).join('');
    return `
      <div class="card">
        <strong>${esc(inbox.senderNumber)}</strong>
        <span class="status status-warn">UNMATCHED</span>
        <p style="font-size:12px;color:var(--text-muted)">${esc(inbox.gatewayId)}</p>
        <pre>${esc(inbox.messageBody)}</pre>
        <p style="font-size:12px;color:var(--text-muted)">${relativeTime(inbox.receivedAt)}</p>
        ${waitingRequests.length ? `
          <div class="match-form">
            <select data-inbox-id="${esc(inbox.id)}">${options}</select>
            <button class="btn-match" data-match-inbox="${esc(inbox.id)}">Match</button>
          </div>` : '<p style="color:var(--text-muted);font-size:12px;margin-top:8px">No waiting requests to match.</p>'}
      </div>`;
  }).join('');

  document.querySelectorAll('[data-match-inbox]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const inboxId = btn.dataset.matchInbox;
      const select = document.querySelector(`select[data-inbox-id="${inboxId}"]`);
      if (!select) return;
      try { await postJson('/api/manual-match', { inboxId, requestId: select.value }); }
      catch (e) { alert(e.message); }
      await refresh();
    });
  });
}

/* ── Audit Log ── */
function renderAudit(logs) {
  const banner = document.getElementById('chainIntegrity');
  if (!logs.length) {
    banner.className = 'integrity-banner integrity-ok';
    banner.textContent = 'No audit entries yet.';
  } else {
    banner.className = 'integrity-banner integrity-ok';
    banner.textContent = `Chain intact — ${logs.length} entries in view (last 100 shown)`;
  }

  document.querySelector('#audit').innerHTML = logs.slice().reverse().map((log) => {
    const detail = log.detail ? JSON.stringify(log.detail) : '';
    return `
      <div class="card">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <strong>${esc(log.action)}</strong>
          <span class="status" style="margin-left:0">${esc(log.actor || 'system')}</span>
          ${log.requestId ? `<code style="font-size:11px;color:var(--text-muted)">${esc(log.requestId)}</code>` : ''}
        </div>
        <p style="font-size:12px;color:var(--text-muted)">${relativeTime(log.timestamp)}</p>
        ${detail ? `<pre style="font-size:11px;margin-top:6px">${esc(detail)}</pre>` : ''}
      </div>`;
  }).join('') || '<p class="empty">No audit entries yet.</p>';
}

/* ── CSV Export ── */
function exportAuditCsv() {
  const logs = window._lastAuditLogs || [];
  const header = 'timestamp,actor,action,requestId,detail\n';
  const rows = logs.map((l) =>
    ['timestamp', 'actor', 'action', 'requestId'].map((k) => `"${String(l[k] || '').replace(/"/g, '""')}"`).concat(
      [`"${JSON.stringify(l.detail || {}).replace(/"/g, '""')}"`]
    ).join(',')
  ).join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Form handlers ── */
document.querySelector('#requestForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await postJson('/api/requests', Object.fromEntries(form.entries()));
    await refresh();
  } catch (e) {
    alert(e.message);
  }
});

document.querySelector('#smsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await postJson('/api/sms/inbound', Object.fromEntries(form.entries()));
    await refresh();
  } catch (e) {
    alert(e.message);
  }
});

/* ── QR Provisioning ── */
let _lastProvPayload = '';

async function generateProvisionQr() {
  const gwId   = document.getElementById('provGwId').value;
  const url    = document.getElementById('provUrl').value.trim();
  const pin    = document.getElementById('provPin').value.trim();
  const secret = document.getElementById('provSecret').value.trim();
  const errEl  = document.getElementById('provError');
  const resEl  = document.getElementById('provResult');

  errEl.style.display = 'none';
  resEl.style.display = 'none';

  if (!url) { errEl.textContent = 'Backend URL is required.'; errEl.style.display = 'block'; return; }
  if (!pin)  { errEl.textContent = 'PIN is required (it will lock Settings on the phone).'; errEl.style.display = 'block'; return; }

  try {
    const data = await postJson('/api/admin/generate-qr', { gwId, url, pin, secret });
    _lastProvPayload = data.payload || '';
    document.getElementById('provQrImg').src = data.dataUrl;
    resEl.style.display = 'block';
  } catch (e) {
    errEl.textContent = `Error: ${e.message}`;
    errEl.style.display = 'block';
  }
}

function copyProvPayload() {
  if (!_lastProvPayload) return;
  navigator.clipboard.writeText(_lastProvPayload).then(() => {
    const btn = document.querySelector('#provResult .btn-secondary');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

// Pre-fill backend URL with current origin on Gateways tab open
document.querySelector('.tab-btn[data-tab="gateways"]').addEventListener('click', () => {
  const urlInput = document.getElementById('provUrl');
  if (!urlInput.value) urlInput.value = window.location.origin;
});

/* ── Boot ── */
refresh();
setInterval(refresh, 10000);
