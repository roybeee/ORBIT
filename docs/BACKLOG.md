# Development backlog

Status: planned unless explicitly marked complete. v0.2 progress is recorded below. These are repository documents, not remotely created GitHub Issues.

| ID | Release | Work item | Acceptance criteria |
|---|---|---|---|
| ORB-001 | v0.1 | Product design and interactive prototype | Complete: eight views, honest demo boundary, deterministic proposal rules |
| ORB-002 | v0.1 | Connect private GitHub remote | Repository exists, app access available, initial source commit pushed and verified |
| ORB-101 | v0.2 | Identity and owner-scoped persistence | Unauthorized requests rejected; cross-owner reads/writes and references denied |
| ORB-102 | v0.2 | Project/task CRUD and deliverables | Reload and second device preserve records; version conflict surfaced |
| ORB-103 | v0.2 | Calendar and timezone handling | All-day dates, UTC/local dates and fixed-event overlaps handled |
| ORB-104 | v0.2 | Source/wiki/knowledge records and links | Original content preserved; stable bidirectional task citations |
| ORB-105 | v0.2 | Daily reviews | One latest record per local day with revision history |
| ORB-106 | v0.2 | Server proposal and approval transactions | Duplicate approval/retry yields one event; stale input rejected |
| ORB-107 | v0.2 | Waiting/hold follow-up dates | Every waiting item can have condition and next check date |
| ORB-108 | v0.2 | PWA and actual mobile validation | Install/reopen/login verified on user's device; offline state is honest |
| ORB-109 | v0.2 | Save failures, export and recovery | No false save success; records can be exported and restored |
| ORB-201 | v0.3 | Extract meeting decisions and action candidates | Grounded citations, schema checks, user acceptance before writes |
| ORB-202 | v0.3 | Wiki updates with revision proposals | Before/after visible; no unreviewed facts overwrite |
| ORB-203 | v0.3 | LLM explanations and estimated-time calibration | Rule validator rejects impossible schedules; provider failures recover |
| ORB-301 | v0.4 | Notion read adapter | Only selected resources, full child pagination, revision deduplication |
| ORB-302 | v0.4 | Calendar read sync | Incremental cursor and expiry/reset, recurring exceptions, last-sync state |
| ORB-303 | v0.4 | Approved calendar write/outbox | Replay-safe writes, external conflict and sync failure reporting |
| ORB-304 | v0.4 | Daily scheduler and optional notifications | User timezone, quiet hours, one job per user/date, retries deduplicated |
| ORB-305 | v0.4 | Private file ingestion | MIME/size checks, parsing state, citation offsets, retry support |

## Release gate

No prototype can be relabeled as a daily-use release until persistence, ownership, date handling, approval idempotency and actual phone flows pass. External account setup and store/browser behavior may affect delivery dates.

## v0.2 progress

- ORB-101: implemented — private sign-in, stable owner ID, persisted state and owner/reference checks.
- ORB-102: implemented — create/edit/status/complete with version conflicts; observable completion criteria retained.
- ORB-103: basic internal calendar and timezone dates implemented; external recurring calendars remain future work.
- ORB-104: manual records and links implemented; original-document revisions and large/paged knowledge storage remain.
- ORB-105: date-based current review records implemented; review revision history remains.
- ORB-106: implemented — server domain transition plus atomic CAS/idempotency receipt.
- ORB-107: task follow-up dates and proposal revisit dates implemented; automatic notifications remain.
- ORB-108: manifest/icons/offline explanation implemented; actual-device installation and browser QA remain.
- ORB-109: save-error input preservation and JSON export implemented; import/restore remains.
- ORB-002: blocked on user GitHub repository access; no repository was fabricated or silently substituted.

Prioritize per-record note/revision storage and paged retrieval before large knowledge imports. Current aggregate persistence is bounded and designed for the first personal-use iteration.

## v0.3 progress

- ORB-104: individual body/version storage, on-demand retrieval and paged body search implemented. Metadata catalog normalization and bulk ingestion remain.
- ORB-201: explicit action-marker extraction, source citations and human acceptance implemented. LLM decisions/action inference remains.
- ORB-202: immutable manual edit history, before/current comparison and restore as a new version implemented. AI wiki update proposals remain.
- ORB-002: private repo creation link and authenticated CLI creation/push script prepared. GitHub account `roybeee` still exposes zero installations/repositories; no callable create-repository action or authenticated CLI is available. Actual GitHub creation/push is incomplete.

Next: complete GitHub account-side creation/access, validate on the user's device, then add grounded AI meeting/wiki proposals with provider configuration and recoverable failures. Bulk imports must wait for metadata catalog normalization and storage limits review.

## GitHub target selected

- User selected `https://github.com/roybeee/ORBIT.git`. Repository exists, is public, and was empty when inspected.
- Local `github` remote configured for the exact target. Actual README initialization failed with GitHub HTTP 403 (`Resource not accessible by integration`); no file or commit was created remotely.
- ORB-002 now requires granting the ChatGPT/Codex GitHub connection repository write access, then uploading the prepared source and checking CI. Do not create the earlier proposed repository.

## GitHub installation completed

- ChatGPT Codex Connector is installed for `roybeee`, and repository writes now succeed.
- ORB-002: completed — uploaded the full v0.3 source snapshot to `roybeee/ORBIT`; repository includes Validate Orbit CI and Issue/PR templates. Earlier access-blocked entries above describe the previous setup state.

## v0.3.1 mobile progress

- ORB-108: install guide/CTA, authenticated manifest, maskable/Apple icons, app shortcuts, standalone detection and mobile keyboard/safe-area handling implemented. Physical-phone installation remains to be checked by opening the published app on the device.
- Reconnection and foreground refresh preserve paused edits and unresolved command receipts. Phone Back navigates between visited workspace screens.
- Automated validation now includes seven PWA asset/cache-policy checks and the authenticated installation page.
- Next personal-use milestone: verify installation on the user's Galaxy, then grounded AI proposals and deliberate notification scheduling. Offline editing and automatic push are not part of this release.

## v0.4 progress

- Conversation-first AI management, owner-scoped history and approval/defer/review-date cards implemented. Actual inference uses the existing Hermes gateway; its HTTPS address and connection key must be configured in app settings.
- ORB-201/202/203: AI meeting/wiki/task proposals and grounded note reads implemented, with immutable edit revision checks and deterministic timing. Time-estimate learning remains.
- Plaud: official remote MCP integration with dedicated OAuth/PKCE implemented; app-side account consent required.
- ORB-302: primary Google Calendar full-window sync implemented with paging, recurring instances, local-date normalization and live conflict checks. Multi-calendar selection and incremental sync remain.
- ORB-303: explicit approved creation with deterministic IDs, owner marker verification and recovery implemented. Durable background outbox and external edit/delete remain.
- ORB-304: daily review can be started through conversation or the existing review screen. Automatic nightly scheduler and push notifications remain.
- Agent conversation/decision export, search pagination beyond the bounded catalogs, bulk ingestion and actual phone/OAuth end-to-end verification remain follow-up work.
