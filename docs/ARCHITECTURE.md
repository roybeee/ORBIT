# Architecture and implementation boundary

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

Scheduler, push subscription, Notion adapter, attachments, semantic search, backup import and actual elapsed-time tracking remain unimplemented. Responses API, Plaud MCP and Google Calendar integration are implemented in v0.4 and require app-side provider configuration/authorization. R2 remains disabled. Dates and work preferences are live; the demo intentionally keeps September 6–7, 2026 examples.

## v0.4 agent and integrations

`lib/orbit/agent` contains the bounded Responses tool loop, owner-scoped conversation/proposal repository, user decision executor, encrypted connections, OAuth/PKCE and Google busy-period adapter. `/api/agent` separates chat from explicit user decisions. The LLM receives read-only MCP tools and a `propose_change` function which only stages cards. Failed turns publish no partial cards. Internal approvals reuse workspace CAS and mutation receipts; related pending cards advance revisions only after their own prerequisite commit.

Migrations `0002` and `0003` add conversations, decisions, encrypted connection records, one-use OAuth states, an external calendar cache and in-flight uniqueness/refresh leases. External calendar records are overlaid for reads and stripped from the aggregate on writes; changes to cached busy time advance the workspace revision. Google event creation uses a deterministic action-derived event ID and verifies its ownership marker on retries. Provider credentials are never persisted in client storage, source control or API status responses.

See [agent operations and setup](Orbit_Agent.ko.md) for the exact credentials, scopes, data window and known limits. Existing explicit-marker extraction remains available independently of AI.
