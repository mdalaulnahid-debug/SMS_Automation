'use strict';

const http = require('node:http');
const { createApp } = require('./app');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const timeoutSweepMs = Number(process.env.TIMEOUT_SWEEP_MS || 60_000);
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

http.createServer(app.handle).listen(port, host, () => {
  console.log(`SMS/WhatsApp automation server listening on http://${host}:${port}`);
  console.log(`Open dashboard at http://localhost:${port}`);

  // Resume any requests that were queued (not yet dispatched) before a restart.
  app
    .recover()
    .then((results) => {
      if (results.length) console.log(`Recovery dispatched ${results.length} queued request(s)`);
    })
    .catch((error) => console.error(`Recovery failed: ${error.message}`));

  setInterval(() => {
    app.service
      .timeoutWaitingRequests()
      .then((timedOut) => {
        if (timedOut.length) {
          console.log(`Timeout sweep marked ${timedOut.length} request(s) as TIMEOUT`);
        }
      })
      .catch((error) => {
        console.error(`Timeout sweep failed: ${error.message}`);
      });
  }, timeoutSweepMs).unref();
});
