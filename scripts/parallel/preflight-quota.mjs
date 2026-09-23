#!/usr/bin/env node
// Quota / account preflight for publish-sites.sh.
//
// Hermes (~/.hermes/auth.json) and the Codex CLI (~/.codex/auth.json) can be
// signed into the same OpenAI account. Then every Codex Sites publication spends
// the weekly quota Hermes needs for planning (2026-09-23: Hermes planning failed
// with 429 "retry after 393141s" after a night of publications). This check runs
// before Codex starts and refuses to publish into an exhausted or shared quota.
//
// It never prints account ids or tokens: ids are compared as SHA-256 hashes and
// only "same account" / "different" / "unknown" is reported.
//
// usage: node scripts/parallel/preflight-quota.mjs [--accept-shared-quota]
//   ORBIT_HERMES_AUTH / ORBIT_CODEX_AUTH override the auth file paths.
//   exit 0 = ok or warn, 2 = blocked, 1 = usage error.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const PROVIDER = 'openai-codex';
const QUOTA_PATTERN = /quota|rate.?limit|429|exhaust|usage.?limit/i;

const nonEmptyString = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);

export function hermesAccountId(auth) {
  return nonEmptyString(auth?.providers?.[PROVIDER]?.tokens?.account_id);
}

// Codex CLI stores ChatGPT sign-ins as {tokens: {account_id, ...}}; API-key
// sign-ins have no account id, which is reported as "unknown".
export function codexAccountId(auth) {
  return nonEmptyString(auth?.tokens?.account_id) ?? nonEmptyString(auth?.account_id);
}

const hashOf = (value) => createHash('sha256').update(value).digest('hex');

export function accountRelation(hermesId, codexId) {
  if (!nonEmptyString(hermesId) || !nonEmptyString(codexId)) return 'unknown';
  return hashOf(hermesId) === hashOf(codexId) ? 'same account' : 'different';
}

// Reset times appear as ISO strings or epoch numbers (seconds or milliseconds).
function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toTimestamp(numeric);
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

const isActive = (entry) => entry && entry.disabled !== true && entry.enabled !== false && entry.active !== false;

function looksLikeQuotaError(entry) {
  return [entry.last_error_code, entry.last_error_reason, entry.last_status]
    .some((value) => value != null && QUOTA_PATTERN.test(String(value)));
}

function hoursUntil(timestamp, now) {
  return Math.round(((timestamp - now) / 3_600_000) * 10) / 10;
}

function credentialFinding(entry, index, now) {
  const resetMs = toTimestamp(entry.last_error_reset_at);
  const quota = looksLikeQuotaError(entry);
  if (resetMs == null && !quota) return null;
  const label = `credential #${index + 1}`;
  const detail = [entry.last_status, entry.last_error_code, entry.last_error_reason].filter((v) => v != null && v !== '').join(' / ');
  if (resetMs != null && resetMs > now) {
    const resetAt = new Date(resetMs).toISOString();
    return {
      block: true,
      resetAt,
      message: `Hermes ${label} is rate-limited until ${resetAt} (${hoursUntil(resetMs, now)}h) [${detail || 'reset pending'}] / Hermes 자격 증명 쿼터가 ${resetAt}까지 소진됨`,
    };
  }
  if (resetMs == null) {
    return {
      block: true,
      resetAt: null,
      message: `Hermes ${label} reported a quota error with no reset time [${detail}] / Hermes 쿼터 오류(재설정 시각 없음)`,
    };
  }
  const resetAt = new Date(resetMs).toISOString();
  return {
    block: false,
    resetAt,
    message: `Hermes ${label} last failed with [${detail}] but its reset time ${resetAt} has passed / 재설정 시각이 지났으므로 경고만 표시`,
  };
}

export function hermesQuotaFindings(auth, now = Date.now()) {
  const pool = auth?.credential_pool?.[PROVIDER];
  const entries = Array.isArray(pool) ? pool : [];
  const fromPool = entries
    .map((entry, index) => (isActive(entry) ? credentialFinding(entry, index, now) : null))
    .filter(Boolean);
  // relogin_required is a stored auth record that can outlive a successful
  // relogin (2026-09-21 record while `hermes auth status` said logged in). It
  // says nothing about quota, so it warns instead of blocking the publication.
  const authError = auth?.providers?.[PROVIDER]?.last_auth_error;
  const relogin = authError?.relogin_required === true
    ? [{
      block: false,
      resetAt: null,
      message: `Hermes ${PROVIDER} needs relogin (${authError.reason ?? 'no reason'} at ${authError.at ?? 'unknown time'}); unrelated to publishing, check \`hermes auth status ${PROVIDER}\` / Hermes 재로그인 필요 — 게시와 무관, \`hermes auth status ${PROVIDER}\` 확인`,
    }]
    : [];
  return [...fromPool, ...relogin];
}

function accountLines(relation, acceptSharedQuota) {
  if (relation === 'same account') {
    return acceptSharedQuota
      ? {block: false, warn: true, lines: ['WARN Hermes and Codex use the same OpenAI account; publishing spends the Hermes weekly quota (--accept-shared-quota) / 같은 계정: Hermes 주간 쿼터를 함께 소모함']}
      : {block: true, warn: false, lines: [
        'BLOCKED Hermes and Codex use the same OpenAI account; a publication spends the Hermes weekly quota / Hermes와 Codex가 같은 OpenAI 계정이라 게시가 Hermes 주간 쿼터를 소모함',
        '        sign Codex into another account (codex logout && codex login), or rerun with --accept-shared-quota / Codex를 다른 계정으로 로그인하거나 --accept-shared-quota로 재실행',
      ]};
  }
  if (relation === 'unknown') {
    return {block: false, warn: true, lines: ['WARN could not compare the Hermes and Codex accounts (auth file missing or without account id) / 계정 비교 불가']};
  }
  return {block: false, warn: false, lines: []};
}

export function evaluatePreflight({hermes, codex, now = Date.now(), acceptSharedQuota = false}) {
  const relation = accountRelation(hermesAccountId(hermes), codexAccountId(codex));
  const account = accountLines(relation, acceptSharedQuota);
  const findings = hermesQuotaFindings(hermes, now);
  const blocked = account.block || findings.some((finding) => finding.block);
  const warned = account.warn || findings.some((finding) => !finding.block);
  const status = blocked ? 'blocked' : warned ? 'warn' : 'ok';
  const lines = [
    `account: ${relation}`,
    ...account.lines,
    ...findings.map((finding) => `${finding.block ? 'BLOCKED' : 'WARN'} ${finding.message}`),
    `preflight: ${status}`,
  ];
  return {status, relation, findings, lines};
}

// A missing or unparsable file is "unknown", never a crash: the check must not
// be the reason a publication cannot start when the files simply are not there.
function readAuth(path) {
  try {
    return {auth: JSON.parse(readFileSync(path, 'utf8')), note: null};
  } catch (error) {
    const reason = error?.code === 'ENOENT' ? 'not found' : 'unreadable';
    return {auth: null, note: `${path}: ${reason}`};
  }
}

function parseArgs(argv) {
  const known = new Set(['--accept-shared-quota']);
  const unknown = argv.filter((arg) => !known.has(arg));
  return {acceptSharedQuota: argv.includes('--accept-shared-quota'), unknown};
}

function nowFrom(env) {
  const override = env.ORBIT_PREFLIGHT_NOW ? Date.parse(env.ORBIT_PREFLIGHT_NOW) : NaN;
  return Number.isNaN(override) ? Date.now() : override;
}

function main(argv, env) {
  const {acceptSharedQuota, unknown} = parseArgs(argv);
  if (unknown.length > 0) {
    process.stderr.write(`[preflight-quota] unexpected argument ${unknown[0]}\nusage: preflight-quota.mjs [--accept-shared-quota]\n`);
    return 1;
  }
  const home = env.HOME || homedir();
  const hermes = readAuth(env.ORBIT_HERMES_AUTH || join(home, '.hermes', 'auth.json'));
  const codex = readAuth(env.ORBIT_CODEX_AUTH || join(home, '.codex', 'auth.json'));
  const result = evaluatePreflight({hermes: hermes.auth, codex: codex.auth, now: nowFrom(env), acceptSharedQuota});
  const notes = [hermes.note, codex.note].filter(Boolean).map((note) => `note ${note}`);
  process.stdout.write([...notes, ...result.lines].map((line) => `[preflight-quota] ${line}`).join('\n') + '\n');
  return result.status === 'blocked' ? 2 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
