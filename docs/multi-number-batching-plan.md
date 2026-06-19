# Multi-number batching — official rules and implementation status

**Status: implemented** (commit `8bd26a5` "Harden backend intake validation
and surface audit failures", extended by `c26b896` "multiple number bug
fixed"). This doc originally captured the plan before implementation; it now
also records what actually shipped, including one deliberate deviation from
the original plan (see "Decision that changed" below).

Source of the rules: official "পুশপুল সার্ভিস" (push-pull service) rule sheet
provided by the requester (officer-facing slides), 2026-06-18.

## Why this mattered

`src/parser.js` used to accept only **one** value per request
(`LCL 01710000000`). The official protocol that operators already work under
supports **up to 5 numbers per SMS**. Every multi-number lookup cost N
separate Telegram requests → N separate operator SMS instead of the 1 SMS the
official system is designed for — a real SMS-cost problem, not just a parity
gap.

## The official rules (as given)

1. Max **5 numbers or IMEIs** per message. More than 5 → operator returns nothing.
2. No `+`/`-` anywhere in or around a number.
3. No space *inside* a single number.
4. No more than **one** space *between* numbers in a batch.
5. Can't request multiple **info types** in one message (no mixing `LRL` +
   `NID-MS`, etc.).
6. Can't request multiple **operators** in one message — except Robi & Airtel,
   which combine.
7. Format must always be **English capital letters** (`LRL` not `Lrl`,
   `MS-NID` not `Ms-nid`).

## What actually shipped — `src/parser.js`

`parseRequestText()` now returns `identifiers` (array), `canonicalPayload`,
and `canonicalRequestText` on success, and a stable `errorCode` + `replyText`
on failure. The full error vocabulary (`ERROR_DEFINITIONS` in `parser.js`):

| `errorCode` | When |
|---|---|
| `EMPTY_MESSAGE` | blank input |
| `UNSUPPORTED_COMMAND` | first token isn't `IMEI-MS`/`LCL`/`LRL`/`MS-NID`/`NID-MS` |
| `MISSING_IDENTIFIERS` | command with no values after it |
| `TOO_MANY_IDENTIFIERS` | more than 5 identifiers (rule 1) |
| `MIXED_REQUEST_TYPES` | a different command keyword appears inside the payload (rule 5) |
| `REPEATED_COMMAND` | the *same* command keyword repeated inside the payload |
| `INVALID_IDENTIFIER_CHARS` | any identifier contains a non-digit (covers rules 2 and 3 — `+`, `-`, `/`, spaces-within-a-number all land here) |
| `INVALID_IDENTIFIER_FORMAT` | digits-only but wrong length/shape for the command's payload type |
| `OPERATOR_MISMATCH` | identifiers resolve to more than one operator in one `LRL`/`LCL`/`MS-NID` request (rule 6) |
| `OPERATOR_UNRESOLVED` | an MSISDN's prefix doesn't match any known operator |
| `DUPLICATE_ACTIVE_REQUEST` | an identical request is already in flight (separate feature added alongside this, see below) |

Rule 4 (single space between numbers) needed no new code — normalization
already collapsed repeated whitespace before this feature existed.
Robi/Airtel combine for free too — `ROBI.msisdnPrefixes` in `domain.js`
already covers both `016` (Airtel) and `018` (Robi) as one operator bucket,
so `OPERATOR_MISMATCH` never fires between them.

`domain.js`'s `targetOperatorsForRequest()` now takes an array of identifiers:
for `RELEVANT_OPERATOR` types it resolves every identifier's operator and
returns a single-operator result only if they all agree — otherwise empty
(which `parser.js` turns into `OPERATOR_MISMATCH` or `OPERATOR_UNRESOLVED`).

## Auto-correct — now implemented (2026-06-19)

The plan as agreed on 2026-06-18 called for auto-correcting trivial
*type-token* formatting mistakes. Initially shipped as strict-rejection-only,
the auto-correct layer was implemented on 2026-06-19 with expanded scope:

1. **Split commands**: `MS NID` → `MS-NID`, `NID MS` → `NID-MS`, `IMEI MS` → `IMEI-MS`
2. **Glued prefixes**: `LRL01308218563` → `LRL 01308218563`, `MSNID01625242040` → `MS-NID 01625242040`
3. **Command-value separators**: `LRL-01718000000`, `LRL:01718000000` → `LRL 01718000000`
4. **Bangladesh country code**: `+8801712345678` and `8801712345678` → `01712345678`
5. **Separator stripping in identifiers**: hyphens, colons, underscores, commas, dots removed from numbers
6. **Case-insensitive commands**: `lrl`, `Ms-Nid` etc. all accepted

The `correctionMessage` field on a successful parse indicates what was auto-corrected.
If the identifier is still malformed after auto-correction, it fails normally with
a specific error message (see below).

## Specific validation error messages (2026-06-19)

`INVALID_IDENTIFIER_FORMAT` now returns a diagnostic message instead of a generic one.
The system detects when identifiers look like the wrong type:

- NID given where phone number expected (and vice versa)
- IMEI given where NID expected (and vice versa)
- Phone number given where IMEI expected (and vice versa)
- Digit count too short or too long for the expected type

NID validation is now strict: exactly 10 (smart NID), 13, or 17 (old NID with birth year) digits.
IMEI validation is now strict: exactly 14 (without check digit) or 15 (with check digit) digits.

## Other things that shipped alongside this (not in the original plan)

- **Reply collection across a batch** (`c26b896`): `formatCombinedReply()` in
  `service.js` used to read only one inbox message
  (`dispatch.inboxId`) per operator. `collectDispatchReplyMessages()` now
  gathers every inbound SMS matched to that dispatch's gateway + request, so
  an operator replying once per number in a batch (rather than one combined
  reply) still gets fully captured in the review draft.
- **Duplicate-request blocking** (`a76d988`): `store.findRecentDuplicateRequest()`
  blocks a new request if an identical one (same type, same canonical
  payload, same target operators) is already active within a 30-minute
  window (`DEFAULT_DUPLICATE_REQUEST_WINDOW_MS`), returning
  `DUPLICATE_ACTIVE_REQUEST` instead of creating a second one.
- **Two-phase dispatch timeout** (`a76d988`): the reply-window clock (now 15
  minutes, `DEFAULT_REPLY_WINDOW_MS`) only starts once the gateway phone's
  send is *carrier-acked* (`sendResult.confirmedAt`). Before that, a shorter
  **send-confirmation grace period** (`DEFAULT_SEND_CONFIRMATION_GRACE_MS`,
  also 15 minutes) covers the claimed-but-not-yet-acked phase, so a stalled
  phone surfaces as a timeout instead of hanging the request forever — see
  `AutomationService.dispatchTimeoutState()`.
- **New diagnostics on `/api/dashboard`**: `delayedConfirmations`,
  `ambiguousReplies24h`, and `duplicateRiskGroups` counts/lists, surfaced in
  the web admin console's Overview and Audit tabs.

## Verification

99 tests pass across `test/persistence.test.js` (5), `test/security.test.js` (12),
`test/telegramBridge.test.js` (9), and `test/workflow.test.js` (73) — run individually
with `node --test <file>` (running multiple files at once is known to hang
in this environment).

## Open follow-ups

- `docs/system-design-v2.md` §5 lists `GET /api/ops/validation-failures` as a
  *future* endpoint — validation failures are currently only visible via the
  general audit log (`REQUEST_VALIDATION_FAILED` events), filterable in the
  web admin Audit tab.
