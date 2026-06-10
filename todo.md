# Todo

## High Priority

- Replace in-memory storage with SQLite or PostgreSQL.
- Build or connect the Android SMS gateway app on the three phones.
- Add gateway configuration UI for phone URLs, shortcodes, and trusted senders.
- Add structured reply extractors for each request type and operator.
- Add authentication and user roles.
- Add manual review actions for approve, reject, retry, and timeout.

## Training Data

- Review and fill blank reply rows.
- Confirm each Excel row is in the correct request-type/operator folder.
- Add more real examples for `MS-NID` and `NID-MS`.
- Convert imported examples into field extraction tests.
- Run `npm run import:training` after every training-data update.

## Operations

- Add phone health checks: online/offline, battery, network, last seen.
- Add retry logic for failed phone gateway sends.
- Add export/reporting for audit logs and request history.
- Add alerting for stuck queues and timeout spikes.

## WhatsApp

- Keep manual WhatsApp posting during MVP.
- Evaluate official WhatsApp integration before automatic group posting.
- Preserve requester tagging and group identity in every final reply.
