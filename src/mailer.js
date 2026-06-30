'use strict';

// Sends transactional email (verification links, MFA codes) via Gmail SMTP using an app password.
// If GMAIL_USER / GMAIL_APP_PASSWORD aren't set (dev/test), falls back to logging the message to
// the console instead of throwing, so registration/login flows stay testable without real SMTP.

const nodemailer = require('nodemailer');

let cachedTransport = null;

function getTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user, pass }
    });
  }
  return cachedTransport;
}

async function sendMail({ to, subject, html, text }) {
  const transport = getTransport();
  const from = process.env.MAIL_FROM || process.env.GMAIL_USER || 'opsbarishal@gmail.com';
  if (!transport) {
    console.warn(`[mailer] SMTP not configured — logging email instead of sending.\nTo: ${to}\nSubject: ${subject}\n${text || html}`);
    return { sent: false, logged: true };
  }
  await transport.sendMail({ from: `LIC Barishal Ops <${from}>`, to, subject, html, text });
  return { sent: true };
}

function verificationEmail(baseUrl, token) {
  const link = `${baseUrl}/verify-email?token=${token}`;
  return {
    subject: 'Verify your LIC Barishal Ops account',
    text: `Verify your account: ${link}\n\nThis link expires in 24 hours.`,
    html: `<p>Click below to verify your LIC Barishal Ops account:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`
  };
}

function mfaCodeEmail(code) {
  return {
    subject: `Your login code: ${code}`,
    text: `Your LIC Barishal Ops login code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your LIC Barishal Ops login code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>This code expires in 10 minutes.</p>`
  };
}

module.exports = { sendMail, verificationEmail, mfaCodeEmail };
