import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateProposal,
  calibrationFactor,
  calibrate,
  inferQuadrant,
  overlaps,
} from '../lib/orbit/planner.ts';
import { applyAction, DomainError, LIMITS } from '../lib/orbit/reducer.ts';
import { habitStreak, weeklyStats, focusIds } from '../lib/orbit/derived.ts';
import { coachTask, handoffLike, guessCognition, needsFeedback } from '../lib/orbit/coach.ts';
import { emptyWorkspace, DEFAULT_PREFERENCES, withDefaults } from '../lib/orbit/model.ts';
import { addDays } from '../lib/orbit/dates.ts';
// Monday 2026-09-07 10:00 in Seoul: a workday, morning, so today's review is allowed.
const now = new Date('2026-09-07T01:00:00Z');
const date = '2026-09-07';
const project = (id, extra = {}) => ({
  id,
  name: id,
  color: '#5558e8',
  symbol: 'O',
  goal: '검토 가능한 결과',
  due: addDays(date, 14),
  priority: 4,
  ...extra,
});
const task = (id, extra = {}) => ({
  id,
  title: id,
  projectId: 'domino',
  status: 'todo',
  duration: 60,
  due: addDays(date, 5),
  impact: 5,
  focus: false,
  definition: '검토 의견을 반영한 초안을 팀에 공유',
  ...extra,
});
const workspace = (extra = {}) => ({
  ...emptyWorkspace(),
  projects: [project('domino'), project('other')],
  dominoProjectId: 'domino',
  ...extra,
});
const prefs = { ...DEFAULT_PREFERENCES };
const meeting = (id, start, end) => ({ id, title: id, date, start, end, kind: 'meeting' });
const busy = (item, block) => overlaps(item, block);
test('Goal Laser takes a contiguous peak-window block before anything else', () => {
  const tasks = [task('laser', { cognition: 'high', duration: 60 }), task('b', { projectId: 'other' })];
  const plan = generateProposal(tasks, [], date, 'normal', undefined, prefs, { dominoProjectId: 'domino' });
  const laser = plan.items.find((i) => i.role === 'laser');
  assert.equal(plan.laser.status, 'placed');
  assert.equal(plan.laser.taskId, 'laser');
  assert.equal(plan.laser.minutes, 180);
  assert.deepEqual([laser.start, laser.end], [540, 720]);
  assert.ok(laser.reason.startsWith('오늘의 Goal Laser'));
  assert.equal(plan.items[0].taskId, 'laser');
});
test('Goal Laser reports failure honestly when no window is long enough, without a partial block', () => {
  const tasks = [task('laser', { cognition: 'high', duration: 300 })];
  const plan = generateProposal(tasks, [meeting('m', 900, 930)], date, 'normal', undefined, prefs, {
    dominoProjectId: 'domino',
  });
  assert.equal(plan.laser.status, 'failed');
  assert.equal(plan.laser.taskId, 'laser');
  assert.ok(plan.laser.note.includes('회의를 옮기거나'));
  assert.equal(
    plan.items.some((i) => i.role === 'laser'),
    false,
  );
  assert.equal(generateProposal(tasks, [], date, 'normal', undefined, prefs).laser.status, 'none');
});
test('non-laser work is placed must-close first, then B → A → C; D is delegated, never scheduled', () => {
  const tasks = [
    task('A', { projectId: 'other', impact: 5, due: addDays(date, 1) }),
    task('C', { projectId: 'other', impact: 2, due: addDays(date, 1) }),
    task('B', { projectId: 'other', impact: 5, due: addDays(date, 10) }),
    task('D', { projectId: 'other', impact: 2, due: addDays(date, 10) }),
  ];
  assert.deepEqual(
    tasks.map((t) => inferQuadrant(t, date)),
    ['A', 'C', 'B', 'D'],
  );
  const plan = generateProposal(tasks, [], date, 'normal', undefined, prefs);
  assert.deepEqual(
    plan.items.map((i) => i.taskId),
    ['B', 'A', 'C'],
  );
  assert.deepEqual(plan.delegate, ['D']);
  assert.equal(plan.items[0].quadrant, 'B');
  const must = generateProposal(
    [...tasks, task('M', { projectId: 'other', impact: 1, must: true })],
    [],
    date,
  );
  assert.equal(must.items[0].taskId, 'M');
  assert.equal(must.items[0].role, 'must');
  assert.ok(must.unscheduled.includes('C'));
});
test('cognition levels steer placement: high in the peak, external outside it, mid after lunch', () => {
  const tasks = [
    task('ext', { projectId: 'other', cognition: 'external', duration: 30 }),
    task('mid', { projectId: 'other', cognition: 'mid', duration: 30 }),
    task('high', { projectId: 'other', cognition: 'high', duration: 30 }),
  ];
  const plan = generateProposal(tasks, [], date, 'normal', undefined, prefs);
  const at = (id) => plan.items.find((i) => i.taskId === id);
  const rhythm = withDefaults(prefs).rhythm;
  assert.ok(at('high').start >= rhythm.peakStart && at('high').end <= rhythm.peakEnd);
  assert.ok(at('ext').start >= rhythm.peakEnd);
  assert.ok(at('mid').start >= rhythm.lunchEnd);
  for (const i of plan.items)
    assert.equal(busy(i, { start: rhythm.lunchStart, end: rhythm.lunchEnd }), false);
});
test('lunch and travel buffers around meetings become busy time', () => {
  const tasks = Array.from({ length: 6 }, (_, n) => task('t' + n, { projectId: 'other', duration: 45 }));
  const plan = generateProposal(tasks, [meeting('m', 840, 900)], date, 'normal', undefined, {
    ...prefs,
    focusLimit: 6,
    travelMinutes: 30,
  });
  assert.ok(plan.items.length >= 3);
  for (const i of plan.items) {
    assert.equal(busy(i, { start: 810, end: 930 }), false);
    assert.equal(busy(i, { start: 720, end: 780 }), false);
  }
  const without = generateProposal(tasks, [meeting('m', 840, 900)], date, 'normal', undefined, {
    ...prefs,
    focusLimit: 6,
  });
  assert.ok(without.budget > plan.budget);
});
test('calibration uses the median of recent actual/estimate ratios and needs five samples', () => {
  const history = [1.5, 1.5, 2.5, 1.0, 1.5].map((ratio, n) =>
    task('h' + n, {
      projectId: 'other',
      status: 'done',
      outcome: 'done',
      cognition: 'high',
      duration: 60,
      actualMinutes: Math.round(60 * ratio),
      completedOn: addDays(date, -3),
    }),
  );
  const fresh = task('new', { projectId: 'other', cognition: 'high', duration: 60 });
  assert.equal(calibrationFactor(history.slice(0, 4).concat(fresh), fresh, date), 1);
  assert.equal(calibrationFactor([...history, fresh], fresh, date), 1.5);
  assert.equal(calibrationFactor([...history, task('low', { cognition: 'low' })], fresh, date), 1.5);
  assert.equal(calibrate(60, 1.5), 90);
  assert.equal(calibrate(20, 0.5), 10);
  assert.equal(calibrate(400, 2), 480);
  const stale = history.map((t) => ({ ...t, completedOn: addDays(date, -40) }));
  assert.equal(calibrationFactor([...stale, fresh], fresh, date), 1);
  const plan = generateProposal([fresh], [], date, 'normal', undefined, prefs, {
    calibration: (t) => calibrationFactor([...history, fresh], t, date),
  });
  assert.equal(plan.items[0].end - plan.items[0].start, 90);
  assert.equal(plan.items[0].factor, 1.5);
  assert.ok(plan.items[0].reason.includes('1.5배'));
});
test('focus sessions: one at a time, elapsed minutes accumulate, and completion records an outcome plus a rule', () => {
  let data = workspace({ tasks: [task('a'), task('b')] });
  data = applyAction(data, { type: 'task.start', id: 'a' }, now);
  assert.equal(data.tasks[0].status, 'doing');
  assert.equal(data.tasks[0].startedAt, now.toISOString());
  assert.throws(() => applyAction(data, { type: 'task.start', id: 'b' }, now), DomainError);
  const later = new Date(now.getTime() + 25 * 60000);
  data = applyAction(data, { type: 'task.stop', id: 'a' }, later);
  assert.equal(data.tasks[0].actualMinutes, 25);
  assert.equal(data.tasks[0].startedAt, undefined);
  assert.throws(() => applyAction(data, { type: 'task.stop', id: 'a' }, later), DomainError);
  data = applyAction(data, { type: 'task.start', id: 'a' }, later);
  data = applyAction(
    data,
    {
      type: 'task.record',
      id: 'a',
      outcome: 'done',
      actualMinutes: 95,
      rule: '제안서는 초안 전에 목차부터 합의한다',
      ruleKind: 'estimate',
    },
    new Date(later.getTime() + 10 * 60000),
  );
  const a = data.tasks[0];
  assert.equal(a.status, 'done');
  assert.equal(a.outcome, 'done');
  assert.equal(a.actualMinutes, 95);
  assert.equal(a.completedOn, date);
  assert.equal(a.startedAt, undefined);
  assert.equal(data.improvements.length, 1);
  assert.equal(data.improvements[0].kind, 'estimate');
  assert.equal(data.improvements[0].source, 'a');
  assert.throws(() => applyAction(data, { type: 'task.start', id: 'a' }, now), DomainError);
  data = applyAction(
    data,
    {
      type: 'task.record',
      id: 'b',
      outcome: 'partial',
      reason: 'waiting',
      rule: '제안서는 초안 전에 목차부터 합의한다',
    },
    now,
  );
  assert.equal(data.tasks[1].status, 'doing');
  assert.equal(data.tasks[1].outcomeReason, 'waiting');
  assert.equal(data.improvements.length, 1, 'an identical active rule is not duplicated');
});
test('one Goal Laser per day; designation reserves a focus slot and can be released', () => {
  let data = workspace({ tasks: [task('a'), task('b'), task('c', { status: 'done' })] });
  data = applyAction(data, { type: 'task.laser', id: 'a', date, laser: true }, now);
  assert.equal(data.tasks[0].laserDate, date);
  assert.equal(data.tasks[0].focus, true);
  assert.ok(focusIds(data, date).has('a'));
  assert.throws(
    () => applyAction(data, { type: 'task.laser', id: 'b', date, laser: true }, now),
    DomainError,
  );
  assert.throws(
    () => applyAction(data, { type: 'task.laser', id: 'c', date, laser: true }, now),
    DomainError,
  );
  data = applyAction(data, { type: 'task.laser', id: 'a', date, laser: false }, now);
  assert.equal(data.tasks[0].laserDate, undefined);
  data = applyAction(data, { type: 'task.laser', id: 'b', date, laser: true }, now);
  assert.equal(data.tasks[1].laserDate, date);
});
test('habits are capped at three, checks build a D+ streak and cannot be dated in the future', () => {
  const habit = (id, mode = 'keep') => ({ id, title: id, mode, startedOn: addDays(date, -10), log: [] });
  let data = workspace();
  for (const h of ['keep', 'quit1', 'quit2'])
    data = applyAction(data, { type: 'habit.upsert', habit: habit(h, h === 'keep' ? 'keep' : 'quit') }, now);
  assert.throws(() => applyAction(data, { type: 'habit.upsert', habit: habit('extra') }, now), DomainError);
  for (const d of [addDays(date, -2), addDays(date, -1)])
    data = applyAction(data, { type: 'habit.check', id: 'keep', date: d, checked: true }, now);
  assert.equal(habitStreak(data.habits[0], date), 2, 'today may still be open');
  data = applyAction(data, { type: 'habit.check', id: 'keep', date, checked: true }, now);
  assert.equal(habitStreak(data.habits[0], date), 3);
  data = applyAction(data, { type: 'habit.check', id: 'keep', date: addDays(date, -1), checked: false }, now);
  assert.equal(habitStreak(data.habits[0], date), 1);
  assert.throws(
    () => applyAction(data, { type: 'habit.check', id: 'keep', date: addDays(date, 1), checked: true }, now),
    DomainError,
  );
  data = applyAction(data, { type: 'habit.check', id: 'keep', date, checked: true }, now);
  assert.equal(data.habits[0].log.length, 2);
});
test('improvement rules are deduplicated and capped, retiring the oldest inactive first', () => {
  const rule = (n, active = true) => ({
    id: 'r' + n,
    rule: '규칙 ' + n,
    kind: 'other',
    createdOn: addDays(date, -n),
    active,
  });
  let data = workspace();
  for (let n = 0; n < LIMITS.improvements; n++)
    data = applyAction(data, { type: 'improvement.add', improvement: rule(n) }, now);
  assert.equal(data.improvements.length, LIMITS.improvements);
  data = applyAction(data, { type: 'improvement.add', improvement: { ...rule(1), id: 'dup' } }, now);
  assert.equal(data.improvements.length, LIMITS.improvements, 'same active rule text is ignored');
  assert.throws(
    () => applyAction(data, { type: 'improvement.add', improvement: rule(99) }, now),
    DomainError,
  );
  data = applyAction(data, { type: 'improvement.retire', id: 'r5' }, now);
  data = applyAction(data, { type: 'improvement.add', improvement: rule(99) }, now);
  assert.equal(data.improvements.length, LIMITS.improvements);
  assert.equal(
    data.improvements.some((i) => i.id === 'r5'),
    false,
  );
  assert.ok(data.improvements.some((i) => i.id === 'r99'));
});
test('tasks added after the day was planned are flagged as unplanned for the evening review', () => {
  let data = workspace({ tasks: [task('planned', { due: date })] });
  data = applyAction(data, { type: 'proposal.generate', date, energy: 'normal' }, now);
  data = applyAction(data, { type: 'task.upsert', task: task('surprise', { due: date }) }, now);
  data = applyAction(data, { type: 'task.upsert', task: task('later', { due: addDays(date, 1) }) }, now);
  assert.equal(data.tasks.find((t) => t.id === 'planned').unplanned, undefined);
  assert.equal(data.tasks.find((t) => t.id === 'surprise').unplanned, true);
  assert.equal(data.tasks.find((t) => t.id === 'later').unplanned, undefined);
  data = applyAction(
    data,
    { type: 'task.upsert', task: { ...task('surprise', { due: date }), title: '이름 변경' } },
    now,
  );
  assert.equal(data.tasks.find((t) => t.id === 'surprise').unplanned, true, 'history survives edits');
});
test('the evening PAFI review applies outcomes, rules and habit checks, then plans tomorrow with a Laser', () => {
  let data = workspace({
    tasks: [
      task('laser', {
        cognition: 'high',
        duration: 120,
        due: date,
        laserDate: date,
        focus: true,
        focusDate: date,
      }),
      task('memo', { projectId: 'other', duration: 30, due: date }),
      task('next', { cognition: 'high', duration: 90 }),
    ],
    habits: [{ id: 'h', title: '아침 산책', mode: 'keep', startedOn: addDays(date, -3), log: [] }],
  });
  const detail = {
    date,
    items: [
      { taskId: 'laser', title: 'laser', outcome: 'done', estimateMinutes: 120, actualMinutes: 150 },
      { taskId: 'memo', title: 'memo', outcome: 'skipped', estimateMinutes: 30, reason: 'priority' },
    ],
    feedback: [
      {
        taskId: 'laser',
        cause: '자료 검색에 시간이 더 들었다',
        alternative: '자료는 전날 모아 둔다',
        rule: '고위 인지 업무는 자료를 전날 준비한다',
        kind: 'buffer',
      },
      { cause: '', alternative: '', rule: '   ' },
    ],
    energy: { sleepMinutes: 420, exercise: '산책 20분', mood: '차분함' },
    smallWins: ['제안서 초안을 끝냈다', '회의를 10분 일찍 마쳤다'],
    gratitude: ['팀의 검토'],
    habitChecks: ['h'],
  };
  const review = { date, win: '', block: '', energy: 'normal' };
  assert.throws(
    () =>
      applyAction(
        data,
        { type: 'review.saveGenerate', review, detail: { ...detail, date: addDays(date, -1) } },
        now,
      ),
    DomainError,
  );
  assert.throws(
    () =>
      applyAction(data, { type: 'review.saveGenerate', review: { ...review, date: addDays(date, 1) } }, now),
    DomainError,
  );
  data = applyAction(data, { type: 'review.saveGenerate', review, detail }, now);
  const laser = data.tasks.find((t) => t.id === 'laser'),
    memo = data.tasks.find((t) => t.id === 'memo');
  assert.equal(laser.status, 'done');
  assert.equal(laser.outcome, 'done');
  assert.equal(laser.actualMinutes, 150);
  assert.equal(laser.completedOn, date);
  assert.equal(memo.outcome, 'skipped');
  assert.equal(memo.outcomeReason, 'priority');
  assert.equal(memo.status, 'todo');
  assert.equal(data.improvements.length, 1, 'blank rules are ignored');
  assert.equal(data.improvements[0].kind, 'buffer');
  assert.deepEqual(data.habits[0].log, [date]);
  const saved = data.reviews.find((r) => r.date === date);
  assert.deepEqual(saved.stats, {
    planned: 2,
    done: 1,
    partial: 0,
    skipped: 1,
    laserMinutes: 150,
    executionRate: 50,
  });
  assert.equal(saved.hasDetail, true);
  assert.equal(saved.highlight, '제안서 초안을 끝냈다');
  assert.deepEqual(saved.completedIds, ['laser']);
  assert.deepEqual(saved.habitChecks, ['h']);
  const tomorrow = data.proposals.find((p) => p.date === addDays(date, 1));
  assert.equal(tomorrow.laser.status, 'placed');
  assert.equal(tomorrow.laser.taskId, 'next');
  assert.equal(tomorrow.items.find((i) => i.role === 'laser').start, 540);
  const week = weeklyStats(data, date);
  assert.equal(week.reviewedDays, 1);
  assert.equal(week.executionRate, 50);
  assert.equal(week.predictionAccuracy, 1.25);
  assert.equal(week.laserDays, 1);
  assert.deepEqual(week.topReasons, [{ reason: 'priority', count: 1 }]);
  assert.equal(week.newRules, 1);
});
test('approving a Laser proposal item designates the day Laser and revoking releases it', () => {
  let data = workspace({ tasks: [task('a', { cognition: 'high' }), task('b', { projectId: 'other' })] });
  data = applyAction(data, { type: 'proposal.generate', date, energy: 'normal' }, now);
  const plan = data.proposals[0];
  const item = plan.items.find((i) => i.role === 'laser');
  data = applyAction(data, { type: 'proposal.approve', date, itemId: item.id }, now);
  assert.equal(data.tasks[0].laserDate, date);
  assert.equal(data.events.length, 1);
  data = applyAction(data, { type: 'proposal.revoke', date, itemId: item.id }, now);
  assert.equal(data.tasks[0].laserDate, undefined);
  assert.equal(data.events.length, 0);
});
test('goal, domino, risk and workspace links are validated and bounded', () => {
  let data = workspace();
  assert.throws(() => applyAction(data, { type: 'project.domino', id: 'missing' }, now), DomainError);
  data = applyAction(data, { type: 'project.domino', id: 'other' }, now);
  assert.equal(data.dominoProjectId, 'other');
  data = applyAction(data, { type: 'project.domino', id: null }, now);
  assert.equal(data.dominoProjectId, undefined);
  const goal = { id: 'g', kind: 'mid', sentence: '연말까지 제휴 매장 3곳 오픈' };
  data = applyAction(data, { type: 'goal.upsert', goal }, now);
  assert.throws(
    () => applyAction(data, { type: 'goal.upsert', goal: { ...goal, id: 'g2', parentId: 'nope' } }, now),
    DomainError,
  );
  data = applyAction(data, { type: 'project.upsert', project: project('domino', { goalId: 'g' }) }, now);
  assert.throws(() => applyAction(data, { type: 'goal.delete', id: 'g' }, now), DomainError);
  const risk = {
    id: 'r',
    title: '임대 계약 갱신',
    checkDate: addDays(date, 7),
    condition: '갱신 조건 서면 합의',
  };
  data = applyAction(data, { type: 'risk.upsert', risk: { ...risk, projectId: 'other' } }, now);
  data = applyAction(data, { type: 'project.delete', id: 'other' }, now);
  assert.equal(data.risks[0].projectId, undefined);
  data = applyAction(data, { type: 'risk.close', id: 'r' }, now);
  assert.equal(data.risks.length, 0);
});
test('the task coach checks the definition, quadrant, cognition, estimate and size while writing', () => {
  const ctx = {
    today: date,
    tasks: [],
    projects: [project('domino'), project('other')],
    goals: [{ id: 'g', kind: 'mid', sentence: '연말 목표' }],
    improvements: [{ id: 'i', rule: '회의 전후 이동 30분', kind: 'buffer', createdOn: date, active: true }],
    dominoProjectId: 'domino',
    factor: 1.5,
  };
  const ids = (checks) => checks.map((c) => c.id + ':' + c.level);
  const draft = task('d', { definition: '', duration: 60, impact: 5, due: addDays(date, 10) });
  const empty = coachTask(draft, ctx);
  assert.ok(ids(empty).includes('definition:warn'));
  assert.ok(ids(empty).includes('quadrant:info'));
  assert.deepEqual(empty.find((c) => c.id === 'quadrant').fix.patch, { quadrant: 'B' });
  assert.deepEqual(empty.find((c) => c.id === 'estimate').fix.patch, { duration: 90 });
  assert.ok(ids(empty).includes('rules:info'));
  assert.ok(ids(empty).includes('goal:info'));
  const handoff = coachTask(
    { ...draft, title: '투자 제안서 초안 작성', definition: '제안서 PDF를 김 대표에게 발송' },
    ctx,
  );
  assert.ok(ids(handoff).includes('definition:ok'));
  assert.deepEqual(handoff.find((c) => c.id === 'cognition').fix.patch, { cognition: 'high' });
  assert.ok(ids(handoff).includes('laser:info'));
  const vague = coachTask({ ...draft, definition: '초안을 다듬는다' }, ctx);
  assert.ok(ids(vague).includes('definition:warn'));
  const d = coachTask({ ...draft, projectId: 'other', impact: 2, duration: 300 }, ctx);
  assert.ok(ids(d).includes('delegate:warn'));
  assert.ok(ids(d).includes('split:warn'));
  assert.ok(ids(coachTask({ ...draft, due: addDays(date, -1) }, ctx)).includes('due:warn'));
  const explicit = coachTask(
    { ...draft, quadrant: 'A', cognition: 'low', duration: 30 },
    { ...ctx, factor: 1 },
  );
  assert.equal(
    explicit.some((c) => ['quadrant', 'cognition', 'estimate'].includes(c.id)),
    false,
  );
  assert.equal(handoffLike('검토 의견을 슬랙에 공유'), true);
  assert.equal(handoffLike('생각 정리'), false);
  assert.equal(guessCognition('파트너 미팅'), 'external');
  assert.equal(guessCognition('영수증 정리'), 'low');
  assert.equal(needsFeedback('done', 60, 70), false);
  assert.equal(needsFeedback('done', 60, 100), true);
  assert.equal(needsFeedback('partial', 60, 60), true);
});
