'use strict';

let overviewData = null;
let requestsData = [];
let repliesData = [];
let unmatchedData = [];
let rejectedData = [];
let auditLogs = [];
let auditFilter = 'all';
let selectedRequestId = null;
let selectedUnmatchedId = null;
let selectedRejectedIndex = null;

let reqTypeFilter = '';
let reqStatusFilter = '';
let reqOperatorFilter = '';
let reqUserFilter = '';
let reqChannelFilter = '';
let reqDateFilter = '';
let filterUserSearchTerm = '';

const REQ_STATUS_GROUPS = {
  review: ['NEEDS_MANUAL_REVIEW', 'APPROVED_FOR_POST', 'APPROVED_FOR_EDIT'],
  live: ['QUEUED', 'WAITING_OPERATOR_REPLY', 'DISPATCHING'],
  done: ['COMPLETED', 'POSTED', 'REPLY_RECEIVED', 'REPLY_POSTED'],
  failed: ['FAILED', 'TIMEOUT']
};
const REQ_STATUS_LABELS = { review: 'Needs Review', live: 'In Progress', done: 'Completed', failed: 'Failed' };
const REQ_DATE_LABELS = { today: 'Today', week: 'Last 7 days', month: 'Last 30 days' };

// Shared heartbeat/ECG waveform for the gateway fleet cards.
const ADMIN_ECG_PATH = 'M0 20 L44 20 L52 8 L60 32 L68 4 L76 20 L120 20 L128 12 L136 28 L144 20 L200 20';

// Approvals Queue coarse tabs (ROMER-style): map to the status groups above.
let reqQueueTab = 'pending';
const QUEUE_TAB_STATUSES = {
  pending: [...REQ_STATUS_GROUPS.review, ...REQ_STATUS_GROUPS.live],
  resolved: [...REQ_STATUS_GROUPS.done],
  archived: [...REQ_STATUS_GROUPS.failed]
};

// Elapsed HH:MM:SS since a request was created — the queue "time in review" clock.
function fmtElapsed(iso) {
  if (!iso) return '—';
  let s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Severity/impact read of a request, derived from its lifecycle status.
function requestImpact(status) {
  if (REQ_STATUS_GROUPS.failed.includes(status)) return { tone: 'danger', label: 'Failed', icon: 'error', crit: 'High criticality', critSub: 'Dispatch failed or timed out' };
  if (REQ_STATUS_GROUPS.review.includes(status)) return { tone: 'warning', label: 'Review', icon: 'rate_review', crit: 'Needs review', critSub: 'Operator reply awaiting approval' };
  if (REQ_STATUS_GROUPS.live.includes(status)) return { tone: 'info', label: 'In flight', icon: 'bolt', crit: 'In progress', critSub: 'Dispatched, awaiting operator' };
  return { tone: 'success', label: 'Sent', icon: 'check_circle', crit: 'Delivered', critSub: 'Reply posted to requester' };
}

function withinDateRange(iso, range) {
  if (!iso) return false;
  const created = new Date(iso);
  const now = new Date();
  if (range === 'today') return created.toDateString() === now.toDateString();
  if (range === 'week') return now - created < 7 * 86_400_000;
  if (range === 'month') return now - created < 30 * 86_400_000;
  return true;
}

// excludeGroup lets us compute "how many results would this option leave" (faceted counts)
// without that group's own selection narrowing itself out of the count.
function requestMatchesFilters(request, reply, excludeGroup) {
  const search = document.getElementById('requestSearch').value.trim().toLowerCase();
  if (search) {
    const haystack = `${request.requestId} ${request.requesterName} ${request.payload} ${request.requestType} ${reply?.replyText || ''}`.toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  if (excludeGroup !== 'user' && reqUserFilter && request.requesterName !== reqUserFilter) return false;
  if (excludeGroup !== 'type' && reqTypeFilter && request.requestType !== reqTypeFilter) return false;
  if (excludeGroup !== 'status' && reqStatusFilter) {
    const allowed = REQ_STATUS_GROUPS[reqStatusFilter] || [];
    if (!allowed.includes(request.status)) return false;
  }
  if (excludeGroup !== 'operator' && reqOperatorFilter) {
    const operators = (request.dispatches || []).map(d => d.operator);
    if (!operators.includes(reqOperatorFilter)) return false;
  }
  if (excludeGroup !== 'channel' && reqChannelFilter && (request.channel || 'manual') !== reqChannelFilter) return false;
  if (excludeGroup !== 'date' && reqDateFilter && !withinDateRange(request.createdAt, reqDateFilter)) return false;
  return true;
}

function activeFilterCount() {
  return [reqUserFilter, reqTypeFilter, reqStatusFilter, reqOperatorFilter, reqChannelFilter, reqDateFilter].filter(Boolean).length;
}

function facetCount(excludeGroup, matcher) {
  return mergedRequestRows().filter(({ request, reply }) => requestMatchesFilters(request, reply, excludeGroup) && matcher(request)).length;
}

function renderFilterOptionList(containerId, options, activeValue, groupName) {
  const container = document.getElementById(containerId);
  if (!options.length) {
    container.innerHTML = '<div class="filter-option-empty">No values yet</div>';
    return;
  }
  container.innerHTML = options.map(opt => `
    <button type="button" class="filter-option ${activeValue === opt.value ? 'active' : ''}" data-filter-group="${groupName}" data-filter-value="${esc(opt.value)}">
      <span>${esc(opt.label)}</span>
      <span class="filter-option-count">${opt.count}</span>
    </button>`).join('');
}

function renderFilterDrawer() {
  const types = [...new Set(requestsData.map(r => r.requestType).filter(Boolean))].sort();
  renderFilterOptionList('filterTypeList', [
    { value: '', label: 'All types', count: facetCount('type', () => true) },
    ...types.map(t => ({ value: t, label: t, count: facetCount('type', r => r.requestType === t) }))
  ], reqTypeFilter, 'type');

  const users = [...new Set(requestsData.map(r => r.requesterName).filter(Boolean))].sort();
  const visibleUsers = filterUserSearchTerm ? users.filter(u => u.toLowerCase().includes(filterUserSearchTerm)) : users;
  renderFilterOptionList('filterUserList', [
    ...(filterUserSearchTerm ? [] : [{ value: '', label: 'All requesters', count: facetCount('user', () => true) }]),
    ...visibleUsers.map(u => ({ value: u, label: u, count: facetCount('user', r => r.requesterName === u) }))
  ], reqUserFilter, 'user');

  renderFilterOptionList('filterStatusList', [
    { value: '', label: 'All statuses', count: facetCount('status', () => true) },
    ...Object.keys(REQ_STATUS_GROUPS).map(key => ({
      value: key, label: REQ_STATUS_LABELS[key],
      count: facetCount('status', r => REQ_STATUS_GROUPS[key].includes(r.status))
    }))
  ], reqStatusFilter, 'status');

  const operators = [...new Set(requestsData.flatMap(r => (r.dispatches || []).map(d => d.operator)).filter(Boolean))].sort();
  renderFilterOptionList('filterOperatorList', [
    { value: '', label: 'All operators', count: facetCount('operator', () => true) },
    ...operators.map(o => ({ value: o, label: o, count: facetCount('operator', r => (r.dispatches || []).some(d => d.operator === o)) }))
  ], reqOperatorFilter, 'operator');

  const channels = [...new Set(requestsData.map(r => r.channel || 'manual'))].sort();
  renderFilterOptionList('filterChannelList', [
    { value: '', label: 'All channels', count: facetCount('channel', () => true) },
    ...channels.map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1), count: facetCount('channel', r => (r.channel || 'manual') === c) }))
  ], reqChannelFilter, 'channel');

  renderFilterOptionList('filterDateList', [
    { value: '', label: 'All time', count: facetCount('date', () => true) },
    ...Object.keys(REQ_DATE_LABELS).map(key => ({
      value: key, label: REQ_DATE_LABELS[key],
      count: facetCount('date', r => withinDateRange(r.createdAt, key))
    }))
  ], reqDateFilter, 'date');

  const count = activeFilterCount();
  const badge = document.getElementById('filterBadge');
  const toggleBtn = document.getElementById('filterToggleBtn');
  if (badge) badge.textContent = String(count);
  if (toggleBtn) toggleBtn.classList.toggle('has-filters', count > 0);
}

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
  // Verify with the entered key explicitly (not authHeaders()) — a stale sessionToken from an
  // earlier Telegram-login session would otherwise win over this key (see authHeaders()) and
  // make a correct key look "invalid".
  const response = await fetch('/api/gateways', { headers: { 'x-api-key': value } });
  if (response.status === 401) {
    return showGate('Invalid API key.');
  }
  // Clear any stale user-login session so it can't keep shadowing this key on later requests.
  localStorage.removeItem('sessionToken');
  localStorage.removeItem('sessionUser');
  localStorage.setItem('adminApiKey', value);
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

  document.getElementById('gatewayCards').innerHTML = (overviewData.gatewayHealth || []).map((gateway) => {
    const state = gateway.status === 'MOCK' ? 'delayed' : gateway.online ? 'online' : 'offline';
    const stateChip = state === 'online' ? 'chip chip-success' : state === 'delayed' ? 'chip chip-muted' : 'chip chip-danger';
    const stateLabel = gateway.status === 'MOCK' ? 'MOCK' : gateway.online ? 'ONLINE' : 'OFFLINE';
    return `
    <div class="fleet-card state-${state}" style="--operator-color:${operatorTone(gateway.operator)}">
      <div class="fleet-rail"></div>
      <div class="fleet-body">
        <div class="fleet-title">
          <div class="fleet-name">${esc(gateway.operatorName)}</div>
          <span class="${stateChip}">${stateLabel}</span>
        </div>
        <div class="fleet-gwid">${esc(gateway.id)}</div>
        <svg class="fleet-heartbeat" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true"><path d="${ADMIN_ECG_PATH}" /></svg>
        <div class="fleet-meta">${esc(gateway.gatewayUrl || 'No URL registered')}<br />Last seen ${relativeTime(gateway.lastSeenAt)} · Delayed sends ${delayedByGateway.get(gateway.id) || 0}</div>
      </div>
    </div>`;
  }).join('');

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
  const allRows = mergedRequestRows();
  let rows = allRows.filter(({ request, reply }) => requestMatchesFilters(request, reply, null));
  const tabStatuses = QUEUE_TAB_STATUSES[reqQueueTab];
  if (tabStatuses) rows = rows.filter(({ request }) => tabStatuses.includes(request.status));

  renderFilterDrawer();

  const countEl = document.getElementById('reqFilterCount');
  if (countEl) {
    const isFiltered = search || activeFilterCount() > 0;
    countEl.textContent = isFiltered ? `${rows.length} of ${allRows.length}` : `${rows.length}`;
  }

  document.getElementById('countRequests').textContent = rows.length;
  document.getElementById('requestList').innerHTML = rows.map(({ request, reply }) => {
    const imp = requestImpact(request.status);
    const urgent = imp.tone === 'warning' || imp.tone === 'danger';
    const desc = (reply && reply.replyText) ? reply.replyText : request.payload;
    return `
    <div class="req-card ${selectedRequestId === request.requestId ? 'active' : ''}" data-request-id="${esc(request.requestId)}">
      <div class="req-card-top">
        <span class="req-id">${esc(request.requestId)}</span>
        <span class="req-timer ${urgent ? 'urgent' : ''}"><span class="material-symbols-outlined">schedule</span>${fmtElapsed(request.createdAt)}</span>
      </div>
      <div>
        <div class="req-title">${esc(request.requestType)} · ${esc(request.payload)}</div>
        <div class="req-desc">${esc(desc)}</div>
      </div>
      <div class="req-card-bottom">
        <span class="req-requester"><span class="req-avatar"><span class="material-symbols-outlined">person</span></span><span>${esc(request.requesterName)}</span></span>
        <span class="impact-badge ${imp.tone}">${esc(imp.label)}</span>
      </div>
    </div>`;
  }).join('') || '<div class="empty">No requests in this queue.</div>';

  document.querySelectorAll('[data-request-id]').forEach((item) => {
    item.addEventListener('click', () => {
      selectedRequestId = item.dataset.requestId;
      renderRequestList();
      renderRequestDetail();
    });
  });

  // Keep a valid selection: if none, or the selected request fell out of the
  // active tab/filter, snap to the first row in view.
  const selectedInView = rows.some(({ request }) => request.requestId === selectedRequestId);
  if (!selectedInView && rows.length) {
    selectedRequestId = rows[0].request.requestId;
    renderRequestList();
    renderRequestDetail();
    return;
  }
  if (!rows.length) {
    selectedRequestId = null;
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
  const imp = requestImpact(request.status);
  const urgent = imp.tone === 'warning' || imp.tone === 'danger';
  const eyebrowColor = imp.tone === 'danger' ? 'var(--danger)' : imp.tone === 'warning' ? 'var(--warning)' : imp.tone === 'success' ? 'var(--success)' : 'var(--accent)';
  const eyebrowText = canApprove ? 'Operational approval required' : `${imp.label} · ${request.status.replaceAll('_', ' ')}`;

  const dispatches = request.dispatches || [];
  const signalsHtml = dispatches.length ? dispatches.map((d) => {
    const meta = [d.gatewayId, d.shortcode ? `→ ${d.shortcode}` : '', d.sentAt ? relativeTime(d.sentAt) : '']
      .filter(Boolean).join(' · ');
    return `
    <div class="signal-row">
      <div class="signal-row-title">[${esc(d.operator || 'OP')}] ${esc((d.status || d.sentStatus || 'dispatch')).toString().replaceAll('_', ' ')}</div>
      <div class="signal-row-body">${esc(meta || 'Queued')}</div>
    </div>`;
  }).join('') : '<div class="signal-empty">No dispatch signals recorded yet.</div>';

  detail.innerHTML = `
    <div class="rd-top">
      <div style="min-width:0">
        <div class="rd-eyebrow" style="color:${eyebrowColor}">${esc(eyebrowText)}</div>
        <div class="rd-created">Created ${formatAbsoluteTime(request.createdAt)}</div>
        <div class="rd-title">${esc(request.requestType)} · ${esc(request.payload)}
          <span style="display:block;margin-top:4px;font-family:var(--font-mono);font-size:15px;font-weight:700;color:var(--text-muted)">${esc(request.requestId)}</span>
        </div>
      </div>
      <div class="rd-actions">
        ${canReject ? '<button id="rejectRequestBtn" class="btn-danger">Deny</button>' : ''}
        ${canApprove ? '<button id="approveReplyBtn" class="btn-primary">Approve</button>' : ''}
        ${canRetry ? '<button id="retryRequestBtn" class="btn-secondary">Retry</button>' : ''}
      </div>
    </div>
    <div class="rd-cards">
      <div class="rd-card">
        <div class="rd-card-label">Requested by</div>
        <div class="rd-card-main">
          <span class="rd-card-icon info"><span class="material-symbols-outlined">person</span></span>
          <div style="min-width:0"><div class="rd-card-value">${esc(request.requesterName)}</div><div class="rd-card-sub">${esc(request.channel || 'manual')} channel</div></div>
        </div>
      </div>
      <div class="rd-card">
        <div class="rd-card-label">Impact analysis</div>
        <div class="rd-card-main">
          <span class="rd-card-icon ${imp.tone}"><span class="material-symbols-outlined">${imp.icon}</span></span>
          <div style="min-width:0"><div class="rd-card-value">${esc(imp.crit)}</div><div class="rd-card-sub">${esc(imp.critSub)}</div></div>
        </div>
      </div>
      <div class="rd-card">
        <div class="rd-card-label">Time in review</div>
        <div class="rd-sla ${urgent ? 'urgent' : ''}">${fmtElapsed(request.createdAt)}</div>
        <div class="rd-card-sub">${urgent ? 'Action needed' : 'Within normal window'}</div>
      </div>
    </div>
    <div class="rd-lower">
      <div class="signal-panel">
        <div class="signal-head">
          <span class="signal-head-title"><span class="material-symbols-outlined">draft</span>Reply Draft</span>
          <span class="signal-count">${reply ? esc(reply.sentStatus) : 'none'}</span>
        </div>
        ${reply
          ? `<div class="signal-row"><div class="signal-row-body" style="color:var(--text-primary)">${esc(reply.replyText)}</div></div>`
          : '<div class="signal-empty">No reply draft yet. The operator has not responded.</div>'}
      </div>
      <div class="signal-panel">
        <div class="signal-head">
          <span class="signal-head-title"><span class="material-symbols-outlined">sensors</span>Linked Operational Signals</span>
          <span class="signal-count">${dispatches.length} total</span>
        </div>
        ${signalsHtml}
      </div>
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

function renderRejectedList() {
  const search = document.getElementById('rejectedSearch').value.trim().toLowerCase();
  const rows = rejectedData.filter((item) => {
    if (!search) return true;
    return `${item.requesterName || ''} ${item.rawText || ''}`.toLowerCase().includes(search);
  });
  document.getElementById('countRejected').textContent = rejectedData.length;
  document.getElementById('rejectedList').innerHTML = rows.map((item, index) => `
    <div class="list-item row-accent danger ${selectedRejectedIndex === index ? 'active' : ''}" data-rejected-index="${index}">
      <div class="item-head">
        <div>
          <div class="item-title">${esc(item.requesterName || 'Unknown sender')}</div>
          <div class="item-meta">${esc(item.errorCode || '')} · ${relativeTime(item.timestamp)}</div>
        </div>
        <span class="chip chip-danger">Rejected</span>
      </div>
      <div class="item-meta">${esc((item.rawText || '').slice(0, 140))}</div>
    </div>`).join('') || '<div class="empty">No rejected messages.</div>';

  document.querySelectorAll('[data-rejected-index]').forEach((el) => {
    el.addEventListener('click', () => {
      selectedRejectedIndex = Number(el.dataset.rejectedIndex);
      renderRejectedList();
      renderRejectedDetail();
    });
  });
}

function renderRejectedDetail() {
  const detail = document.getElementById('rejectedDetail');
  const item = rejectedData[selectedRejectedIndex];
  if (!item) {
    detail.innerHTML = '<div class="empty">Select a rejected message to see its full original text.</div>';
    return;
  }
  detail.innerHTML = `
    <div class="section-eyebrow">Rejected — ${esc(item.errorCode || '')}</div>
    <div style="font-size:24px;font-weight:800;letter-spacing:-0.04em">${esc(item.requesterName || 'Unknown sender')}</div>
    <div class="detail-block">
      <div class="detail-label">Full original text</div>
      <div class="raw-reply">${esc(item.rawText || '')}</div>
    </div>
    <div class="detail-block">
      <div class="detail-label">Metadata</div>
      <div class="detail-value">Chat ${esc(item.chatId || 'n/a')} · ${formatAbsoluteTime(item.timestamp)}</div>
    </div>`;
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

document.getElementById('queueTabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-queue]');
  if (!tab) return;
  reqQueueTab = tab.dataset.queue;
  document.querySelectorAll('#queueTabs .queue-tab').forEach((t) => t.classList.toggle('active', t === tab));
  selectedRequestId = null;
  renderRequestList();
});

document.getElementById('filterUserSearch').addEventListener('input', e => {
  filterUserSearchTerm = e.target.value.trim().toLowerCase();
  renderFilterDrawer();
});

document.getElementById('filterDrawer').addEventListener('click', e => {
  const option = e.target.closest('[data-filter-group]');
  if (option) {
    const group = option.dataset.filterGroup;
    const value = option.dataset.filterValue;
    if (group === 'type') reqTypeFilter = value;
    else if (group === 'user') reqUserFilter = value;
    else if (group === 'status') reqStatusFilter = value;
    else if (group === 'operator') reqOperatorFilter = value;
    else if (group === 'channel') reqChannelFilter = value;
    else if (group === 'date') reqDateFilter = value;
    renderRequestList();
    return;
  }
  const header = e.target.closest('[data-toggle-group]');
  if (header) header.closest('.filter-group').classList.toggle('collapsed');
});

document.getElementById('filterToggleBtn').addEventListener('click', () => {
  const open = document.getElementById('requestsLayout').classList.toggle('filter-open');
  document.getElementById('filterToggleBtn').classList.toggle('active', open);
});

document.getElementById('filterClearAll').addEventListener('click', () => {
  reqTypeFilter = '';
  reqUserFilter = '';
  reqStatusFilter = '';
  reqOperatorFilter = '';
  reqChannelFilter = '';
  reqDateFilter = '';
  filterUserSearchTerm = '';
  document.getElementById('filterUserSearch').value = '';
  renderRequestList();
});

document.getElementById('unmatchedSearch').addEventListener('input', renderUnmatchedList);
document.getElementById('rejectedSearch').addEventListener('input', renderRejectedList);
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

// --- Super-admin hidden sign-in URL ---

async function loadGateUrl() {
  const res = await apiFetch('/api/admin/super-admin-gate');
  if (!res.ok) return;
  const { url } = await res.json();
  document.getElementById('gateUrlDisplay').textContent = url;
}

document.getElementById('copyGateUrlBtn').addEventListener('click', async () => {
  const url = document.getElementById('gateUrlDisplay').textContent;
  const resultEl = document.getElementById('gateUrlResult');
  try {
    await navigator.clipboard.writeText(url);
    resultEl.textContent = 'Copied.';
    resultEl.style.color = 'var(--success)';
    resultEl.style.display = 'block';
  } catch {
    resultEl.textContent = 'Could not copy — select and copy manually.';
    resultEl.style.color = 'var(--danger)';
    resultEl.style.display = 'block';
  }
});

document.getElementById('regenerateGateUrlBtn').addEventListener('click', async () => {
  const resultEl = document.getElementById('gateUrlResult');
  if (!confirm('Rotate the super-admin sign-in URL? The current link stops working immediately.')) return;
  try {
    const body = await postJson('/api/admin/super-admin-gate/regenerate', {});
    document.getElementById('gateUrlDisplay').textContent = body.url;
    resultEl.textContent = 'URL rotated. The old link no longer works.';
    resultEl.style.color = 'var(--success)';
    resultEl.style.display = 'block';
  } catch (error) {
    resultEl.textContent = error.message || 'Failed to rotate the URL.';
    resultEl.style.color = 'var(--danger)';
    resultEl.style.display = 'block';
  }
});

// --- Team (promote-officer-to-admin, super-admin only) ---

function currentSessionUserId() {
  try {
    return JSON.parse(localStorage.getItem('sessionUser') || '{}').id || null;
  } catch {
    return null;
  }
}

async function loadTeam() {
  const res = await apiFetch('/api/admin/users');
  if (!res.ok) return;
  const { users } = await res.json();
  renderTeam(users);
}

function renderTeam(users) {
  const selfId = currentSessionUserId();
  document.getElementById('teamList').innerHTML = users.length
    ? users.map((user) => {
        const isSelf = user.id === selfId;
        const roleTone = user.role === 'super_admin' ? 'chip-violet' : user.role === 'admin' ? 'chip-accent' : 'chip-muted';
        let action = '';
        if (user.role === 'officer') {
          action = `<button type="button" class="btn-secondary" data-promote="${esc(user.id)}">Promote to admin</button>`;
        } else if (user.role === 'admin') {
          action = `<button type="button" class="btn-secondary" data-demote="${esc(user.id)}">Demote to officer</button>`;
        }
        return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--divider)">
        <div>
          <div>${esc(user.name)} ${isSelf ? '<span class="mono" style="color:var(--text-muted)">(you)</span>' : ''}</div>
          <div class="mono" style="color:var(--text-muted);font-size:11px">${esc(user.email)} · <span class="chip ${roleTone}">${esc(user.role)}</span> · ${esc(user.status)}</div>
        </div>
        <span>${isSelf || user.role === 'super_admin' ? '' : action}</span>
      </div>`;
      }).join('')
    : '<div class="empty">No accounts yet.</div>';
}

document.getElementById('teamList').addEventListener('click', async (event) => {
  const promoteId = event.target?.dataset?.promote;
  const demoteId = event.target?.dataset?.demote;
  const userId = promoteId || demoteId;
  if (!userId) return;
  const newRole = promoteId ? 'admin' : 'officer';
  const resultEl = document.getElementById('teamResult');
  try {
    await postJson(`/api/admin/users/${encodeURIComponent(userId)}/role`, { role: newRole });
    resultEl.textContent = `Role updated to ${newRole}.`;
    resultEl.style.color = 'var(--success)';
    resultEl.style.display = 'block';
    await loadTeam();
  } catch (error) {
    resultEl.textContent = error.message || 'Failed to update role.';
    resultEl.style.color = 'var(--danger)';
    resultEl.style.display = 'block';
  }
});

// --- Invite-only registration (super-admin only) ---

async function loadInvites() {
  const res = await apiFetch('/api/admin/invites');
  if (!res.ok) return;
  const { invites } = await res.json();
  renderInvites(invites);
}

function renderInvites(invites) {
  const pending = invites.filter((i) => !i.consumed_at && new Date(i.expires_at).getTime() > Date.now());
  document.getElementById('inviteList').innerHTML = pending.length
    ? pending.map((invite) => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--divider)">
        <div>
          <div>${esc(invite.name || invite.email)}</div>
          <div class="mono" style="color:var(--text-muted);font-size:11px">${esc(invite.email)} · <span class="chip chip-accent">${esc(invite.role)}</span> · expires ${new Date(invite.expires_at).toLocaleDateString()}</div>
        </div>
      </div>`).join('')
    : '<div class="empty">No pending invites.</div>';
}

document.getElementById('inviteForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const resultEl = document.getElementById('inviteResult');
  try {
    const body = await postJson('/api/admin/invites', {
      email: document.getElementById('inviteEmail').value.trim(),
      name: document.getElementById('inviteName').value.trim(),
      phone: document.getElementById('invitePhone').value.trim(),
      designation: document.getElementById('inviteDesignation').value.trim(),
      unit: document.getElementById('inviteUnit').value.trim(),
      role: document.getElementById('inviteRole').value
    });
    resultEl.innerHTML = `Invite created. Send this link: <div class="mono" style="margin-top:6px;word-break:break-all;user-select:all">${esc(body.registrationLink)}</div>`;
    resultEl.style.color = 'var(--success)';
    resultEl.style.display = 'block';
    document.getElementById('inviteForm').reset();
    await loadInvites();
  } catch (error) {
    resultEl.textContent = error.message || 'Failed to create invite.';
    resultEl.style.color = 'var(--danger)';
    resultEl.style.display = 'block';
  }
});

document.getElementById('directAccountForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const resultEl = document.getElementById('directAccountResult');
  try {
    const body = await postJson('/api/admin/accounts', {
      email: document.getElementById('directEmail').value.trim(),
      name: document.getElementById('directName').value.trim(),
      phone: document.getElementById('directPhone').value.trim(),
      designation: document.getElementById('directDesignation').value.trim(),
      unit: document.getElementById('directUnit').value.trim(),
      role: document.getElementById('directRole').value,
      password: document.getElementById('directPassword').value
    });
    resultEl.textContent = `Account created for ${body.email}.`;
    resultEl.style.color = 'var(--success)';
    resultEl.style.display = 'block';
    document.getElementById('directAccountForm').reset();
    await loadTeam();
  } catch (error) {
    resultEl.textContent = error.message || 'Failed to create account.';
    resultEl.style.color = 'var(--danger)';
    resultEl.style.display = 'block';
  }
});

document.getElementById('changePasswordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const resultEl = document.getElementById('changePasswordResult');
  try {
    await postJson('/api/auth/change-password', { currentPassword, newPassword });
    resultEl.textContent = 'Password changed.';
    resultEl.style.color = 'var(--success)';
    resultEl.style.display = 'block';
    document.getElementById('changePasswordForm').reset();
  } catch (error) {
    resultEl.textContent = error.message || 'Failed to change password.';
    resultEl.style.color = 'var(--danger)';
    resultEl.style.display = 'block';
  }
});

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

// --- Personnel Registry (bulk import + super-admin single-add) ---

function showRegistryResult(message, isError) {
  const el = document.getElementById('registryResult');
  el.textContent = message;
  el.style.display = 'block';
  el.style.color = isError ? 'var(--danger)' : 'var(--success)';
}

function renderRegistryList(records) {
  document.getElementById('registryList').innerHTML = records.length
    ? `<div class="tool-note">${records.length} record(s) in the registry.</div>` + records.map((r) => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--divider)">
        <span class="mono">${esc(r.name)} — ${esc(r.designation || '')} ${esc(r.unit ? `(${r.unit})` : '')}</span>
      </div>`).join('')
    : '<div class="empty">No registry records imported yet — registration will reject every attempt until an admin imports the roster.</div>';
}

async function loadPersonnelRegistry() {
  const res = await apiFetch('/api/admin/personnel-registry');
  if (!res.ok) return;
  const data = await res.json();
  renderRegistryList(data.records || []);
}

document.getElementById('registryImportForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('registryFileInput');
  const file = input.files?.[0];
  if (!file) {
    showRegistryResult('Choose a .xlsx file first.', true);
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const res = await apiFetch('/api/admin/personnel-registry/import', { method: 'POST', body: buffer });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed.');
    showRegistryResult(`Imported ${data.count} record(s) — roster replaced.`, false);
    input.value = '';
    await loadPersonnelRegistry();
  } catch (error) {
    showRegistryResult(error.message || 'Import failed.', true);
  }
});

document.getElementById('registryAddForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const record = await postJson('/api/admin/personnel-registry/add', {
      name: document.getElementById('regAddName').value.trim(),
      designation: document.getElementById('regAddDesignation').value.trim(),
      unit: document.getElementById('regAddUnit').value.trim(),
      phone: document.getElementById('regAddPhone').value.trim(),
      email: document.getElementById('regAddEmail').value.trim()
    }).then((body) => body.record);
    showRegistryResult(`Added ${record.name} to the registry.`, false);
    document.getElementById('registryAddForm').reset();
    await loadPersonnelRegistry();
  } catch (error) {
    showRegistryResult(error.message || 'Failed to add record.', true);
  }
});

async function refreshAdmin() {
  const [overviewRes, requestsRes, repliesRes, unmatchedRes, rejectedRes, auditRes] = await Promise.all([
    apiFetch('/api/admin/overview'),
    apiFetch('/api/admin/requests'),
    apiFetch('/api/admin/replies'),
    apiFetch('/api/admin/unmatched'),
    apiFetch('/api/admin/rejected-messages'),
    apiFetch('/api/admin/audit')
  ]);
  overviewData = await overviewRes.json();
  requestsData = (await requestsRes.json()).requests || [];
  repliesData = (await repliesRes.json()).replyDrafts || [];
  const unmatchedPayload = await unmatchedRes.json();
  unmatchedData = unmatchedPayload.unmatched || [];
  const rejectedPayload = await rejectedRes.json();
  rejectedData = rejectedPayload.rejected || [];
  const auditPayload = await auditRes.json();
  auditLogs = auditPayload.auditLogs || [];

  renderOverview();
  populatePhoneInboxGateways();
  renderRequestList();
  renderUnmatchedList();
  renderRejectedList();
  renderAuditSummary();
  renderAuditList();
  const integrity = auditPayload.integrity?.ok
    ? `${auditPayload.integrity.count} audit events verified`
    : `Audit chain issue at ${auditPayload.integrity?.brokenAt || 'unknown row'}`;
  document.getElementById('chainIntegrity').className = auditPayload.integrity?.ok ? 'banner banner-ok' : 'banner banner-danger';
  document.getElementById('chainIntegrity').innerHTML = `<span class="material-symbols-outlined">${auditPayload.integrity?.ok ? 'verified' : 'warning'}</span>${esc(integrity)}`;
}

// ── Live phone inbox ────────────────────────────────────────────────────────
let phoneInboxPollTimer = null;

function populatePhoneInboxGateways() {
  const sel = document.getElementById('phoneInboxGateway');
  if (!sel || !overviewData) return;
  const current = sel.value;
  const gateways = overviewData.gatewayHealth || [];
  sel.innerHTML = gateways.map((g) => `<option value="${esc(g.id)}">${esc(g.operatorName || g.operator)} · ${esc(g.id)}</option>`).join('');
  if (current && gateways.some((g) => g.id === current)) sel.value = current;
}

async function fetchPhoneDump(gatewayId) {
  try {
    const res = await apiFetch(`/api/admin/gateways/${encodeURIComponent(gatewayId)}/inbox`);
    return (await res.json()).dump;
  } catch {
    return null;
  }
}

function renderPhoneInbox(dump) {
  const list = document.getElementById('phoneInboxList');
  const messages = (dump && dump.messages) || [];
  list.innerHTML = messages.length
    ? messages.map((m) => `
      <div class="list-item">
        <div class="item-head">
          <div class="item-title">${esc(m.address || m.from || 'unknown sender')}</div>
          <span class="item-meta">${esc(m.date || m.receivedAt || '')}</span>
        </div>
        <div class="item-meta" style="white-space:pre-wrap;margin-top:4px">${esc(m.body || '')}</div>
      </div>`).join('')
    : '<div class="empty">Phone inbox is empty.</div>';
}

async function requestPhoneInbox() {
  const gatewayId = document.getElementById('phoneInboxGateway').value;
  const status = document.getElementById('phoneInboxStatus');
  if (!gatewayId) { status.textContent = 'No gateway selected.'; return; }
  status.textContent = `Requesting inbox from ${gatewayId}… waiting for the phone to poll (a few seconds).`;
  const before = (await fetchPhoneDump(gatewayId))?.receivedAt || null;
  try {
    await postJson(`/api/admin/gateways/${encodeURIComponent(gatewayId)}/request-inbox`, { limit: 50 });
  } catch (error) {
    status.textContent = `Request failed: ${error.message || error}`;
    return;
  }
  let tries = 0;
  clearInterval(phoneInboxPollTimer);
  phoneInboxPollTimer = setInterval(async () => {
    tries += 1;
    const dump = await fetchPhoneDump(gatewayId);
    if (dump && dump.receivedAt !== before) {
      clearInterval(phoneInboxPollTimer);
      renderPhoneInbox(dump);
      status.textContent = `Received ${dump.messages.length} message(s) ${relativeTime(dump.receivedAt)}.`;
    } else if (tries > 20) {
      clearInterval(phoneInboxPollTimer);
      status.textContent = 'No response yet — the phone may be offline, slow to poll, or on an app version without inbox support. Try Refresh shortly.';
    }
  }, 2000);
}

async function refreshPhoneInbox() {
  const gatewayId = document.getElementById('phoneInboxGateway').value;
  const status = document.getElementById('phoneInboxStatus');
  if (!gatewayId) { status.textContent = 'No gateway selected.'; return; }
  const dump = await fetchPhoneDump(gatewayId);
  if (!dump) {
    status.textContent = 'No inbox captured yet — click "Request live inbox".';
    document.getElementById('phoneInboxList').innerHTML = '';
    return;
  }
  renderPhoneInbox(dump);
  status.textContent = `Last captured ${relativeTime(dump.receivedAt)} · ${dump.messages.length} message(s).`;
}

function boot() {
  pollHealth();
  setInterval(pollHealth, 30_000);
  refreshAdmin();
  setInterval(refreshAdmin, 15_000);
  // Load once only — the 15s refresh interval would otherwise clobber an in-progress edit.
  loadSettings();
  document.getElementById('registrySuperAdminBlock').style.display = isSuperAdminUnlocked() ? 'block' : 'none';
  loadPersonnelRegistry();
  if (isSuperAdminUnlocked()) {
    document.getElementById('teamSidebarItem').style.display = '';
    loadTeam();
    loadInvites();
    loadGateUrl();
  }
}

(async function sessionInit() {
  const sessionToken = localStorage.getItem('sessionToken');
  if (sessionToken) {
    let user = null;
    try {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${sessionToken}` } });
      if (res.ok) user = (await res.json()).user;
    } catch (_) {}
    if (user && (user.role === 'admin' || user.role === 'super_admin')) {
      localStorage.setItem('sessionUser', JSON.stringify(user));
      document.getElementById('authGate').style.display = 'none';
      document.getElementById('adminApp').style.display = 'block';
      boot();
      return;
    }
    if (user && user.role === 'officer') {
      location.replace('/');
      return;
    }
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('sessionUser');
  }
  // Fall back to legacy API key, or redirect to login.
  if (isAdminUnlocked()) {
    document.getElementById('authGate').style.display = 'none';
    document.getElementById('adminApp').style.display = 'block';
    boot();
    return;
  }
  location.replace('/login.html');
})();
