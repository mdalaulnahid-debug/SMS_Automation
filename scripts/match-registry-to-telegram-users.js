#!/usr/bin/env node
'use strict';

// DRY RUN BY DEFAULT — matches the already-imported Personnel Registry
// (name/designation/unit/phone/email, imported via Admin Console > Team >
// Personnel Registry) against Telegram identities actually observed in the
// group, so an admin doesn't have to hand-authorize every DM sender one at
// a time.
//
// Telegram's Bot API does NOT let a bot list a group's full member list
// (privacy restriction) — there is no "get all members" call available
// here. The best available signal is everyone who has actually POSTED in
// the group: every valid Telegram-channel request (store.requests) plus
// every rejected/invalid group message (audit log REQUEST_VALIDATION_FAILED
// entries, which also carry requesterId/requesterName). That is what
// "current users from the telegram group" means in this script — people
// with observed activity, not a full member roster Telegram won't hand over.
//
// The registry has name/phone/email; Telegram only ever gives us an id and
// a display name (never phone/email, unless a user explicitly shares their
// contact card, which nothing here does) — so matching is necessarily by
// NAME, not phone/email. Two passes: exact (case/whitespace-normalized)
// name match, then a looser pass with common BD police rank/title words
// stripped from both sides (Telegram display names and registry names may
// or may not include rank). Anything that resolves to more than one
// registry record, or no record at all, is reported for manual review --
// never guessed.
//
// Run on the server (dry run — prints a report only, writes nothing):
//   node scripts/match-registry-to-telegram-users.js
// Run with --apply to actually add every unambiguous match to
// authorizedUsers (config/telegram.json) — review the dry-run report first:
//   node scripts/match-registry-to-telegram-users.js --apply

const path = require('node:path');
const { AutomationStore } = require('../src/store');
const { UserAuthStore } = require('../src/userAuth');
const settingsStore = require('../src/settingsStore');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'automation.db');
const authDbPath = process.env.AUTH_DB_PATH || path.join(__dirname, '..', 'data', 'auth.db');
const apply = process.argv.includes('--apply');

const store = new AutomationStore({}, { dbPath });
const userAuth = new UserAuthStore(authDbPath);

const registry = userAuth.listRegistry();
console.log(`Personnel Registry: ${registry.length} record(s).`);

// --- Collect distinct Telegram identities observed in the group ---
const seen = new Map(); // telegramId -> { telegramId, name }

for (const request of store.listRequests()) {
  if (request.channel !== 'telegram' || !request.requesterId) continue;
  if (!seen.has(request.requesterId)) {
    seen.set(request.requesterId, { telegramId: request.requesterId, name: request.requesterName || '' });
  }
}
for (const log of store.auditLogs) {
  if (log.action !== 'REQUEST_VALIDATION_FAILED') continue;
  const id = log.details?.requesterId;
  if (!id) continue;
  if (!seen.has(id)) {
    seen.set(id, { telegramId: id, name: log.details?.requesterName || '' });
  }
}

const telegramUsers = [...seen.values()];
console.log(`Telegram identities observed in group activity: ${telegramUsers.length}\n`);

// Already-authorized senders don't need matching again.
const alreadyAuthorized = new Set(settingsStore.readAuthorizedUsers().map((u) => u.telegramUserId));

// --- Name normalization ---
const RANK_WORDS = new Set([
  'addl', 'additional', 'sp', 'dsp', 'asp', 'oc', 'si', 'asi', 'io',
  'constable', 'inspector', 'superintendent', 'officer', 'sub', 'in', 'charge',
  'dc', 'ac', 'sac', 'dig', 'ig', 'commissioner', 'joint', 'deputy', 'assistant',
  'mr', 'mrs', 'md', 'dr'
]);

function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

function stripRankWords(normalized) {
  return normalized
    .split(' ')
    .filter((word) => !RANK_WORDS.has(word))
    .join(' ');
}

const registryIndex = registry.map((record) => ({
  record,
  exact: normalize(record.name),
  stripped: stripRankWords(normalize(record.name))
}));

const matched = [];
const ambiguous = [];
const unmatchedTelegramUsers = [];

for (const user of telegramUsers) {
  if (alreadyAuthorized.has(user.telegramId)) continue; // nothing to do

  const userExact = normalize(user.name);
  const userStripped = stripRankWords(userExact);

  let candidates = registryIndex.filter((r) => r.exact === userExact && userExact);
  let matchKind = 'exact';
  if (!candidates.length) {
    candidates = registryIndex.filter((r) => r.stripped === userStripped && userStripped);
    matchKind = 'fuzzy (rank words stripped)';
  }

  if (candidates.length === 1) {
    matched.push({ user, record: candidates[0].record, matchKind });
  } else if (candidates.length > 1) {
    ambiguous.push({ user, candidates: candidates.map((c) => c.record) });
  } else {
    unmatchedTelegramUsers.push(user);
  }
}

const matchedRegistryIds = new Set(matched.map((m) => m.record.id));
const unmatchedRegistryRecords = registry.filter((r) => !matchedRegistryIds.has(r.id));

console.log(`--- Matched (${matched.length}) ---`);
for (const { user, record, matchKind } of matched) {
  console.log(`  ${user.telegramId} "${user.name}" -> "${record.name}" (${record.designation || 'no designation'}, ${record.unit || 'no unit'}) [${matchKind}]`);
}

console.log(`\n--- Ambiguous — needs manual review (${ambiguous.length}) ---`);
for (const { user, candidates } of ambiguous) {
  console.log(`  ${user.telegramId} "${user.name}" could be: ${candidates.map((c) => `"${c.name}" (${c.designation || 'n/a'})`).join(' OR ')}`);
}

console.log(`\n--- Telegram senders with NO registry match (${unmatchedTelegramUsers.length}) ---`);
for (const user of unmatchedTelegramUsers) {
  console.log(`  ${user.telegramId} "${user.name || '(no name captured)'}"`);
}

console.log(`\n--- Registry records with no observed Telegram activity yet (${unmatchedRegistryRecords.length}) ---`);
for (const record of unmatchedRegistryRecords) {
  console.log(`  "${record.name}" (${record.designation || 'n/a'}, ${record.unit || 'n/a'})`);
}

if (!apply) {
  console.log(`\nDry run only — nothing was written. Re-run with --apply to add the ${matched.length} matched user(s) above to authorizedUsers.`);
} else {
  console.log(`\n--apply passed — writing ${matched.length} matched user(s) to authorizedUsers...`);
  for (const { user, record } of matched) {
    settingsStore.writeAuthorizedUser(user.telegramId, record.name);
    console.log(`  added ${user.telegramId} — ${record.name}`);
  }
  console.log('\nDone. Restart the Telegram bridge for this to take effect (pm2 restart sms-bridge).');
}
