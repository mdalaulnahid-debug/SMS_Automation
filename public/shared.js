'use strict';

function applyTheme(mode) {
  const dark = mode === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = dark ? 'light_mode' : 'dark_mode';
  const toggle = document.getElementById('themeToggle');
  if (toggle) toggle.checked = dark;
  localStorage.setItem('theme', dark ? 'dark' : 'light');
}

function toggleTheme() {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}

function toggleThemeCheckbox(cb) {
  applyTheme(cb.checked ? 'dark' : 'light');
}

(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
})();

function authHeaders() {
  const sessionToken = localStorage.getItem('sessionToken');
  if (sessionToken) return { Authorization: `Bearer ${sessionToken}` };
  const key = localStorage.getItem('adminApiKey');
  return key ? { 'x-api-key': key } : {};
}

function isAdminUnlocked() {
  if (localStorage.getItem('adminApiKey')) return true;
  try {
    const user = JSON.parse(localStorage.getItem('sessionUser') || '{}');
    return user.role === 'admin' || user.role === 'super_admin';
  } catch { return false; }
}

async function sessionLogout() {
  const token = localStorage.getItem('sessionToken');
  if (token) {
    try { await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); } catch (_) {}
  }
  localStorage.removeItem('sessionToken');
  localStorage.removeItem('sessionUser');
  location.replace('/login.html');
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...authHeaders() }
  });
  if (response.status === 401) {
    if (typeof window.onAuthRequired === 'function') window.onAuthRequired();
    return new Promise(() => {});
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
  if (!response.ok && response.status !== 202) throw new Error(body.error || JSON.stringify(body));
  return body;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function relativeTime(iso) {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return `${Math.max(1, Math.floor(diffMs / 1000))}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString();
}

function formatAbsoluteTime(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function statusTone(status) {
  if (['FAILED', 'TIMEOUT', 'REPLY_POSTED'].includes(status)) return 'danger';
  if (['COMPLETED', 'POSTED', 'REPLY_RECEIVED'].includes(status)) return 'success';
  if (['NEEDS_MANUAL_REVIEW', 'APPROVED_FOR_POST', 'APPROVED_FOR_EDIT'].includes(status)) return 'warning';
  return 'info';
}

function statusChipClass(status) {
  const tone = statusTone(status);
  if (tone === 'success') return 'chip chip-success';
  if (tone === 'danger') return 'chip chip-danger';
  if (tone === 'warning') return 'chip chip-warning';
  return 'chip chip-accent';
}

function operatorTone(operator) {
  if (operator === 'GP') return 'var(--operator-gp)';
  if (operator === 'ROBI') return 'var(--operator-robi)';
  if (operator === 'BANGLALINK') return 'var(--operator-banglalink)';
  return 'var(--accent)';
}

function renderDispatches(dispatches) {
  if (!dispatches?.length) return '';
  return `<div class="dispatch-row">${dispatches.map((dispatch) => {
    const cls = dispatch.status === 'REPLY_RECEIVED'
      ? 'dispatch-ok'
      : ['TIMEOUT', 'FAILED'].includes(dispatch.status)
        ? 'dispatch-err'
        : 'dispatch-pending';
    return `<span class="dispatch-badge ${cls}">${esc(dispatch.operator)} · ${esc(dispatch.status.replaceAll('_', ' '))}</span>`;
  }).join('')}</div>`;
}

async function pollHealth() {
  try {
    const res = await fetch('/api/health');
    const data = res.ok ? await res.json() : null;
    const online = data?.ok === true;
    const dot = document.getElementById('pulseIndicator');
    const label = document.getElementById('statusLabel');
    if (dot) dot.className = `pulse-dot${online ? '' : ' offline'}`;
    if (label) {
      label.textContent = online ? 'System healthy' : 'System down';
      label.style.color = online ? 'var(--accent)' : 'var(--danger)';
    }
  } catch {
    const dot = document.getElementById('pulseIndicator');
    const label = document.getElementById('statusLabel');
    if (dot) dot.className = 'pulse-dot offline';
    if (label) {
      label.textContent = 'System down';
      label.style.color = 'var(--danger)';
    }
  }
}

function auditLogsToCsv(logs) {
  const header = 'timestamp,actor,action,requestId,detail\n';
  const rows = logs.map((log) =>
    ['timestamp', 'actor', 'action', 'requestId']
      .map((key) => `"${String(log[key] || '').replace(/"/g, '""')}"`)
      .concat(`"${JSON.stringify(log.details || log.detail || {}).replace(/"/g, '""')}"`)
      .join(',')
  ).join('\n');
  return header + rows;
}

function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

let _lastProvPayload = '';
async function generateProvisionQr() {
  const gwId = document.getElementById('provGwId')?.value;
  const url = document.getElementById('provUrl')?.value.trim();
  const pin = document.getElementById('provPin')?.value.trim();
  const secret = document.getElementById('provSecret')?.value.trim();
  const errorEl = document.getElementById('provError');
  const resultEl = document.getElementById('provResult');
  if (errorEl) errorEl.style.display = 'none';
  if (resultEl) resultEl.style.display = 'none';
  if (!gwId || !url || !pin) {
    if (errorEl) {
      errorEl.textContent = 'Gateway ID, backend URL, and PIN are required.';
      errorEl.style.display = 'block';
    }
    return;
  }

  try {
    const data = await postJson('/api/admin/generate-qr', { gwId, url, pin, secret });
    _lastProvPayload = data.payload || '';
    const img = document.getElementById('provQrImg');
    if (img) img.src = data.dataUrl;
    if (resultEl) resultEl.style.display = 'flex';
  } catch (error) {
    if (errorEl) {
      errorEl.textContent = error.message;
      errorEl.style.display = 'block';
    }
  }
}

function copyProvPayload(buttonSelector) {
  if (!_lastProvPayload) return;
  navigator.clipboard.writeText(_lastProvPayload).then(() => {
    const button = document.querySelector(buttonSelector);
    if (!button) return;
    const original = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => {
      button.textContent = original;
    }, 1500);
  });
}
