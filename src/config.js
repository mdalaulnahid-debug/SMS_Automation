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
        trustedSenders: config.trustedSenders || []
      }
    ])
  );
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

module.exports = { loadGatewayConfig };
