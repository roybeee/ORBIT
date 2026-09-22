# Automatic meeting review and notifications

Validated against GitHub main `d26db5c4b1b4a35f9da0748f886a6c86eaa850f0`.

- Plaud import (including text whose Plaud summary is still pending) durably queues review. Unchanged imports repair missing queue rows. The scheduled runtime starts and drives reviews without opening a note; old failed extractor jobs are upgraded once.
- A Plaud text summary is shown immediately. Image-only links remain a visible source-waiting state until text arrives. Final summaries use meeting information, topics, future plans, next steps, and AI suggestions/questions.
- A dedicated meeting contract and bounded automatic response repairs replace the generic conversation action contract. Summaries survive proposal validation failures. No domain changes occur before owner approval.
- Undated task/project drafts are blocked on the server until the owner selects a due date. Editing a proposed project's due date updates only its dependent proposal guards; source/target changes still invalidate approval.
- Notifications persist by owner in D1. Completion, approval requests, execution failures, successful approvals, failed applications and completed tasks are reported. Stable event IDs deduplicate polling/restarts.
- Optional Web Push uses per-owner VAPID keys, encrypted aes128gcm payloads, an endpoint allowlist, delivery leases, retry backoff and expired subscription removal. Lock-screen payloads do not expose meeting contents. The user must enable notifications separately on each device. No browser permission is requested automatically.

Verification: automatic import-to-proposal tests with malformed model responses, recovery of missed records, image-only source handling, missing-date approval gate, dependent project approval, source-change protection, independent Node crypto decryption/VAPID verification, notification owner isolation/deduplication/read state and push retry/expiry. Browser fixture tested the actual meeting-review and notification components (date entry, approval, read-all). The fixture route was removed before release.

`meeting-approval.jpg` is a browser QA capture with synthetic data, not the owner's live records. Production device delivery requires the user's one-time browser/OS permission and is not implied by the fixture.
