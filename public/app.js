'use strict';

let opsOverview = null;
let opsActivity = [];
let activeFilter = 'all';
let activeSearch = '';

function showAuthDialog() {
  const overlay = document.getElementById('authOverlay');
  const input = document.getElementById('authKeyInput');
  input.value = localStorage.getItem('adminApiKey') || '';
  overlay.style.display = 'flex';
  input.focus();
}
window.onAuthRequired = showAuthDialog;

function submitAuthKey() {
  const value = document.getElementById('authKeyInput').value.trim();
  if (value) {
    localStorage.setItem('adminApiKey', value);
    document.getElementById('settingsApiKey').value = value;
  } else {
    localStorage.removeItem('adminApiKey');
  }
  document.getElementById('authOverlay').style.display = 'none';
  updateAdminVisibility();
}

document.getElementById('authKeyInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitAuthKey();
});

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
    button.classList.add('active');
    document.getElementById(`panel-${button.dataset.tab}`).classList.add('active');
    localStorage.setItem('opsTab', button.dataset.tab);
    if (button.dataset.tab === 'activity') renderActivityFeed();
  });
});

(function restoreTab() {
  const saved = localStorage.getItem('opsTab');
  if (!saved) return;
  const button = document.querySelector(`.nav-item[data-tab="${saved}"]`);
  if (button) button.click();
})();

function updateAdminVisibility() {
  const unlocked = isAdminUnlocked();
  document.querySelectorAll('.admin-only').forEach((element) => {
    element.style.display = unlocked ? 'block' : 'none';
  });
  const apiKeyStatus = document.getElementById('apiKeyStatus');
  const key = localStorage.getItem('adminApiKey');
  apiKeyStatus.textContent = key ? `Saved (${key.slice(0, 4)}…)` : 'Not set';
  apiKeyStatus.style.color = key ? 'var(--success)' : 'var(--text-muted)';
}

document.getElementById('settingsApiKey').value = localStorage.getItem('adminApiKey') || '';
document.getElementById('settingsApiKey').addEventListener('input', (event) => {
  const value = event.target.value.trim();
  if (value) localStorage.setItem('adminApiKey', value);
  else localStorage.removeItem('adminApiKey');
  updateAdminVisibility();
});

document.getElementById('backendUrlDisplay').textContent = window.location.origin;
document.getElementById('provUrl').value = window.location.origin;

document.getElementById('activitySearch').addEventListener('input', (event) => {
  activeSearch = event.target.value.toLowerCase();
  renderActivityFeed();
});

document.querySelectorAll('#activityFilters .filter-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#activityFilters .filter-chip').forEach((item) => item.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.filter;
    renderActivityFeed();
  });
});

function renderPosture(overview) {
  const posture = overview.posture || {};
  const alerts = overview.alerts || {};
  document.getElementById('opsPosture').className = `posture-banner glass-panel status-strip${alerts.total ? ' warning' : ''}`;
  document.getElementById('opsPosture').innerHTML = `
    <div class="posture-top">
      <div>
        <div class="section-eyebrow">System posture</div>
        <div class="posture-title">${esc(posture.summary || 'Monitoring nominal')}</div>
        <div class="posture-sub">Backend reachability, fleet state, and exception volume are surfaced here first so operators can scan in seconds.</div>
      </div>
      <span class="${alerts.total ? 'chip chip-warning' : 'chip chip-success'}">${alerts.total || 0} alert${alerts.total === 1 ? '' : 's'}</span>
    </div>
    <div class="kpi-grid" style="margin-top:16px">
      <div class="kpi-tile"><div class="kpi-value">${overview.stats?.todayRequests || 0}</div><div class="kpi-label">Today</div></div>
      <div class="kpi-tile"><div class="kpi-value warning">${alerts.pendingApprovals || 0}</div><div class="kpi-label">Pending Review</div></div>
      <div class="kpi-tile"><div class="kpi-value ${alerts.failedRequests ? 'danger' : ''}">${alerts.failedRequests || 0}</div><div class="kpi-label">Failed / Timeout</div></div>
    </div>
    <div class="quick-actions" style="margin-top:14px">
      <button onclick="refreshOps()" class="primary-link">Refresh posture</button>
      <a href="/admin" class="primary-link">Jump to admin</a>
      <button onclick="openActivityTab()">Review incidents</button>
    </div>`;
}

function renderOperatorStrip(operators) {
  document.getElementById('operatorStrip').innerHTML = operators.map((operator) => `
    <div class="operator-mini" style="--operator-color:${operatorTone(operator.operator)}">
      <div class="head"></div>
      <div class="body">
        <div class="operator-name">${esc(operator.operatorName)}</div>
        <div class="operator-state">${esc(operator.state)}</div>
        <div class="operator-meta">${esc(operator.gatewayId)} · ${relativeTime(operator.lastSeenAt)}</div>
      </div>
    </div>`).join('');
}

function renderAttentionGrid(overview) {
  const alerts = overview.alerts || {};
  const cards = [
    { title: 'Approvals waiting', value: alerts.pendingApprovals || 0, tone: 'warning', detail: 'Supervisor review queue' },
    { title: 'Failed / timed out', value: alerts.failedRequests || 0, tone: alerts.failedRequests ? 'danger' : '', detail: 'Requests needing intervention' },
    { title: 'Unmatched replies', value: alerts.unmatchedSms || 0, tone: alerts.unmatchedSms ? 'warning' : '', detail: 'Potential exception desk work' },
    { title: 'Offline gateways', value: alerts.offlineGateways || 0, tone: alerts.offlineGateways ? 'danger' : '', detail: 'Fleet availability concern' }
  ];
  document.getElementById('attentionGrid').innerHTML = cards.map((card) => `
    <div class="attention-card glass-panel status-strip ${card.tone || 'success'}">
      <div class="attention-head">
        <div class="attention-title">${card.title}</div>
        <span class="${card.value ? `chip chip-${card.tone || 'success'}` : 'chip chip-muted'}">${card.value ? 'Attention' : 'Clear'}</span>
      </div>
      <div class="attention-value ${card.tone || ''}" style="margin-top:12px">${card.value}</div>
      <div class="attention-detail">${card.detail}</div>
    </div>`).join('');
}

function renderOpsActivity(events) {
  document.getElementById('opsActivity').innerHTML = events.slice(0, 6).map((event) => `
    <div class="timeline-item">
      <div class="timeline-marker ${event.severity === 'critical' ? 'danger' : event.severity === 'warning' ? 'warning' : event.severity === 'success' ? 'success' : ''}"></div>
      <div>
        <div class="timeline-title">${esc(event.title)}</div>
        <div class="timeline-meta">${esc(event.summary || '')}${event.operator ? ` · ${esc(event.operator)}` : ''}</div>
      </div>
      <div class="timeline-time">${relativeTime(event.occurredAt)}</div>
    </div>`).join('') || '<div class="empty">No recent activity.</div>';
}

function renderActivitySummary() {
  const totals = {
    sent: opsActivity.filter((event) => event.type === 'dispatch_sent').length,
    replies: opsActivity.filter((event) => event.type === 'reply_received').length,
    failed: opsActivity.filter((event) => event.severity === 'critical').length,
    system: opsActivity.filter((event) => event.type === 'audit' || event.type === 'gateway_offline').length
  };
  document.getElementById('activitySummary').innerHTML = `
    <div class="summary-item"><div class="summary-value">${totals.sent}</div><div class="summary-label">Sent</div></div>
    <div class="summary-item"><div class="summary-value" style="color:var(--success)">${totals.replies}</div><div class="summary-label">Replies</div></div>
    <div class="summary-item"><div class="summary-value ${totals.failed ? 'danger' : ''}">${totals.failed}</div><div class="summary-label">Critical</div></div>
    <div class="summary-item"><div class="summary-value">${totals.system}</div><div class="summary-label">System</div></div>`;
}

function renderActivityFeed() {
  renderActivitySummary();
  const filtered = opsActivity.filter((event) => {
    if (activeFilter !== 'all' && event.severity !== activeFilter) return false;
    if (!activeSearch) return true;
    const haystack = `${event.title} ${event.summary || ''} ${event.meta?.requestId || ''} ${event.gatewayId || ''}`.toLowerCase();
    return haystack.includes(activeSearch);
  });

  document.getElementById('activityFeed').innerHTML = filtered.map((event) => `
    <div class="timeline-item row-accent ${event.severity === 'critical' ? 'danger' : event.severity === 'warning' ? 'warning' : event.severity === 'success' ? 'success' : 'info'}">
      <div class="timeline-marker ${event.severity === 'critical' ? 'danger' : event.severity === 'warning' ? 'warning' : event.severity === 'success' ? 'success' : ''}"></div>
      <div>
        <div class="timeline-title">${esc(event.title)}</div>
        <div class="timeline-meta">${esc(event.summary || '—')}</div>
        <div class="timeline-meta">${event.operator ? esc(event.operator) + ' · ' : ''}${event.gatewayId ? esc(event.gatewayId) + ' · ' : ''}${event.meta?.requestId ? esc(event.meta.requestId) : ''}</div>
      </div>
      <div class="timeline-time">${relativeTime(event.occurredAt)}</div>
    </div>`).join('') || '<div class="empty">No events match the current filters.</div>';
}

function openActivityTab() {
  document.querySelector('.nav-item[data-tab="activity"]').click();
}

async function refreshOps() {
  try {
    const [overviewRes, activityRes] = await Promise.all([
      apiFetch('/api/ops/overview'),
      apiFetch('/api/ops/activity')
    ]);
    opsOverview = await overviewRes.json();
    const activityData = await activityRes.json();
    opsActivity = activityData.activity || [];

    renderPosture(opsOverview);
    renderOperatorStrip(opsOverview.operators || []);
    renderAttentionGrid(opsOverview);
    renderOpsActivity(opsOverview.activity || []);
    renderActivityFeed();
    document.getElementById('lastRefresh')?.remove();
  } catch (error) {
    console.error('Failed to refresh operations UI:', error);
  }
}

window._bootTime = Date.now();
updateAdminVisibility();
pollHealth();
setInterval(pollHealth, 30_000);
refreshOps();
setInterval(refreshOps, 15_000);
