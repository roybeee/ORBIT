import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {checkMigrations, journalOf} from '../scripts/check-migrations.mjs';

const ROOT_UUID = '00000000-0000-0000-0000-000000000000';
const repoRoot = fileURLToPath(new URL('../', import.meta.url));

function fixture(tags, {chain = true, sql = true, snapshots = true} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-migrations-'));
  mkdirSync(join(root, 'drizzle', 'meta'), {recursive: true});
  const entries = tags.map((tag, idx) => ({idx, version: '6', when: 1000 + idx, tag, breakpoints: true}));
  writeFileSync(join(root, 'drizzle', 'meta', '_journal.json'), JSON.stringify({version: '7', dialect: 'sqlite', entries}, null, 2));
  let previous = ROOT_UUID;
  tags.forEach((tag, index) => {
    if (sql) writeFileSync(join(root, 'drizzle', `${tag}.sql`), `-- ${tag}\nCREATE TABLE t${index} (id text);\n`);
    const id = `id-${index}`;
    if (snapshots) writeFileSync(join(root, 'drizzle', 'meta', `${tag.slice(0, 4)}_snapshot.json`),
      JSON.stringify({version: '6', dialect: 'sqlite', id, prevId: chain ? previous : 'broken', tables: {}}));
    previous = id;
  });
  return root;
}

test('a consistent journal, sql and snapshot chain passes', () => {
  const root = fixture(['0000_first', '0001_second', '0002_third']);
  try {
    const result = checkMigrations(root);
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
    assert.equal(result.count, 3);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('duplicate or out-of-order indexes from a parallel branch are rejected', () => {
  const root = fixture(['0000_first', '0001_second']);
  try {
    const journal = journalOf(root);
    journal.entries.push({idx: 1, version: '6', when: 3000, tag: '0001_parallel', breakpoints: true});
    writeFileSync(join(root, 'drizzle', 'meta', '_journal.json'), JSON.stringify(journal));
    writeFileSync(join(root, 'drizzle', '0001_parallel.sql'), 'CREATE TABLE p (id text);\n');
    const result = checkMigrations(root);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => /idx 1/.test(problem) && /position 2/.test(problem)));
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('a journal entry whose sql file or snapshot is missing is rejected', () => {
  const root = fixture(['0000_first', '0001_second']);
  try {
    unlinkSync(join(root, 'drizzle', '0001_second.sql'));
    unlinkSync(join(root, 'drizzle', 'meta', '0001_snapshot.json'));
    const result = checkMigrations(root);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => /0001_second\.sql/.test(problem)));
    assert.ok(result.problems.some((problem) => /0001_snapshot\.json/.test(problem)));
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('a broken snapshot prevId chain is rejected', () => {
  const root = fixture(['0000_first', '0001_second'], {chain: false});
  try {
    const result = checkMigrations(root);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => /prevId/.test(problem)));
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('sql files or snapshots that the journal does not know are rejected', () => {
  const root = fixture(['0000_first']);
  try {
    writeFileSync(join(root, 'drizzle', '0001_orphan.sql'), 'CREATE TABLE o (id text);\n');
    const result = checkMigrations(root);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => /orphan/.test(problem)));
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('renumbering or dropping a migration that the base branch already has is rejected', () => {
  const root = fixture(['0000_first', '0001_renamed', '0002_new']);
  try {
    const base = {version: '7', dialect: 'sqlite', entries: [
      {idx: 0, version: '6', when: 1, tag: '0000_first', breakpoints: true},
      {idx: 1, version: '6', when: 2, tag: '0001_second', breakpoints: true},
    ]};
    const result = checkMigrations(root, {baseJournal: base});
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => /0001_second/.test(problem) && /base/.test(problem)));
    const appended = checkMigrations(fixture(['0000_first', '0001_second', '0002_new']), {baseJournal: base});
    assert.equal(appended.ok, true);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('the repository migration history itself is consistent', () => {
  const result = checkMigrations(repoRoot);
  assert.deepEqual(result.problems, []);
  assert.ok(result.count >= 29);
});
