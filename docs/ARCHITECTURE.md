# Architecture and implementation boundary

## Current v0.1

- `app/page.tsx`: Korean interactive prototype, eight hash-addressed views. State is in React memory and resets on reload.
- `app/globals.css`: shared tokens, desktop workspace and mobile bottom navigation, reduced-motion styles.
- `lib/orbit/model.ts`: typed domain entities.
- `lib/orbit/seed.ts`: explicitly synthetic demonstration data; not imported meeting notes.
- `lib/orbit/planner.ts`: pure scheduling and approval rules, independent of React and hosting.
- `tests/planner.test.mjs`: eight substantive scheduling/approval tests.
- `tests/rendered-html.test.mjs`: Worker SSR response, Korean workspace and honest prototype status.

No production data API, LLM call, persistent record storage, connector, service worker, push subscription or scheduler is active. The inherited database schema and auth helper are scaffolding only; `.openai/hosting.json` keeps D1 and R2 disabled.

## v0.2 boundary

Extract UI views and reusable form/list components as backend work begins. Avoid putting database or LLM calls inside view components. Introduce server modules for authenticated repositories and domain services, then replace the in-memory state adapter. Keep identifiers and source links stable.

Ownership must be verified server-side for every entity and reference. Scheduled jobs must carry an explicit owner and use a transactional outbox. Approval must atomically create a uniquely linked internal calendar event, record a decision and audit event. Use an idempotency key plus entity version checks, not a disabled button as the correctness mechanism.

Production schema and API proposals are documented in `Orbit_Design_v0.1.ko.md`. They are not active migrations and should be reviewed with the chosen identity model before implementation. Preserve source documents and revisions separately from extracted candidates and accepted records.

## Portability

The prototype uses the provided React/Vinext/Worker toolchain. Preserve pinned dependencies and the lockfile. The application domain must not depend on the hosting API. Database, object storage, LLM and calendar clients belong behind server adapters.

Do not commit source credentials, real user records, runtime database files or private documents. Sites source control and the requested GitHub remote are separate; a Sites push is not a GitHub push.
