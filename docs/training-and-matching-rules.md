# Training And Matching Rules

This file is the quick-reference rule sheet for request routing, intake normalization, reply-shape recognition, and future self-training behavior.

Use this file as the first checkpoint before changing:

- `src/parser.js`
- `src/replyAnalyzer.js`
- `src/service.js`
- training data import or self-training logic

## Training Data Source

Primary manual training source:

- `Training Data/Automation/LCL.xlsx`
- `Training Data/Automation/LRL.xlsx`
- `Training Data/Automation/MS-NID.xlsx`
- `Training Data/Automation/NID-MS.xlsx`
- `Training Data/Automation/IMEI-MS.xlsx`

Ignore for now:

- `Training Data/Automation/Operato_wise_data.zip`
- `Training Data/Automation/README.md`

Notes:

- The top-level five Excel files are the current practical source of truth.
- Some older operator-wise subfolder files are noisy or mislabeled, so do not trust them over the five top-level workbooks without manual review.
- When the system captures new real request/reply pairs, those should feed a separate self-training store rather than silently polluting the manual baseline.

## Request Routing Rules

- `NID-MS` must fan out to all three operators: GP, Robi, Banglalink.
- `IMEI-MS` must fan out to all three operators: GP, Robi, Banglalink.
- `LRL`, `LCL`, and `MS-NID` are mobile-number-driven requests and must go only to the relevant operator for that MSISDN.

## Intake Normalization Rules

Initially intake was treated as a fully hardbound rule with strict operator-format typing required from the user.

Current rule:

- operator-facing SMS is still hardbound
- intake is now lightly normalized before validation and routing

Allowed safe normalization:

- split compound commands such as `MS NID`, `NID MS`, `IMEI MS`
- glued command prefixes such as `LRL017...` or `MSNID016...`
- lowercase or mixed-case command tokens
- `+880` / `880` country-code MSISDN forms
- harmless separators inside numeric identifiers

Not allowed:

- mixed request families in one message
- more than 5 identifiers
- unsafe or ambiguous payloads that still fail shape validation after normalization
- any hidden metadata in the operator-facing SMS body

## Silent Reference Rule

- Every request received from Telegram should get an internal silent reference.
- That silent reference is for backend correlation only.
- The silent reference must never be added to the operator-facing outbound SMS body.
- Outbound operator SMS must stay compliant with the hardbound telecom command format.
- The silent reference and normalization logic are backend-only conveniences; operators must still receive the canonical telecom command only.

## Reply Shape Rules

### LRL

`LRL` is a last radio location request.

Strong indicators:

- geographic position or `Lat` / `Long` / `Latitude` / `Longitude`
- radio-location wording such as `RADIO LOCATION`
- `LastActiveDateTime` or `LRA`
- location-only result with no meaningful B-party call/SMS record

Important nuance:

- Some operator formats, especially Banglalink, may still include `IMEI`, `UsageType`, or other network metadata inside an `LRL` reply.
- Do not classify a reply as `LCL` only because it contains `IMEI`.
- For `LRL`, the strongest signal is that the body is centered on radio/location status and geographic position.

### LCL

`LCL` is also a last location request, but it is tied to a call/SMS event context.

Strong indicators:

- B-party number
- event or usage markers such as:
  - `MOC`
  - `MTC`
  - `SMSMO`
  - `SMSMT`
  - `CALL MO`
  - `CALL MT`
- event timestamp for the call/SMS record
- `IMEI` commonly appears

Important distinction from `LRL`:

- `LCL` usually includes B-party or call/SMS usage context.
- `LRL` usually emphasizes radio status and/or lat-long style positioning.

### MS-NID

`MS-NID` starts with a mobile number and asks for identity output.

Strong indicators:

- the reply begins with the echoed `MSISDN`
- then returns NID-like identity data
- often includes date of birth
- should not look like a location-response body

Typical patterns from training data:

- `MSISDN: 880...`
- NID value plus DoB
- `Sorry No records found` style no-data response

### NID-MS

`NID-MS` starts with an NID and asks for one or more MSISDN results.

Strong indicators:

- the reply echoes the NID first
- then returns one or more MSISDN values
- no-data variants are normal

Important caution:

- Do not confuse a reply containing `MSISDN` with `MS-NID`.
- For `NID-MS`, the key is that the request seed is NID and the reply should anchor on that echoed NID.

### IMEI-MS

`IMEI-MS` starts with a 15-digit IMEI from the user side.

Important nuance:

- The last IMEI digit is a check digit only.
- Operators may return records using a 14-digit form inside result lines.
- This is expected and should not be treated as a mismatch by itself.
- Operators usually echo the requested IMEI first, and that first echoed IMEI is the most important anchor.

Matching rule:

- Check the first IMEI echoed in the reply before judging the rest of the body.
- Later IMEI values inside result lines may differ in 14-digit vs 15-digit presentation.

Typical patterns from training data:

- `IMEI: <requested imei>`
- then `MSISDN` + date rows
- or `No data found`

## Matching Safety Rules

- Do not auto-match a reply to a request only because both belong to the same gateway/operator.
- Do not rely on generic tokens like `cell`, `location`, `name`, `mobile`, or `MSISDN` alone.
- `LRL` and `LCL` need stricter separation because both can describe a last-known place.
- For `LCL`, B-party and usage indicators are strong differentiators.
- For `LRL`, geographic/radio-location fields are stronger differentiators.
- For `IMEI-MS`, the first echoed IMEI is a higher-confidence discriminator than generic `MSISDN` tokens.
- If a reply body looks like a different request family than the pending request, prefer manual review over auto-attach.

## Self-Training Rules

The system should maintain a separate self-training store for real captured request/reply pairs.

Requirements:

- keep manual baseline training data separate from self-learned data
- store only real request/reply examples that were actually processed by the system
- retain only the latest 100 self-training entries
- when adding a new entry beyond 100, remove the oldest one
- do not overwrite the top-level five manual training Excel files automatically
- self-training data should be reviewable and reversible

Recommended contents for each self-training entry:

- timestamp
- requester/channel metadata if safe
- request type
- canonical request text
- operator
- raw operator reply
- matched outcome
- whether the match was automatic or manually corrected

## Current Practical Warning

- Existing historical training samples are useful for reply-shape understanding, but not every old sample is clean.
- Treat the five top-level `Training Data/Automation/*.xlsx` files as the active manual baseline.
- Treat self-training data as a separate rolling memory, capped at 100 entries.
