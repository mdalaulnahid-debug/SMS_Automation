# Multi-number batching — official rules and implementation plan

**Status:** planned, not implemented. Source: official "পুশপুল সার্ভিস" (push-pull
service) rule sheet provided by the requester (officer-facing slides), 2026-06-18.
This doc is the rule-data capture and the agreed plan — no parser/domain code has
changed yet.

## Why this matters

Today [`src/parser.js`](../src/parser.js) only accepts **one** value per request
(`LCL 01710000000`). The official protocol that operators already work under
supports **up to 5 numbers per SMS**. Every multi-number lookup today costs N
separate Telegram requests → N separate operator SMS, instead of the 1 SMS the
official system is designed for. Closing this gap is a real SMS-cost reduction,
not just a parity nice-to-have.

## The official rules (as given)

1. Max **5 numbers or IMEIs** per message. More than 5 → operator returns nothing.
2. No `+`/`-` anywhere in or around a number.
3. No space *inside* a single number.
4. No more than **one** space *between* numbers in a batch.
   (Already satisfied by our parser today — `cleaned.replace(/\s+/g, ' ')`
   collapses any run of spaces. No change needed for this rule.)
5. Can't request multiple **info types** in one message (no mixing `LRL` +
   `NID-MS`, etc.). Already structurally impossible for us — the parser only
   ever reads one type token per message.
6. Can't request multiple **operators** in one message — except Robi & Airtel,
   which combine. Already free for us: `ROBI.msisdnPrefixes` in
   [`domain.js`](../src/domain.js) already includes both `016` (Airtel) and
   `018` (Robi) as one bucket.
7. Format must always be **English capital letters** (`LRL` not `Lrl`,
   `MS-NID` not `Ms-nid`).

## Canonical format table (matches our `REQUEST_TYPES` exactly)

| Requested info | Format | Single number | Multiple numbers |
|---|---|---|---|
| IMEI search | `IMEI-MS` | `IMEI-MS 865239458712678` | `IMEI-MS 865239458712678 865239458712679` |
| Last Call Location | `LCL` | `LCL 01710000000` | `LCL 01710000000 01720000001` |
| Last Radio Location | `LRL` | `LRL 01710000000` | `LRL 01710000000 01720000001` |
| Mobile → NID | `MS-NID` | `MS-NID 01810000000` | `MS-NID 01810000000 01820000001` |
| NID → Mobile | `NID-MS` | `NID-MS 4246780000` | `NID-MS 4246780000 524678000` |

## Recurring real-world mistakes (from the wrong/correct examples)

- Type glued to the number, often with a stray hyphen: `LRL01308-218563`,
  `LCL-01981-332862`.
- Hyphenated type typed with a space instead: `MS NID 0162...` (should be
  `MS-NID`), `IMEI ms ...` (should be `IMEI-MS`).
- Type written after the number, randomly cased: `01718663266` / `Lrl/Lcl`.
- Several single-number messages sent separately instead of one batched
  message: five separate `MS NID <num>` lines instead of one
  `MS-NID <num1> <num2> <num3> <num4>`.
- Prose mixing two info types in one message: `Nid with LRL 01917574316 NID
  01925098586` → should be two separate messages.

## Decisions locked in (2026-06-18)

- **Auto-correct vs. reject:** auto-correct trivial *type-token* formatting
  only (glued type+number → insert space; spaced hyphenated type like
  `MS NID` → join to `MS-NID`; stray `+`/`-` adjacent to the type code →
  stripped). Never auto-correct *inside* the actual MSISDN/NID/IMEI digits —
  too risky to guess at intent. Everything else (batch > 5, mixed types,
  mixed operators, malformed numbers) gets a **specific** rejection message,
  not the old generic one.
- **Batch cap scope:** the 5-number cap applies to **all five** request
  types, including `NID-MS` and `IMEI-MS` (which fan out to all 3 operator
  gateways) — matches the rule sheet's table, which shows multi-number
  examples for those two types with no different limit called out.

## Implementation plan

1. **Domain model** ([`domain.js`](../src/domain.js)): each request type
   accepts an array of 1–5 values instead of a single string; each entry
   validated with the type's existing regex (MSISDN/NID/IMEI).
2. **Parser** ([`parser.js`](../src/parser.js)):
   - Auto-correct layer on the type token only (see above), applied before
     validation.
   - Split the payload into tokens; reject with a specific message if
     count > 5.
   - Reject any token containing `+`/`-`.
   - For MSISDN-based types (`LRL`/`LCL`/`MS-NID`), resolve each number's
     operator and reject if the batch isn't all the same operator bucket.
   - Detect and name mixed-type prose with a specific "split into two
     messages" correction instead of the generic unsupported-type error.
3. **Dispatch** ([`smsGateway.js`](../src/smsGateway.js)):
   `formatOperatorSms()` must emit one batched SMS body (`LCL 017...
   018...`) for the whole batch — this is the actual SMS-cost reduction.
4. **Reply matching** ([`service.js`](../src/service.js)): audit how a
   reply gets matched/drafted today, since a batched request will get back
   one reply covering multiple numbers. **Not yet verified — open risk to
   check before implementation.**
5. **Tests** ([`test/workflow.test.js`](../test/workflow.test.js)): batch
   happy-path per type (1–5 values), >5 rejected, mixed-operator batch
   rejected (LRL/LCL/MS-NID only), each auto-correct case, each strict-reject
   case.

## Next step

Start at step 1 (domain model) when implementation is greenlit. This doc
should be updated as decisions change or steps complete.
