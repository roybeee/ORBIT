# Development backlog

Status: planned unless explicitly marked complete. These are repository documents, not remotely created GitHub Issues.

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
