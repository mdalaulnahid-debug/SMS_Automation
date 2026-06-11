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

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { TelegramClient } = require('./telegramClient');
const { BackendClient } = require('./backendClient');
const { handleIntake, postApprovedReplies } = require('./bridge');

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

async function intakeLoop(config, telegram, backend) {
  let offset;
  log('intake loop started (long polling getUpdates)');
  // Drain any backlog first so a restart does not replay old messages as new requests.
  // We advance the offset past everything already queued without acting on it.
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
      if (!update.message) continue;
      // Helpful during setup: surface the chat id of any group the bot is added to.
      if (String(update.message.chat?.id) !== String(config.groupChatId)) {
        log(`message from non-target chat ${update.message.chat?.id} (${update.message.chat?.title || 'n/a'}) — ignored`);
        continue;
      }
      try {
        await handleIntake(update.message, { config, backend, telegram, log });
      } catch (error) {
        log(`handleIntake error: ${error.message}`);
      }
    }
  }
}

async function postingLoop(config, telegram, backend) {
  const interval = config.pollPostIntervalMs || 3000;
  log(`posting loop started (poll every ${interval}ms)`);
  for (;;) {
    try {
      await postApprovedReplies({ backend, telegram, log });
    } catch (error) {
      log(`postApprovedReplies error: ${error.message}`);
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
