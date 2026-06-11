'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

function loadGatewayConfig() {
  const configPath = process.env.SMS_GATEWAYS_CONFIG || join(__dirname, '..', 'config', 'gateways.json');
  if (!existsSync(configPath)) return {};

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid config/gateways.json: ${error.message}`);
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([operatorKey, config]) => [
      operatorKey.toUpperCase(),
      {
        gatewayUrl: trimTrailingSlash(config.gatewayUrl),
        sendPath: config.sendPath || '/send-sms',
        apiKey: config.apiKey || '',
        // Shared secret the phone must present on inbound webhook / registration (machine identity).
        secret: config.secret || '',
        trustedSenders: config.trustedSenders || []
      }
    ])
  );
}

// Security config: admin API key (protects dashboard/admin API) plus strict-mode toggles.
// Empty adminApiKey = auth disabled (dev/test); set it in production. Env vars win over the file.
function loadAuthConfig() {
  const configPath = process.env.SMS_AUTH_CONFIG || join(__dirname, '..', 'config', 'auth.json');
  let file = {};
  if (existsSync(configPath)) {
    try {
      file = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (error) {
      throw new Error(`Invalid config/auth.json: ${error.message}`);
    }
  }
  const truthy = (v) => v === true || v === 'true' || v === '1';
  return {
    adminApiKey: process.env.ADMIN_API_KEY || file.adminApiKey || '',
    requireGatewayAuth:
      process.env.REQUIRE_GATEWAY_AUTH !== undefined
        ? truthy(process.env.REQUIRE_GATEWAY_AUTH)
        : Boolean(file.requireGatewayAuth),
    denyUnknownRequesters:
      process.env.DENY_UNKNOWN_REQUESTERS !== undefined
        ? truthy(process.env.DENY_UNKNOWN_REQUESTERS)
        : Boolean(file.denyUnknownRequesters)
  };
}

// Optional Telegram config — only loaded to read autoApprove setting into the service.
// The full Telegram config is used by the bridge process, not the backend.
function loadTelegramConfig() {
  const configPath = process.env.SMS_TELEGRAM_CONFIG || join(__dirname, '..', 'config', 'telegram.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

module.exports = { loadGatewayConfig, loadAuthConfig, loadTelegramConfig };
