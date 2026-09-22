# Trusted Slack directive receipt candidate — t_44ee3a1f

**Independent QA artifact; NOT production-ready. Do not install/deploy this candidate.**

Recovered the prior owner's uncommitted implementation in the same task worktree. Original base: `9be7744990f1dbd530f03c97f95e456ed9358614`. Fetched and verified GitHub `origin/main` against `ls-remote`, then fast-forwarded the worktree without discarding the integration to `d26db5c4b1b4a35f9da0748f886a6c86eaa850f0`.

## Implemented and exercised locally

- Tool identity is optional to the model and is resolved from bound gateway ContextVars plus the profile-scoped Slack event ledger. Environment-variable fallback is not trusted.
- Runtime workspace, requester, channel, thread **and message timestamp** must match the ledger. Supplied source aliases cannot override it. The recovery added a failing regression and fixed the missing message timestamp check.
- Bounded change payloads and proposal alternatives survive module reload in SQLite. Provider exception text is not persisted; a fixed failure category is stored.
- Ambiguous candidate proposals do not POST until an exact approval command is read back from the requester in the original thread. Copied, bot-authored, edited, wrong-owner and wrong-route approvals fail closed. Recovery also fixed approval of a root message in its reply thread, with a RED→GREEN regression.
- The selected proposal and original source are retained. Successful local replay returns the persisted receipt without another POST. A failed GET can retry GET without repeating POST. Failed provider status never yields overall success.
- Source/change/project/target/receipt readback tampering fails verification.
- Missing source is stored as `pending_source`, with no network transmission. Unknown POST outcome is `uncertain`, never automatically re-POSTed.

## Real local demo, explicit fixture boundary

`demo.py` imports the actual plugin and actual Hermes ledger/session-context implementation. It uses a temporary HERMES_HOME and real SQLite files, reloads the plugin, runs a loopback HTTP server, executes the actual HTTP client, approval reader, receipt POST and target GET, and asserts exactly one POST across the successful replay scenario.

**Slack and ORBIT responses are synthetic fixtures, not the production backend, and no real provider is changed.** Only the HTTP destination is redirected in the harness. All synthetic identities are labelled test data; they are not the requester’s channel/message identity. Demonstrated output:

- `pending_before_approval: needs_confirmation`
- `restart_resume: completed`, `replay: completed`
- `durable_request_rows: 1`, `receipt_posts: 1`, `origin_preserved: true`
- `production_verified: false`

This proves the component path, not end-to-end production integration or general exactly-once delivery.

## Contract validation: BLOCKED

Read-only authenticated GET to the configured `/api/integrations/slack/directives?id=contract-probe-nonexistent-t_44ee3a1f` returned **HTTP 403**, `text/plain; charset=UTF-8`, not JSON. No credentials, response bodies or actual records were printed. Redirect following is disabled. A 403 is an access-layer observation: it does **not** establish whether the production route exists behind that layer.

The freshly verified canonical source has **no** `app/api/integrations/slack/directives/route.ts` or implementation of this contract. The historical integration was not imported wholesale. Live plugin/source was not changed. Consequently, the following candidate assumptions are unverified:

1. `POST endpoint` accepts `{source, providerStatus, providerError, change, project?}` and returns a stable `{id}`. `source` includes platform, channelId, workspaceId, requesterId, messageTs, and available eventId/clientMsgId/threadId.
2. `GET endpoint?id=...` returns that exact `id`, source, change and providerStatus. A completed result supplies canonical `project.id` and the actual task/note target: id, type and entity with matching projectId and requested values.
3. A failed provider receipt reads back as `provider_failed`. Ambiguity reads back as `needs_confirmation` with bounded canonical project-ID candidates.
4. Server authorization maps integration credentials + Slack identity to the correct tenant/owner. Backend receipt/target updates and alias handling must be atomic and idempotent. None of these server guarantees are supplied by this artifact.

## Missing acceptance / release blockers

- **Production/backend contract and authenticated real receipt/target readback:** unavailable (403; canonical implementation absent). Requires an agreed current-main API, tenant authorization, append-only persistence migration and independent server integration tests. No production POST was attempted.
- **Exactly-once recovery after an uncertain POST:** deliberately fail-closed, not automatic recovery. Needs backend idempotency/reconciliation by durable source identity. A local lock alone cannot prove distributed exactly-once behavior.
- **Pending-source promotion:** an unbound durable request cannot yet be safely attached to a later trusted origin. It remains pending, and the current message suggests a fresh request. That does NOT satisfy no-duplicate same-request resume; a safe origin-binding protocol is still required.
- **Automatic project/type/location ambiguity detection before provider writes:** caller-supplied alternatives are supported, but this is a post-attempt receipt tool. It does not intercept provider writes, infer all ambiguities, or provide a preflight/approval orchestration hook. Model-supplied provider status is not independently provider-verified here.
- **Knowledge-base destination:** explicit `destination_blocked`; no knowledge-base write adapter. Do not claim that choice was saved.
- **Slack production approval readback:** scopes/token access and gateway dispatch of approval messages are not verified against a real Slack event. No real channel/message IDs were supplied in this task; none were invented.
- **Alias collision/incremental-alias completeness:** local sequence tests exercise the actual installed ledger with a stable message timestamp. They do not prove the upstream ledger attaches every new alias or detects all contradictory alias combinations. Plugin does not modify that ledger.
- Further QA should examine concurrent approval/readback recovery, retention and cancellation, connection lifetime, and backend-generated empty/invalid proposals before promotion.

## Independent verifier commands

From this task's checkout (or a clean checkout of its commit):

```bash
cd /home/hermes/parallel-projects/orbit/.worktrees/t_44ee3a1f
export PYTHONPATH=/home/hermes/.hermes/hermes-agent
uv run --with pytest --python /home/hermes/.hermes/hermes-agent/venv/bin/python \
  python -m pytest integrations/hermes-orbit-slack/tests -q
uv run --with pytest --python /home/hermes/.hermes/hermes-agent/venv/bin/python \
  python integrations/hermes-orbit-slack/demo.py
npm run install:ci
npm run typecheck
npm test
```

The tested Hermes dependency HEAD is `4db2300592d902a9cb6b7f7f15ae08b8ea25f361`; it must expose `gateway.slack_event_ledger` and `gateway.session_context`. Tests/demo use temporary profile state and do not touch the live plugin. `pytest` is explicitly supplied by `uv`; it is not assumed installed globally.

Optional authorized **read-only** production re-probe with the existing environment configuration:

```bash
python3 integrations/hermes-orbit-slack/contract_probe.py
```

The probe always exits 2 because reading an intentionally nonexistent ID cannot establish full contract compatibility. It reports metadata only. Do not treat a later 200 or 404 alone as release approval. Do not copy credentials into reports or git.

## Verification obtained

- Plugin tests: **33 passed** after the recovery fixes.
- Local loopback component demo: passed all assertions.
- `npm run install:ci`: passed (initial typecheck/test attempt lacked installed dependencies; corrected by canonical installer).
- `npm run typecheck`: exit 0.
- `npm test`: exit 0, including verified build and cold/warm Python-less setup checks. Full local logs: `/tmp/t_44ee3a1f-typecheck.log`, `/tmp/t_44ee3a1f-npm-test.log`, `/tmp/t_44ee3a1f-install.log`.
- Read-only remote contract probe: exit 2 / HTTP 403 / unverified.

## Rollback and scope

Nothing was deployed, restarted, pushed or merged; no Kanban/profile/live-plugin changes were made. Only this task branch's integration files were added. To discard this candidate in a downstream branch, revert its integration commit; do not reset shared main. There is no production data rollback to perform. If this is ever installed after completing the blockers, preserve its durable pending/uncertain database through rollback so earlier requests cannot be silently reissued.
