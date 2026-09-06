# Architecture and implementation boundary

## v0.2: authenticated personal workspace

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

This is a deliberate interim storage shape, not the final long-term knowledge architecture. Each owner aggregate is bounded to 950,000 UTF-8 bytes; a meeting note is capped at 100,000 characters. All queries and receipt keys include the authenticated owner. No client-supplied owner identifier is accepted. New users start with no fabricated records.

Before bulk ingestion or a growing personal knowledge base, migrate note bodies/revisions to individual owner-scoped records with paged metadata queries and on-demand body retrieval. Preserve IDs, links and existing data through an append-only migration/backfill sequence. Only then add broad AI ingestion. Do not silently truncate notes or replace the database with device-local storage when limits are reached.

## Auth and authorization

Private Sites dispatch controls who may reach this Site. Server routes additionally require both `oai-authenticated-user-id` and email and isolate every workspace by the stable ID. SIWC identifies a user; Site access policy controls the allowed audience. Do not turn the Site public to make API testing easier. Do not implement or replace platform sign-in/callback routes.

## Tests

- Planner: fixed schedules, gaps, capacity, dependencies, approval idempotency and stale checks.
- Storage: actual generated SQL on a local SQLite D1-shaped adapter; owner separation, reloads, stale writes, concurrent commands, replay, atomic approval and hold dates.
- Built Worker HTTP: auth redirects, Korean root without demo data, isolated demo, anonymous API rejection, origin checks and persisted owner data.
- The smoke loader supplies only the Cloudflare environment binding in Node. It is test-only and does not affect runtime identity checks or deployment code.

These tests are local; they do not claim live browser, device or cloud D1 end-to-end coverage.

## Not yet active

No LLM, external calendar/Notion adapter, scheduler, push subscription, attachments, semantic search, wiki revision UI, restore/import or actual elapsed-time tracking. R2 remains disabled. Dates and work preferences are live; the demo intentionally keeps September 6–7, 2026 examples.
