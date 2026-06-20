'use strict';

// Authenticated, file-backed read/write for the small set of operational settings that used
// to require SSH + hand-editing JSON on the VPS (Telegram group chat id, operator hotline
// numbers). Every write here is additive to the existing config-file format — nothing here
// changes how config/*.json is loaded by default, so a backend that never calls these
// functions behaves exactly as before.

const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

// Read fresh on every call (not frozen at require time) so tests can override via env var
// regardless of module require order, and so a future config-reload feature isn't blocked.
function telegramConfigPath() {
  return process.env.SMS_TELEGRAM_CONFIG || join(__dirname, '..', 'config', 'telegram.json');
}

function gatewaysConfigPath() {
  return process.env.SMS_GATEWAYS_CONFIG || join(__dirname, '..', 'config', 'gateways.json');
}

function readJsonFile(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid ${path}: ${error.message}`);
  }
}

function writeJsonFile(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

function readTelegramGroupChatId() {
  const file = readJsonFile(telegramConfigPath());
  return file.groupChatId !== undefined ? String(file.groupChatId) : '';
}

// Merges into the existing telegram.json rather than replacing it, so botToken/adminApiKey/etc.
// are preserved. Caller is responsible for telling an operator the bridge needs a restart to
// pick this up — it's a separate long-lived process that reads its config once at startup.
function writeTelegramGroupChatId(groupChatId) {
  const trimmed = String(groupChatId ?? '').trim();
  if (!trimmed) throw new Error('groupChatId is required');
  if (!/^-?\d+$/.test(trimmed)) throw new Error('groupChatId must be numeric (e.g. -1004316326579)');

  const path = telegramConfigPath();
  const file = readJsonFile(path);
  file.groupChatId = trimmed;
  writeJsonFile(path, file);
  return trimmed;
}

function readOperatorContacts() {
  const file = readJsonFile(gatewaysConfigPath());
  return Object.fromEntries(
    Object.entries(file).map(([operatorKey, config]) => [
      operatorKey.toUpperCase(),
      { shortcode: config.shortcode || '' }
    ])
  );
}

// Merges a single operator's shortcode override into gateways.json, preserving every other
// field (gatewayUrl/secret/trustedSenders/etc.) and every other operator's entry untouched.
function writeOperatorShortcode(operatorKey, shortcode) {
  const trimmed = String(shortcode ?? '').trim();
  if (!trimmed) throw new Error('shortcode is required');
  if (!/^[+\d][\d]{6,14}$/.test(trimmed)) {
    throw new Error('shortcode must be a phone number or short code (digits, optional leading +)');
  }

  const path = gatewaysConfigPath();
  const file = readJsonFile(path);
  const key = String(operatorKey || '').toUpperCase();
  file[key] = { ...(file[key] || {}), shortcode: trimmed };
  writeJsonFile(path, file);
  return trimmed;
}

function readAuthorizedUsers() {
  const file = readJsonFile(telegramConfigPath());
  const authorizedUsers = file.authorizedUsers || {};
  return Object.entries(authorizedUsers).map(([telegramUserId, entry]) => ({
    telegramUserId,
    name: entry?.name || ''
  }));
}

// Adds or updates one entry in telegram.json's authorizedUsers map, preserving every other
// entry and every other top-level field. Same restart caveat as writeTelegramGroupChatId —
// the bridge reads this once at startup.
function writeAuthorizedUser(telegramUserId, name) {
  const trimmedId = String(telegramUserId ?? '').trim();
  const trimmedName = String(name ?? '').trim();
  if (!trimmedId) throw new Error('telegramUserId is required');
  if (!/^\d+$/.test(trimmedId)) throw new Error('telegramUserId must be numeric (the user\'s Telegram id, not @username)');
  if (!trimmedName) throw new Error('name is required');

  const path = telegramConfigPath();
  const file = readJsonFile(path);
  file.authorizedUsers = { ...(file.authorizedUsers || {}), [trimmedId]: { name: trimmedName } };
  writeJsonFile(path, file);
  return { telegramUserId: trimmedId, name: trimmedName };
}

function removeAuthorizedUser(telegramUserId) {
  const trimmedId = String(telegramUserId ?? '').trim();
  if (!trimmedId) throw new Error('telegramUserId is required');

  const path = telegramConfigPath();
  const file = readJsonFile(path);
  const authorizedUsers = { ...(file.authorizedUsers || {}) };
  if (!(trimmedId in authorizedUsers)) throw new Error(`No authorized user with id ${trimmedId}`);
  delete authorizedUsers[trimmedId];
  file.authorizedUsers = authorizedUsers;
  writeJsonFile(path, file);
  return trimmedId;
}

module.exports = {
  telegramConfigPath,
  gatewaysConfigPath,
  readTelegramGroupChatId,
  writeTelegramGroupChatId,
  readOperatorContacts,
  writeOperatorShortcode,
  readAuthorizedUsers,
  writeAuthorizedUser,
  removeAuthorizedUser
};
