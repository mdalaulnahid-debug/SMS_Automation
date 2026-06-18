# System Design v2

Enterprise-grade target design for SMS Automation.

This document defines the product as a multi-client platform with a single
backend authority and clear security, operational, and UX boundaries.

## 1. Product Surfaces

The system has four distinct surfaces:

1. **Web Operations UI**
   - browser-accessible operational interface
   - quick monitoring, review, gateway status, incident awareness
2. **Web Admin Console**
   - full desktop command center
   - approvals, unmatched cases, audit, provisioning, user management
3. **Android Gateway App**
   - installed on operator phones
   - sends SMS, receives SMS, reports health, polls jobs, local diagnostics
4. **Android Admin App**
   - separate Android application for supervisors/admins
   - mobile approvals, gateway fleet monitoring, audit lookup, provisioning, OTA control

Important rule:

- **Android admin must be a separate app from Android gateway/user app**
- the gateway app is an operational device runtime, not a supervisor console

## 2. Product Principle

All business rules must live in the backend platform.

The intake boundary is now part of that rule:

- request parsing and validation happen in the backend before queueing
- clients may assist with formatting, but they are not trusted as the workflow authority
- Android gateway devices must only ever receive backend-approved canonical dispatch text

Clients may differ in:

- layout
- interaction model
- density
- navigation
- platform conventions

Clients must not differ in:

- request lifecycle rules
- dispatch lifecycle rules
- auth/role enforcement
- matching rules
- audit semantics
- approval semantics
- validation semantics

## 3a. Intake Validation Boundary

Every human-originated request must pass through a deterministic backend validation layer before it can become a request record or an operator dispatch.

Current validation contract:

- supported commands: `IMEI-MS`, `LCL`, `LRL`, `MS-NID`, `NID-MS`
- harmless whitespace variance is normalized
- canonical dispatch text is generated as `COMMAND identifier1 identifier2 ...`
- invalid requests do not enter the normal request queue
- invalid requests do not create operator outbox jobs
- invalid requests are written to audit as structured validation-failure events

Current enterprise rule:

- for `LCL`, `LRL`, and `MS-NID`, all identifiers in one message must resolve to the same operator group
- for `NID-MS` and `IMEI-MS`, fan-out to all operators remains valid

## 3. Component Diagram

```text
                        +----------------------+
                        |   Web Operations UI  |
                        |   browser surface    |
                        +----------+-----------+
                                   |
                                   |
                        +----------v-----------+
                        |   Web Admin Console  |
                        |   browser surface    |
                        +----------+-----------+
                                   |
                                   |
                        +----------v-----------+
                        |   API Gateway /      |
                        |   Backend Platform   |
                        +----------+-----------+
                                   |
          +------------------------+------------------------+
          |                        |                        |
          |                        |                        |
 +--------v--------+     +---------v---------+    +--------v--------+
 | Workflow Layer  |     | Domain Services   |    | Background Jobs |
 | orchestration   |     | rules & state     |    | sweep/recovery  |
 +--------+--------+     +---------+---------+    +--------+--------+
          |                        |                        |
          +------------------------+------------------------+
                                   |
                        +----------v-----------+
                        | Persistence Layer    |
                        | SQLite now, DB-ready |
                        +----------+-----------+
                                   |
             +---------------------+----------------------+
             |                                            |
 +-----------v------------+                   +-----------v------------+
 | Android Gateway App(s) |                   | Telegram Bridge        |
 | GP / Robi / BL phones  |                   | intake + post worker   |
 +------------------------+                   +------------------------+

             +---------------------+
             | Android Admin App   |
             | supervisor surface  |
             +---------------------+
```

## 4. Role Model

The current shared-key model should evolve into explicit platform roles.

### Human roles

- **Reviewer**
  - review reply drafts
  - approve/reject/retry
  - inspect unmatched cases
- **Admin**
  - all reviewer rights
  - manage users
  - manage gateways
  - export audits
  - provision devices
  - manage release operations
- **Super Admin**
  - emergency override actions
  - revoke devices
  - rotate secrets
  - change security policy

### Machine roles

- **Gateway Device**
  - poll jobs
  - ACK dispatch result
  - report inbound SMS
  - send watchdog/health signals
- **Bridge Worker**
  - submit Telegram-originated requests
  - poll approved drafts
  - confirm post/edit events

## 5. API Boundary Plan

The backend should expose role-specific API areas, even if they share the same
server process.

### Public health and bootstrap

- `GET /api/health`
- `GET /api/app/version`
- `GET /api/app/apk`

### Gateway device API

- `POST /api/gateways/register`
- `GET /api/gateway/jobs`
- `POST /api/gateway/jobs/:id/ack`
- `POST /api/sms/inbound`
- `POST /api/sms/delivery`
- `POST /api/gateway/watchdog`

### Operations API

- `GET /api/ops/overview`
- `GET /api/ops/requests`
- `GET /api/ops/gateways`
- `GET /api/ops/replies`
- `GET /api/ops/unmatched`
- `GET /api/ops/validation-failures` (future view-model endpoint if audit traffic becomes too dense)

### Admin API

- `POST /api/admin/replies/:id/approve`
- `POST /api/admin/requests/:id/reject`
- `POST /api/admin/requests/:id/retry`
- `POST /api/admin/manual-match`
- `GET /api/admin/audit`
- `GET /api/admin/audit/export`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `POST /api/admin/users/:id/status`
- `POST /api/admin/app/publish-apk`
- `POST /api/admin/generate-qr`

### Integration API

- Telegram bridge endpoints
- future notification/BI/reporting adapters

Design rule:

- UI clients should prefer purpose-built view endpoints over raw snapshots
- admin actions should be command-style endpoints with clear audit entries
- validation failures should remain observable to admins even when they are not persisted as normal request records

## 6. Client Split

## Web Operations UI

Audience:

- operators
- quick reviewers
- on-call supervisors

Characteristics:

- responsive
- fast to scan
- lower-density than admin console
- can surface urgent approval/review tasks

## Web Admin Console

Audience:

- supervisors
- compliance/admin staff
- desk-based reviewers

Characteristics:

- desktop-first
- dense workflows
- queue management
- unmatched case handling
- audit and export

## Android Gateway App

Audience:

- field/operator device owner
- gateway phone maintainer

Characteristics:

- locked-down
- minimal workflow set
- service control
- connection health
- SIM/operator identity
- local log visibility

Must not contain:

- full audit console
- user management
- heavy admin tooling
- broad fleet management

## Android Admin App

Audience:

- supervisor
- mobile admin
- escalation handler

Characteristics:

- separate app identity
- mobile command center
- alerts, review queues, approvals, unmatched cases, fleet health
- safe subset of desktop admin power

## 7. Deployment Model

### Current acceptable deployment

- backend and Telegram bridge on VPS
- SQLite persistence
- gateway phones connecting remotely or by LAN, depending on setup

### Target enterprise deployment

- backend app process
- bridge worker process
- optional job worker process
- reverse proxy/TLS
- managed secrets
- scheduled backups
- environment-specific config

### Environments

- **Local Dev**
  - example configs
  - local SQLite
  - mock/test gateway traffic
- **Home/Office Ops**
  - pull and bootstrap on Windows machine
  - restore local secrets
  - use real devices
- **VPS Production**
  - managed config
  - process supervision
  - nightly backup
  - audit retention

## 8. Security Model

### Identity and auth

- human users should move to session-based auth
- machine clients should use device/service credentials
- admin actions should require stronger assurance than read-only status access

### Recommended security upgrades

1. Replace long-term browser `localStorage` admin key as the primary human auth model
2. Introduce user accounts or signed session tokens for web/admin/mobile-admin surfaces
3. Assign each gateway device a unique credential and revocation status
4. Separate reviewer permissions from admin permissions
5. Add rate limits and suspicious-action monitoring to all write endpoints
6. Treat repeated validation failures as a signal for misuse, training gaps, or malicious probing

### Secret handling

- no secrets in Git
- rotate gateway secrets
- rotate admin bootstrap secret
- support revoking individual devices without rekeying the whole fleet

### Audit model

Every privileged action should record:

- actor id
- actor role
- client type
- target resource
- old/new state if applicable
- timestamp
- request correlation id

Validation failures should also record:

- raw request text
- normalized text
- request channel
- requester identity, if known
- stable error code
- human-readable failure reason

## 9. Data Model Direction

Core entities:

- **Request**
  - user intent and identity
- **Dispatch**
  - per-operator execution unit
- **Reply Draft**
  - reviewable output artifact
- **Gateway**
  - device identity and runtime state
- **User**
  - human actor and permissions
- **Audit Event**
  - immutable action record
- **Validation Failure Event**
  - currently represented as an audit event, not a first-class request row
- **Incident**
  - future entity for escalations, device issues, suspicious behavior

## 10. Maintainability Rules

1. One source of truth for status enums and transitions
2. One source of truth for role permissions
3. Background timers owned by a runtime coordinator, not hidden inside factories
4. Config loading must be deterministic and overrideable by environment
5. UI clients consume stable view models, not random internal store shapes
6. Request validation rules, command lists, and canonicalization policy live in one backend module
7. Every architectural change updates the docs in the same PR
8. No mixing gateway runtime concerns with supervisor/admin concerns in the same Android app

## 11. Immediate Design Decisions

These should be treated as locked unless there is a strong reason to revisit:

- separate **Android Gateway App** and **Android Admin App**
- admin console accessible from both **web admin** and **Android admin**
- backend remains the single workflow authority
- UI surfaces differ by role and device, not by inconsistent business logic
- future UI refactor should target professionalism, clarity, and operational trust over generic dashboard styling

## 12. Suggested Next Implementation Order

1. Surface validation-failure visibility cleanly in web/admin audit views
2. Formalize view-model/API boundaries for web/admin/admin-android
3. Split human auth from machine auth
4. Design the Android admin app scope and navigation
5. Refactor web/admin UI around the new information architecture
6. Add incident/alert model for operational maturity
