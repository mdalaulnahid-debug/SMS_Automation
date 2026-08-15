'use strict';

const http = require('node:http');
const { createApp } = require('./app');
const { createMaintenanceCoordinator } = require('./maintenance');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const timeoutSweepMs = Number(process.env.TIMEOUT_SWEEP_MS || 60_000);
const useTunnel = process.argv.includes('--tunnel') || process.env.TUNNEL === '1';

let app;
try {
  app = createApp();
} catch (error) {
  console.error(error.message);
  if (/gateways\.json/i.test(error.message)) {
    console.error('Fix config/gateways.json, or delete it and restart to recreate from the example.');
  }
  process.exit(1);
}

const maintenance = createMaintenanceCoordinator({
  service: app.service,
  store: app.store,
  timeoutSweepMs
});

http.createServer(app.handle).listen(port, host, () => {
  console.log(`SMS/Telegram automation server listening on http://${host}:${port}`);
  console.log(`Open dashboard at http://localhost:${port}`);

  if (useTunnel) {
    startTunnel(port);
  }

  // Resume any requests that were queued (not yet dispatched) before a restart.
  app
    .recover()
    .then((results) => {
      if (results.length) console.log(`Recovery dispatched ${results.length} queued request(s)`);
    })
    .catch((error) => console.error(`Recovery failed: ${error.message}`));
  maintenance.start();
});

// Optional internet tunnel via localtunnel (npm i -g localtunnel, then start with --tunnel).
// Prints a public HTTPS URL you can paste into the Android app's Backend URL field.
function startTunnel(localPort) {
  let lt;
  try {
    lt = require('localtunnel');
  } catch {
    console.warn('[tunnel] localtunnel not installed. Run: npm install -g localtunnel');
    console.warn('[tunnel] Or use ngrok: ngrok http ' + localPort);
    return;
  }
  (async () => {
    try {
      const tunnel = await lt({ port: localPort });
      console.log('\n========================================');
      console.log('  INTERNET URL (paste into Android app):');
      console.log(' ', tunnel.url);
      console.log('========================================\n');
      tunnel.on('close', () => console.warn('[tunnel] Tunnel closed. Restart with --tunnel to reconnect.'));
      tunnel.on('error', (err) => console.warn('[tunnel] Tunnel error:', err.message));
    } catch (err) {
      console.warn('[tunnel] Failed to open tunnel:', err.message);
      console.warn('[tunnel] Alternative: ngrok http ' + localPort);
    }
  })();
}
