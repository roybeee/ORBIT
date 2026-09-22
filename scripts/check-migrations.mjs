#!/usr/bin/env node
// Guards the append-only Drizzle migration history when several branches merge
// in parallel. Two branches that each generate the next migration number will
// conflict in drizzle/meta/_journal.json; a careless resolution can leave two
// entries with one idx or a snapshot chain that no longer links. This check
// rejects that before the merged revision reaches main or a Sites publication.
//
// Usage: node scripts/check-migrations.mjs [--root <dir>] [--base <git-ref>]
//   --base compares against the journal of an already-integrated revision so a
//   branch cannot renumber, rename or drop a migration that main already has.
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT_UUID = '00000000-0000-0000-0000-000000000000';
const JOURNAL = join('drizzle', 'meta', '_journal.json');

export function journalOf(root) {
  return JSON.parse(readFileSync(join(root, JOURNAL), 'utf8'));
}

function readJson(path, problems, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push(`${label} is not readable JSON: ${error.message}`);
    return null;
  }
}

function checkEntries(root, entries, problems) {
  const seenTags = new Set();
  let previousId = ROOT_UUID;
  entries.forEach((entry, position) => {
    const tag = String(entry?.tag ?? '');
    if (entry?.idx !== position) problems.push(`journal idx ${entry?.idx} at position ${position} must equal its position (tag ${tag || '?'})`);
    if (!/^\d{4}_[a-z0-9_]+$/.test(tag)) problems.push(`journal tag "${tag}" at position ${position} is not NNNN_name`);
    else if (Number(tag.slice(0, 4)) !== position) problems.push(`journal tag "${tag}" number does not match position ${position}`);
    if (seenTags.has(tag)) problems.push(`journal tag "${tag}" appears more than once`);
    seenTags.add(tag);
    const sqlPath = join(root, 'drizzle', `${tag}.sql`);
    if (!existsSync(sqlPath) || statSync(sqlPath).size === 0) problems.push(`migration file drizzle/${tag}.sql is missing or empty`);
    const snapshotName = `${tag.slice(0, 4)}_snapshot.json`;
    const snapshotPath = join(root, 'drizzle', 'meta', snapshotName);
    if (!existsSync(snapshotPath)) {
      problems.push(`snapshot drizzle/meta/${snapshotName} is missing`);
      return;
    }
    const snapshot = readJson(snapshotPath, problems, `drizzle/meta/${snapshotName}`);
    if (!snapshot) return;
    if (snapshot.prevId !== previousId) problems.push(`drizzle/meta/${snapshotName} prevId ${snapshot.prevId} does not link to the previous snapshot id ${previousId}`);
    previousId = snapshot.id;
  });
  return seenTags;
}

function checkOrphans(root, seenTags, problems) {
  const knownSnapshots = new Set([...seenTags].map((tag) => `${tag.slice(0, 4)}_snapshot.json`));
  for (const name of readdirSync(join(root, 'drizzle'))) {
    if (name.endsWith('.sql') && !seenTags.has(name.slice(0, -4))) problems.push(`drizzle/${name} is not listed in the journal (orphan migration)`);
  }
  for (const name of readdirSync(join(root, 'drizzle', 'meta'))) {
    if (name.endsWith('_snapshot.json') && !knownSnapshots.has(name)) problems.push(`drizzle/meta/${name} is not listed in the journal (orphan snapshot)`);
  }
}

function checkBasePrefix(entries, baseJournal, problems) {
  const baseEntries = Array.isArray(baseJournal?.entries) ? baseJournal.entries : [];
  baseEntries.forEach((baseEntry, position) => {
    const current = entries[position];
    if (!current || current.tag !== baseEntry.tag) {
      problems.push(`base migration ${baseEntry.tag} (idx ${position}) was renumbered, renamed or removed; migrations already on the base branch are append-only`);
    }
  });
}

export function checkMigrations(root, {baseJournal} = {}) {
  const problems = [];
  const journal = readJson(join(root, JOURNAL), problems, JOURNAL);
  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  if (journal && !Array.isArray(journal.entries)) problems.push(`${JOURNAL} has no entries array`);
  const seenTags = checkEntries(root, entries, problems);
  if (existsSync(join(root, 'drizzle'))) checkOrphans(root, seenTags, problems);
  if (baseJournal) checkBasePrefix(entries, baseJournal, problems);
  return {ok: problems.length === 0, problems, count: entries.length};
}

function baseJournalFromGit(root, ref) {
  if (!ref || /^0+$/.test(ref)) return null;
  try {
    return JSON.parse(execFileSync('git', ['show', `${ref}:${JOURNAL}`], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}));
  } catch {
    console.warn(`[check-migrations] base ${ref} has no readable ${JOURNAL}; skipping the base comparison.`);
    return null;
  }
}

function main(argv) {
  let root = process.cwd();
  let base = null;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--root') root = argv[++index];
    else if (argv[index] === '--base') base = argv[++index];
    else throw new Error(`Unknown argument ${argv[index]}`);
  }
  const result = checkMigrations(root, {baseJournal: baseJournalFromGit(root, base)});
  if (!result.ok) {
    console.error(`[check-migrations] ${result.problems.length} problem(s) in ${result.count} migration(s):`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[check-migrations] ${result.count} migrations consistent${base ? ` and append-only relative to ${base}` : ''}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
