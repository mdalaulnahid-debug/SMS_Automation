'use strict';
/* Desktop admin console — relies on shared.js (loaded first) for theme,
   auth, apiFetch/postJson, relativeTime/esc/statusChipClass/renderDispatches,
   pollHealth, CSV/QR helpers. See docs/design-system.md. */

/* ── Auth gate (this page's 401 handler — full page, not an overlay) ── */
function showGate(message) {
  document.getElementById('adminApp').style.display = 'none';
  document.getElementById('authGate').style.display = 'flex';
  const err = document.getElementById('gateError');
  if (message) { err.textContent = message; err.style.display = 'block'; }
  else { err.style.display = 'none'; }
}
window.onAuthRequired = () => showGate('Invalid or expired API key.');

async function unlockAdmin() {
  const val = document.getElementById('gateKeyInput').value.trim();
  const err = document.getElementById('gateError');
  err.style.display = 'none';
  if (!val) { err.textContent = 'API key is required.'; err.style.display = 'block'; return; }
  localStorage.setItem('adminApiKey', val);

  // Verify by hitting an admin-gated endpoint before showing the app.
  const res = await fetch('/api/gateways', { headers: authHeaders() });
  if (res.status === 401) {
    localStorage.removeItem('adminApiKey');
    err.textContent = 'Invalid API key.';
    err.style.display = 'block';
    return;
  }
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('adminApp').style.display = 'block';
  boot();
}

function lockAdmin() {
  localStorage.removeItem('adminApiKey');
  window.location.reload();
}

document.getElementById('gateKeyInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') unlockAdmin();
});

/* ── Sidebar navigation ── */
document.querySelectorAll('.sidebar-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.admin-section').forEach((s) => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`section-${btn.dataset.section}`).classList.add('active');
  });
});

/* ── Provision URL pre-fill ── */
const _provUrl = document.getElementById('provUrl');
if (_provUrl && !_provUrl.value) _provUrl.value = window.location.origin;

/* ── Overview: stats + gateways + queues ── */
function renderStats(requests) {
  const today = new Date().toDateString();
  const todayCount = requests.filter((r) => new Date(r.createdAt).toDateString() === today).length;
  const active    = requests.filter((r) => ['RECEIVED','VALIDATED','QUEUED','SMS_SENT','WAITING_OPERATOR_REPLY','NEEDS_MANUAL_REVIEW'].includes(r.status)).length;
  const completed = requests.filter((r) => r.status === 'COMPLETED').length;
  const failed    = requests.filter((r) => ['FAILED','TIMEOUT'].includes(r.status)).length;

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card"><div class="stat-num">${todayCount}</div><div class="stat-lbl">Today</div></div>
    <div class="stat-card"><div class="stat-num accent">${active}</div><div class="stat-lbl">Active</div></div>
    <div class="stat-card"><div class="stat-num success">${completed}</div><div class="stat-lbl">Completed</div></div>
    <div class="stat-card"><div class="stat-num ${failed > 0 ? 'danger' : ''}">${failed}</div><div class="stat-lbl">Failed</div></div>`;
}

function renderGatewayCards(gateways) {
  document.getElementById('gatewayCards').innerHTML = gateways.map((gw) => {
    const isMock   = gw.status === 'MOCK';
    const stateKey = isMock ? 'mock' : (gw.online ? 'online' : 'offline');
    const chipCls  = isMock ? 'chip-muted' : (gw.online ? 'chip-success' : 'chip-danger');
    const label    = isMock ? 'MOCK' : (gw.online ? 'ONLINE' : 'OFFLINE');
    const lastSeen = gw.lastSeenAt ? relativeTime(gw.lastSeenAt) : 'never';
    return `
      <div class="gw-card ${stateKey}">
        <div class="gw-icon"><span class="material-symbols-outlined">cell_tower</span></div>
        <div class="gw-info">
          <div class="gw-name">${esc(gw.operatorName || gw.id)}</div>
          <div class="gw-id">${esc(gw.id)}</div>
          <div class="gw-meta">Last seen: ${lastSeen}</div>
        </div>
        <span class="chip ${chipCls}">${label}</span>
      </div>`;
  }).join('') || '<p class="empty">No gateways configured.</p>';
}

function renderQueues(queues) {
  document.getElementById('queuesBody').innerHTML = queues.map((q) => `
    <tr>
      <td><strong>${esc(q.operator)}</strong></td>
      <td>${q.active ? `<span class="cell-mono">${esc(q.active.requestId)}</span>` : '<span class="cell-muted">None</span>'}</td>
      <td>${q.waiting.length ? q.waiting.map((r) => `<span class="cell-mono">${esc(r.requestId)}</span>`).join(', ') : '<span class="cell-muted">None</span>'}</td>
    </tr>`
  ).join('') || `<tr><td colspan="3" class="empty">No queues.</td></tr>`;
}

/* ── Requests & Replies ── */
function renderRequestsTable(requests) {
  document.getElementById('countRequests').textContent = requests.length;
  document.getElementById('requestsBody').innerHTML = requests.slice().reverse().map((req) => {
    const canReject = req.status === 'NEEDS_MANUAL_REVIEW';
    const canRetry  = ['NEEDS_MANUAL_REVIEW','FAILED','TIMEOUT'].includes(req.status);
    return `
      <tr>
        <td><span class="cell-mono">${esc(req.requestId)}</span></td>
        <td>
          <div>${esc(req.requestType)}: <strong>${esc(req.payload)}</strong></div>
          ${(req.targetOperators||[]).length ? `<div class="cell-muted">→ ${req.targetOperators.join(', ')}</div>` : ''}
          ${renderDispatches(req.dispatches)}
        </td>
        <td>
          <span class="${statusChipClass(req.status)}">${req.status}</span>
          ${req.failedReason ? `<div class="error-text">${esc(req.failedReason)}</div>` : ''}
        </td>
        <td>@${esc(req.requesterName)}${req.channel !== 'manual' ? `<div class="cell-muted">via ${esc(req.channel)}</div>` : ''}</td>
        <td class="cell-muted">${relativeTime(req.createdAt)}</td>
        <td class="cell-actions">
          ${canReject ? `<button class="btn-sm btn-danger" data-reject="${esc(req.requestId)}">Reject</button>` : ''}
          ${canRetry  ? `<button class="btn-sm btn-retry"  data-retry="${esc(req.requestId)}">Retry</button>`  : ''}
        </td>
      </tr>`;
  }).join('') || `<tr><td colspan="6" class="empty">No active requests.</td></tr>`;

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

function renderRepliesTable(replies, requests) {
  const requestById = new Map(requests.map((r) => [r.requestId, r]));
  document.getElementById('repliesBody').innerHTML = replies.slice().reverse().map((reply) => {
    const request    = requestById.get(reply.requestId);
    const canApprove = reply.sentStatus === 'DRAFT' && request?.status === 'NEEDS_MANUAL_REVIEW';
    return `
      <tr>
        <td><span class="cell-mono">${esc(reply.requestId)}</span></td>
        <td><span class="chip ${reply.sentStatus === 'POSTED' ? 'chip-success' : 'chip-accent'}">${esc(reply.sentStatus)}</span></td>
        <td class="cell-truncate" title="${esc(reply.replyText)}">${esc(reply.replyText)}</td>
        <td class="cell-muted">${reply.postedMessageId ? esc(reply.postedMessageId) : '—'}</td>
        <td class="cell-actions">
          ${canApprove ? `<button class="btn-sm btn-primary" data-approve="${esc(reply.requestId)}">Approve &amp; Post</button>` : ''}
        </td>
      </tr>`;
  }).join('') || `<tr><td colspan="5" class="empty">No reply drafts.</td></tr>`;

  document.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try { await postJson(`/api/reply-drafts/${encodeURIComponent(btn.dataset.approve)}/approve`, {}); }
      catch (e) { alert(e.message); }
      await refresh();
    });
  });
}

/* ── Unmatched SMS ── */
function renderUnmatchedTable(unmatched, requests) {
  document.getElementById('countUnmatched').textContent = unmatched.length;
  const waitingRequests = requests.filter((r) =>
    ['WAITING_OPERATOR_REPLY','NEEDS_MANUAL_REVIEW','TIMEOUT'].includes(r.status)
  );
  const body = document.getElementById('unmatchedBody');
  if (!unmatched.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty">No unmatched SMS.</td></tr>`;
    return;
  }
  body.innerHTML = unmatched.map((inbox) => {
    const options = waitingRequests.map((r) =>
      `<option value="${esc(r.requestId)}">${esc(r.requestId)} (${esc(r.requestType)} ${esc(r.payload)})</option>`
    ).join('');
    return `
      <tr>
        <td><span class="cell-mono">${esc(inbox.senderNumber)}</span></td>
        <td class="cell-muted">${esc(inbox.gatewayId)}</td>
        <td class="cell-truncate" title="${esc(inbox.messageBody)}">${esc(inbox.messageBody)}</td>
        <td class="cell-muted">${relativeTime(inbox.receivedAt)}</td>
        <td>
          ${waitingRequests.length ? `
            <div style="display:flex;gap:6px">
              <select class="match-select" data-inbox-id="${esc(inbox.id)}">${options}</select>
              <button class="btn-sm btn-primary" data-match-inbox="${esc(inbox.id)}">Match</button>
            </div>` : '<span class="cell-muted">No waiting requests.</span>'}
        </td>
      </tr>`;
  }).join('');

  document.querySelectorAll('[data-match-inbox]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const inboxId = btn.dataset.matchInbox;
      const select  = document.querySelector(`select[data-inbox-id="${inboxId}"]`);
      if (!select) return;
      try { await postJson('/api/manual-match', { inboxId, requestId: select.value }); }
      catch (e) { alert(e.message); }
      await refresh();
    });
  });
}

/* ── Audit Log ── */
let _auditLogs = [];

function renderAuditTable() {
  const search = document.getElementById('auditSearch').value.toLowerCase();
  const filtered = _auditLogs.filter((log) => {
    if (!search) return true;
    const haystack = `${log.action} ${log.actor || ''} ${log.requestId || ''}`.toLowerCase();
    return haystack.includes(search);
  });

  document.getElementById('auditBody').innerHTML = filtered.slice().reverse().slice(0, 200).map((log) => {
    const detail = log.detail ? JSON.stringify(log.detail) : '';
    return `
      <tr>
        <td class="cell-muted">${relativeTime(log.timestamp)}</td>
        <td>${esc(log.actor || 'system')}</td>
        <td>${esc(log.action)}</td>
        <td class="cell-mono">${log.requestId ? esc(log.requestId) : '—'}</td>
        <td class="cell-truncate" title="${esc(detail)}">${esc(detail)}</td>
      </tr>`;
  }).join('') || `<tr><td colspan="5" class="empty">No audit entries match.</td></tr>`;
}

function renderAuditBanner(logs) {
  const banner = document.getElementById('chainIntegrity');
  banner.className = 'banner banner-ok';
  banner.innerHTML = `<span class="material-symbols-outlined">verified</span> Chain intact — ${logs.length} entries total`;
}

function exportAuditCsv() {
  downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, auditLogsToCsv(_auditLogs));
}

/* ── Dev Tools forms ── */
document.getElementById('requestForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try { await postJson('/api/requests', Object.fromEntries(form.entries())); await refresh(); }
  catch (e2) { alert(e2.message); }
});

document.getElementById('smsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try { await postJson('/api/sms/inbound', Object.fromEntries(form.entries())); await refresh(); }
  catch (e2) { alert(e2.message); }
});

/* ── Main refresh ── */
async function refresh() {
  try {
    const [dashRes, unmatchedRes, gatewayRes] = await Promise.all([
      apiFetch('/api/dashboard'),
      apiFetch('/api/sms/unmatched'),
      apiFetch('/api/gateways')
    ]);
    const data          = await dashRes.json();
    const unmatchedData = await unmatchedRes.json();
    const gatewayData   = gatewayRes.ok ? await gatewayRes.json() : { gateways: data.gateways || [] };
    const unmatched     = unmatchedData.unmatched || [];

    _auditLogs = data.auditLogs || [];

    renderStats(data.requests || []);
    renderGatewayCards(gatewayData.gateways || []);
    renderQueues(data.queues || []);
    renderRequestsTable(data.requests || []);
    renderRepliesTable(data.replyDrafts || [], data.requests || []);
    renderUnmatchedTable(unmatched, data.requests || []);
    renderAuditBanner(_auditLogs);
    renderAuditTable();

    document.getElementById('lastRefresh').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.error('refresh failed:', err);
  }
}

/* ── Boot (called once unlocked) ── */
function boot() {
  pollHealth();
  setInterval(pollHealth, 30_000);
  refresh();
  setInterval(refresh, 10_000);
}

/* ── Init: skip the gate if a key is already saved ── */
(function init() {
  if (isAdminUnlocked()) {
    document.getElementById('authGate').style.display = 'none';
    document.getElementById('adminApp').style.display = 'block';
    boot();
  } else {
    document.getElementById('gateKeyInput').focus();
  }
})();
