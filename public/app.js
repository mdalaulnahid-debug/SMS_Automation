'use strict';

let opsOverview = null;
let opsActivity = [];
let activeFilter = 'all';
let activeSearch = '';

function showAuthDialog() {
  // Re-locking (e.g. a stored key turned out to be invalid) must hide the app
  // content again, not just float the gate on top of it — otherwise data already
  // rendered before the 401 stays visible underneath.
  document.getElementById('opsApp').style.display = 'none';
  const overlay = document.getElementById('authOverlay');
  const input = document.getElementById('authKeyInput');
  input.value = localStorage.getItem('adminApiKey') || '';
  overlay.style.display = 'flex';
  input.focus();
}
window.onAuthRequired = showAuthDialog;

async function submitAuthKey() {
  const value = document.getElementById('authKeyInput').value.trim();
  const errorEl = document.getElementById('authError');
  errorEl.style.display = 'none';
  if (!value) {
    errorEl.textContent = 'API key is required.';
    errorEl.style.display = 'block';
    return;
  }
  // Verify with the entered key explicitly (not authHeaders()) — a stale sessionToken from an
  // earlier login session would otherwise win over this key (see authHeaders()) and make a
  // correct key look "invalid".
  const res = await fetch('/api/ops/overview', { headers: { 'x-api-key': value } });
  if (res.status === 401) {
    errorEl.textContent = 'Invalid API key.';
    errorEl.style.display = 'block';
    return;
  }
  // Clear any stale user-login session so it can't keep shadowing this key on later requests.
  localStorage.removeItem('sessionToken');
  localStorage.removeItem('sessionUser');
  localStorage.setItem('adminApiKey', value);
  document.getElementById('settingsApiKey').value = value;
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('opsApp').style.display = 'block';
  updateAdminVisibility();
  boot();
}

document.getElementById('authKeyInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitAuthKey();
});

function selectTab(tab) {
  document.querySelectorAll('.nav-item, .ops-sidebar-item').forEach((item) => {
    const isMatch = item.dataset.tab === tab;
    item.classList.toggle('active', isMatch);
    if (isMatch) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
  const panel = document.getElementById(`panel-${tab}`);
  if (panel) panel.classList.add('active');
  localStorage.setItem('opsTab', tab);
  if (tab === 'activity') renderActivityFeed();
}

document.querySelectorAll('.nav-item, .ops-sidebar-item').forEach((button) => {
  button.addEventListener('click', () => selectTab(button.dataset.tab));
});

function selectSettingsGroup(group) {
  document.querySelectorAll('.settings-nav-item').forEach((item) => {
    const isMatch = item.dataset.group === group;
    item.classList.toggle('active', isMatch);
    if (isMatch) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  document.querySelectorAll('.settings-group').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.groupPanel === group);
  });
}

(function restoreTab() {
  const saved = localStorage.getItem('opsTab');
  if (!saved) return;
  if (document.querySelector(`[data-tab="${saved}"]`)) selectTab(saved);
})();

function updateAdminVisibility() {
  const unlocked = isAdminUnlocked();
  document.querySelectorAll('.admin-only').forEach((element) => {
    element.hidden = !unlocked;
  });
  const apiKeyStatus = document.getElementById('apiKeyStatus');
  const key = localStorage.getItem('adminApiKey');
  apiKeyStatus.textContent = key ? `Saved (${key.slice(0, 4)}…)` : 'Not set';
  apiKeyStatus.style.color = key ? 'var(--success)' : 'var(--text-muted)';
}

// Access-tier boundary (docs/security-hardening-v1-design.md §4): a plain
// 'officer' session (Registered Officer) gets the informational Home + its
// own account status, never the fleet/activity monitoring surfaces — those
// stay reserved for admin/super_admin, matching the server-side gating on
// /api/ops/*. The legacy admin-key path (no sessionUser at all) is always
// treated as operational, same as before this tier existed.
function currentRole() {
  try {
    const user = JSON.parse(localStorage.getItem('sessionUser') || '{}');
    return user.role || null;
  } catch {
    return null;
  }
}

function isOperationalRole() {
  const role = currentRole();
  return !role || role === 'admin' || role === 'super_admin';
}

function renderAccountStatus() {
  let user;
  try {
    user = JSON.parse(localStorage.getItem('sessionUser') || '{}');
  } catch {
    return;
  }
  if (!user.email) return;

  const statusLabels = { active: 'Active', pending_approval: 'Pending review' };
  const statusTones = { active: 'chip-success', pending_approval: 'chip-warning' };
  const statusLabel = statusLabels[user.status] || user.status || 'Active';
  const statusChip = document.getElementById('accountStatusChip');
  statusChip.textContent = statusLabel;
  statusChip.className = `chip ${statusTones[user.status] || 'chip-muted'}`;

  document.getElementById('accountSubtitle').textContent = user.status === 'pending_approval'
    ? 'Your registration is awaiting administrator approval.'
    : 'Registered Officer';

  const fields = [
    { label: 'Name', value: user.name },
    { label: 'Designation', value: user.designation },
    { label: 'Unit', value: user.unit },
    { label: 'Email', value: user.email },
    { label: 'Phone', value: user.phone },
    { label: 'Telegram', value: user.telegramLinked ? 'Linked' : 'Not linked' }
  ];
  document.getElementById('accountGrid').innerHTML = fields.map(({ label, value }) => `
    <div>
      <div class="account-field-label">${esc(label)}</div>
      <div class="account-field-value${value ? '' : ' muted'}">${value ? esc(value) : '—'}</div>
    </div>`).join('');

  document.getElementById('accountCard').hidden = false;
}

function applyRoleView() {
  const operational = isOperationalRole();
  document.querySelectorAll('.officer-hide').forEach((element) => {
    element.hidden = !operational;
  });
  document.getElementById('homeOperational').hidden = !operational;
  document.getElementById('homeInfo').hidden = operational;
  if (!operational) {
    renderAccountStatus();
    // A previous admin/super_admin session on this browser may have left the
    // Activity tab selected in localStorage (restoreTab() runs before role is
    // known) — force back to Home rather than leave a hidden, unfetched panel
    // marked active.
    if (document.querySelector('.officer-hide.active')) selectTab('home');
  }
}

document.getElementById('settingsApiKey').value = localStorage.getItem('adminApiKey') || '';
document.getElementById('settingsApiKey').addEventListener('input', (event) => {
  const value = event.target.value.trim();
  if (value) {
    // A stale sessionToken from an earlier login session would otherwise win over this key
    // on every request (see authHeaders()), silently making a correct key look broken.
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('sessionUser');
    localStorage.setItem('adminApiKey', value);
  } else {
    localStorage.removeItem('adminApiKey');
  }
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
  const warn = Boolean(alerts.total);
  const el = document.getElementById('opsPosture');
  el.className = `posture-banner glass-panel posture-1a${warn ? ' warn' : ''}`;
  el.innerHTML = `
    <div class="posture-head-row">
      <div class="posture-badge"><span></span></div>
      <div>
        <div class="section-eyebrow">Operational posture · ${relativeTime(overview.generatedAt)}</div>
        <div class="posture-title">${esc(posture.summary || 'Monitoring nominal')}</div>
      </div>
    </div>
    <div class="posture-sub">${warn
      ? `${alerts.total} item${alerts.total === 1 ? '' : 's'} need attention — work the queue below.`
      : 'Audit chain verified · Telegram bridge connected · no failed dispatches recently.'}</div>
    <div class="posture-actions">
      <button class="btn-primary" onclick="openActivityTab()">Review queue</button>
      <button class="btn-secondary" onclick="refreshOps()">Refresh</button>
    </div>`;
}

function renderOperatorStrip(operators) {
  const labels = { online: 'Online', delayed: 'Delayed', offline: 'Offline' };
  document.getElementById('operatorStrip').innerHTML = operators.map((operator) => {
    const state = gatewayState(operator);
    return `
    <div class="fleet-row state-${state}" style="--operator-color:${operatorTone(operator.operator)}">
      <div class="fleet-id">
        <div class="fleet-name">${esc(operator.operatorName)}</div>
        <div class="fleet-gw">${esc(operator.gatewayId)}</div>
      </div>
      <svg class="fleet-ecg" viewBox="0 0 180 40" preserveAspectRatio="none" aria-hidden="true"><path d="${ECG_PATH_D}" /></svg>
      <div class="fleet-state">
        <div class="fleet-state-label"><span class="fleet-state-dot"></span>${labels[state]}</div>
        <div class="fleet-last">${relativeTime(operator.lastSeenAt)}</div>
      </div>
    </div>`;
  }).join('');
}

function renderAttentionGrid(overview) {
  const alerts = overview.alerts || {};
  const items = [
    { icon: 'rate_review', tone: 'warning', value: alerts.pendingApprovals || 0, title: 'reply drafts to review', detail: 'Supervisor review queue' },
    { icon: 'error', tone: 'danger', value: alerts.failedRequests || 0, title: 'failed / timed-out dispatches', detail: 'Requests needing intervention' },
    { icon: 'link_off', tone: 'accent', value: alerts.unmatchedSms || 0, title: 'unmatched inbound replies', detail: 'Exception desk work' },
    { icon: 'cell_tower', tone: 'danger', value: alerts.offlineGateways || 0, title: 'offline gateways', detail: 'Fleet availability concern' }
  ];
  document.getElementById('attentionGrid').innerHTML = items.map((item) => {
    const active = item.value > 0;
    const tone = active ? item.tone : 'success';
    const chipTone = active ? (item.tone === 'accent' ? 'accent' : item.tone) : 'muted';
    return `
    <div class="attention-item">
      <span class="attention-icon ${tone}"><span class="material-symbols-outlined">${active ? item.icon : 'check_circle'}</span></span>
      <div class="attention-body">
        <div class="attention-item-title">${item.value} ${esc(item.title)}</div>
        <div class="attention-item-detail">${active ? esc(item.detail) : 'All clear'}</div>
      </div>
      <span class="chip chip-${chipTone}">${active ? 'Act' : 'OK'}</span>
    </div>`;
  }).join('');
}

const ECG_PATH_D = 'M0 20 L40 20 L48 8 L56 32 L64 4 L72 20 L110 20 L118 12 L126 28 L134 20 L180 20';

function gatewayState(operator) {
  if (operator.state === 'MOCK') return 'delayed';
  if (operator.online) return 'online';
  const lastSeenMs = operator.lastSeenAt ? new Date(operator.lastSeenAt).getTime() : 0;
  const silentForMs = Date.now() - lastSeenMs;
  if (lastSeenMs && silentForMs < 30 * 60 * 1000) return 'delayed';
  return 'offline';
}

function renderHomeGateways(operators) {
  const labels = { online: 'Online', delayed: 'Delayed', offline: 'Offline' };
  document.getElementById('homeGateways').innerHTML = operators.map((operator) => {
    const state = gatewayState(operator);
    return `
    <div class="gateway-card state-${state}">
      <div class="gateway-name">${esc(operator.operatorName)}</div>
      <svg class="gateway-ecg" viewBox="0 0 180 40" preserveAspectRatio="none" aria-hidden="true">
        <path d="${ECG_PATH_D}" />
      </svg>
      <div class="gateway-status-row"><span class="gateway-status-dot"></span>${labels[state]}</div>
      <div class="gateway-meta">${relativeTime(operator.lastSeenAt)}</div>
    </div>`;
  }).join('');
}

function renderHomeSummary(overview) {
  const alerts = overview.alerts || {};
  document.getElementById('homeSummary').innerHTML = `
    <div class="summary-item"><div class="summary-value">${overview.stats?.todayRequests || 0}</div><div class="summary-label">Today</div></div>
    <div class="summary-item"><div class="summary-value ${alerts.pendingApprovals ? 'warning' : ''}">${alerts.pendingApprovals || 0}</div><div class="summary-label">Needs Review</div></div>
    <div class="summary-item"><div class="summary-value ${alerts.failedRequests ? 'danger' : ''}">${alerts.failedRequests || 0}</div><div class="summary-label">Failed</div></div>`;
}

function renderHomeTicker(events) {
  const latest = (events || [])[0];
  const ticker = document.getElementById('homeTicker');
  if (!latest) {
    ticker.innerHTML = '';
    return;
  }
  ticker.innerHTML = `<span class="material-symbols-outlined">bolt</span>${esc(latest.title)}${latest.operator ? ` · ${esc(latest.operator)}` : ''} · ${relativeTime(latest.occurredAt)}`;
}

function renderHomeMinimal(overview) {
  const alerts = overview.alerts || {};
  const headline = document.getElementById('homeHeadline');
  headline.textContent = overview.posture?.summary || 'Monitoring nominal';
  headline.classList.toggle('warning', Boolean(alerts.total));
  document.getElementById('homeTimestamp').textContent = `Updated ${relativeTime(overview.generatedAt)}`;
  renderHomeGateways(overview.operators || []);
  renderHomeSummary(overview);
  renderHomeTicker(overview.activity || []);
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

  document.getElementById('activityFeed').innerHTML = filtered.map((event, i) => `
    <div class="timeline-item timeline-in row-accent ${event.severity === 'critical' ? 'danger' : event.severity === 'warning' ? 'warning' : event.severity === 'success' ? 'success' : 'info'}" style="animation-delay:${Math.min(i, 10) * 30}ms">
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

    renderHomeMinimal(opsOverview);
    renderPosture(opsOverview);
    renderOperatorStrip(opsOverview.operators || []);
    renderAttentionGrid(opsOverview);
    renderActivityFeed();
    document.getElementById('lastRefresh')?.remove();
  } catch (error) {
    console.error('Failed to refresh operations UI:', error);
  }
}

let booted = false;
function boot() {
  if (booted) return; // avoid stacking duplicate intervals if the gate re-locks and re-unlocks
  booted = true;
  pollHealth();
  setInterval(pollHealth, 30_000);
  applyRoleView();
  // A Registered Officer session must never call /api/ops/* — that endpoint
  // is now admin-only server-side (security-hardening v1 §4), and calling it
  // anyway would 401 and trip apiFetch's onAuthRequired handler, which is
  // sessionLogout() here — silently signing the officer out just for opening
  // the home page. Skip the fetch/poll loop entirely for that tier instead.
  if (isOperationalRole()) {
    refreshOps();
    setInterval(refreshOps, 15_000);
  }
}

window._bootTime = Date.now();
window.onAuthRequired = sessionLogout; // 401 mid-session → clear token and go to login

(async function sessionInit() {
  const sessionToken = localStorage.getItem('sessionToken');
  if (sessionToken) {
    let user = null;
    try {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${sessionToken}` } });
      if (res.ok) user = (await res.json()).user;
    } catch (_) {}
    if (user) {
      localStorage.setItem('sessionUser', JSON.stringify(user));
      document.getElementById('authOverlay').style.display = 'none';
      document.getElementById('opsApp').style.display = 'block';
      updateAdminVisibility();
      boot();
      return;
    }
    // Token no longer valid — clear and fall through to redirect.
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('sessionUser');
  }
  // No valid session → go to login page.
  location.replace('/login.html');
})();
