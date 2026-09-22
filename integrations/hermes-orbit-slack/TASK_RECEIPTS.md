# Google Tasks receipt recovery — t_44ee3a1f

This repair extends the existing note-only backend with a bounded Google Tasks result receipt. It does not create, update, complete, delete or duplicate a Google task. It does not silently create an ORBIT task or choose a project. A receipt is not an ORBIT task-board import. Ambiguous future project registration still needs canonical requester confirmation.

## Runtime contract

`orbit_slack_directive_sync` accepts:

```json
{"provider_status":"succeeded","change":{"kind":"task","provider":"google_tasks","text":"Exact existing title","due":"2026-09-30","providerTaskListId":"actual Google API list id","providerTaskId":"actual Google API task id"}}
```

Do not supply a project or alternatives for this receipt-only operation. The plugin obtains the Slack workspace, user, channel, exact message and aliases from the trusted gateway context and durable ledger; it accepts no caller-origin override. It fetches the exact Google object using the current profile's explicitly configured `ORBIT_SLACK_GOOGLE_TOKEN_FILE` (absolute path to existing Google authorized-user credentials, with Tasks read access). An active secret scope cannot borrow an ambient file. Google OAuth refresh is in memory and the task API is GET-only. Runtime needs the installed `google-auth` and `requests` libraries. Do not print tokens or provider notes.

The fetched ID/title/due/status/deleted/hidden state must match. ETag, provider link and notes digest are generated from that GET, not from the model. Raw notes/account numbers are not transferred. `failed` attempts persist the failure category only without a Google GET or creating a target; they never return overall success.

ORBIT transport retains the pinned HTTPS origin, scoped application key and separate existing `OAI-Sites-Authorization` gate. Task binding is `orbit-slack-task-receipt-v1` and is scoped to the credential's owner/workspace/requester. POST is an authenticated receipt insert only. GET by receipt or immutable operation key reads its stored snapshot, explicitly `receiptOnly:true`; it is not represented as a live Google query. Successful plugin output is `receipt_only:true, provider_mutated:false`. Actual Google readback runs again on task retries before completion; payload/ETag changes fail closed rather than silently rewriting history.

## Recovery invariants

1. Read the authorized exact Slack source from the ledger and verify the original message/bot receipt via Slack GET. Never use latest-thread lookup or ask the user to manufacture IDs.
2. GET the already-existing provider task and verify title, due date, status and link. Do not call insert/update as recovery. A Google UI link ID may differ from its API ID; use the actual GET result.
3. After reviewed source, current-main PR/CI, authorization and the configured serialized release, install only the reviewed runtime overlay/plugin. Retain all unrelated dirty files and scoped settings. Current runtime candidate is `52e1e00805ca19ede14877e7de3a621d3861e95e`, not proof of live installation.
4. Use the original durable correlation/operation identity. Persist the wire before sending. A lost POST acknowledgement is reconciled by GET only. Do not clear requests, generate a new source or re-POST an uncertain row.
5. Verify ORBIT receipt ID, source, binding, result snapshot and provider result. Check normal replay creates one receipt. Report separately: provider existed, receipt persisted, runtime deployed.

A model-facing historical-origin override is intentionally not exposed. The approved operator recovery must bind only the verified exact ledger row, verify it against Slack, and invoke the same handler in that bounded context; never alter the live ledger to fabricate an inbound event.

## Test evidence

`tests/slack-task-receipts.test.mjs` was RED (HTTP422) on the note-only server before implementation. `tests/test_task_backend.py` was RED on unsupported provider-result fields before implementation, and its failed-attempt regression was RED before failure receipt support. Tests use actual SDK discovery, gateway ledger and TS/SQLite; only Google responses are fixtures. `slack-task-receipts-http.test.mjs` exercises the built Worker route with all provider fetches forbidden. Existing dual-auth queue/SDK/TLS tests remain mandatory. Separate operator-only evidence exercises the actual candidate Google GET against the existing authorized item; no live provider or ORBIT writes are implied by local fixtures.

## Rollout and rollback boundary

Current scope includes repair and requested rollout, but deployment still requires the governing approval gate and normal coordinated release; a local test or GitHub PR is not deployment. Never send Slack/email from this recovery. Preserve production receipt/ledger state on code rollback. Restore only this plugin/runtime overlay's backed-up preimages and scoped settings; do not reset the shared gateway checkout or delete receipt data. Backend has no new schema migration in this repair. The inherited current-main credential seed migration chooses the latest workspace: before any production use, independently verify the existing credential's owner against canonical identity rather than treating that seed as an identity proof.
