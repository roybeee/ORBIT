# Scoped credential operator procedure (unreleased)

This is an approved-release procedure, **not authorization to execute it now**. Approval `C0C05PW95JL:1790046857.814999` remains BLOCK. No production credential, environment, deployment or local live Hermes configuration was changed by this work.

## Prerequisites / three separate authorities

1. Merge the exact reviewed ORBIT candidate through GitHub `Validate Orbit`, then use the approved Sites release procedure and verify deployed source/tree. Local tests are not GitHub CI. Check concurrent deployment/environment work before proceeding.
2. Obtain an **already verified, unconflicted canonical identity**: exact `ownerId` and its normalized-email SHA-256 `emailHash`, from the existing authenticated ORBIT identity-link workflow and independently verified account evidence. A Slack user ID, Sites project owner, bypass token or caller-supplied identity header is NOT this owner. Never invent an owner or create an identity row to make provisioning pass. If verified binding evidence is unavailable, STOP; this route intentionally does not bootstrap identities. No direct SQL access is assumed or required by this procedure. The route checks the existing binding and fences insertion at commit time.
3. Confirm the intended Slack workspace/requester pair independently. The original request is workspace `T0B2WRN9MHA`, requester `U0B2R5WL206`; these are not canonical ORBIT owner IDs.
4. Obtain existing private Sites gate access through the authorized operator mechanism. This is only transport access. A separate short-lived operator secret authorizes this one pinned provisioning manifest. Neither gate nor operator secret authorizes directive writes; the new app key does.

## Prepare offline (never in Git, chat, shell arguments or logs)

Use a trusted terminal, no tracing/session capture. Generate two independent secrets with `secrets.token_hex(32)` in a password manager/offline tool: one operator secret and one application key. Store them in the approved secret store, not this repository. Hash their exact ASCII values with SHA-256. The server stores only hashes. Do not reuse the Sites token, Slack bot token, operator secret or any old application key.

Prepare this exact JSON manifest privately (all values must be verified; placeholder text is not executable identity data):

```json
{
  "action": "create",
  "tokenHash": "<SHA-256 of new application key, 64 lowercase hex>",
  "ownerId": "<verified existing canonical owner ID>",
  "emailHash": "<verified canonical normalized-email SHA-256>",
  "workspaceId": "T0B2WRN9MHA",
  "requesterId": "U0B2R5WL206",
  "expiresAt": 0
}
```

Set `expiresAt` to an explicit UTC epoch **milliseconds** future deadline, at most 30 days from execution (prefer a short operational window). No raw secret may enter this JSON. Hashes and account metadata should still be treated as sensitive. Keep the immutable manifest for uncertain-response reconciliation. The operator enablement window is controlled separately below; it does not automatically expire at the application deadline.

## Enable only through approved Sites environment/deployment controls

Use the supported Sites `update_environment_variables` operation for the exact project ID read from `.openai/hosting.json`. Discover its **current tool schema** before calling it; do not guess argument names or replace unrelated variables. Set only:

- `ORBIT_SLACK_PROVISION_AUTH_HASH`: SHA-256 of the operator secret (not the secret).
- `ORBIT_SLACK_PROVISION_MANIFEST`: serialized exact JSON above.

Use the approved environment activation/deployment flow and verify the exact deployed revision and environment status. These variables are server-only: never `NEXT_PUBLIC_*`, Vite public defines or client assets. Environment access is an administrative capability, not a model/tool-call input. Do not send raw secrets to the Sites environment tool. No SQL console, shell on the Worker, or undocumented database credential is necessary.

## Execute exact GET / POST {} / GET, with pinned TLS and no redirects

The following Python 3 snippet is executable **only after the above approvals and activation**. It prompts invisibly for credentials, never prints response bodies/headers or secrets, uses system CA validation, bypasses ambient proxies, rejects redirects and only talks to the manually verified HTTPS origin. Do not substitute an arbitrary URL from an error response. Never use `curl -v`, `-k`, `-L`, query-string credentials or browser-storage credentials.

```python
import getpass, json, re, urllib.request, urllib.parse, urllib.error
origin = input('Exact approved deployed HTTPS origin (no path): ').strip()
p = urllib.parse.urlsplit(origin)
assert p.scheme == 'https' and p.hostname and not p.username and not p.password
assert p.path == '' and not p.query and not p.fragment
assert origin == 'https://' + p.netloc
operator = getpass.getpass('One-operation operator secret: ')
gate = getpass.getpass('Existing Sites gate token (without Bearer): ')
assert re.fullmatch('[0-9a-f]{64}', operator)
assert gate and '\r' not in gate and '\n' not in gate
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None
client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
url = origin + '/api/integrations/slack/credentials'
def call(method):
    req = urllib.request.Request(url, method=method,
        data=b'{}' if method == 'POST' else None,
        headers={'Authorization': 'Bearer ' + operator,
                 'OAI-Sites-Authorization': 'Bearer ' + gate,
                 'Content-Type': 'application/json'})
    try:
        with client.open(req, timeout=20) as response:
            assert response.status == 200 and response.geturl() == url
            assert response.headers.get_content_type() == 'application/json'
            value = json.loads(response.read(4096))
            assert value.get('state') in ('absent','active','expired','revoked')
            assert type(value.get('matches')) is bool
            print(method, value['state'], 'matches=' + str(value['matches']))
            return value
    except urllib.error.HTTPError as error:
        raise SystemExit('Stopped: HTTP ' + str(error.code)) from None
    except Exception:
        raise SystemExit('Stopped: transport/response failure; reconcile GET before retry') from None
before = call('GET')
if input('Execute the independently approved pinned manifest? type APPLY: ') == 'APPLY':
    call('POST')
    after = call('GET')
    assert after['matches'] is True
```

For create/rotate expect `active, matches=true`; for revoke expect `revoked, matches=true`. GET is read-only for this credentials route. Do not interpret a generic 200/403 or site page as success. On lost POST acknowledgement, first run GET with **the same pinned manifest** and verify state/matches; if unresolved, a repeat POST `{}` of that same manifest is idempotent. Do not generate another key or change principal/expiry to hide uncertainty. A 409 requires reconciliation; never reset the database or resurrect a revoked key. GET `matches=false` or unexpected state blocks success.

## Rotate, revoke, disable

- Rotation: generate a fresh app key, set `action=rotate`, its `tokenHash`, and `previousTokenHash` equal to the old app-key digest. Preserve owner/workspace/requester/email binding; explicitly choose new expiry. Through the same approved environment/deployment path stage a fresh operator secret hash and exact manifest. POST atomically inserts the successor and revokes the matching active predecessor. GET verifies successor. Repeating the exact rotation is safe after lost ACK. No overlap period is promised.
- Revocation: stage `action=revoke` with the exact existing token hash, principal and expiry; omit `previousTokenHash`. POST then GET must return revoked/matches. Receipts are retained. Revoked keys cannot be reactivated by create/rotate replay. Expired app keys fail directive auth even if still stored.
- Immediately after maintenance, remove/disable both provisioning variables through supported Sites environment controls and the approved activation/deployment path. Verify an operator GET now returns 401 (without logging headers). An empty auth hash disables the route; removing both is preferred. Destroy the temporary operator secret after reconciliation. If disablement fails, treat it as an open administrative exposure and escalate; don't report maintenance complete.

## Future authorized Hermes installation (not performed here)

Only after release approval, set the intended profile's secret settings, not shared ambient environment or another profile:

- `ORBIT_SLACK_DIRECTIVE_URL = <approved HTTPS origin>/api/integrations/slack/directives`
- `ORBIT_SLACK_APPROVED_ORIGIN = <exact same HTTPS origin>`
- `ORBIT_SLACK_INGEST_KEY = <new raw application key>`
- `ORBIT_SLACK_SITES_BEARER = <existing raw Sites gate token>`
- `SLACK_BOT_TOKEN = <separately authorized approval-readback token>`

Use the installed Hermes version's documented secret/profile tooling. Never install the operator secret or manifest in Hermes. Missing active-scope settings must fail, not borrow another profile or process credentials. Generic Slack calls must not receive the Sites gate. No redirects, insecure TLS, foreign origins or provider-side credential forwarding are allowed. Preserve pending/uncertain local ledger state through rotations and rollback. Actual production readback/approval and approved runtime restart remain separate release checks.

## Local evidence boundary

`tests/slack-provisioning-http.test.mjs` exercises the actual built Worker routes and real SQLite, including credential-to-directives authentication, disabled/wrong auth, forged headers, missing/conflicted identity, pinned manifest/body rejection, lost-ACK GET/replay, rotation/revoke and no resurrection. The Cloudflare binding is a local loader and identities are explicit test fixtures. It does not prove the live private Sites gate or a production identity binding. The separate gated HTTPS plugin tests prove local dual-header transport and no redirect leaks with real SDK dispatch; Slack readback is a fixture. No live rollout is implied.
