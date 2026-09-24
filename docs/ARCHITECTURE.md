# Architecture and implementation boundary

Current reliability changes and verification: [2026-09-19 operations note](Reliability_2026-09-19.ko.md). Historical version sections below describe the boundary at the time of each release.

## v0.3: authenticated personal workspace and document history

- `app/page.tsx`, `app/demo/page.tsx`: protected, dynamic server pages using the dispatch-owned ChatGPT sign-in flow. A stable Site-scoped user ID is required; email is display metadata.
- `components/orbit/workspace.tsx`: Korean responsive workspace and forms. Demo mode is explicit and never invokes the persistence API.
- `lib/orbit/use-workspace.ts`: server-authoritative state, acknowledged saves, stable retry IDs, conflict reporting, and periodic reloads that pause during uncertain writes and form/review editing.
- `lib/orbit/model.ts`, `dates.ts`, `derived.ts`: typed state, timezone/date-only helpers and derived focus state.
- `lib/orbit/validation.ts`: bounded, strict command validation.
- `lib/orbit/reducer.ts`: server domain transitions and reference checks; the same pure functions support the isolated demo.
- `lib/orbit/planner.ts`: deterministic capacity, workday, dependency and approval rules. No model provider is invoked.
- `db/repository.ts`: raw prepared D1 statements, owner-scoped reads, optimistic revision checks, transactional idempotency receipts.
- `db/schema.ts`, `drizzle/`: schema-only generated migrations. Applied migration files and journal snapshots must stay immutable.
- `app/api/workspace/route.ts`: authenticated GET/POST, origin and JSON checks, bounded input, no-store responses, explicit 401/409/422/503 states.
- `public/manifest.webmanifest`, `sw.js`, icons and `offline.html`: install configuration and a static offline explanation. The service worker never caches authenticated application HTML, APIs, exports or user data.

## Persistence decision and bounded scope

The first individual-use release stores a versioned aggregate per owner in D1, plus an idempotency receipt table. A single compare-and-swap update atomically records the related task, proposal and calendar state. Receipt insertion is gated on the winning mutation ID inside the same D1 batch. Duplicate or uncertain HTTP retries cannot create duplicate calendar blocks. Concurrent stale requests receive a conflict instead of overwriting data.

Document bodies and every acknowledged version now live in `orbit_note_revisions`, keyed by authenticated owner, note ID and note revision. The workspace keeps compact metadata and immutable pointers. A note edit, its new revision and the request receipt commit in one guarded batch. Restore reads an existing version and appends a new one; it never rewrites history. Delete checks task references and removes only the target document's records.

v2 aggregates remain readable. The next accepted command inserts all legacy note versions through one bounded `json_each` statement, writes the v3 metadata pointers, and records any new document version in the same transaction. Migration SQL is schema-only. The original `0000` migration remains unchanged; `0001_pale_charles_xavier.sql` adds the document version table.

`GET /api/notes?id=...` loads an authorized body/version. `history=1` returns 10 versions with a monotonic before-revision cursor. Without an ID, the route joins the current metadata/version pointers and searches title, summary, tags and the current full body, returning 24 records per page. Old revisions do not pollute search. A workspace revision guard detects a changed catalog during paging. All SQL uses prepared parameters and owner constraints.

`GET /api/export` streams current document versions against snapshot pointers, avoiding a single in-memory collection of all bodies. The client waits for the full response before downloading. A concurrent deletion that removes a pinned version fails the download; users can retry. Exports do not include history or unsaved forms.

The catalog and non-document workspace data still share a 950,000-byte aggregate. Document text is separately bounded to 100,000 characters and the HTTP command to 400,000 bytes. This removes the former combined-body ceiling but does not mean unlimited storage. Normalize the remaining metadata catalog before large imports; search currently scans the active documents rather than a full-text index.

`lib/orbit/meeting.ts` recognizes only explicit markers (`할 일:`, `액션:`, `TODO:`, `ACTION:`, `- [ ]`). No LLM is called and no implicit promise/date/assignee is inferred. The user selects candidates and edits title, due date, duration and completion criteria. Server acceptance reloads the pinned source, validates line references, writes task citations and prevents same-source duplicates across retries and later note revisions. Direct task edits cannot forge those citations. No calendar block is created until the normal proposal approval workflow.

`components/orbit/note-detail.tsx` implements body retrieval, history comparison/restore and candidate approval; `note-library.tsx` implements paged search and recovery. Demo mode stays isolated and explicitly disables durable history.

## Auth and authorization

Private Sites dispatch controls who may reach this Site. Server routes additionally require both `oai-authenticated-user-id` and email and isolate every workspace by the stable ID. SIWC identifies a user; Site access policy controls the allowed audience. Do not turn the Site public to make API testing easier. Do not implement or replace platform sign-in/callback routes.

## Tests

- Planner: fixed schedules, gaps, capacity, dependencies, approval idempotency and stale checks.
- Storage: actual generated SQL on a local SQLite D1-shaped adapter; owner separation, reloads, stale writes, concurrent commands, replay, atomic approval and hold dates.
- Built Worker HTTP: auth redirects, Korean root without demo data, isolated demo, anonymous API rejection, origin checks and persisted owner data.
- The smoke loader supplies only the Cloudflare environment binding in Node. It is test-only and does not affect runtime identity checks or deployment code.

These tests are local; they do not claim live browser, device or cloud D1 end-to-end coverage.

## Not yet active

Scheduler, push subscription, Notion adapter, attachments, semantic search, backup import and actual elapsed-time tracking remain unimplemented. Native Hermes Agent runs, Plaud MCP and Google Calendar integration require app-side gateway configuration and account authorization. R2 remains disabled. Dates and work preferences are live; the demo intentionally keeps September 6–7, 2026 examples.

## v0.4 agent and integrations

`lib/orbit/agent` contains the native Hermes run adapter, owner-scoped conversation/proposal repository, user decision executor, encrypted connections, OAuth/PKCE and Google busy-period adapter. `/api/agent` separates chat from explicit decisions; `/api/agent/run` advances or cancels an existing run. D1 records exact submission payloads and native idempotency keys before network submission, retains remote run IDs across lost acknowledgements, and serializes foreground reconciliation. Hermes returns a bounded read-request or final-proposal envelope. Only validated final proposals become cards; native completed function calls are never re-executed as client tool requests. Failed/cancelled turns publish no partial cards. Plaud reads use a pinned Streamable HTTP MCP client and read-only catalog filtering. Google reads use the official Calendar adapter. The existing Hermes instance selects the model/provider; Orbit never falls back to a model-vendor API. Internal approvals reuse workspace CAS and mutation receipts; related pending cards advance revisions only after their own prerequisite commit.

Migrations `0002` and `0003` add conversations, decisions, encrypted connection records, one-use OAuth states, an external calendar cache and in-flight uniqueness/refresh leases. External calendar records are overlaid for reads and stripped from the aggregate on writes; changes to cached busy time advance the workspace revision. Google event creation uses a deterministic action-derived event ID and verifies its ownership marker on retries. Provider credentials are never persisted in client storage, source control or API status responses.

See [agent operations and setup](Orbit_Agent.ko.md) for the exact credentials, scopes, data window and known limits. Existing explicit-marker extraction remains available independently of AI.

## Attachment flow

`POST /share-target` is intercepted by the installed service worker before generic fetch filtering. It awaits an IndexedDB transaction containing File objects and stable IDs before redirecting to authenticated `/share?draft=...`. The Worker fallback reports a failed intake. Intake hands prepared IDs to a chat composer or event form; only actual destination commit removes the matching local handoff. A separate upload list recovers unbound prepared server files.

`orbit_attachments` owns metadata, upload lease, immutable object/preview keys, preparation state, and a single turn/event binding. Raw PUT streams directly to R2. Preview PUT is bounded to 600 KB; context finalization makes derivatives immutable. The workspace/turn write checks ownership/readiness and binds in the same D1 batch. Losing acknowledgement reconciles stored pointers before cleanup. No original binaries or base64 are stored in D1 or serialized Hermes jobs. Native request retries reconstruct identical preview bytes and retain the durable key on storage/transport failures.

Only content-hashed public code/styles and safe offline assets are cached. Private HTML, API responses, exports and file bytes always require network/owner authentication. Temporary received files are device-local drafts, not offline workspace replicas.

## v0.6 BRAINY companion

The BRAINY/GoTEM planner method is implemented as checks that run while work is written, started and finished, not as extra form fields. `lib/orbit/coach.ts` is a pure function over a task draft and workspace context that returns advisory checks (definition written as a handoff, inferred quadrant and cognition, calibrated estimate, oversized work, overdue date, Goal Laser candidate, unlinked goal, active rules), each optionally carrying a one-tap patch. No check blocks a save.

`lib/orbit/planner.ts` fills lunch and meeting travel before anything else, places at most one Goal Laser from the domino project as a contiguous block (`laserMinutes`, default 180) in the peak rhythm window, then places must-close items and B → A → C by score; D-quadrant work goes to `proposal.delegate` unless explicitly marked must-close. Placement follows an explicit cognition level only. `calibrationFactor` is the median actual/estimate ratio of completed work in the last 30 days (project + cognition, then cognition, then all; five samples minimum; clamped ×0.5–×2). Proposal reasons state where a block actually landed.

`lib/orbit/reducer.ts` adds `task.start` / `task.stop` / `task.record` (one running session per workspace, elapsed minutes accumulate into `actualMinutes`, outcome and reason recorded, an optional rule becomes an improvement), `task.laser` (one Laser per date, reserves a focus slot), `review.save` / `review.saveGenerate` with an optional detail (applies item outcomes, feedback rules and habit checks, stores compact `stats`; `saveGenerate` also generates tomorrow with domino and calibration options in the same transition), and bounded goal/habit/risk/improvement collections (`LIMITS`). Tasks created for today after the day was planned are flagged `unplanned` for the evening review.

Review detail (items, feedback, energy, small wins, gratitude, habit checks) is stored in `orbit_reviews` (migration `0010`, one row per owner and date) and written in the same gated D1 batch as the workspace aggregate, so a rejected revision writes no detail row and a replayed operation writes it once. The aggregate keeps only stats, habit checks and the first small win. `/api/reviews?date=` returns one detail; `?from=&to=` returns up to 62 days. Export streams the details after the documents.

`components/orbit/coach/*` hosts the UI: `TaskCoach` (draft checks), `FocusSession` and its record dialog, `TodayLaser` (morning panel: Laser, must-close, risks, habits, yesterday's win), `ReviewWizard` (four PAFI steps; outcomes are required before feedback), `GoalsPanel` (goals, domino, habits, risks, rules) and `WeeklyStats`. The Hermes context includes goals, domino, Laser, rules, habits, risks and weekly stats; agent proposals may record outcomes, rules, habits, risks and the Laser but cannot delete goals or habits or start sessions.

Not included: automatic morning/evening scheduling, push reminders for the review, biometric energy sources, and cross-owner or team views. Calibration needs at least five completed items with actual minutes before it changes any estimate.

### Evidence-first 1-minute review

`lib/orbit/review-evidence.ts` builds the review's result candidates from stored records only (no model call): an outcome already recorded for the date is `confirmed`; otherwise explicit wording in notes filed that day (meetings, Slack-directive notes, mail), linked delegation updates, or at least five focus-timer minutes since the task's last outcome record produce a `suggested` outcome with the source lines attached. The task's own title words are removed before reading outcome wording, negations win over completion words, and conflicting records produce no guess. Calendar blocks are shown as planned minutes and never used as actual time. `GET /api/reviews?date=&evidence=1` runs the same function on the server with note bodies read by `readNoteBodies` (bounded to 24 notes of that date); the client shows local candidates first and only refreshes rows the user has not touched.

The wizard saves only answered rows: a pending suggestion or "아직 모름" never becomes an outcome. `review.save` rejects a detail with a repeated task, skips a past-date execution record identical to the latest one for that task and date, and gives an unfinished item with reason `waiting` a next-day `checkDate` (surfacing it in the dashboard's attention list) without removing it from planning candidates. `reviewReflection` describes, using the planner's own `calibrationEvidence`, what the save changes for the next day; the proposal view shows it once after saving. Each saved detail carries count-only `confirmation` metrics (candidates shown, confirmed, unknown, accepted, edited, seconds open → save); `confirmationTrend` compares the first seven measured days with the following seven.

### GoTEM Slack messages from stored state

The Hermes GoTEM cron (morning 09:00 / afternoon 14:00 / night 22:30, #비서실) runs `integrations/hermes-gotem/gotem-<slot>.sh` as a `no_agent` script: the script POSTs `{slot}` to `/api/integrations/slack/gotem` and prints the returned `text`, and an empty print is a silent run. The route (`lib/orbit/slack/gotem-http.ts`) authenticates with the same provisioned Slack credential as the directives route (`orbit_slack_credentials`, scope `directives:write`), so the owner comes from the credential, never from the request. `lib/orbit/slack/gotem.ts` composes the message from the saved workspace only — no model call — in the order today's one thing → first 10 minutes → plan state → one ORBIT link. Morning/afternoon read `planStatus` for the `ready / stale / local (+analysis running/failed) / none` wording and its basis time; the night message counts `reviewCandidates` and links to `/#review`. The afternoon message is skipped when the focus task is started, done, or its planned slot has not ended. POST claims `(owner, date, slot)` in `orbit_gotem_sends` with `ON CONFLICT DO NOTHING`; a second call that day returns `send:false, reason:'duplicate'`. GET previews without claiming. Each row stores the decision, plan state, task id and carried review date for later measurement.

`lib/orbit/today-focus.ts` is the shared "today's one thing": the brief's first priority (title, `approach[0]`, planned slot) or, for a local plan, the laser task with its done definition. The home hero uses it ahead of the chief signal unless a focus session is running. A review may carry one improvement (`ReviewDetail.carry`, the day-level rule field): `review.save` keeps it as an active improvement and on `DailyReview.carry`, and the next day's home hero and morning message show it with the review date. The planner and brief prompt are unchanged by this.

`writeCommand` also appends a row to `orbit_task_starts` (owner, task, `startedAt`, local date) whenever a commit gives a task a new `startedAt`, gated on the winning workspace revision like the other side tables, because `Task.startedAt` is cleared when the session ends. `lib/orbit/slack/gotem-metrics.ts` (`GET /api/gotem/metrics`, session owner) reads it with `orbit_gotem_sends` and the saved reviews: the share of sent morning messages followed within 60 minutes by a start of the message's task (any start when the message named none) with the median delay, and the share of non-empty review carries whose next morning message recorded that review date.

### Goal Laser × one-page brief

`lib/orbit/brief/planning.ts` turns the brief's priorities into `PlannerOptions`: `ordered` restricts and ranks candidates, `laserTaskId` is the first priority that deserves deep work (high cognition, ≥90 minutes, or ≥45 minutes in the domino project), and `calibration` applies the median actual/estimate factor. The planner places priorities ranked above the Laser first (quick unblockers keep their early slot), then the Laser as a contiguous `laserMinutes` block in the peak window, then the rest in the brief's order. `ProposalItem.estimate` records the task duration the block was planned from, so approval detects a changed estimate without rejecting calibrated or Laser blocks. The planning catalog carries `brainy` (domino project, goal ladder, rules ★, habits with streaks, standing risks, weekly stats, yesterday's review) and the planning instructions ask Hermes to choose priority 1 from the domino project and to tag priorities with cognition and quadrant.

`startPlanningAction` saves the PAFI review detail (`review.save` + detail) before analysis starts. When no Hermes connection exists (`HERMES_SETUP`), it and `POST /api/brief` fall back to the deterministic planner and report `local: true`; the brief panel shows a notice instead of an error. That guard is pre-flight only, so `lib/orbit/agent/runner.ts` repeats the fallback for a run that dies after it started: every terminal failure of a planning turn (`failPlanning`) fills a missing plan for that date with the same `localPlanning` before the turn is recorded as failed, and says so in the error. An existing plan for the date is never replaced, and `daily-runtime` stops re-queuing a failed run once the date has a plan. A spent provider quota (`QUOTA_FAILURE`) skips the smaller-catalog retry ladder like an auth failure and gets its own hint rather than an API-key one.

### Project auto-assignment and the connection graph

`lib/orbit/classify.ts` scores a task's title and completion criterion against each project's vocabulary: manual `Project.keywords` (weight 3), the project name and its tokens (2.5/2), and words recurring in the project's own tasks and notes (0.8). Matching runs on whitespace-free NFKC strings; a term counts when it is contained in the text (score `len² × weight`) and otherwise contributes a discounted longest-common-substring hit of two or more characters. A suggestion is `high` confidence when a manual keyword or a term of three or more characters matched. `autoAssignments` proposes moves only for undone tasks whose current project has no comparable hold. The task form applies a high-confidence suggestion while the title is typed until the user picks a project by hand; the coach shows lower-confidence hints; the tasks screen reviews bulk moves and applies them through the `task.assign` action (up to 200 per command, 20 per agent card), which also relabels the task's focus blocks.

`lib/orbit/graph.ts` builds the connection graph (projects as hubs; tasks, notes, goals, dependency edges and project ↔ keyword ↔ task chains from `keywordLinks`) and lays it out with a deterministic force simulation (repulsion, springs by edge kind, centering, 320 cooled steps). `components/orbit/graph/graph-view.tsx` renders it as pannable, zoomable SVG with search highlighting and neighbour focus; nodes open the matching detail sheet.


### Parallel Hermes conversations

Migration `0011` replaces owner-wide running-turn uniqueness with `(owner_id, conversation_id)` uniqueness. Existing jobs, run IDs and transcript history are preserved. Each thread retains a distinct Hermes session key and each turn retains its own submission idempotency key, lease and cancellation flag. The API returns all `activeRuns` plus the selected thread's `activeRun`; the UI reconciles every active thread with up to four concurrent status requests. Switching conversations does not disable another thread's composer. Per-date strategy generation uses a dedicated deterministic conversation, separate from ordinary chat.

The owner-wide approval lock and workspace revision checks remain: parallel analysis never authorizes concurrent destructive overwrites. Native Hermes HTTP 429 responses remain queued locally with 5–60 second backoff and unchanged idempotency keys; one saturated request does not block other threads. The setup helper configures `gateway.api_server.max_concurrent_runs` (default 10, configurable using `--max-concurrent-runs`). Updating Orbit does not remotely modify an already running Mac gateway. Its actual capacity and model-provider limits still apply. See https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server#concurrent-run-cap.


### Approval and connection recovery

Approval cards persist an action hash and semantic fingerprints for the records they depend on. Unrelated workspace revisions can advance without invalidating a card. Every local approval rechecks its dependencies, then uses the existing workspace CAS and immutable operation receipt; a concurrent write is retried against a fresh snapshot. Changed targets and legacy stale cards queue a new analysis in the same conversation. The full old proposal remains server-side review context. Replacement cards require fresh approval, and publication/retirement is gated atomically by the old card's refresh generation and pending state. Dates, note revisions, project-name resolution and sequential card prerequisites participate in revalidation.

The chat client pins the account for an entire delivery operation and preserves the exact message UUID, conversation and attachments. Lost acknowledgements use owner-scoped exact receipts, independent of paged history. Only confirmed absence permits one identical ordinary submission. Existing failed receipts are replayed unless the user explicitly requests a failed-turn retry. Turn creation and queued work are committed together; retries CAS the prior failed lease. Read/poll transport failures have bounded retries and backoff; approval writes are reconciled through exact state/detail receipts. Authentication or inconclusive reconciliation pauses automatic submission while preserving the pending identity and editable draft. Online/visibility recovery shares the send lock and cancels on conversation changes.
