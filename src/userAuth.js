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
`;

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

  listUsers() {
    return this.db.prepare('SELECT id, email, name, phone, role, status, email_verified, created_at, last_login_at FROM auth_users ORDER BY created_at').all();
  }

  // Registration: creates a pending_verification user and returns the raw verify token (caller emails it).
  register({ email, password, name, phone, role = 'officer' }) {
    email = String(email || '').trim().toLowerCase();
    if (!isValidEmail(email)) throw new Error('Invalid email address.');
    if (!password || String(password).length < 8) throw new Error('Password must be at least 8 characters.');
    if (!name || !String(name).trim()) throw new Error('Name is required.');
    if (!ROLES.includes(role)) throw new Error('Invalid role.');
    if (this._row(email)) throw new Error('An account with this email already exists.');

    const id = randomBytes(16).toString('hex');
    const verifyToken = generateToken();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString();

    this.db
      .prepare(
        `INSERT INTO auth_users
         (id, email, password_hash, name, phone, role, status, email_verified, verify_token, verify_token_expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending_verification', 0, ?, ?, ?)`
      )
      .run(id, email, hashPassword(password), String(name).trim(), phone ? String(phone).trim() : null, role, verifyToken, expiresAt, now);

    return { id, email, verifyToken };
  }

  // Directly creates an active, pre-verified account (used for the super-admin bootstrap).
  createVerifiedUser({ email, password, name, role }) {
    email = String(email || '').trim().toLowerCase();
    if (this._row(email)) return this._row(email);
    const id = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO auth_users
         (id, email, password_hash, name, role, status, email_verified, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', 1, ?)`
      )
      .run(id, email, hashPassword(password), name, role, now);
    return this._row(email);
  }

  verifyEmail(token) {
    const user = this.db.prepare('SELECT * FROM auth_users WHERE verify_token = ?').get(token);
    if (!user) throw new Error('Invalid or already-used verification link.');
    if (new Date(user.verify_token_expires_at).getTime() < Date.now()) {
      throw new Error('Verification link expired. Please register again or request a new link.');
    }
    this.db
      .prepare(
        `UPDATE auth_users SET email_verified = 1, status = 'active', verify_token = NULL, verify_token_expires_at = NULL WHERE id = ?`
      )
      .run(user.id);
    return this.getUserById(user.id);
  }

  // Step 1 of login: verify password, issue a short-lived MFA code + pending token.
  // Returns { pendingToken, mfaCode, email } — caller emails mfaCode to the user and returns pendingToken to the client.
  startLogin({ email, password }) {
    const user = this._row(email);
    if (!user) throw new Error('Invalid email or password.');
    if (!verifyPassword(password, user.password_hash)) throw new Error('Invalid email or password.');
    if (user.status === 'disabled') throw new Error('This account has been disabled. Contact an administrator.');
    if (!user.email_verified) throw new Error('Please verify your email before logging in.');

    const mfaCode = generateMfaCode();
    const pendingToken = generateToken();
    const expiresAt = new Date(Date.now() + MFA_PENDING_TTL_MS).toISOString();

    this.db
      .prepare('UPDATE auth_users SET mfa_code_hash = ?, mfa_code_expires_at = ?, pending_session_token = ? WHERE id = ?')
      .run(hashToken(mfaCode), expiresAt, pendingToken, user.id);

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
    if (!user || user.status === 'disabled') return null;
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
    if (!['active', 'disabled', 'pending_verification'].includes(status)) throw new Error('Invalid status.');
    this.db.prepare('UPDATE auth_users SET status = ? WHERE id = ?').run(status, userId);
  }
}

module.exports = { UserAuthStore, isValidEmail, ROLES };
