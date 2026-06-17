# Telegram Bridge

Full-automation channel for request intake and reply posting, replacing manual WhatsApp
copy/paste. Telegram's Bot API officially supports reading group messages, replying in-thread,
and tagging users — with **no companion phone and no ban risk**, unlike WhatsApp Web automation
(which this project explicitly rejected).

The bridge runs as a **separate process** from the backend (`telegram-bridge/start.js`). A
Telegram outage or ban never takes down the SMS engine; the two communicate only over the
backend's existing HTTP API.

---

## Architecture

```text
Telegram group
  │  (1) member posts "LRL 01712345678"
  ▼
Telegram Bridge  ── long-poll getUpdates ──► intake
  │  authorize sender (deny-by-default) → POST /api/requests {channel:'telegram', chatId, sourceMessageId, ...}
  ▼
Backend (unchanged core)  → route → gateway phone → operator SMS → reply match → draft
  │
  │  reviewer approves on dashboard → draft status APPROVED_FOR_POST  (request stays NEEDS_MANUAL_REVIEW)
  ▼
Telegram Bridge  ── poll GET /api/reply-drafts?status=APPROVED_FOR_POST ──► posting
     sendMessage(reply_to_message_id = sourceMessageId, text_mention entity = requester)
     → POST /api/reply-drafts/:id/posted  → request COMPLETED
```

The matching/safety core (trusted-sender filter, one-active-per-operator queue, reply window,
manual-review gate) is **unchanged** — the bridge only adds the two chat-facing ends.

## Why a two-step post (approve → bridge confirms)

For automated channels, dashboard **Approve** does *not* mark the request complete. It sets the
draft to `APPROVED_FOR_POST` and leaves the request in `NEEDS_MANUAL_REVIEW`. Only after the
bridge actually delivers the message to Telegram does it call `/posted`, which moves the request
to `REPLY_POSTED → COMPLETED`. This guarantees a reply that failed to send never looks
completed, and is retried on the next polling cycle. Manual channel (`channel: 'manual'`, the
default) is unchanged: Approve completes in one step because the reviewer pastes it themselves.

## Setup

1. **Create the bot:** message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. **Disable privacy mode:** BotFather → your bot → *Bot Settings → Group Privacy → Turn off.*
   Otherwise the bot only sees messages that mention it or are commands — it won't see plain
   `LRL …` requests. (Making the bot a group **admin** also grants full visibility.)
3. **Add the bot to the group**, and make it admin (recommended).
4. **Find the group chat id:** start the bridge once (`npm run start:telegram`); it logs the chat
   id of every group it receives a message from. Group ids are negative (e.g. `-1001234567890`).
5. **Configure:** copy `config/telegram.example.json` → `config/telegram.json` (gitignored) and set:
   - `botToken` — from BotFather
   - `groupChatId` — the target group id
   - `backendUrl` — default `http://localhost:3000`
   - `authorizedUsers` — map each member's **numeric Telegram user id** to a name (deny-by-default;
     anyone not listed is rejected). A user's id appears in the bridge log when they post.

### Working from another PC

If you pull this repo on a second machine, the bridge code comes with Git, but
`config/telegram.json` does not. Restore that file first, or recreate it from
`config/telegram.example.json` with the real bot token, target group chat id, backend URL, and
authorized users.

## Run

```bash
npm start            # backend (separate terminal)
npm run start:telegram   # bridge
```

The bridge prints the connected bot username, the backend URL, and the target group on startup.

## Files

| File | Role |
|------|------|
| `telegram-bridge/start.js` | Runner: intake long-poll loop + posting poll loop |
| `telegram-bridge/bridge.js` | Core logic (`planIntake`, `handleIntake`, `postApprovedReplies`, `buildMention`) — unit-tested |
| `telegram-bridge/telegramClient.js` | Telegram Bot API wrapper (getUpdates, sendMessage, threaded reply + mention) |
| `telegram-bridge/backendClient.js` | Backend HTTP client (submit, list approved, mark posted) |
| `config/telegram.example.json` | Config template |

Tests: `test/telegramBridge.test.js` (`node --test`).

## Backend API used by the bridge

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/requests` | Submit intake with `channel:'telegram'`, `chatId`, `sourceMessageId` |
| GET | `/api/reply-drafts?status=APPROVED_FOR_POST` | Poll reviewer-approved drafts to post |
| POST | `/api/reply-drafts/:replyId/posted` | Confirm delivery (`{ postedMessageId }`) → completes request |

## Notes & limits

- **Mentions:** uses a `text_mention` entity over the leading `@Name` line, so the tag is real
  and tappable even for members without a public @username. Requires the bot to have seen the
  user in the group (it has, since they posted the request).
- **Zero dependencies:** uses Node 18+ global `fetch` + long polling — no public URL, no webhook,
  no inbound firewall port on the bridge host.
- **Manual-review gate stays on by default.** "Full automation" here means no retyping, not
  "no human checks." An optional auto-approve-on-HIGH-confidence path can be added later.
- **One bot, one group** per config. Multiple groups would need multiple configs/processes.
