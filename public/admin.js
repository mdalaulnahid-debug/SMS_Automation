'use strict';

let overviewData = null;
let requestsData = [];
let repliesData = [];
let unmatchedData = [];
let auditLogs = [];
let auditFilter = 'all';
let selectedRequestId = null;
let selectedUnmatchedId = null;

function showGate(message) {
  document.getElementById('adminApp').style.display = 'none';
  document.getElementById('authGate').style.display = 'flex';
  const error = document.getElementById('gateError');
  if (message) {
    error.textContent = message;
    error.style.display = 'block';
  } else {
    error.style.display = 'none';
  }
}
window.onAuthRequired = () => showGate('Invalid or expired API key.');

async function unlockAdmin() {
  const value = document.getElementById('gateKeyInput').value.trim();
  if (!value) return showGate('API key is required.');
  localStorage.setItem('adminApiKey', value);
  const response = await fetch('/api/gateways', { headers: authHeaders() });
  if (response.status === 401) {
    localStorage.removeItem('adminApiKey');
    return showGate('Invalid API key.');
  }
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('adminApp').style.display = 'block';
  boot();
}

function lockAdmin() {
  localStorage.removeItem('adminApiKey');
  location.reload();
}

document.getElementById('gateKeyInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') unlockAdmin();
});

document.querySelectorAll('.sidebar-item').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-item').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('.admin-section').forEach((section) => section.classList.remove('active'));
    button.classList.add('active');
    document.getElementById(`section-${button.dataset.section}`).classList.add('active');
  });
});

function renderOverview() {
  document.getElementById('environmentLabel').textContent = (overviewData.environment || 'production').toUpperCase();
  document.getElementById('lastRefresh').textContent = `Updated ${new Date().toLocaleTimeString()}`;

  const stats = overviewData.stats || {};
  const diagnostics = overviewData.diagnostics || {};
  const delayedByGateway = new Map();
  (diagnostics.delayedConfirmations || []).forEach((row) => {
    delayedByGateway.set(row.gatewayId, (delayedByGateway.get(row.gatewayId) || 0) + 1);
  });
  document.getElementById('statsGrid').innerHTML = [
    ['Active requests', stats.activeRequests || 0, ''],
    ['Pending approvals', stats.pendingApprovals || 0, 'warning'],
    ['Failed / timed out', stats.failedOrTimedOut || 0, stats.failedOrTimedOut ? 'danger' : ''],
    ['Unmatched inbound', stats.unmatchedInbound || 0, stats.unmatchedInbound ? 'warning' : ''],
    ['Online gateways', stats.onlineGateways || 0, 'success'],
    ['Delayed sends', stats.delayedConfirmations || 0, stats.delayedConfirmations ? 'danger' : 'success'],
    ['Ambiguous replies', stats.ambiguousReplies24h || 0, stats.ambiguousReplies24h ? 'warning' : 'success'],
    ['Duplicate risks', stats.duplicateRiskGroups || 0, stats.duplicateRiskGroups ? 'warning' : 'success'],
    ['Telegram chat mismatches', stats.telegramChatMismatches24h || 0, stats.telegramChatMismatches24h ? 'danger' : 'success'],
    ['Unauthorized attempts', stats.telegramUnauthorizedAttempts24h || 0, stats.telegramUnauthorizedAttempts24h ? 'danger' : 'success']
  ].map(([label, value, tone]) => `
    <div class="kpi-tile">
      <div class="kpi-value ${tone}">${value}</div>
      <div class="kpi-label">${label}</div>
      <div class="kpi-subtext">${label === 'Online gateways' ? 'Fleet availability' : 'Command-center signal'}</div>
    </div>`).join('');

  document.getElementById('gatewayCards').innerHTML = (overviewData.gatewayHealth || []).map((gateway) => `
    <div class="fleet-card" style="--operator-color:${operatorTone(gateway.operator)}">
      <div class="fleet-rail"></div>
      <div class="fleet-body">
        <div class="fleet-title">
          <div class="fleet-name">${esc(gateway.operatorName)}</div>
          <span class="${gateway.status === 'MOCK' ? 'chip chip-muted' : gateway.online ? 'chip chip-success' : 'chip chip-danger'}">${gateway.status === 'MOCK' ? 'MOCK' : gateway.online ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
        <div class="fleet-state">${esc(gateway.id)}</div>
        <div class="fleet-meta">${gateway.gatewayUrl || 'No URL registered'}<br />Last seen ${relativeTime(gateway.lastSeenAt)}<br />Delayed sends ${delayedByGateway.get(gateway.id) || 0}</div>
      </div>
    </div>`).join('');

  document.getElementById('queuesBody').innerHTML = (overviewData.queues || []).map((queue) => `
    <tr>
      <td><strong>${esc(queue.operator)}</strong></td>
      <td class="mono">${queue.active ? esc(queue.active.requestId) : '—'}</td>
      <td>${queue.waiting.length}</td>
      <td>${queue.delayedSendCount ? `${queue.delayedSendCount} delayed` : 'Clear'}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty">No queue data.</td></tr>';

  document.getElementById('recentIncidents').innerHTML = (overviewData.activity || []).slice(0, 8).map((event) => `
    <div class="timeline-item">
      <div class="timeline-marker ${event.severity === 'critical' ? 'danger' : event.severity === 'warning' ? 'warning' : event.severity === 'success' ? 'success' : ''}"></div>
      <div>
        <div class="timeline-title">${esc(event.title)}</div>
        <div class="timeline-meta">${esc(event.summary || '')}</div>
      </div>
      <div class="timeline-time">${relativeTime(event.occurredAt)}</div>
    </div>`).join('') || '<div class="empty">No recent incidents.</div>';

  const alerts = overviewData.alerts || {};
  const alertItems = [
    ['Pending approvals', alerts.pendingApprovals || 0, 'warning'],
    ['Failed requests', alerts.failedRequests || 0, alerts.failedRequests ? 'danger' : 'success'],
    ['Unmatched inbound', alerts.unmatchedSms || 0, alerts.unmatchedSms ? 'warning' : 'success'],
    ['Offline gateways', alerts.offlineGateways || 0, alerts.offlineGateways ? 'danger' : 'success'],
    ['Delayed sends', stats.delayedConfirmations || 0, stats.delayedConfirmations ? 'danger' : 'success'],
    ['Ambiguous replies (24h)', stats.ambiguousReplies24h || 0, stats.ambiguousReplies24h ? 'warning' : 'success'],
    ['Duplicate blocks (24h)', diagnostics.recentDuplicateBlocks || 0, diagnostics.recentDuplicateBlocks ? 'warning' : 'success'],
    ['Telegram chat mismatches (24h)', stats.telegramChatMismatches24h || 0, stats.telegramChatMismatches24h ? 'danger' : 'success'],
    ['Unauthorized attempts (24h)', stats.telegramUnauthorizedAttempts24h || 0, stats.telegramUnauthorizedAttempts24h ? 'danger' : 'success']
  ];
  document.getElementById('alertSummary').innerHTML = alertItems.map(([label, value, tone]) => `
    <div class="banner banner-${tone === 'warning' ? 'warn' : tone === 'danger' ? 'danger' : 'ok'}">
      <span class="material-symbols-outlined">${tone === 'danger' ? 'warning' : tone === 'warning' ? 'rule' : 'verified'}</span>
      <div style="display:flex;justify-content:space-between;align-items:center;width:100%;gap:10px">
        <span>${label}</span>
        <strong>${value}</strong>
      </div>
    </div>`).join('');
}

function mergedRequestRows() {
  const replyByRequest = new Map(repliesData.map((reply) => [reply.requestId, reply]));
  return requestsData.map((request) => ({ request, reply: replyByRequest.get(request.requestId) || null }));
}

function renderRequestList() {
  const search = document.getElementById('requestSearch').value.trim().toLowerCase();
  const rows = mergedRequestRows().filter(({ request, reply }) => {
    if (!search) return true;
    const haystack = `${request.requestId} ${request.requesterName} ${request.payload} ${request.requestType} ${reply?.replyText || ''}`.toLowerCase();
    return haystack.includes(search);
  });

  document.getElementById('countRequests').textContent = rows.length;
  document.getElementById('requestList').innerHTML = rows.map(({ request, reply }) => `
    <div class="list-item row-accent ${statusTone(request.status)} ${selectedRequestId === request.requestId ? 'active' : ''}" data-request-id="${esc(request.requestId)}">
      <div class="item-head">
        <div>
          <div class="item-title">${esc(request.requestId)}</div>
          <div class="item-meta">${esc(request.requestType)} · ${esc(request.payload)}</div>
        </div>
        <span class="${statusChipClass(request.status)}">${esc(request.status.replaceAll('_', ' '))}</span>
      </div>
      <div class="item-meta">@${esc(request.requesterName)} · ${relativeTime(request.createdAt)}</div>
      ${renderDispatches(request.dispatches)}
      ${reply ? `<div class="item-meta" style="margin-top:8px">Draft: ${esc(reply.sentStatus)}</div>` : ''}
    </div>`).join('') || '<div class="empty">No requests match the current search.</div>';

  document.querySelectorAll('[data-request-id]').forEach((item) => {
    item.addEventListener('click', () => {
      selectedRequestId = item.dataset.requestId;
      renderRequestList();
      renderRequestDetail();
    });
  });

  if (!selectedRequestId && rows.length) {
    selectedRequestId = rows[0].request.requestId;
    renderRequestList();
    renderRequestDetail();
  }
}

function renderRequestDetail() {
  const selected = mergedRequestRows().find(({ request }) => request.requestId === selectedRequestId);
  const detail = document.getElementById('requestDetail');
  if (!selected) {
    detail.innerHTML = '<div class="empty">Select a request or draft to inspect details and act.</div>';
    return;
  }
  const { request, reply } = selected;
  const canApprove = reply && reply.sentStatus === 'DRAFT' && request.status === 'NEEDS_MANUAL_REVIEW';
  const canReject = request.status === 'NEEDS_MANUAL_REVIEW';
  const canRetry = ['NEEDS_MANUAL_REVIEW', 'FAILED', 'TIMEOUT'].includes(request.status);

  detail.innerHTML = `
    <div class="section-eyebrow">Review drawer</div>
    <div style="font-size:26px;font-weight:800;letter-spacing:-0.04em">${esc(request.requestId)}</div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span class="${statusChipClass(request.status)}">${esc(request.status.replaceAll('_', ' '))}</span>
      <span class="chip chip-muted">${esc(request.requestType)}</span>
      <span class="chip chip-violet">${esc(request.payload)}</span>
    </div>
    <div class="detail-actions">
      ${canApprove ? '<button id="approveReplyBtn" class="btn-primary">Approve and post</button>' : ''}
      ${canReject ? '<button id="rejectRequestBtn" class="btn-danger">Reject</button>' : ''}
      ${canRetry ? '<button id="retryRequestBtn" class="btn-secondary">Retry</button>' : ''}
    </div>
    <div class="detail-block">
      <div class="detail-label">Requester</div>
      <div class="detail-value">@${esc(request.requesterName)} · ${esc(request.channel || 'manual')}</div>
    </div>
    <div class="detail-block">
      <div class="detail-label">Dispatch posture</div>
      <div class="detail-value">${renderDispatches(request.dispatches)}</div>
    </div>
    <div class="detail-block">
      <div class="detail-label">Reply draft</div>
      <div class="detail-value">${reply ? `<div class="raw-reply">${esc(reply.replyText)}</div>` : 'No reply draft yet.'}</div>
    </div>
    <div class="detail-block">
      <div class="detail-label">Created</div>
      <div class="detail-value">${formatAbsoluteTime(request.createdAt)}</div>
    </div>`;

  if (canApprove) {
    document.getElementById('approveReplyBtn').addEventListener('click', async () => {
      await postJson(`/api/reply-drafts/${encodeURIComponent(request.requestId)}/approve`, {});
      await refreshAdmin();
    });
  }
  if (canReject) {
    document.getElementById('rejectRequestBtn').addEventListener('click', async () => {
      const reason = window.prompt('Rejection reason (optional):');
      if (reason === null) return;
      await postJson(`/api/requests/${encodeURIComponent(request.requestId)}/reject`, { reason });
      await refreshAdmin();
    });
  }
  if (canRetry) {
    document.getElementById('retryRequestBtn').addEventListener('click', async () => {
      await postJson(`/api/requests/${encodeURIComponent(request.requestId)}/retry`, {});
      await refreshAdmin();
    });
  }
}

function renderUnmatchedList() {
  const search = document.getElementById('unmatchedSearch').value.trim().toLowerCase();
  const rows = unmatchedData.filter((item) => {
    if (!search) return true;
    return `${item.senderNumber} ${item.gatewayId} ${item.messageBody}`.toLowerCase().includes(search);
  });
  document.getElementById('countUnmatched').textContent = rows.length;
  document.getElementById('unmatchedList').innerHTML = rows.map((item) => `
    <div class="list-item row-accent warning ${selectedUnmatchedId === item.id ? 'active' : ''}" data-unmatched-id="${esc(item.id)}">
      <div class="item-head">
        <div>
          <div class="item-title">${esc(item.senderNumber)}</div>
          <div class="item-meta">${esc(item.gatewayId)} · ${relativeTime(item.receivedAt)}</div>
        </div>
        <span class="chip chip-warning">Unmatched</span>
      </div>
      <div class="item-meta">${esc(item.messageBody)}</div>
    </div>`).join('') || '<div class="empty">No unmatched SMS currently.</div>';

  document.querySelectorAll('[data-unmatched-id]').forEach((item) => {
    item.addEventListener('click', () => {
      selectedUnmatchedId = item.dataset.unmatchedId;
      renderUnmatchedList();
      renderUnmatchedDetail();
    });
  });

  if (!selectedUnmatchedId && rows.length) {
    selectedUnmatchedId = rows[0].id;
    renderUnmatchedList();
    renderUnmatchedDetail();
  }
}

async function renderUnmatchedDetail() {
  const detail = document.getElementById('unmatchedDetail');
  const inbox = unmatchedData.find((item) => item.id === selectedUnmatchedId);
  if (!inbox) {
    detail.innerHTML = '<div class="empty">Select an unmatched reply to review likely request candidates.</div>';
    return;
  }

  detail.innerHTML = `
    <div class="section-eyebrow">Exception review</div>
    <div style="font-size:24px;font-weight:800;letter-spacing:-0.04em">${esc(inbox.senderNumber)}</div>
    <div class="detail-block">
      <div class="detail-label">Raw inbound SMS</div>
      <div class="raw-reply">${esc(inbox.messageBody)}</div>
    </div>
    <div class="detail-block">
      <div class="detail-label">Gateway metadata</div>
      <div class="detail-value">${esc(inbox.gatewayId)} · ${formatAbsoluteTime(inbox.receivedAt)}</div>
    </div>
    <div class="detail-block">
      <div class="detail-label">Guided manual match</div>
      <div class="detail-value">Loading ranked candidates…</div>
    </div>`;

  let candidates = [];
  try {
    const res = await apiFetch(`/api/admin/unmatched/${encodeURIComponent(inbox.id)}/candidates`);
    const body = await res.json();
    candidates = body.candidates || [];
  } catch (err) {
    detail.querySelector('.detail-block:last-child').innerHTML = `
      <div class="detail-label">Guided manual match</div>
      <div class="detail-value">Failed to load candidates: ${esc(err.message)}</div>`;
    return;
  }

  // Re-check the currently selected item hasn't changed while the fetch was in flight.
  if (selectedUnmatchedId !== inbox.id) return;

  detail.querySelector('.detail-block:last-child').innerHTML = `
    <div class="detail-label">Guided manual match — ranked by the same logic as live auto-matching</div>
    ${candidates.length ? `
      <select id="manualMatchSelect" class="select-field">
        ${candidates.map((c) => `<option value="${esc(c.requestId)}">${esc(c.requestId)} · ${esc(c.requestType)} ${esc(c.payload)} · ${esc(c.status)}${c.status === 'COMPLETED' ? ' (correction)' : ''} · score ${c.score}</option>`).join('')}
      </select>
      <div class="item-meta" style="margin-top:6px">Higher score = stronger match. A COMPLETED candidate means re-attaching will issue a correction message instead of a fresh reply.</div>
      <div class="detail-actions" style="margin-top:12px">
        <button id="manualMatchBtn" class="btn-primary">Match to selected request</button>
      </div>` : '<div class="detail-value">No requests on this gateway are eligible for match.</div>'}
  `;

  const button = document.getElementById('manualMatchBtn');
  if (button) {
    button.addEventListener('click', async () => {
      const requestId = document.getElementById('manualMatchSelect').value;
      const candidate = candidates.find((c) => c.requestId === requestId);
      const endpoint = candidate && candidate.status === 'COMPLETED' ? '/api/admin/correct-match' : '/api/manual-match';
      await postJson(endpoint, { inboxId: inbox.id, requestId });
      await refreshAdmin();
    });
  }
}

function renderAuditList() {
  const search = document.getElementById('auditSearch').value.trim().toLowerCase();
  const rows = auditLogs.filter((log) => {
    if (!search) return true;
    return `${log.action} ${log.actor || ''} ${log.requestId || ''} ${JSON.stringify(log.details || {})}`.toLowerCase().includes(search);
  });
  document.getElementById('auditList').innerHTML = rows.slice().reverse().map((log) => `
    <div class="list-item row-accent ${statusTone(log.action)}">
      <div class="item-head">
        <div>
          <div class="item-title">${esc(log.action.replaceAll('_', ' '))}</div>
          <div class="item-meta">${esc(log.actor || 'system')} · ${log.requestId ? esc(log.requestId) + ' · ' : ''}${relativeTime(log.timestamp)}</div>
        </div>
        <span class="chip chip-muted">${esc((log.actor || 'system').toUpperCase())}</span>
      </div>
      <div class="audit-row-detail">${esc(JSON.stringify(log.details || {}))}</div>
    </div>`).join('') || '<div class="empty">No audit entries match the current search.</div>';
}

function filteredAuditLogs(search = '') {
  return auditLogs.filter((log) => {
    if (auditFilter === 'validation' && log.action !== 'REQUEST_VALIDATION_FAILED') return false;
    if (!search) return true;
    return `${log.action} ${log.actor || ''} ${log.requestId || ''} ${JSON.stringify(log.details || {})}`.toLowerCase().includes(search);
  });
}

function renderAuditSummary() {
  const validationRows = auditLogs.filter((log) => log.action === 'REQUEST_VALIDATION_FAILED');
  const last24hCutoff = Date.now() - (24 * 60 * 60 * 1000);
  const validationRecent = validationRows.filter((log) => Date.parse(log.timestamp) >= last24hCutoff);
  document.getElementById('auditTotalCount').textContent = auditLogs.length;
  document.getElementById('validationFailCount').textContent = validationRows.length;
  document.getElementById('validationFailRecentCount').textContent = validationRecent.length;
  document.getElementById('countAudit').textContent = auditLogs.length;
}

function renderAuditDetails(log) {
  if (log.action === 'REQUEST_VALIDATION_FAILED') {
    const details = log.details || {};
    return `
      <div class="audit-row-detail-grid">
        <div class="audit-detail-line">
          <div class="audit-detail-label">Reason</div>
          <div class="audit-detail-value">${esc((details.errors || []).join('; ') || details.errorCode || 'Validation rejected')}</div>
        </div>
        <div class="audit-detail-line">
          <div class="audit-detail-label">Request Context</div>
          <div class="audit-detail-value">${esc([
            details.requesterName ? `Requester: ${details.requesterName}` : null,
            details.requesterId ? `ID: ${details.requesterId}` : null,
            details.channel ? `Channel: ${details.channel}` : null,
            details.chatId ? `Chat: ${details.chatId}` : null
          ].filter(Boolean).join(' | ') || 'No requester metadata')}</div>
        </div>
        <div class="audit-detail-line">
          <div class="audit-detail-label">Raw Message</div>
          <div class="audit-detail-value">${esc(details.rawText || '')}</div>
        </div>
        <div class="audit-detail-line">
          <div class="audit-detail-label">Normalized Input</div>
          <div class="audit-detail-value">${esc(details.normalizedText || '')}</div>
        </div>
        <div class="audit-detail-line">
          <div class="audit-detail-label">Error Code</div>
          <div class="audit-detail-value">${esc(details.errorCode || '')}</div>
        </div>
      </div>`;
  }
  return `<div class="audit-row-detail">${esc(JSON.stringify(log.details || {}))}</div>`;
}

function auditChipClass(log) {
  if (log.action === 'REQUEST_VALIDATION_FAILED') return 'chip chip-danger';
  return 'chip chip-muted';
}

function auditChipLabel(log) {
  if (log.action === 'REQUEST_VALIDATION_FAILED') return 'BLOCKED';
  return (log.actor || 'system').toUpperCase();
}

function setAuditFilter(nextFilter) {
  auditFilter = nextFilter;
  document.getElementById('auditFilterAll').classList.toggle('active', nextFilter === 'all');
  document.getElementById('auditFilterValidation').classList.toggle('active', nextFilter === 'validation');
  renderAuditList();
}

function renderAuditList() {
  const search = document.getElementById('auditSearch').value.trim().toLowerCase();
  const rows = filteredAuditLogs(search);
  document.getElementById('auditList').innerHTML = rows.slice().reverse().map((log) => `
    <div class="list-item row-accent ${statusTone(log.action)}">
      <div class="item-head">
        <div>
          <div class="item-title">${esc(log.action.replaceAll('_', ' '))}</div>
          <div class="item-meta">${esc(log.actor || 'system')} · ${log.requestId ? `${esc(log.requestId)} · ` : ''}${relativeTime(log.timestamp)}</div>
        </div>
        <span class="${auditChipClass(log)}">${esc(auditChipLabel(log))}</span>
      </div>
      ${renderAuditDetails(log)}
    </div>`).join('') || '<div class="empty">No audit entries match the current search.</div>';
}

function exportAuditCsv() {
  downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, auditLogsToCsv(auditLogs));
}

document.getElementById('requestSearch').addEventListener('input', renderRequestList);
document.getElementById('unmatchedSearch').addEventListener('input', renderUnmatchedList);
document.getElementById('auditSearch').addEventListener('input', renderAuditList);
document.getElementById('auditFilterAll').addEventListener('click', () => setAuditFilter('all'));
document.getElementById('auditFilterValidation').addEventListener('click', () => setAuditFilter('validation'));
document.getElementById('provUrl').value = window.location.origin;

document.getElementById('requestForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  await postJson('/api/requests', Object.fromEntries(form.entries()));
  await refreshAdmin();
});

document.getElementById('smsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  await postJson('/api/sms/inbound', Object.fromEntries(form.entries()));
  await refreshAdmin();
});

function showSettingsResult(message, isError) {
  const el = document.getElementById('settingsResult');
  el.textContent = message;
  el.style.display = 'block';
  el.style.color = isError ? 'var(--danger)' : 'var(--success)';
}

async function loadSettings() {
  const res = await apiFetch('/api/admin/settings');
  if (!res.ok) return;
  const data = await res.json();
  document.getElementById('settingsGroupChatId').value = data.telegramGroupChatId || '';
  const operator = document.getElementById('settingsOperator').value;
  document.getElementById('settingsShortcode').value = (data.operators?.[operator]?.shortcode) || '';
  renderAuthorizedUsers(data.authorizedUsers || []);
}

function renderAuthorizedUsers(users) {
  document.getElementById('authorizedUsersList').innerHTML = users.length
    ? users.map((user) => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0">
        <span class="mono">${esc(user.telegramUserId)} — ${esc(user.name)}</span>
        <button type="button" class="btn-secondary" data-remove-auth-user="${esc(user.telegramUserId)}">Remove</button>
      </div>`).join('')
    : '<div class="empty">No authorized users yet — group is open to any member, private DMs are closed to everyone.</div>';
}

document.getElementById('authorizedUsersList').addEventListener('click', async (event) => {
  const telegramUserId = event.target?.dataset?.removeAuthUser;
  if (!telegramUserId) return;
  try {
    await postJson('/api/admin/settings/authorized-users/remove', { telegramUserId });
    showSettingsResult(`Removed ${telegramUserId}. Restart the Telegram bridge for this to take effect.`, false);
    await loadSettings();
  } catch (error) {
    showSettingsResult(error.message || 'Failed to remove authorized user.', true);
  }
});

document.getElementById('authorizedUserForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const telegramUserId = document.getElementById('authUserId').value.trim();
  const name = document.getElementById('authUserName').value.trim();
  try {
    const body = await postJson('/api/admin/settings/authorized-users', { telegramUserId, name });
    showSettingsResult(`Added ${body.name}. ${body.note || ''}`, false);
    document.getElementById('authUserId').value = '';
    document.getElementById('authUserName').value = '';
    await loadSettings();
  } catch (error) {
    showSettingsResult(error.message || 'Failed to add authorized user.', true);
  }
});

document.getElementById('settingsOperator').addEventListener('change', loadSettings);

document.getElementById('telegramGroupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const groupChatId = document.getElementById('settingsGroupChatId').value.trim();
  try {
    const body = await postJson('/api/admin/settings/telegram-group', { groupChatId });
    showSettingsResult(`Saved. ${body.note || ''}`, false);
  } catch (error) {
    showSettingsResult(error.message || 'Failed to update group chat ID.', true);
  }
});

document.getElementById('operatorContactForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const operator = document.getElementById('settingsOperator').value;
  const shortcode = document.getElementById('settingsShortcode').value.trim();
  try {
    const body = await postJson('/api/admin/settings/operator-contact', { operator, shortcode });
    showSettingsResult(`Saved ${body.operator} hotline number — applied immediately.`, false);
    await refreshAdmin();
  } catch (error) {
    showSettingsResult(error.message || 'Failed to update operator number.', true);
  }
});

async function refreshAdmin() {
  const [overviewRes, requestsRes, repliesRes, unmatchedRes, auditRes] = await Promise.all([
    apiFetch('/api/admin/overview'),
    apiFetch('/api/admin/requests'),
    apiFetch('/api/admin/replies'),
    apiFetch('/api/admin/unmatched'),
    apiFetch('/api/admin/audit')
  ]);
  overviewData = await overviewRes.json();
  requestsData = (await requestsRes.json()).requests || [];
  repliesData = (await repliesRes.json()).replyDrafts || [];
  const unmatchedPayload = await unmatchedRes.json();
  unmatchedData = unmatchedPayload.unmatched || [];
  const auditPayload = await auditRes.json();
  auditLogs = auditPayload.auditLogs || [];

  renderOverview();
  renderRequestList();
  renderUnmatchedList();
  renderAuditSummary();
  renderAuditList();
  const integrity = auditPayload.integrity?.ok
    ? `${auditPayload.integrity.count} audit events verified`
    : `Audit chain issue at ${auditPayload.integrity?.brokenAt || 'unknown row'}`;
  document.getElementById('chainIntegrity').className = auditPayload.integrity?.ok ? 'banner banner-ok' : 'banner banner-danger';
  document.getElementById('chainIntegrity').innerHTML = `<span class="material-symbols-outlined">${auditPayload.integrity?.ok ? 'verified' : 'warning'}</span>${esc(integrity)}`;
}

function boot() {
  pollHealth();
  setInterval(pollHealth, 30_000);
  refreshAdmin();
  setInterval(refreshAdmin, 15_000);
  // Load once only — the 15s refresh interval would otherwise clobber an in-progress edit.
  loadSettings();
}

(function init() {
  if (isAdminUnlocked()) {
    document.getElementById('authGate').style.display = 'none';
    document.getElementById('adminApp').style.display = 'block';
    boot();
  }
})();
