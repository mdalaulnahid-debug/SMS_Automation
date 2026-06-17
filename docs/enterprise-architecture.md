# Enterprise Architecture Baseline

This document defines the target product architecture for SMS Automation as a
professional multi-surface application, not just a working prototype.

It covers four product surfaces:

- **Core backend platform** — request intake, workflow orchestration, queueing,
  audit, matching, and persistence
- **Web operations interface** — quick monitoring and lightweight actions
- **Admin interface** — dense supervision, audit, provisioning, and exception handling
- **Android gateway application** — operator phone runtime, service health, and
  device-side administration

## Product goals

The system should feel enterprise-grade in three ways:

1. **Operationally trustworthy**
   - failures are visible
   - background jobs are explicit
   - state survives restart
   - auditability is built in
2. **Architecturally clean**
   - transport, workflow, domain, and persistence concerns are separated
   - runtime schedulers are owned by the server runtime, not hidden inside app factories
   - configuration is deterministic and portable
3. **Visually credible**
   - web and Android surfaces look intentionally designed
   - information hierarchy is clear
   - the UI communicates a real product team, not an ad hoc internal tool

## Target backend layering

The backend should be treated as four layers.

### 1. Transport layer

Files like `src/app.js`, `src/server.js`, and bridge clients belong here.

Responsibilities:

- HTTP routing
- request parsing / response shaping
- auth headers and machine identity checks
- static asset serving
- integration endpoints

Non-responsibilities:

- domain decisions
- queue policy
- matching policy
- timeout policy
- draft assembly policy

### 2. Application workflow layer

This is currently centered in `src/service.js`.

Responsibilities:

- submit request workflow
- receive SMS workflow
- retry / reject / approve workflows
- draft lifecycle
- fan-out finalization
- timeout handling

This layer should orchestrate domain rules and persistence, but not know about
HTML pages or UI structure.

### 3. Domain layer

This is currently spread across `src/domain.js`, `src/parser.js`,
`src/replyAnalyzer.js`, and parts of `src/store.js`.

Responsibilities:

- operators and routing rules
- request and dispatch state machines
- phone normalization
- reply classification and matching heuristics
- audit invariants

This layer should hold the business rules that define the product.

### 4. Infrastructure layer

This is currently handled by `src/persistence.js`, `src/config.js`,
`src/smsGateway.js`, and deployment scripts.

Responsibilities:

- SQLite persistence
- config file loading
- phone job dispatch transport
- deployment and runtime maintenance tasks

## Runtime model

To keep the system predictable, runtime maintenance must be explicit.

Required background concerns:

- timeout sweep
- stale claimed-job reclaim
- recovery of queued work after restart

Design rule:

- **application construction must not silently start timers**
- timers belong to a dedicated runtime coordinator started by the server entrypoint

This keeps tests clean, avoids duplicated intervals, and makes production
behavior easier to reason about.

## Frontend product surfaces

## 1. Web operations interface

Purpose:

- quick status checks
- light-touch review from phone or laptop
- operational awareness

Should emphasize:

- live system posture
- alerts and exceptions
- pending review items
- gateway availability

Should not become the main power-user console.

## 2. Admin interface

Purpose:

- high-density review workflows
- unmatched and ambiguous cases
- audit and compliance review
- provisioning and configuration support

Should become the primary desktop command center.

Design direction:

- cleaner information architecture
- fewer generic cards
- stronger visual hierarchy
- professional operational dashboard language

## 3. Android gateway UI

Purpose:

- device runtime control
- service health
- SIM/operator identity
- local diagnostics
- OTA/admin support

Design direction:

- preserve the stronger visual identity already present
- reduce settings confusion
- clarify primary vs advanced actions
- make service state impossible to misread

## Configuration and portability model

To support work from multiple PCs, configuration should be split into:

- **repo-tracked defaults/templates**
- **local private secrets**
- **runtime-generated machine-local state**

### Repo-tracked

- code
- docs
- scripts
- config examples
- UI assets

### Local private secrets

- `config/auth.json`
- `config/gateways.json`
- `config/telegram.json`
- VPS/admin notes

### Runtime-generated local state

- `data/automation.db`
- WAL/shm files
- temporary logs and build artifacts

Enterprise rule:

- a fresh checkout should be able to bootstrap itself into a **developer-ready**
  state without manual file hunting
- a fresh checkout should clearly report which private files are still required
  for a **production-ready** state

## Near-term implementation priorities

1. Move background schedulers into a dedicated runtime coordinator
2. Add workstation bootstrap scripts so a fresh pull is predictable
3. Continue separating backend responsibilities into clearer modules
4. Upgrade web/admin information architecture before visual polish
5. Align web visual language with the stronger Android identity

## Definition of “world class” for this product

For this system, world class does not mean flashy.

It means:

- reliable under restart and partial failure
- obvious to operate during stress
- consistent across backend, web, admin, and Android surfaces
- secure enough that trust boundaries are visible and deliberate
- designed well enough that nobody reading or using it assumes it was thrown together
