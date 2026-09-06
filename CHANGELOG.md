# Changelog

## 0.4.0 — 2026-09-06

- Conversation is the default screen; Korean mobile composer, persistent history, source references and approval/defer inbox.
- Real Responses API tool loop uses owner-scoped workspace and document context; all changes are persisted proposal cards until explicit approval.
- Plaud official remote MCP with dedicated dynamic registration, PKCE and encrypted app credentials.
- Google Calendar MCP plus own OAuth setup, primary-calendar paging/normalization, live conflict checks and repeat-safe approved creation without attendees or notifications.
- AES-GCM owner/provider-bound secrets; one-use OAuth state, serialized token refresh, turn/action leases and workspace revision checks.
- Existing calendar/planner approvals refresh connected busy periods; imported events are edited in Google.
- Sixteen agent/integration tests and protected API tests added to CI. External API tests use synthetic responses; real OAuth and paid inference require app-side credentials and consent.
- No automatic nightly scheduler, push delivery, bulk import or physical-device QA.

## 0.3.1 — 2026-09-06

- Private `/install` guide for Galaxy/Android and iPhone, deferred install prompt, cancellation fallback and actual standalone/install event detection.
- Credentialed manifest link for authenticated hosting, maskable/Apple icons and app shortcuts.
- Mobile keyboard-aware forms, safe areas, larger touch targets and screen history for the phone Back action.
- Foreground/reconnection refresh respects open edits and unresolved saves; offline status does not claim a successful save.
- Static-only offline caching validates response types and excludes sign-in redirects, private records and APIs.
- Seven PWA policy/asset checks plus a protected installation-route check added to CI.
- GitHub connection completed; source updates are maintained in roybeee/ORBIT.
- Scope: installable web app (PWA); no store package, offline record editing, scheduled push notifications or physical-device QA.

## 0.3.0 — 2026-09-06

- Immutable document versions, on-demand bodies, paged current-body search and history.
- Atomic, lossless v2 document migration with preserved IDs and task links.
- Explicit meeting action candidates, editable acceptance and immutable source citations.
- Same-source duplicate prevention, including after unrelated meeting edits.
- Previous/current document comparison and restore as a new version.
- Streaming current-record export includes complete document bodies.
- Eleven note/migration/search tests and six built-Worker route tests, alongside eighteen existing planner/storage tests.
- GitHub creation/push script and a prefilled private-repository link prepared; actual creation remains blocked by missing callable creation/authentication.
- Limits: catalog metadata remains bounded; no LLM inference, external sync, automatic nightly scheduler, bulk imports or browser/device QA.

## 0.2.0 — 2026-09-06

- Account-scoped D1 persistence, atomic revision checks and replay-safe commands.
- Protected workspace and API; isolated `/demo` without durable sample records.
- Live dates, week navigation, project/task/note/event editing and date-based review history.
- Server proposal approval/revoke; hold reason and next review date carried across future plans.
- User workday/timezone/capacity preferences and JSON export.
- PWA manifest, app icons, privacy-conscious static offline explanation.
- Ten storage/date tests plus five built-Worker auth/API tests; original eight planner tests retained.
- Limitations: no live connectors, LLM, scheduled notifications, offline records, import/restore or real-device QA. GitHub remote still awaits repository access.

## 0.1.0 — 2026-09-06

- Product specification, information architecture, data model, approval rules and release backlog.
- Korean responsive workspace with Today, Calendar, Tasks, Projects, Wiki, Knowledge, Evening Review and Tomorrow Proposal.
- In-session creation and navigation of sample tasks, projects, events and records.
- Deterministic scheduling, fixed-event protection, capacity/energy limits and dependency checks.
- Approval, defer reason, re-review, revoke and decision-preserving regeneration.
- Scheduling tests, server render smoke test and GitHub CI/Issue/PR templates.
- Boundary: no persistent user records, live integrations, LLM, scheduler, PWA or remote GitHub connection yet.
