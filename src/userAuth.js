'use strict';

// User accounts, sessions, and email-based MFA for officer/admin login.
// Separate SQLite file from the main automation DB (data/auth.db by default) — this is
// identity/access data, not request workflow data, and keeping it apart simplifies backup/audit
// scoping. Uses node:crypto scrypt for password hashing (no external dependency).

const { DatabaseSync } = require('node:sqlite');
const { scryptSync, randomBytes, randomInt, timingSafeEqual } = require('node:crypto');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  telegram_id TEXT,
  role TEXT NOT NULL DEFAULT 'officer',
  status TEXT NOT NULL DEFAULT 'pending_verification',
  email_verified INTEGER NOT NULL DEFAULT 0,
  verify_token TEXT,
  verify_token_expires_at TEXT,
  mfa_code_hash TEXT,
  mfa_code_expires_at TEXT,
  pending_session_token TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS personnel_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  designation TEXT,
  unit TEXT,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  imported_by TEXT
);
CREATE TABLE IF NOT EXISTS registration_tokens (
  telegram_id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS registration_invites (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  designation TEXT,
  unit TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS super_admin_gate (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  slug TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days to complete an invited registration

const REGISTRATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours to complete registration via a bot-issued link

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const MFA_PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes to enter the MFA code
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours to verify email
const ROLES = ['officer', 'admin', 'super_admin'];

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function hashToken(token) {
  return scryptSync(token, 'mfa-static-salt', 32).toString('hex');
}

// Registration activation policy (design doc §3, decided 2026-07-07): while a
// migration window is set and still in the future, a registry-matched
// registration auto-activates; otherwise it needs super-admin approval. No
// window configured at all (the default) means "always auto-activate" — this
// must never change behavior for a deployment that hasn't opted into the
// registration-gating rollout yet.
function isWithinRegistrationWindow(registrationWindowEndsAt, now = Date.now()) {
  if (!registrationWindowEndsAt) return true;
  return new Date(registrationWindowEndsAt).getTime() > now;
}

function generateToken() {
  return randomBytes(32).toString('hex');
}

function generateMfaCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

class UserAuthStore {
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath || ':memory:');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
    this._migrateSchema();
    this._ensureSuperAdminGateSlug();
  }

  // The hidden super-admin login wall's URL is a random slug, generated once
  // on first boot and never displayed anywhere in the UI — logged to the
  // server console so whoever has server/log access can retrieve it once and
  // bookmark it. Regenerating it (regenerateSuperAdminGateSlug) invalidates
  // the old URL immediately.
  _ensureSuperAdminGateSlug() {
    const existing = this.db.prepare('SELECT slug FROM super_admin_gate WHERE id = 1').get();
    if (existing) return existing.slug;
    const slug = randomBytes(9).toString('base64url');
    this.db
      .prepare('INSERT INTO super_admin_gate (id, slug, created_at) VALUES (1, ?, ?)')
      .run(slug, new Date().toISOString());
    console.log(`[super-admin gate] hidden sign-in URL: /console/${slug} — this is only logged once, bookmark it now.`);
    return slug;
  }

  getSuperAdminGateSlug() {
    return this.db.prepare('SELECT slug FROM super_admin_gate WHERE id = 1').get().slug;
  }

  // Lets an already-authenticated super_admin rotate the hidden URL (e.g.
  // after suspecting it leaked). Logs the new one the same way as first boot.
  regenerateSuperAdminGateSlug() {
    const slug = randomBytes(9).toString('base64url');
    this.db.prepare('UPDATE super_admin_gate SET slug = ?, created_at = ? WHERE id = 1').run(slug, new Date().toISOString());
    console.log(`[super-admin gate] hidden sign-in URL rotated: /console/${slug} — this is only logged once, bookmark it now.`);
    return slug;
  }

  // CREATE TABLE IF NOT EXISTS above is a no-op against an auth_users table that
  // already existed before telegram_id was added (any real deployment's DB file).
  // Add the column if it's missing, then ensure the uniqueness index either way —
  // one Telegram identity must map to at most one account. A partial index (WHERE
  // telegram_id IS NOT NULL) allows any number of unlinked (NULL) accounts.
  _migrateSchema() {
    const columns = this.db.prepare('PRAGMA table_info(auth_users)').all();
    if (!columns.some((col) => col.name === 'telegram_id')) {
      this.db.exec('ALTER TABLE auth_users ADD COLUMN telegram_id TEXT');
    }
    if (!columns.some((col) => col.name === 'designation')) {
      this.db.exec('ALTER TABLE auth_users ADD COLUMN designation TEXT');
    }
    if (!columns.some((col) => col.name === 'unit')) {
      this.db.exec('ALTER TABLE auth_users ADD COLUMN unit TEXT');
    }
    if (!columns.some((col) => col.name === 'reset_token')) {
      this.db.exec('ALTER TABLE auth_users ADD COLUMN reset_token TEXT');
    }
    if (!columns.some((col) => col.name === 'reset_token_expires_at')) {
      this.db.exec('ALTER TABLE auth_users ADD COLUMN reset_token_expires_at TEXT');
    }
    this.db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_telegram_id ON auth_users(telegram_id) WHERE telegram_id IS NOT NULL'
    );
  }

  close() {
    this.db.close();
  }

  _row(email) {
    return this.db.prepare('SELECT * FROM auth_users WHERE email = ?').get(String(email).toLowerCase());
  }

  getUserById(id) {
    return this.db.prepare('SELECT * FROM auth_users WHERE id = ?').get(id) || null;
  }

  getUserByEmail(email) {
    return this._row(email) || null;
  }

  // The join key between the two identity systems that have never been linked
  // (web login here vs. the Telegram bridge's flat authorizedUsers config) —
  // see docs/security-hardening-v1-design.md §5. Telegram user IDs are treated
  // as strings throughout (matching how config/telegram.json already keys
  // authorizedUsers), since they're large integers with no arithmetic use.
  getUserByTelegramId(telegramId) {
    if (!telegramId) return null;
    return this.db.prepare('SELECT * FROM auth_users WHERE telegram_id = ?').get(String(telegramId)) || null;
  }

  // Links a Telegram identity to an existing account. Rejects if that Telegram
  // ID is already linked to a DIFFERENT account (the partial unique index
  // enforces this at the DB level too; this just turns the raw constraint
  // error into a clear, catchable application error).
  linkTelegramId(userId, telegramId) {
    const normalized = String(telegramId || '').trim();
    if (!normalized) throw new Error('Telegram ID is required.');
    const existing = this.getUserByTelegramId(normalized);
    if (existing && existing.id !== userId) {
      throw new Error('This Telegram account is already linked to another user.');
    }
    this.db.prepare('UPDATE auth_users SET telegram_id = ? WHERE id = ?').run(normalized, userId);
  }

  listUsers() {
    return this.db.prepare('SELECT id, email, name, phone, telegram_id, role, status, email_verified, created_at, last_login_at FROM auth_users ORDER BY created_at').all();
  }

  // Registration: creates a pending_verification user and returns the raw verify token (caller emails it).
  // telegramId is optional — set when registration originated from the bot's
  // registration-link flow (not built yet; the field exists so that flow has
  // somewhere to plug in without another schema change).
  register({ email, password, name, phone, role = 'officer', telegramId, designation, unit }) {
    email = String(email || '').trim().toLowerCase();
    if (!isValidEmail(email)) throw new Error('Invalid email address.');
    if (!password || String(password).length < 8) throw new Error('Password must be at least 8 characters.');
    if (!name || !String(name).trim()) throw new Error('Name is required.');
    if (!ROLES.includes(role)) throw new Error('Invalid role.');
    if (this._row(email)) throw new Error('An account with this email already exists.');
    const normalizedTelegramId = telegramId ? String(telegramId).trim() : null;
    if (normalizedTelegramId && this.getUserByTelegramId(normalizedTelegramId)) {
      throw new Error('This Telegram account is already linked to another user.');
    }

    const id = randomBytes(16).toString('hex');
    const verifyToken = generateToken();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString();

    this.db
      .prepare(
        `INSERT INTO auth_users
         (id, email, password_hash, name, phone, telegram_id, designation, unit, role, status, email_verified, verify_token, verify_token_expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification', 0, ?, ?, ?)`
      )
      .run(
        id, email, hashPassword(password), String(name).trim(),
        phone ? String(phone).trim() : null, normalizedTelegramId,
        designation ? String(designation).trim() : null, unit ? String(unit).trim() : null,
        role, verifyToken, expiresAt, now
      );

    return { id, email, verifyToken };
  }

  // Directly creates an active, pre-verified account — used for the
  // super-admin bootstrap, and for a super-admin creating an account
  // by hand from the admin console (no invite round trip needed).
  createVerifiedUser({ email, password, name, role, phone, designation, unit }) {
    email = String(email || '').trim().toLowerCase();
    if (this._row(email)) return this._row(email);
    const id = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO auth_users
         (id, email, password_hash, name, phone, designation, unit, role, status, email_verified, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?)`
      )
      .run(id, email, hashPassword(password), name, phone || null, designation || null, unit || null, role, now);
    return this._row(email);
  }

  // Registration invite: a super-admin-issued token binding a specific
  // email/identity to a role. This is now the ONLY way a new admin account
  // gets created via the web registration form — there is no open sign-up
  // path left. (Officer accounts are never invited; startLogin() blocks
  // that role from the website entirely — see the access-model correction
  // in SESSION_MEMORY.md, 2026-07-15.)
  createInvite({ email, name, phone, designation, unit, role = 'admin', createdBy }) {
    email = String(email || '').trim().toLowerCase();
    if (!isValidEmail(email)) throw new Error('Invalid email address.');
    if (role !== 'admin' && role !== 'super_admin') {
      throw new Error('Invites can only be issued for the admin or super_admin role.');
    }
    if (this._row(email)) throw new Error('An account with this email already exists.');
    const token = generateToken();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    this.db
      .prepare(
        `INSERT INTO registration_invites
         (token, email, name, phone, designation, unit, role, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        token, email, name ? String(name).trim() : null, phone ? String(phone).trim() : null,
        designation ? String(designation).trim() : null, unit ? String(unit).trim() : null,
        role, createdBy || null, now, expiresAt
      );
    return { token, email, name, role, expiresAt };
  }

  // Read-only check for the Register page — never throws, just tells the
  // caller whether to show the form at all ("You are not authorized for
  // Registration" is the caller's job to render when this returns null).
  getInviteIfValid(token) {
    if (!token) return null;
    const invite = this.db.prepare('SELECT * FROM registration_invites WHERE token = ?').get(String(token));
    if (!invite || invite.consumed_at) return null;
    if (new Date(invite.expires_at).getTime() < Date.now()) return null;
    return invite;
  }

  // Throwing variant for the actual registration submit — same checks as
  // getInviteIfValid, but with a message the UI can surface as a real error.
  validateInvite(token) {
    const invite = this.db.prepare('SELECT * FROM registration_invites WHERE token = ?').get(String(token || ''));
    if (!invite) throw new Error('You are not authorized for Registration.');
    if (invite.consumed_at) throw new Error('This invitation has already been used.');
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      throw new Error('This invitation has expired. Ask a super-admin to send a new one.');
    }
    return invite;
  }

  consumeInvite(token) {
    this.db.prepare('UPDATE registration_invites SET consumed_at = ? WHERE token = ?').run(new Date().toISOString(), token);
  }

  listInvites() {
    return this.db
      .prepare(
        'SELECT token, email, name, role, created_by, created_at, expires_at, consumed_at FROM registration_invites ORDER BY created_at DESC'
      )
      .all();
  }

  // registrationWindowEndsAt (optional) decides what verifying lands the account
  // in: 'active' immediately (default, and always during a migration window) or
  // 'pending_approval' (post-window steady state — see isWithinRegistrationWindow).
  verifyEmail(token, { registrationWindowEndsAt } = {}) {
    const user = this.db.prepare('SELECT * FROM auth_users WHERE verify_token = ?').get(token);
    if (!user) throw new Error('Invalid or already-used verification link.');
    if (new Date(user.verify_token_expires_at).getTime() < Date.now()) {
      throw new Error('Verification link expired. Please register again or request a new link.');
    }
    const status = isWithinRegistrationWindow(registrationWindowEndsAt) ? 'active' : 'pending_approval';
    this.db
      .prepare(
        `UPDATE auth_users SET email_verified = 1, status = ?, verify_token = NULL, verify_token_expires_at = NULL WHERE id = ?`
      )
      .run(status, user.id);
    return this.getUserById(user.id);
  }

  listPendingApprovals() {
    return this.db
      .prepare(
        'SELECT id, email, name, phone, telegram_id, role, created_at FROM auth_users WHERE status = ? ORDER BY created_at'
      )
      .all('pending_approval');
  }

  // Super-admin activates a pending_approval account. Only meaningful from
  // that specific status — approving an already-active or disabled account
  // would silently paper over a status this action was never meant to touch.
  approveRegistration(userId) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('User not found.');
    if (user.status !== 'pending_approval') {
      throw new Error(`Cannot approve a user with status "${user.status}" (expected pending_approval).`);
    }
    this.db.prepare(`UPDATE auth_users SET status = 'active' WHERE id = ?`).run(userId);
    return this.getUserById(userId);
  }

  // Self-service password change — requires proving the CURRENT password (not
  // just a valid session), so a hijacked/left-open session alone can't lock
  // the real owner out or plant a new credential.
  changePassword(userId, currentPassword, newPassword) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('User not found.');
    if (!verifyPassword(currentPassword, user.password_hash)) {
      throw new Error('Current password is incorrect.');
    }
    if (String(newPassword || '').length < 8) {
      throw new Error('New password must be at least 8 characters.');
    }
    this.db.prepare('UPDATE auth_users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), userId);
  }

  // Forgot-password: issues a reset token for an *existing, non-disabled*
  // account. Returns null (not a thrown error) when the email doesn't match
  // anything, so the API layer can always respond 200 either way and never
  // leak which emails have accounts — the same shape as most real-world
  // reset flows, deliberately not mirroring startLogin()'s throw-on-miss.
  requestPasswordReset(email) {
    const user = this._row(email);
    if (!user || user.status === 'disabled') return null;
    const resetToken = generateToken();
    const expiresAt = new Date(Date.now() + MFA_PENDING_TTL_MS * 6).toISOString(); // 1 hour
    this.db
      .prepare('UPDATE auth_users SET reset_token = ?, reset_token_expires_at = ? WHERE id = ?')
      .run(resetToken, expiresAt, user.id);
    return { resetToken, email: user.email, name: user.name };
  }

  // Completes a reset: verifies the token, sets the new password, and
  // invalidates every existing session for the account — a password reset
  // is exactly the moment a stale/hijacked session should stop working.
  resetPassword(resetToken, newPassword) {
    const user = this.db.prepare('SELECT * FROM auth_users WHERE reset_token = ?').get(resetToken);
    if (!user) throw new Error('Invalid or already-used reset link.');
    if (!user.reset_token_expires_at || new Date(user.reset_token_expires_at).getTime() < Date.now()) {
      throw new Error('Reset link expired. Please request a new one.');
    }
    if (String(newPassword || '').length < 8) {
      throw new Error('New password must be at least 8 characters.');
    }
    this.db
      .prepare('UPDATE auth_users SET password_hash = ?, reset_token = NULL, reset_token_expires_at = NULL WHERE id = ?')
      .run(hashPassword(newPassword), user.id);
    this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(user.id);
  }

  // Shared core of step 1: password + status checks, issues the MFA code.
  // Role gating is the caller's job (startLogin vs startSuperAdminLogin
  // enforce opposite rules on the same underlying account), so this never
  // rejects on role itself.
  _beginLogin(email, password) {
    const user = this._row(email);
    if (!user) throw new Error('Invalid email or password.');
    if (!verifyPassword(password, user.password_hash)) throw new Error('Invalid email or password.');
    if (user.status === 'disabled') throw new Error('This account has been disabled. Contact an administrator.');
    if (user.status === 'pending_approval') throw new Error('Your registration is pending administrator approval.');
    if (!user.email_verified) throw new Error('Please verify your email before logging in.');

    const mfaCode = generateMfaCode();
    const pendingToken = generateToken();
    const expiresAt = new Date(Date.now() + MFA_PENDING_TTL_MS).toISOString();

    this.db
      .prepare('UPDATE auth_users SET mfa_code_hash = ?, mfa_code_expires_at = ?, pending_session_token = ? WHERE id = ?')
      .run(hashToken(mfaCode), expiresAt, pendingToken, user.id);

    return { user, pendingToken, mfaCode };
  }

  // Step 1 of the NORMAL login (/login): verify password, issue a short-lived
  // MFA code + pending token. Returns { pendingToken, mfaCode, email } —
  // caller emails mfaCode to the user and returns pendingToken to the client.
  startLogin({ email, password }) {
    const { user, pendingToken, mfaCode } = this._beginLogin(email, password);
    // Access-model correction (2026-07-15): the website is a supervision/
    // admin tool now, not something regular officers use — they interact
    // with the system entirely through Telegram. Any pre-existing officer-
    // role account (from before this change) is blocked here rather than
    // deleted, so nothing destructive happens to old data.
    if (user.role === 'officer') {
      throw new Error('Officer accounts do not have website access. Use the Telegram bot to submit requests.');
    }
    // Super-admin never authenticates through the public /login page at all
    // — that's the whole point of the hidden gate (see startSuperAdminLogin).
    // The message stays generic; it must not hint that a separate URL exists.
    if (user.role === 'super_admin') {
      throw new Error('Invalid email or password.');
    }
    return { pendingToken, mfaCode, email: user.email, name: user.name };
  }

  // Step 1 of the HIDDEN super-admin gate — the only login path that accepts
  // a super_admin account. Rejects every other role, including admin, so a
  // correct password for a non-super_admin account still can't get in here.
  startSuperAdminLogin({ email, password }) {
    const { user, pendingToken, mfaCode } = this._beginLogin(email, password);
    if (user.role !== 'super_admin') {
      throw new Error('Invalid email or password.');
    }
    return { pendingToken, mfaCode, email: user.email, name: user.name };
  }

  // Step 2 of login: verify the 6-digit code against the pending token, issue a real session.
  completeLogin({ pendingToken, code, ip, userAgent }) {
    const user = this.db.prepare('SELECT * FROM auth_users WHERE pending_session_token = ?').get(pendingToken);
    if (!user) throw new Error('Login session expired. Please log in again.');
    if (!user.mfa_code_expires_at || new Date(user.mfa_code_expires_at).getTime() < Date.now()) {
      throw new Error('Verification code expired. Please log in again.');
    }
    const candidate = hashToken(String(code || '').trim());
    const a = Buffer.from(candidate, 'hex');
    const b = Buffer.from(user.mfa_code_hash || '', 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('Incorrect verification code.');
    }

    this.db
      .prepare('UPDATE auth_users SET mfa_code_hash = NULL, mfa_code_expires_at = NULL, pending_session_token = NULL, last_login_at = ? WHERE id = ?')
      .run(new Date().toISOString(), user.id);

    const token = generateToken();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    this.db
      .prepare('INSERT INTO auth_sessions (token, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
      .run(token, user.id, now, expiresAt, ip || null, userAgent || null);

    return { token, expiresAt, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }

  validateSession(token) {
    if (!token) return null;
    const session = this.db.prepare('SELECT * FROM auth_sessions WHERE token = ?').get(token);
    if (!session) return null;
    if (new Date(session.expires_at).getTime() < Date.now()) {
      this.db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
      return null;
    }
    const user = this.getUserById(session.user_id);
    // Defense in depth: startLogin() already blocks pending_approval from ever
    // reaching a session, but a session shouldn't stay valid if status changes
    // out from under it later either (matches the existing disabled check).
    if (!user || user.status === 'disabled' || user.status === 'pending_approval') return null;
    return { session, user };
  }

  logout(token) {
    this.db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
  }

  setRole(userId, role) {
    if (!ROLES.includes(role)) throw new Error('Invalid role.');
    this.db.prepare('UPDATE auth_users SET role = ? WHERE id = ?').run(role, userId);
  }

  setStatus(userId, status) {
    if (!['active', 'disabled', 'pending_verification', 'pending_approval'].includes(status)) {
      throw new Error('Invalid status.');
    }
    this.db.prepare('UPDATE auth_users SET status = ? WHERE id = ?').run(status, userId);
  }

  // --- Personnel Registry (design doc §6) ---
  // A registration attempt is validated against this — self-declared identity
  // (whatever someone types in) is never trusted. See personnelRegistry.js
  // for the pure phone+email matching logic this data feeds.

  // Wholesale replace: an admin re-import is expected to supersede the
  // previous roster entirely (the source spreadsheet IS the roster, not a
  // diff against it), not merge with it. Runs in a transaction so a failed
  // import can never leave the registry half-updated.
  replaceRegistry(records, importedBy) {
    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM personnel_registry');
      const insert = this.db.prepare(
        `INSERT INTO personnel_registry (id, name, designation, unit, phone, email, imported_at, imported_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const record of records) {
        insert.run(
          randomBytes(12).toString('hex'),
          String(record.name || '').trim(),
          record.designation ? String(record.designation).trim() : null,
          record.unit ? String(record.unit).trim() : null,
          String(record.phone || '').trim(),
          String(record.email || '').trim().toLowerCase(),
          now,
          importedBy || null
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { count: records.length, importedAt: now };
  }

  // Adds a single record without touching the rest of the roster — for a
  // super-admin adding one new officer between spreadsheet re-imports,
  // rather than needing a full re-upload for one person. Unlike
  // replaceRegistry, this rejects an exact (phone, email) duplicate instead
  // of silently creating a second row for the same person.
  addRegistryRecord({ name, designation, unit, phone, email }, addedBy) {
    const trimmedName = String(name || '').trim();
    const trimmedPhone = String(phone || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!trimmedName) throw new Error('Name is required.');
    if (!trimmedPhone) throw new Error('Phone is required.');
    if (!isValidEmail(normalizedEmail)) throw new Error('Invalid email address.');
    if (this.buildPersonnelRegistry().matchByPhoneAndEmail(trimmedPhone, normalizedEmail)) {
      throw new Error('A registry record with this phone and email already exists.');
    }

    const id = randomBytes(12).toString('hex');
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO personnel_registry (id, name, designation, unit, phone, email, imported_at, imported_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, trimmedName, designation ? String(designation).trim() : null, unit ? String(unit).trim() : null, trimmedPhone, normalizedEmail, now, addedBy || null);

    return this.db.prepare('SELECT * FROM personnel_registry WHERE id = ?').get(id);
  }

  listRegistry() {
    return this.db.prepare('SELECT * FROM personnel_registry ORDER BY name').all();
  }

  registrySize() {
    return this.db.prepare('SELECT COUNT(*) AS c FROM personnel_registry').get().c;
  }

  // Builds a ready-to-use PersonnelRegistry (the pure matcher in
  // personnelRegistry.js) from the currently-persisted roster.
  buildPersonnelRegistry() {
    const { PersonnelRegistry } = require('./personnelRegistry');
    return new PersonnelRegistry(this.listRegistry());
  }

  // --- Registration-link tokens (design doc §5) ---
  // Minted when an unregistered Telegram sender DMs the bot, so the bot can
  // reply with a link to the web registration form that already knows which
  // Telegram identity to link on success. One active token per Telegram id —
  // a repeat DM before the first link is used just re-issues (INSERT OR
  // REPLACE), rather than piling up rows for the same sender.
  createRegistrationToken(telegramId, { now = Date.now(), ttlMs = REGISTRATION_TOKEN_TTL_MS } = {}) {
    const normalized = String(telegramId || '').trim();
    if (!normalized) throw new Error('Telegram ID is required.');
    const token = generateToken();
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttlMs).toISOString();
    this.db
      .prepare(
        `INSERT INTO registration_tokens (telegram_id, token, created_at, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(telegram_id) DO UPDATE SET token = excluded.token, created_at = excluded.created_at, expires_at = excluded.expires_at, consumed_at = NULL`
      )
      .run(normalized, token, createdAt, expiresAt);
    return { token, expiresAt };
  }

  // Validates and burns a registration token, returning the Telegram ID it
  // was minted for. Single-use (consumed_at set on success) so a link can't
  // be replayed to link a second account to the same Telegram identity.
  consumeRegistrationToken(token, { now = Date.now() } = {}) {
    const row = this.db.prepare('SELECT * FROM registration_tokens WHERE token = ?').get(String(token || ''));
    if (!row) throw new Error('Invalid or expired registration link.');
    if (row.consumed_at) throw new Error('This registration link has already been used.');
    if (new Date(row.expires_at).getTime() < now) throw new Error('This registration link has expired. Ask the bot for a new one.');
    this.db.prepare('UPDATE registration_tokens SET consumed_at = ? WHERE telegram_id = ?').run(new Date(now).toISOString(), row.telegram_id);
    return row.telegram_id;
  }
}

module.exports = { UserAuthStore, isValidEmail, ROLES, SESSION_TTL_MS, isWithinRegistrationWindow };
