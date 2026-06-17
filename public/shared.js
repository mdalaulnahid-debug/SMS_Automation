'use strict';

/* Shared utilities — see docs/design-system.md.
   Loaded by both public/app.js (mobile user app) and public/admin.js
   (desktop admin console), via a <script> tag before the page-specific
   script. Keep this generic: no DOM ids that don't exist on both pages. */

/* ── Theme ── */
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = dark ? 'light_mode' : 'dark_mode';
  const cb = document.getElementById('themeToggle');
  if (cb) cb.checked = dark;
  localStorage.setItem('theme', dark ? 'dark' : 'light');
}

function toggleTheme() {
  applyTheme(document.documentElement.getAttribute('data-theme') !== 'dark');
}

function toggleThemeCheckbox(cb) {
  applyTheme(cb.checked);
}

(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved ? saved === 'dark' : prefersDark);
})();

/* ── Auth ── */
function authHeaders() {
  const key = localStorage.getItem('adminApiKey');
  return key ? { 'x-api-key': key } : {};
}

function isAdminUnlocked() {
  return !!localStorage.getItem('adminApiKey');
}

// Each page defines window.onAuthRequired (overlay vs full-page gate).
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

/* ── Formatting helpers ── */
function relativeTime(iso) {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
  return new Date(iso).toLocaleString();
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function statusChipClass(status) {
  if (status === 'COMPLETED') return 'chip chip-success';
  if (['FAILED', 'TIMEOUT'].includes(status)) return 'chip chip-danger';
  if (status === 'NEEDS_MANUAL_REVIEW') return 'chip chip-warning';
  return 'chip chip-accent';
}

function renderDispatches(dispatches) {
  if (!dispatches || !dispatches.length) return '';
  const badges = dispatches.map((d) => {
    const cls = d.status === 'REPLY_RECEIVED' ? 'dispatch-ok'
      : ['TIMEOUT', 'FAILED'].includes(d.status) ? 'dispatch-err'
      : 'dispatch-pending';
    const icon = d.status === 'REPLY_RECEIVED' ? '✓'
      : ['TIMEOUT', 'FAILED'].includes(d.status) ? '✗' : '…';
    return `<span class="dispatch-badge ${cls}">${d.operator} ${icon}</span>`;
  }).join('');
  return `<div class="dispatch-row">${badges}</div>`;
}

/* ── Health poll — expects #pulseIndicator and #statusLabel in the page ── */
async function pollHealth() {
  try {
    const res = await fetch('/api/health');
    const data = res.ok ? await res.json() : null;
    const online = data?.ok === true;
    const dot   = document.getElementById('pulseIndicator');
    const label = document.getElementById('statusLabel');
    if (dot)   dot.className = `pulse-dot${online ? '' : ' offline'}`;
    if (label) {
      label.textContent = online ? 'Working' : 'Down';
      label.style.color = online ? 'var(--success)' : 'var(--danger)';
    }
  } catch {
    const dot   = document.getElementById('pulseIndicator');
    const label = document.getElementById('statusLabel');
    if (dot)   dot.className = 'pulse-dot offline';
    if (label) { label.textContent = 'Down'; label.style.color = 'var(--danger)'; }
  }
}

/* ── CSV download ── */
function downloadCsv(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function auditLogsToCsv(logs) {
  const header = 'timestamp,actor,action,requestId,detail\n';
  const rows = logs.map((l) =>
    ['timestamp', 'actor', 'action', 'requestId']
      .map((k) => `"${String(l[k] || '').replace(/"/g, '""')}"`)
      .concat([`"${JSON.stringify(l.detail || {}).replace(/"/g, '""')}"`])
      .join(',')
  ).join('\n');
  return header + rows;
}

/* ── QR Provisioning — expects #provGwId/#provUrl/#provPin/#provSecret/
   #provError/#provResult/#provQrImg in the page ── */
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
  if (!pin)  { errEl.textContent = 'PIN is required.';        errEl.style.display = 'block'; return; }

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

function copyProvPayload(buttonSelector) {
  if (!_lastProvPayload) return;
  navigator.clipboard.writeText(_lastProvPayload).then(() => {
    const btn = document.querySelector(buttonSelector);
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}
