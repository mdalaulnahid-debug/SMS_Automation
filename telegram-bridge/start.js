'use strict';

// Telegram bridge runner: long-polls Telegram for group messages (intake) and polls the
// backend for approved drafts (posting). Runs as a SEPARATE process from the backend so a
// Telegram outage or ban never takes down the SMS engine.
//
//   node telegram-bridge/start.js
//
// Requires config/telegram.json (copy from config/telegram.example.json, set botToken +
// groupChatId, list authorizedUsers by numeric Telegram user id). Bot must have group
// privacy OFF (BotFather) or be a group admin, or it won't see normal group messages.

const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { TelegramClient } = require('./telegramClient');
const { BackendClient } = require('./backendClient');
const { handleIntake, postApprovedReplies, postLiveEdits, notifyTimeouts } = require('./bridge');

function loadConfig() {
  const path = join(__dirname, '..', 'config', 'telegram.json');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.error(`Missing config/telegram.json — copy config/telegram.example.json and fill it in.`);
    process.exit(1);
  }
  const config = JSON.parse(raw);
  if (!config.botToken || config.botToken.includes('PASTE')) {
    console.error('config/telegram.json: set botToken from BotFather.');
    process.exit(1);
  }
  if (!config.groupChatId) {
    console.error('config/telegram.json: set groupChatId (the bridge logs incoming chat ids to help find it).');
    process.exit(1);
  }
  return config;
}

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

const OFFSET_FILE = join(__dirname, '..', 'data', 'telegram-offset.json');

function loadOffset() {
  try {
    if (existsSync(OFFSET_FILE)) {
      return JSON.parse(readFileSync(OFFSET_FILE, 'utf8')).offset || undefined;
    }
  } catch { /* start fresh if file is corrupt */ }
  return undefined;
}

function saveOffset(offset) {
  try {
    writeFileSync(OFFSET_FILE, JSON.stringify({ offset }), 'utf8');
  } catch (e) {
    log(`warn: could not save offset: ${e.message}`);
  }
}

async function intakeLoop(config, telegram, backend) {
  let offset = loadOffset();
  if (offset !== undefined) {
    log(`intake loop started — resuming from offset ${offset} (messages during downtime will be processed)`);
  } else {
    log('intake loop started — no saved offset, processing all pending messages');
  }

  // Owned for the lifetime of the loop so a wrong-chat config drift is reported to
  // admin/web audit once, not on every single message from that chat.
  const reportedMismatchChatIds = new Set();

  for (;;) {
    let updates;
    try {
      updates = await telegram.getUpdates({ offset, timeoutSec: 30 });
    } catch (error) {
      log(`getUpdates error: ${error.message} — retrying in 5s`);
      await sleep(5000);
      continue;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      saveOffset(offset);
      if (!update.message) continue;
      try {
        const result = await handleIntake(update.message, { config, backend, telegram, log, reportedMismatchChatIds });
        if (result.action === 'ignore' && result.reason === 'wrong chat') {
          log(`message from non-target chat ${result.chatId} (${result.chatTitle || 'n/a'}) — ignored`);
        }
      } catch (error) {
        log(`handleIntake error: ${error.message}`);
      }
    }
  }
}

async function postingLoop(config, telegram, backend) {
  const interval = config.pollPostIntervalMs || 3000;
  // Seed with already-terminal requests so a restart doesn't re-notify old timeouts.
  const notifiedTimeouts = new Set();
  try {
    const existing = await backend.listRecentRequests();
    for (const r of existing) {
      if (['TIMEOUT', 'FAILED'].includes(r.status)) notifiedTimeouts.add(r.requestId);
    }
    log(`posting loop: seeded ${notifiedTimeouts.size} already-notified timeout(s)`);
  } catch (e) {
    log(`posting loop: could not seed timeouts — ${e.message}`);
  }
  log(`posting loop started (poll every ${interval}ms)`);
  for (;;) {
    try {
      await postApprovedReplies({ backend, telegram, log });
    } catch (error) {
      log(`postApprovedReplies error: ${error.message}`);
    }
    try {
      await postLiveEdits({ backend, telegram, log });
    } catch (error) {
      log(`postLiveEdits error: ${error.message}`);
    }
    try {
      await notifyTimeouts({ backend, telegram, notifiedSet: notifiedTimeouts, log });
    } catch (error) {
      log(`notifyTimeouts error: ${error.message}`);
    }
    await sleep(interval);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const config = loadConfig();
  const telegram = new TelegramClient({ botToken: config.botToken });
  const backend = new BackendClient({
    backendUrl: config.backendUrl || 'http://localhost:3000',
    adminApiKey: config.adminApiKey || process.env.ADMIN_API_KEY || ''
  });

  const me = await telegram.call('getMe');
  log(`connected as @${me.username} (bot id ${me.id})`);
  log(`backend: ${backend.base} · target group: ${config.groupChatId}`);

  // Run both loops concurrently; if either throws fatally, exit non-zero so a supervisor restarts.
  await Promise.race([
    intakeLoop(config, telegram, backend),
    postingLoop(config, telegram, backend)
  ]);
}

main().catch((error) => {
  log(`FATAL: ${error.message}`);
  process.exit(1);
});
