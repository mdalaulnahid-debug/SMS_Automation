#!/usr/bin/env node
'use strict';

// Standalone account-recovery utility — run this ON THE SERVER, by hand, over
// your own SSH session. It never transmits or logs the plaintext password;
// it reads it from your own terminal and writes only the resulting hash.
//
// Usage (on the VPS, from /opt/sms-backend):
//   node scripts/reset-password.js <current-email> [new-email]
//   node scripts/reset-password.js mdalaulnahid@gmail.com opsbarishal@gmail.com
// You'll be prompted to type the new password (input is not echoed).
// Omit [new-email] to reset the password only, keeping the current email.
//
// Hash format matches src/userAuth.js's hashPassword() exactly
// (scrypt, 64-byte derived key, random 16-byte hex salt, "salt:hash"),
// so the account can log in normally afterward with no other changes.

const { DatabaseSync } = require('node:sqlite');
const { scryptSync, randomBytes, timingSafeEqual } = require('node:crypto');
const readline = require('node:readline');
const path = require('node:path');

const currentEmail = String(process.argv[2] || '').trim().toLowerCase();
const newEmail = process.argv[3] ? String(process.argv[3]).trim().toLowerCase() : null;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if (!currentEmail) {
  console.error('Usage: node scripts/reset-password.js <current-email> [new-email]');
  process.exit(1);
}
if (newEmail && !EMAIL_RE.test(newEmail)) {
  console.error(`"${newEmail}" doesn't look like a valid email address.`);
  process.exit(1);
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// Single prompt only (no separate confirm step) — a second sequential
// question() on a non-TTY/piped stdin can hang forever once the stream
// hits EOF between prompts (readline auto-closes on end-of-input by
// default), so one prompt is the reliable choice here. Re-run the script
// if you mistype.
function readHiddenPassword(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const originalWrite = rl._writeToOutput.bind(rl);
    let muted = false;
    rl._writeToOutput = (chunk) => {
      originalWrite(muted ? '*'.repeat(chunk.length) : chunk);
    };
    rl.question(promptText, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const dbPath = process.env.AUTH_DB_PATH || path.join(__dirname, '..', 'data', 'auth.db');
  const db = new DatabaseSync(dbPath);

  const user = db.prepare('SELECT id, email, status FROM auth_users WHERE email = ?').get(currentEmail);
  if (!user) {
    console.error(`No account found for ${currentEmail}.`);
    process.exit(1);
  }

  if (newEmail && newEmail !== currentEmail) {
    const conflict = db.prepare('SELECT id FROM auth_users WHERE email = ?').get(newEmail);
    if (conflict) {
      console.error(`"${newEmail}" is already in use by a different account. Nothing was changed.`);
      process.exit(1);
    }
  }

  const password = await readHiddenPassword(
    `New password for ${newEmail || currentEmail} (min 8 characters): `
  );
  if (!password || password.length < 8) {
    console.error('Password must be at least 8 characters. Nothing was changed.');
    process.exit(1);
  }

  const newHash = hashPassword(password);
  // Self-check before writing — confirms the hash this script just produced
  // actually verifies correctly against the app's own verifyPassword logic.
  if (!verifyPassword(password, newHash)) {
    console.error('Internal error: hash self-check failed. Nothing was changed.');
    process.exit(1);
  }

  if (newEmail && newEmail !== currentEmail) {
    db.prepare(
      'UPDATE auth_users SET email = ?, password_hash = ?, mfa_code_hash = NULL, mfa_code_expires_at = NULL, pending_session_token = NULL WHERE id = ?'
    ).run(newEmail, newHash, user.id);
    console.log(`Email changed to ${newEmail} and password updated (status: ${user.status}). Sign in with the new email.`);
  } else {
    db.prepare(
      'UPDATE auth_users SET password_hash = ?, mfa_code_hash = NULL, mfa_code_expires_at = NULL, pending_session_token = NULL WHERE id = ?'
    ).run(newHash, user.id);
    console.log(`Password updated for ${currentEmail} (status: ${user.status}). You can sign in now.`);
  }
}

main().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
