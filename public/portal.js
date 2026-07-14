'use strict';

// Minimal client script for the officer portal. Deliberately does not import
// app.js or any admin/operational code — a Telegram-linked officer's browser
// never downloads that bundle at all (see the server-side branch in
// src/app.js's GET / handler). This file only renders the signed-in officer's
// own account status and handles sign-out.

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function renderAccount(user) {
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

function portalLogout() {
  const token = localStorage.getItem('sessionToken');
  localStorage.removeItem('sessionToken');
  localStorage.removeItem('sessionUser');
  fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    .catch(() => {})
    .finally(() => location.replace('/login.html'));
}
window.portalLogout = portalLogout;

(async function init() {
  const sessionToken = localStorage.getItem('sessionToken');
  if (!sessionToken) return location.replace('/login.html');
  try {
    const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${sessionToken}` } });
    if (!res.ok) throw new Error('session invalid');
    const { user } = await res.json();
    localStorage.setItem('sessionUser', JSON.stringify(user));
    // An admin/super_admin landing here (e.g. a stale bookmark) belongs on
    // the real app instead — bounce them rather than showing this page.
    if (user.role !== 'officer') return location.replace('/');
    renderAccount(user);
  } catch (_) {
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('sessionUser');
    location.replace('/login.html');
  }
})();
