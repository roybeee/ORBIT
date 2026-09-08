# Sound station in Orbit

The user-supplied ORBIT Sound 2.0 portable app is retained in `vendor/orbit-sound/portable.html` with its original license notices and SHA-256. `scripts/port-sound.mjs` checks that fingerprint, applies guarded single-occurrence integration seams, syntax-checks the resulting script, and emits the self-contained static document. A change to the upstream package requires reviewing the seams and fingerprint. The original 24 scene definitions, embedded images, synthesis engine, mixer, timer, fade, binaural controls, recommendations and evaluation UI remain intact.

## Workspace integration

- Workspace menu and headphone shortcut open `#sound`.
- Focus-session **집중 사운드** passes task title and planned minutes, without changing the task or starting sound automatically.
- The iframe loads on first use and remains mounted while navigating other workspace pages. A compact player exposes status, remaining playback time, pause/resume and volume.
- A browser reload restores the server checkpoint paused. The first play after reload is performed inside the sound document to satisfy browser audio activation rules. Mobile screen locks, calls, browser shutdown and OS suspension may interrupt playback; the app does not claim native background-audio guarantees.
- Timer completion asks for feedback; it never completes the linked Orbit task automatically.

## Storage and isolation

The sandbox permits scripts and JSON import/export, but omits same-origin access. The original network-denying CSP remains intact. A narrow source-checked postMessage channel relays storage actions through the authenticated parent to `/api/sound`. The parent uses same-origin requests; the frame receives no OAuth credentials or workspace records. Playback messages contain no goal/history content.

`orbit_sound_state` stores a separate owner-scoped aggregate. Prepared D1 statements and bounded compare-and-swap retries merge concurrent actions without overwriting the task workspace. A second new active session cannot replace an unfinished session. Checkpoints are monotonic; retried finish/routine actions are idempotent. No client-local records are authoritative. The demo explicitly uses ephemeral state.

The bundled backup/import format stays compatible. Import validates and merges by ID and refuses while a session is active. A previous downloaded HTML file or separate sound website is a different storage origin: export its JSON and use **백업 불러오기** to migrate. The original file and its records are not accessed automatically.

## Validation

`tests/sound.test.mjs` covers actual migrated SQLite storage, owner isolation, concurrent updates, duplicate completion, backup merge, sandbox message source checks, save failures and playback control hooks without autoplay. Build also syntax-checks the patched bundled script. Real-device listening and lock-screen playback are separate from these checks.
