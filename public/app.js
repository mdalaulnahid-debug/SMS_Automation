'use strict';
/* Mobile user app — relies on shared.js (loaded first) for theme, auth,
   apiFetch/postJson, relativeTime/esc/statusChipClass/renderDispatches,
   pollHealth, CSV/QR helpers. See docs/design-system.md. */

/* ── Auth overlay (this page's 401 handler) ── */
function showAuthDialog() {
  const overlay = document.getElementById('authOverlay');
  const input   = document.getElementById('authKeyInput');
  input.value = localStorage.getItem('adminApiKey') || '';
  overlay.classList.add('visible');
  input.focus();
}
window.onAuthRequired = showAuthDialog;

function submitAuthKey() {
  const val = document.getElementById('authKeyInput').value.trim();
  if (val) {
    localStorage.setItem('adminApiKey', val);
    const si = document.getElementById('settingsApiKey');
    if (si) si.value = val;
  }
  document.getElementById('authOverlay').classList.remove('visible');
  updateAdminVisibility();
  refresh();
}

document.getElementById('authKeyInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAuthKey();
  if (e.key === 'Escape') document.getElementById('authOverlay').classList.remove('visible');
});

function updateAdminVisibility() {
  const unlocked = isAdminUnlocked();
  document.querySelectorAll('.admin-only').forEach((el) => {
    el.style.display = unlocked ? 'block' : 'none';
  });
  renderSettingsApiKeyStatus();
}

function renderSettingsApiKeyStatus() {
  const el = document.getElementById('apiKeyStatus');
  if (!el) return;
  const key = localStorage.getItem('adminApiKey');
  el.textContent = key ? `Set (${key.slice(0, 4)}…)` : 'Not set';
  el.style.color = key ? 'var(--success)' : 'var(--text-muted)';
}

/* ── Settings API key — live save on input ── */
const _settingsApiKey = document.getElementById('settingsApiKey');
_settingsApiKey.value = localStorage.getItem('adminApiKey') || '';
_settingsApiKey.addEventListener('input', () => {
  const val = _settingsApiKey.value.trim();
  if (val) localStorage.setItem('adminApiKey', val);
  else localStorage.removeItem('adminApiKey');
  updateAdminVisibility();
});

/* ── Backend URL (read-only, shows current origin) ── */
const _urlDisplay = document.getElementById('backendUrlDisplay');
if (_urlDisplay) _urlDisplay.textContent = window.location.origin;

/* ── Provision URL pre-fill ── */
const _provUrl = document.getElementById('provUrl');
if (_provUrl && !_provUrl.value) _provUrl.value = window.location.origin;

/* ── Bottom Nav ── */
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    localStorage.setItem('activeTab', btn.dataset.tab);
    if (btn.dataset.tab === 'logs') renderLogs();
  });
});

(function restoreTab() {
  const saved = localStorage.getItem('activeTab');
  if (saved) {
    const btn = document.querySelector(`.nav-item[data-tab="${saved}"]`);
    if (btn) btn.click();
  }
})();

/* ── Home: Stats ── */
function renderStats(requests) {
  const today = new Date().toDateString();
  const todayCount = requests.filter((r) => new Date(r.createdAt).toDateString() === today).length;
  const active    = requests.filter((r) => ['RECEIVED','VALIDATED','QUEUED','SMS_SENT','WAITING_OPERATOR_REPLY','NEEDS_MANUAL_REVIEW'].includes(r.status)).length;
  const completed = requests.filter((r) => r.status === 'COMPLETED').length;
  const failed    = requests.filter((r) => ['FAILED','TIMEOUT'].includes(r.status)).length;

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card">
      <div class="stat-num">${todayCount}</div>
      <div class="stat-lbl">Today</div>
    </div>
    <div class="stat-card">
      <div class="stat-num accent">${active}</div>
      <div class="stat-lbl">Active</div>
    </div>
    <div class="stat-card">
      <div class="stat-num success">${completed}</div>
      <div class="stat-lbl">Completed</div>
    </div>
    <div class="stat-card">
      <div class="stat-num ${failed > 0 ? 'danger' : ''}">${failed}</div>
      <div class="stat-lbl">Failed</div>
    </div>`;
}

/* ── Home: Gateway Cards ── */
function renderGatewayCards(gateways) {
  document.getElementById('gatewayCards').innerHTML = gateways.map((gw) => {
    const isMock   = gw.status === 'MOCK';
    const stateKey = isMock ? 'mock' : (gw.online ? 'online' : 'offline');
    const chipCls  = isMock ? 'chip-muted' : (gw.online ? 'chip-success' : 'chip-danger');
    const label    = isMock ? 'MOCK' : (gw.online ? 'ONLINE' : 'OFFLINE');
    const lastSeen = gw.lastSeenAt ? relativeTime(gw.lastSeenAt) : 'never';
    return `
      <div class="gw-card ${stateKey}">
        <div class="gw-icon">
          <span class="material-symbols-outlined">cell_tower</span>
        </div>
        <div class="gw-info">
          <div class="gw-name">${esc(gw.operatorName || gw.id)}</div>
          <div class="gw-id">${esc(gw.id)}</div>
          <div class="gw-meta">Last seen: ${lastSeen}</div>
        </div>
        <span class="chip ${chipCls}">${label}</span>
      </div>`;
  }).join('') || '<p class="empty">No gateways configured.</p>';
}

/* ── Admin: Active Requests ── */
function renderRequests(requests) {
  document.getElementById('requests').innerHTML = requests.slice().reverse().map((req) => {
    const canReject = req.status === 'NEEDS_MANUAL_REVIEW';
    const canRetry  = ['NEEDS_MANUAL_REVIEW','FAILED','TIMEOUT'].includes(req.status);
    return `
      <div class="req-card">
        <div class="req-row">
          <span class="req-id">${esc(req.requestId)}</span>
          <span class="${statusChipClass(req.status)}">${req.status}</span>
        </div>
        <div class="req-type">${esc(req.requestType)}: <strong>${esc(req.payload)}</strong>${(req.targetOperators||[]).length ? ` → ${req.targetOperators.join(', ')}` : ''}</div>
        ${renderDispatches(req.dispatches)}
        <div class="req-meta">@${esc(req.requesterName)}${req.channel !== 'manual' ? ` via ${req.channel}` : ''} · ${relativeTime(req.createdAt)}</div>
        ${req.failedReason ? `<div class="error-text">Reason: ${esc(req.failedReason)}</div>` : ''}
        <div class="req-actions">
          ${canReject ? `<button class="btn-sm btn-danger" data-reject="${esc(req.requestId)}">Reject</button>` : ''}
          ${canRetry  ? `<button class="btn-sm btn-retry"  data-retry="${esc(req.requestId)}">Retry</button>`  : ''}
        </div>
      </div>`;
  }).join('') || '<p class="empty">No active requests.</p>';

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

/* ── Admin: Reply Drafts ── */
function renderReplies(replies, requests) {
  const requestById = new Map(requests.map((r) => [r.requestId, r]));
  document.getElementById('replies').innerHTML = replies.slice().reverse().map((reply) => {
    const request    = requestById.get(reply.requestId);
    const canApprove = reply.sentStatus === 'DRAFT' && request?.status === 'NEEDS_MANUAL_REVIEW';
    return `
      <div class="draft-card">
        <div class="req-row">
          <span class="req-id">${esc(reply.requestId)}</span>
          <span class="chip ${reply.sentStatus === 'POSTED' ? 'chip-success' : 'chip-accent'}">${esc(reply.sentStatus)}</span>
        </div>
        <div class="draft-text">${esc(reply.replyText)}</div>
        ${reply.postedMessageId ? `<div class="req-meta">Telegram msg: ${esc(reply.postedMessageId)}</div>` : ''}
        ${canApprove ? `<div class="req-actions"><button class="btn-sm btn-primary" data-approve="${esc(reply.requestId)}">Approve &amp; Post</button></div>` : ''}
      </div>`;
  }).join('') || '<p class="empty">No reply drafts.</p>';

  document.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try { await postJson(`/api/reply-drafts/${encodeURIComponent(btn.dataset.approve)}/approve`, {}); }
      catch (e) { alert(e.message); }
      await refresh();
    });
  });
}

/* ── Admin: Unmatched SMS ── */
function renderUnmatched(unmatched, requests) {
  const waitingRequests = requests.filter((r) =>
    ['WAITING_OPERATOR_REPLY','NEEDS_MANUAL_REVIEW','TIMEOUT'].includes(r.status)
  );
  const container = document.getElementById('unmatched');
  if (!unmatched.length) {
    container.innerHTML = '<p class="empty">No unmatched SMS.</p>';
    return;
  }
  container.innerHTML = unmatched.map((inbox) => {
    const options = waitingRequests.map((r) =>
      `<option value="${esc(r.requestId)}">${esc(r.requestId)} (${esc(r.requestType)} ${esc(r.payload)})</option>`
    ).join('');
    return `
      <div class="req-card">
        <div class="req-row">
          <span class="req-id">${esc(inbox.senderNumber)}</span>
          <span class="chip chip-warning">UNMATCHED</span>
        </div>
        <div class="req-meta">${esc(inbox.gatewayId)} · ${relativeTime(inbox.receivedAt)}</div>
        <div class="draft-text">${esc(inbox.messageBody)}</div>
        ${waitingRequests.length ? `
          <div class="match-form">
            <select data-inbox-id="${esc(inbox.id)}">${options}</select>
            <button class="btn-sm btn-primary" data-match-inbox="${esc(inbox.id)}">Match</button>
          </div>` : '<p class="req-meta" style="margin-top:8px">No waiting requests to match.</p>'}
      </div>`;
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

/* ── Logs: unified feed ── */
let _unifiedFeed  = [];
let _logPage      = 0;
let _activeFilter = 'all';
let _activeSearch = '';
const LOG_PAGE_SIZE = 20;

function buildUnifiedFeed(outbox, inbox, auditLogs) {
  const feed = [];

  outbox.forEach((row) => {
    const isFailed = ['FAILED','ERROR'].includes(row.sentStatus) || row.sendResult?.ok === false;
    feed.push({
      type:  isFailed ? 'failed' : 'sent',
      time:  row.sentAt || row.createdAt || '',
      title: row.messageBody || '(no message)',
      meta:  `${row.gatewayId} → ${row.destinationNumber} · ${relativeTime(row.sentAt)}`
    });
  });

  inbox.forEach((row) => {
    feed.push({
      type:  'received',
      time:  row.receivedAt || '',
      title: row.messageBody || '(empty)',
      meta:  `From ${row.senderNumber || row.from || '?'} · ${row.gatewayId} · ${relativeTime(row.receivedAt)}`
    });
  });

  auditLogs.forEach((log) => {
    feed.push({
      type:  'system',
      time:  log.timestamp || '',
      title: log.action,
      meta:  `${log.actor || 'system'}${log.requestId ? ' · ' + log.requestId : ''} · ${relativeTime(log.timestamp)}`
    });
  });

  feed.sort((a, b) => new Date(b.time) - new Date(a.time));
  return feed;
}

function computeSuccessRate(outbox) {
  if (!outbox.length) return '—';
  const ok = outbox.filter((r) => !['FAILED','ERROR'].includes(r.sentStatus) && r.sendResult?.ok !== false).length;
  return Math.round((ok / outbox.length) * 100) + '%';
}

function renderLogStats(outbox, feed) {
  const today      = new Date().toDateString();
  const todayItems = feed.filter((f) => f.time && new Date(f.time).toDateString() === today).length;
  const failed     = feed.filter((f) => f.type === 'failed').length;
  const successRate = computeSuccessRate(outbox);
  const uptimeMins  = Math.floor((Date.now() - window._bootTime) / 60000);
  const uptime      = uptimeMins < 60 ? `${uptimeMins}m` : `${Math.floor(uptimeMins / 60)}h`;

  document.getElementById('logStatsGrid').innerHTML = `
    <div class="log-stat-card">
      <div class="log-stat-num">${todayItems}</div>
      <div class="log-stat-lbl">Today</div>
    </div>
    <div class="log-stat-card">
      <div class="log-stat-num success">${successRate}</div>
      <div class="log-stat-lbl">Success</div>
    </div>
    <div class="log-stat-card">
      <div class="log-stat-num ${failed > 0 ? 'danger' : ''}">${failed}</div>
      <div class="log-stat-lbl">Failed</div>
    </div>
    <div class="log-stat-card">
      <div class="log-stat-num">${uptime}</div>
      <div class="log-stat-lbl">Uptime</div>
    </div>`;
}

function applyLogFilter() {
  _activeSearch = document.getElementById('logSearch').value.toLowerCase();
  _logPage = 0;
  renderLogs();
}

function loadMoreLogs() {
  _logPage++;
  renderLogs();
}

function renderLogs() {
  const filtered = _unifiedFeed.filter((entry) => {
    if (_activeFilter !== 'all' && entry.type !== _activeFilter) return false;
    if (_activeSearch) {
      const haystack = (entry.title + ' ' + entry.meta).toLowerCase();
      if (!haystack.includes(_activeSearch)) return false;
    }
    return true;
  });

  const end     = (_logPage + 1) * LOG_PAGE_SIZE;
  const visible = filtered.slice(0, end);
  const feedEl  = document.getElementById('logFeed');
  if (!feedEl) return;

  feedEl.innerHTML = visible.map((entry) => `
    <div class="log-entry">
      <div class="log-dot ${entry.type}"></div>
      <div class="log-body">
        <div class="log-title">${esc(entry.title)}</div>
        <div class="log-meta">${esc(entry.meta)}</div>
      </div>
      <span class="log-badge ${entry.type}">${entry.type}</span>
    </div>`
  ).join('') || '<p class="empty">No log entries match.</p>';

  const btn = document.getElementById('loadMoreBtn');
  if (btn) btn.style.display = filtered.length > end ? 'block' : 'none';
}

document.getElementById('filterChips').querySelectorAll('.filter-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    _activeFilter = chip.dataset.filter;
    _logPage = 0;
    renderLogs();
  });
});

/* ── Admin: Audit Log ── */
function renderAudit(logs) {
  const banner = document.getElementById('chainIntegrity');
  if (banner) {
    banner.className = 'banner banner-ok';
    banner.innerHTML = `<span class="material-symbols-outlined">verified</span> Chain intact — ${logs.length} entries`;
  }

  const el = document.getElementById('auditFeed');
  if (!el) return;
  el.innerHTML = logs.slice().reverse().slice(0, 50).map((log) => {
    const detail = log.detail ? JSON.stringify(log.detail) : '';
    return `
      <div class="log-entry">
        <div class="log-dot system"></div>
        <div class="log-body">
          <div class="log-title">${esc(log.action)}</div>
          <div class="log-meta">${esc(log.actor || 'system')}${log.requestId ? ' · ' + esc(log.requestId) : ''} · ${relativeTime(log.timestamp)}</div>
          ${detail ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-family:monospace;word-break:break-all">${esc(detail.slice(0, 120))}${detail.length > 120 ? '…' : ''}</div>` : ''}
        </div>
      </div>`;
  }).join('') || '<p class="empty">No audit entries.</p>';
}

function exportAuditCsv() {
  downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, auditLogsToCsv(window._lastAuditLogs || []));
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

    window._lastAuditLogs = data.auditLogs || [];

    renderStats(data.requests || []);
    renderGatewayCards(gatewayData.gateways || []);
    if (isAdminUnlocked()) {
      renderRequests(data.requests || []);
      renderReplies(data.replyDrafts || [], data.requests || []);
      renderUnmatched(unmatched, data.requests || []);
    }

    _unifiedFeed = buildUnifiedFeed(data.smsOutbox || [], data.smsInbox || [], data.auditLogs || []);
    renderLogStats(data.smsOutbox || [], _unifiedFeed);
    if (document.getElementById('panel-logs').classList.contains('active')) renderLogs();

    renderAudit(data.auditLogs || []);

    document.getElementById('lastRefresh').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.error('refresh failed:', err);
  }
}

/* ── Boot ── */
window._bootTime = Date.now();
updateAdminVisibility();
pollHealth();
setInterval(pollHealth, 30_000);
refresh();
setInterval(refresh, 10_000);
