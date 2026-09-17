# Remaining mission implementation and verification — 2026-09-17

## Implemented in Orbit

- Automatic preparation of normal/recovery scheduling alternatives, preserving approved/deferred blocks and all real calendar events. Server time floors, dependency/hold/blocker checks, stale preview rejection and explicit application/approval.
- Gmail source metadata and delegation replies matched by exact sender, thread and registration time; outbound and ambiguous mail never marks work complete. Recent-mail refresh while catching up older pages.
- ODA collector with explicit metric/store/field/month mapping, scoped encrypted connection, finalized snapshot contract, fixed origin, bounded round-robin scheduling, deduplication and immutable corrections. Each mapping currently targets one explicitly selected settlement month. Failed sources do not block later mappings.
- Settings ZIP export, preview and atomic restore: preferences/domino, memories, care, chief, proposal history, sound, selected calendars, runtime and external-coaching settings. Approval/timer/lease/token state is not reactivated. Independent sound/settings CAS and workspace revision guard all writes. Current Google access is checked before calendar selection restoration. Prior calendar cache is invalidated.
- Concurrent chat recovery improvements merged from the source branch.

## Verification evidence

- Orbit full regression suite: 327 passed, zero failed before final selected-metric UI refinement; final build/typecheck gate rerun for that refinement.
- New domain/DB tests cover future placement, midnight, fixed events, drafts, blockers, exact mail identity, restore collision/owner/replay/active-run protection, missing/draft metrics, full-month validation and corrections.
- ODA `npm run test:ci` and `npm run build:oda` passed. Targeted automation suite: 19 passed, including frozen totals, restricted field access, absent months and missing finalization snapshot.

## External completion gates

- ODA API source is implemented and tested against release base `540f206a64c6eadb89d0bc9f2d19486f8f96ba5a`; exact patch is in `docs/integrations/oda-settlement-metrics.patch`. GitHub app write denied with 403 `Resource not accessible by integration`. No remaining authorized credential helper/environment token or browser GitHub session was available. Consequently ODA API changes have NOT been pushed or deployed; do not claim real ODA collection is active.
- Managed preview started at the documented address, but cloud browser navigation returned `net::ERR_BLOCKED_BY_CLIENT`. No browser click verification is claimed.
- This runtime does not expose the user's Windows microphone/ASIDE process. Live D1 has an ASIDE job in `needs_attention`, not a verified successful run. No new real-PC voice or ASIDE completion is claimed.
- Gmail collection requires an existing read connection and explicit delegation sender/thread mapping. ODA collection requires the API deployment, connected token and explicit metric mapping.

No new paid services, schedules or outbound messages were created. Existing daily cost reporting and Render scheduling were left intact.
