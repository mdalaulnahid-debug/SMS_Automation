'use strict';

const http = require('node:http');
const { createApp } = require('./app');

const port = Number(process.env.PORT || 3000);
const app = createApp();

http.createServer(app.handle).listen(port, () => {
  console.log(`SMS/WhatsApp automation server listening on http://localhost:${port}`);
});
