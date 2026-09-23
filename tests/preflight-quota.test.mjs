import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  accountRelation,
  codexAccountId,
  evaluatePreflight,
  hermesAccountId,
  hermesQuotaFindings,
} from '../scripts/parallel/preflight-quota.mjs';

const script = fileURLToPath(new URL('../scripts/parallel/preflight-quota.mjs', import.meta.url));
const NOW = Date.parse('2026-09-23T12:00:00Z');
const FAKE_ACCOUNT = 'acct-fake-0000-shared';
const FAKE_TOKEN = 'fake-access-token-must-never-print';

function hermesAuth({account = FAKE_ACCOUNT, pool = [], lastAuthError} = {}) {
  return {
    providers: {
      'openai-codex': {
        tokens: {account_id: account, access_token: FAKE_TOKEN, refresh_token: `${FAKE_TOKEN}-refresh`},
        ...(lastAuthError ? {last_auth_error: lastAuthError} : {}),
      },
    },
    credential_pool: {'openai-codex': pool},
  };
}

function codexAuth({account = FAKE_ACCOUNT} = {}) {
  return {OPENAI_API_KEY: null, tokens: {account_id: account, access_token: FAKE_TOKEN, id_token: `${FAKE_TOKEN}-id`}};
}

function fixtureDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-preflight-'));
  const paths = {};
  for (const [name, value] of Object.entries(files)) {
    paths[name] = join(dir, `${name}.json`);
    writeFileSync(paths[name], typeof value === 'string' ? value : JSON.stringify(value));
  }
  return {dir, paths};
}

function runCli(env, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: {...process.env, ORBIT_PREFLIGHT_NOW: new Date(NOW).toISOString(), ...env},
  });
  return {code: result.status, output: `${result.stdout}${result.stderr}`};
}

test('account ids are read from the Hermes provider and the Codex tokens', () => {
  assert.equal(hermesAccountId(hermesAuth()), FAKE_ACCOUNT);
  assert.equal(codexAccountId(codexAuth()), FAKE_ACCOUNT);
  assert.equal(hermesAccountId({}), null);
  assert.equal(codexAccountId({OPENAI_API_KEY: 'sk-fake', tokens: null}), null);
});

test('account relation compares hashes and reports same / different / unknown', () => {
  assert.equal(accountRelation('a', 'a'), 'same account');
  assert.equal(accountRelation('a', 'b'), 'different');
  assert.equal(accountRelation(null, 'b'), 'unknown');
  assert.equal(accountRelation('a', undefined), 'unknown');
});

test('a credential whose quota resets in the future is a blocking finding', () => {
  const findings = hermesQuotaFindings(hermesAuth({pool: [{
    last_status: 'exhausted', last_error_code: 429, last_error_reason: 'quota exhausted',
    last_error_reset_at: '2026-09-27T21:09:21Z',
  }]}), NOW);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].block, true);
  assert.equal(findings[0].resetAt, '2026-09-27T21:09:21.000Z');
});

test('epoch reset times in seconds and milliseconds are both understood', () => {
  const seconds = hermesQuotaFindings(hermesAuth({pool: [{last_error_reset_at: NOW / 1000 + 3600}]}), NOW);
  const millis = hermesQuotaFindings(hermesAuth({pool: [{last_error_reset_at: NOW + 3600_000}]}), NOW);
  assert.equal(seconds[0].resetAt, '2026-09-23T13:00:00.000Z');
  assert.equal(millis[0].resetAt, '2026-09-23T13:00:00.000Z');
});

test('a 429 without any reset time blocks, one whose reset has passed only warns', () => {
  const noReset = hermesQuotaFindings(hermesAuth({pool: [{last_error_code: '429'}]}), NOW);
  const passed = hermesQuotaFindings(hermesAuth({pool: [{last_error_code: 429, last_error_reset_at: '2026-09-20T00:00:00Z'}]}), NOW);
  assert.equal(noReset[0].block, true);
  assert.equal(passed[0].block, false);
});

test('healthy and disabled credentials produce no findings', () => {
  const findings = hermesQuotaFindings(hermesAuth({pool: [
    {last_status: 'ok'},
    {disabled: true, last_error_code: 429, last_error_reset_at: '2026-09-27T00:00:00Z'},
  ]}), NOW);
  assert.deepEqual(findings, []);
});

// relogin_required is a stale Hermes auth record, not a quota state: it must not
// stop a publication (it did, permanently, even with --accept-shared-quota).
test('relogin_required on the provider only warns', () => {
  const findings = hermesQuotaFindings(hermesAuth({lastAuthError: {reason: 'token revoked', relogin_required: true, at: '2026-09-23T10:00:00Z'}}), NOW);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].block, false);
  assert.match(findings[0].message, /relogin/i);
  assert.match(findings[0].message, /hermes auth status openai-codex/);
});

test('relogin_required with different accounts is a warning, not a block', () => {
  const result = evaluatePreflight({
    hermes: hermesAuth({lastAuthError: {reason: 'credential_pool_refresh_failure', relogin_required: true, at: '2026-09-21T04:11:09Z'}}),
    codex: codexAuth({account: 'other'}),
    now: NOW,
  });
  assert.equal(result.status, 'warn');
});

test('relogin_required plus an accepted shared quota passes with warnings', () => {
  const result = evaluatePreflight({
    hermes: hermesAuth({lastAuthError: {reason: 'credential_pool_refresh_failure', relogin_required: true, at: '2026-09-21T04:11:09Z'}}),
    codex: codexAuth(),
    now: NOW,
    acceptSharedQuota: true,
  });
  assert.equal(result.status, 'warn');
});

test('same account blocks unless the shared quota is accepted', () => {
  const blocked = evaluatePreflight({hermes: hermesAuth(), codex: codexAuth(), now: NOW});
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.relation, 'same account');
  const accepted = evaluatePreflight({hermes: hermesAuth(), codex: codexAuth(), now: NOW, acceptSharedQuota: true});
  assert.equal(accepted.status, 'warn');
});

test('different accounts pass, unknown accounts only warn', () => {
  assert.equal(evaluatePreflight({hermes: hermesAuth(), codex: codexAuth({account: 'other'}), now: NOW}).status, 'ok');
  assert.equal(evaluatePreflight({hermes: null, codex: codexAuth(), now: NOW}).status, 'warn');
  assert.equal(evaluatePreflight({hermes: null, codex: null, now: NOW}).status, 'warn');
});

test('accepting the shared quota does not override an exhausted credential', () => {
  const result = evaluatePreflight({
    hermes: hermesAuth({pool: [{last_error_code: 429, last_error_reset_at: '2026-09-27T21:09:21Z'}]}),
    codex: codexAuth(),
    now: NOW,
    acceptSharedQuota: true,
  });
  assert.equal(result.status, 'blocked');
  assert.ok(result.lines.some((line) => line.includes('2026-09-27T21:09:21.000Z')));
});

test('evaluation never exposes account ids or tokens', () => {
  const result = evaluatePreflight({hermes: hermesAuth(), codex: codexAuth(), now: NOW});
  const text = result.lines.join('\n');
  assert.ok(!text.includes(FAKE_ACCOUNT));
  assert.ok(!text.includes(FAKE_TOKEN));
});

test('CLI exits 2 when blocked and 0 when accepted, without printing secrets', () => {
  const {dir, paths} = fixtureDir({hermes: hermesAuth(), codex: codexAuth()});
  try {
    const env = {ORBIT_HERMES_AUTH: paths.hermes, ORBIT_CODEX_AUTH: paths.codex};
    const blocked = runCli(env);
    assert.equal(blocked.code, 2, blocked.output);
    assert.match(blocked.output, /same account/);
    assert.match(blocked.output, /--accept-shared-quota/);
    assert.ok(!blocked.output.includes(FAKE_ACCOUNT));
    assert.ok(!blocked.output.includes(FAKE_TOKEN));
    const accepted = runCli(env, ['--accept-shared-quota']);
    assert.equal(accepted.code, 0, accepted.output);
    assert.match(accepted.output, /WARN/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('CLI treats missing and unreadable auth files as unknown (warn, exit 0)', () => {
  const {dir, paths} = fixtureDir({codex: '{not json'});
  try {
    const result = runCli({ORBIT_HERMES_AUTH: join(dir, 'absent.json'), ORBIT_CODEX_AUTH: paths.codex});
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /unknown/);
    assert.ok(!result.output.includes('{not json'));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('CLI blocks with the reset time when the Hermes pool is exhausted', () => {
  const {dir, paths} = fixtureDir({
    hermes: hermesAuth({pool: [{last_status: 'exhausted', last_error_code: 429, last_error_reason: 'quota', last_error_reset_at: '2026-09-27T21:09:21Z'}]}),
    codex: codexAuth({account: 'someone-else'}),
  });
  try {
    const result = runCli({ORBIT_HERMES_AUTH: paths.hermes, ORBIT_CODEX_AUTH: paths.codex});
    assert.equal(result.code, 2, result.output);
    assert.match(result.output, /2026-09-27T21:09:21\.000Z/);
    assert.match(result.output, /different/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('CLI exits 0 when only relogin_required is reported', () => {
  const {dir, paths} = fixtureDir({
    hermes: hermesAuth({lastAuthError: {reason: 'credential_pool_refresh_failure', relogin_required: true, at: '2026-09-21T04:11:09Z'}}),
    codex: codexAuth(),
  });
  try {
    const result = runCli({ORBIT_HERMES_AUTH: paths.hermes, ORBIT_CODEX_AUTH: paths.codex}, ['--accept-shared-quota']);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /WARN Hermes openai-codex needs relogin/);
    assert.match(result.output, /preflight: warn/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('CLI rejects unknown arguments', () => {
  const result = runCli({ORBIT_HERMES_AUTH: '/nonexistent/h.json', ORBIT_CODEX_AUTH: '/nonexistent/c.json'}, ['--bogus']);
  assert.equal(result.code, 1);
});
