# Graph Report - .  (2026-07-04)

## Corpus Check
- Large corpus: 651 files · ~1,554,684 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 1053 nodes · 2042 edges · 64 communities (57 shown, 7 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 154 edges (avg confidence: 0.66)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Web Frontend (ops+admin)|Web Frontend (ops+admin)]]
- [[_COMMUNITY_Android Admin App UI|Android Admin App UI]]
- [[_COMMUNITY_Automation Store & Audit|Automation Store & Audit]]
- [[_COMMUNITY_Android Gateway LogDB|Android Gateway Log/DB]]
- [[_COMMUNITY_Android Prefs Storage|Android Prefs Storage]]
- [[_COMMUNITY_Telegram Bridge|Telegram Bridge]]
- [[_COMMUNITY_Gateway Foreground Service|Gateway Foreground Service]]
- [[_COMMUNITY_Training Data & Matching|Training Data & Matching]]
- [[_COMMUNITY_Android Admin Dashboard|Android Admin Dashboard]]
- [[_COMMUNITY_User Auth & Sessions|User Auth & Sessions]]
- [[_COMMUNITY_Android Backend Client|Android Backend Client]]
- [[_COMMUNITY_Android Gateway Main UI|Android Gateway Main UI]]
- [[_COMMUNITY_OpsAdmin Data Builder|Ops/Admin Data Builder]]
- [[_COMMUNITY_Reply Analysis & Webhook|Reply Analysis & Webhook]]
- [[_COMMUNITY_Android SMS Receivers|Android SMS Receivers]]
- [[_COMMUNITY_Request Parser|Request Parser]]
- [[_COMMUNITY_Android Settings Screen|Android Settings Screen]]
- [[_COMMUNITY_Persistence Layer|Persistence Layer]]
- [[_COMMUNITY_Automation Service|Automation Service]]
- [[_COMMUNITY_Domain Model & Queue|Domain Model & Queue]]
- [[_COMMUNITY_Android Admin Design System|Android Admin Design System]]
- [[_COMMUNITY_Android Update Checker|Android Update Checker]]
- [[_COMMUNITY_Android Permissions|Android Permissions]]
- [[_COMMUNITY_SMS Gateway Dispatch|SMS Gateway Dispatch]]
- [[_COMMUNITY_Manual Review Store|Manual Review Store]]
- [[_COMMUNITY_SettingsConfig Store|Settings/Config Store]]
- [[_COMMUNITY_Android SMS Sender|Android SMS Sender]]
- [[_COMMUNITY_Persistence Tests|Persistence Tests]]
- [[_COMMUNITY_Android Service Events|Android Service Events]]
- [[_COMMUNITY_App Bootstrap & Config|App Bootstrap & Config]]
- [[_COMMUNITY_Server Entry & Maintenance|Server Entry & Maintenance]]
- [[_COMMUNITY_Operator Queue|Operator Queue]]
- [[_COMMUNITY_Security Tests|Security Tests]]
- [[_COMMUNITY_Workflow Tests|Workflow Tests]]
- [[_COMMUNITY_Training Reorg Script|Training Reorg Script]]
- [[_COMMUNITY_Android Backend Discovery|Android Backend Discovery]]
- [[_COMMUNITY_BottomNavHelper.kt|BottomNavHelper.kt]]
- [[_COMMUNITY_DispatchTracker.kt|DispatchTracker.kt]]
- [[_COMMUNITY_RetryWorker.kt|RetryWorker.kt]]
- [[_COMMUNITY_auth.js|auth.js]]
- [[_COMMUNITY_settingsStore.test.js|settingsStore.test.js]]
- [[_COMMUNITY_GatewayApplication.kt|GatewayApplication.kt]]
- [[_COMMUNITY_NetworkUtils.kt|NetworkUtils.kt]]
- [[_COMMUNITY_UpdateInstaller.kt|UpdateInstaller.kt]]
- [[_COMMUNITY_WebhookSender.kt|WebhookSender.kt]]
- [[_COMMUNITY_mailer.js|mailer.js]]
- [[_COMMUNITY_network.js|network.js]]
- [[_COMMUNITY_PhoneUtils.kt|PhoneUtils.kt]]
- [[_COMMUNITY_app.js|app.js]]
- [[_COMMUNITY_backup.sh|backup.sh]]
- [[_COMMUNITY_deploy.sh|deploy.sh]]
- [[_COMMUNITY_setup-ssl.sh|setup-ssl.sh]]
- [[_COMMUNITY_vps-setup.sh|vps-setup.sh]]

## God Nodes (most connected - your core abstractions)
1. `AutomationStore` - 54 edges
2. `AdminMainActivity` - 43 edges
3. `Prefs` - 41 edges
4. `GatewayForegroundService` - 25 edges
5. `AdminActivity` - 24 edges
6. `MainActivity` - 24 edges
7. `AutomationService` - 24 edges
8. `esc()` - 21 edges
9. `UserAuthStore` - 18 edges
10. `BackendClient` - 17 edges

## Surprising Connections (you probably didn't know these)
- `renderAuditList()` --indirect_call--> `log()`  [INFERRED]
  public/admin.js → telegram-bridge/start.js
- `auditToCsv()` --calls--> `esc()`  [INFERRED]
  src/app.js → public/shared.js
- `appWith()` --calls--> `createApp()`  [EXTRACTED]
  test/userAuth.test.js → src/app.js
- `main()` --calls--> `rebuildTrainingCache()`  [EXTRACTED]
  scripts/importTrainingData.js → src/trainingData.js
- `appWith()` --calls--> `createApp()`  [EXTRACTED]
  test/security.test.js → src/app.js

## Import Cycles
- None detected.

## Communities (64 total, 7 thin omitted)

### Community 0 - "Web Frontend (ops+admin)"
Cohesion: 0.05
Nodes (74): activeFilterCount(), auditChipClass(), auditChipLabel(), auditLogs, boot(), exportAuditCsv(), facetCount(), filteredAuditLogs() (+66 more)

### Community 1 - "Android Admin App UI"
Cohesion: 0.11
Nodes (18): Activity, AdminBackendClient, JSONArray, JSONObject, String, AdminMainActivity, Bundle, JSONArray (+10 more)

### Community 2 - "Automation Store & Audit"
Cohesion: 0.06
Nodes (14): assertTransition(), createRequestId(), normalizePhoneNumber(), normalizeSenderId(), AutomationStore, canonicalize(), { createHash }, DUPLICATE_BLOCKING_STATUSES (+6 more)

### Community 3 - "Android Gateway Log/DB"
Cohesion: 0.05
Nodes (27): ActivityLogBinding, AppDatabase, get(), Context, migrate(), Int, List, Long (+19 more)

### Community 4 - "Android Prefs Storage"
Cohesion: 0.14
Nodes (8): Boolean, Context, Int, List, Pair, String, Prefs, SharedPreferences

### Community 5 - "Telegram Bridge"
Cohesion: 0.08
Nodes (27): BackendClient, buildMention(), handleIntake(), notifyTimeouts(), planIntake(), postApprovedReplies(), postLiveEdits(), shouldSuppressGroupReply() (+19 more)

### Community 6 - "Gateway Foreground Service"
Cohesion: 0.08
Nodes (20): android, GatewayForegroundService, Boolean, Int, Intent, String, HttpServer, Boolean (+12 more)

### Community 7 - "Training Data & Matching"
Cohesion: 0.08
Nodes (40): { join }, main(), { rebuildTrainingCache }, { basename, dirname, extname, join }, buildPatterns(), buildSignature(), buildSummary(), emptyCatalog() (+32 more)

### Community 8 - "Android Admin Dashboard"
Cohesion: 0.11
Nodes (15): ActivityAdminBinding, AdminActivity, BackendClient, Boolean, Bundle, Int, LinearLayout, List (+7 more)

### Community 9 - "User Auth & Sessions"
Cohesion: 0.09
Nodes (19): { DatabaseSync }, generateMfaCode(), generateToken(), hashPassword(), hashToken(), isValidEmail(), ROLES, { scryptSync, randomBytes, randomInt, timingSafeEqual } (+11 more)

### Community 10 - "Android Backend Client"
Cohesion: 0.13
Nodes (16): AppVersion, AuditEntry, BackendClient, DashboardSnapshot, DispatchInfo, GatewayStatus, Boolean, Int (+8 more)

### Community 11 - "Android Gateway Main UI"
Cohesion: 0.12
Nodes (9): ActivityMainBinding, Boolean, Bundle, Int, Menu, MenuItem, MainActivity, ObjectAnimator (+1 more)

### Community 12 - "Ops/Admin Data Builder"
Cohesion: 0.08
Nodes (23): {
  AutomationService,
  DEFAULT_SEND_CONFIRMATION_GRACE_MS,
  DEFAULT_DUPLICATE_REQUEST_WINDOW_MS
}, { AutomationStore }, buildActivityFeed(), buildAdminData(), buildOpsData(), decorateGatewayHealth(), { getBackendUrls, getLanAddresses, getPreferredLanIp }, https (+15 more)

### Community 13 - "Reply Analysis & Webhook"
Cohesion: 0.13
Nodes (18): TERMINAL_DISPATCH_STATUSES, analyzeOperatorReply(), confidenceScore(), { extractSilentReference }, inferReplyFamilies(), { matchReplyAgainstTraining, scoreReplyFamiliesFromTraining }, matchTrainingPattern(), payloadInReply() (+10 more)

### Community 14 - "Android SMS Receivers"
Cohesion: 0.10
Nodes (14): BootReceiver, Context, Intent, Context, Intent, String, SmsReceiver, Context (+6 more)

### Community 15 - "Request Parser"
Cohesion: 0.17
Nodes (19): diagnoseIdentifierError(), ERROR_DEFINITIONS, HYPHENATED_COMMANDS, identifierMatchesType(), invalidResult(), invalidResultWithText(), isImei(), isMsisdn() (+11 more)

### Community 16 - "Android Settings Screen"
Cohesion: 0.18
Nodes (6): ActivitySettingsBinding, Boolean, Bundle, Int, List, SettingsActivity

### Community 17 - "Persistence Layer"
Cohesion: 0.20
Nodes (5): { DatabaseSync }, j(), nz(), p(), Persistence

### Community 18 - "Automation Service"
Cohesion: 0.17
Nodes (3): AutomationService, collectDispatchReplyMessages(), formatCombinedReply()

### Community 19 - "Domain Model & Queue"
Cohesion: 0.17
Nodes (13): DISPATCH_STATUSES, formatOperatorSms(), isTrustedSenderForGateway(), operatorForGateway(), operatorForMsisdn(), OPERATORS, REQUEST_DEFINITIONS, REQUEST_TYPES (+5 more)

### Community 20 - "Android Admin Design System"
Cohesion: 0.27
Nodes (7): AdminDesignSystem, Context, String, TextView, View, Palette, GradientDrawable

### Community 21 - "Android Update Checker"
Cohesion: 0.23
Nodes (7): BackendClient, Boolean, Context, Int, Long, String, UpdateChecker

### Community 22 - "Android Permissions"
Cohesion: 0.22
Nodes (6): ActivityPermissionsBinding, Boolean, Bundle, String, PermissionsActivity, Array

### Community 23 - "SMS Gateway Dispatch"
Cohesion: 0.15
Nodes (9): SmsGatewayClient, assert, { AutomationService }, { AutomationStore }, { inferReplyFamilies }, { OperatorQueue }, { SmsGatewayClient }, { STATUSES } (+1 more)

### Community 24 - "Manual Review Store"
Cohesion: 0.16
Nodes (9): { existsSync, mkdirSync, readFileSync, writeFileSync }, { join }, ManualReviewStore, assert, { existsSync, mkdtempSync, readFileSync, rmSync }, { join }, { ManualReviewStore }, test (+1 more)

### Community 25 - "Settings/Config Store"
Cohesion: 0.34
Nodes (13): { existsSync, readFileSync, writeFileSync }, gatewaysConfigPath(), { join }, readAuthorizedUsers(), readJsonFile(), readOperatorContacts(), readTelegramGroupChatId(), removeAuthorizedUser() (+5 more)

### Community 26 - "Android SMS Sender"
Cohesion: 0.27
Nodes (8): Context, Int, List, String, Triple, SmsSender, PendingIntent, SmsManager

### Community 27 - "Persistence Tests"
Cohesion: 0.15
Nodes (10): assert, { AutomationService }, { AutomationStore }, { join }, { mkdtempSync, rmSync }, { OperatorQueue }, { SmsGatewayClient }, { STATUSES } (+2 more)

### Community 28 - "Android Service Events"
Cohesion: 0.35
Nodes (4): Boolean, Context, String, ServiceEvents

### Community 29 - "App Bootstrap & Config"
Cohesion: 0.25
Nodes (10): createApp(), json(), { existsSync, readFileSync }, { join }, loadAuthConfig(), loadGatewayConfig(), loadMailConfig(), loadTelegramConfig() (+2 more)

### Community 30 - "Server Entry & Maintenance"
Cohesion: 0.22
Nodes (7): createMaintenanceCoordinator(), { createApp }, { createMaintenanceCoordinator }, http, maintenance, port, timeoutSweepMs

### Community 32 - "Security Tests"
Cohesion: 0.24
Nodes (8): assert, { AutomationStore }, call(), { createApp }, mockReq(), mockRes(), { Readable }, test

### Community 33 - "Workflow Tests"
Cohesion: 0.20
Nodes (8): assert, { AutomationService }, { AutomationStore }, { OperatorQueue }, { parseRequestText }, { SmsGatewayClient }, { STATUSES }, test

### Community 34 - "Training Reorg Script"
Cohesion: 0.31
Nodes (8): { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync }, inferOperator(), inferRequestType(), { join, extname, basename }, main(), OPERATORS, REQUEST_TYPES, walk()

### Community 35 - "Android Backend Discovery"
Cohesion: 0.50
Nodes (4): BackendDiscovery, Int, List, String

### Community 36 - "BottomNavHelper.kt"
Cohesion: 0.36
Nodes (5): BottomNavHelper, Activity, Int, NavDestination, BottomNavigationView

### Community 37 - "DispatchTracker.kt"
Cohesion: 0.43
Nodes (3): DispatchTracker, Boolean, String

### Community 38 - "RetryWorker.kt"
Cohesion: 0.33
Nodes (4): Result, String, RetryWorker, CoroutineWorker

### Community 39 - "auth.js"
Cohesion: 0.52
Nodes (6): isAdmin(), isValidGateway(), presentedGatewaySecret(), presentedToken(), safeEqual(), { timingSafeEqual }

### Community 40 - "settingsStore.test.js"
Cohesion: 0.29
Nodes (5): assert, { join }, { mkdtempSync, rmSync, writeFileSync, readFileSync }, test, { tmpdir }

### Community 41 - "GatewayApplication.kt"
Cohesion: 0.40
Nodes (4): applyTheme(), GatewayApplication, Context, Application

### Community 42 - "NetworkUtils.kt"
Cohesion: 0.40
Nodes (3): Context, String, NetworkUtils

### Community 43 - "UpdateInstaller.kt"
Cohesion: 0.47
Nodes (3): Context, UpdateInstaller, File

### Community 44 - "WebhookSender.kt"
Cohesion: 0.33
Nodes (4): Boolean, Context, String, WebhookSender

### Community 45 - "mailer.js"
Cohesion: 0.40
Nodes (3): getTransport(), nodemailer, sendMail()

### Community 46 - "network.js"
Cohesion: 0.60
Nodes (4): getBackendUrls(), getLanAddresses(), getPreferredLanIp(), os

## Knowledge Gaps
- **141 isolated node(s):** `Palette`, `requestsData`, `repliesData`, `unmatchedData`, `rejectedData` (+136 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `auditToCsv()` connect `Web Frontend (ops+admin)` to `Ops/Admin Data Builder`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **What connects `Palette`, `requestsData`, `repliesData` to the rest of the system?**
  _141 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Web Frontend (ops+admin)` be split into smaller, more focused modules?**
  _Cohesion score 0.05393000573723465 - nodes in this community are weakly interconnected._
- **Should `Android Admin App UI` be split into smaller, more focused modules?**
  _Cohesion score 0.10752688172043011 - nodes in this community are weakly interconnected._
- **Should `Automation Store & Audit` be split into smaller, more focused modules?**
  _Cohesion score 0.06398730830248546 - nodes in this community are weakly interconnected._
- **Should `Android Gateway Log/DB` be split into smaller, more focused modules?**
  _Cohesion score 0.053544494720965306 - nodes in this community are weakly interconnected._
- **Should `Android Prefs Storage` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._