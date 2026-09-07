import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestProject, autoAssignments, keywordLinks, projectTerms, assignmentPlan, projectDraft, automaticProject } from '../lib/orbit/classify.ts';
import { applyAction, DomainError } from '../lib/orbit/reducer.ts';
import { coachTask } from '../lib/orbit/coach.ts';
import { buildGraph, layoutGraph, connectedTasks } from '../lib/orbit/graph.ts';
import { parseAction } from '../lib/orbit/agent/protocol.ts';
import { emptyWorkspace } from '../lib/orbit/model.ts';
const now = new Date('2026-09-07T01:00:00Z');
const project = (id, name, keywords) => ({
  id,
  name,
  color: '#5558e8',
  symbol: name.slice(0, 1),
  goal: '',
  due: '2026-09-30',
  priority: 3,
  ...(keywords ? { keywords } : {}),
});
const projects = [
  project('ofd', '올드페리도넛 가맹'),
  project('pizza', '옥수동 화덕피자'),
  project('mapdal', '맵달 서울', ['4층', '멜로우빈', '라이브커머스']),
  project('orbit', '나의 매니지먼트 앱'),
  project('bucket', '9월 7일 핵심 실행'),
  project('hr', '채용·HR', ['HR', '채용', '면접']),
  project('ir', '투자 유치', ['한투파', 'IR', '투자자']),
  project('fin', '재무·자금', ['자금', '조달', '현금']),
];
const task = (id, title, projectId = 'bucket', extra = {}) => ({
  id,
  title,
  projectId,
  status: 'todo',
  duration: 60,
  due: '2026-09-08',
  impact: 3,
  focus: false,
  definition: '',
  ...extra,
});
const tasks = [
  task('t0', '올드페리도넛 영업자료 완성하는 것'),
  task('t1', '피자브랜드 네이밍 확정하고 다음 프로세스로 넘어가는 것'),
  task('t2', 'HR 공고들 분석해서 면접일정 잡는 것'),
  task('t3', '멜로우빈과 4층에 진행하는 공동사업 프로젝트 계약 조건 협의 잘 마치는 것'),
  task('t4', '한투파에 넘어갈 자료 빌드업 해서 한투파에 넘기는 것'),
  task('t5', '9월을 버텨나가려면 자금이 얼마가 필요할지 계산해보고 조달방법 강구하는 것'),
  task('t6', '오늘 점심 뭐 먹지'),
];
test('project names and manual keywords identify the project a Korean task title belongs to', () => {
  const best = (title) => suggestProject(title, projects, tasks)[0];
  assert.equal(best('올드페리도넛 영업자료 완성하는 것').projectId, 'ofd');
  assert.equal(best('올드페리도넛 영업자료 완성하는 것').confidence, 'high');
  assert.deepEqual(best('올드페리도넛 영업자료 완성하는 것').matched, ['올드페리도넛']);
  assert.equal(best('HR 공고들 분석해서 면접일정 잡는 것').projectId, 'hr');
  assert.equal(best('멜로우빈과 4층에 진행하는 공동사업 프로젝트 계약 조건 협의').projectId, 'mapdal');
  assert.equal(best('한투파에 넘어갈 자료 빌드업 해서 한투파에 넘기는 것').projectId, 'ir');
  assert.equal(
    best('9월을 버텨나가려면 자금이 얼마가 필요할지 계산해보고 조달방법 강구하는 것').projectId,
    'fin',
  );
  const pizza = best('피자브랜드 네이밍 확정하고 다음 프로세스로 넘어가는 것');
  assert.equal(pizza.projectId, 'pizza');
  assert.equal(pizza.confidence, 'low', 'a partial 2-character overlap is only a hint');
  assert.equal(best('오늘 점심 뭐 먹지'), undefined);
  assert.equal(
    suggestProject('프로젝트 회의 자료 정리', projects, tasks).length,
    0,
    'generic words never match',
  );
  assert.ok(projectTerms(projects[2]).some((t) => t.manual && t.text === '멜로우빈'));
});
test('the classifier learns a project vocabulary from its own tasks and notes', () => {
  const learned = [
    task('a', '가맹 영업자료 목차 확정', 'ofd'),
    task('b', '가맹 영업자료 디자인 검수', 'ofd'),
    task('c', '가맹 영업자료 인쇄 발주', 'ofd'),
  ];
  const ranked = suggestProject('영업자료 최종본 파트너 발송', projects, learned);
  assert.equal(ranked[0]?.projectId, 'ofd');
  assert.ok(ranked[0].matched.includes('영업자료'));
});
test('auto assignment proposes only confident moves out of projects with no keyword hold', () => {
  const moves = autoAssignments(tasks, projects);
  assert.deepEqual(
    moves.map((m) => m.taskId + '→' + m.projectId),
    ['t0→ofd', 't2→hr', 't3→mapdal', 't4→ir', 't5→fin'],
  );
  assert.deepEqual(moves[0].matched, ['올드페리도넛']);
  assert.equal(moves[0].from, 'bucket');
  const settled = [
    task('x', '올드페리도넛 가맹 설명회', 'ofd'),
    task('y', '완료된 올드페리도넛 일', 'bucket', { status: 'done' }),
  ];
  assert.equal(
    autoAssignments(settled, projects).length,
    0,
    'tasks already held by their project or done stay',
  );
  const both = [task('z', '올드페리도넛 매장에서 라이브커머스 촬영', 'mapdal')];
  assert.equal(
    autoAssignments(both, projects).length,
    0,
    'a task its current project also claims is not moved',
  );
});
test('task.assign moves tasks and their focus blocks in one transition and validates targets', () => {
  let data = {
    ...emptyWorkspace(),
    projects: projects.slice(0, 2).concat(projects[4]),
    tasks: [task('t0', '올드페리도넛 영업자료 완성하는 것'), task('t1', '피자 네이밍')],
    events: [
      {
        id: 'approved:x',
        title: '올드페리도넛 영업자료 완성하는 것',
        date: '2026-09-08',
        start: 540,
        end: 600,
        kind: 'focus',
        projectId: 'bucket',
        taskId: 't0',
      },
    ],
  };
  data = applyAction(
    data,
    {
      type: 'task.assign',
      assignments: [
        { id: 't0', projectId: 'ofd' },
        { id: 't1', projectId: 'pizza' },
      ],
    },
    now,
  );
  assert.equal(data.tasks[0].projectId, 'ofd');
  assert.equal(data.tasks[1].projectId, 'pizza');
  assert.equal(data.events[0].projectId, 'ofd');
  assert.throws(
    () => applyAction(data, { type: 'task.assign', assignments: [{ id: 't0', projectId: 'nope' }] }, now),
    DomainError,
  );
  assert.throws(
    () => applyAction(data, { type: 'task.assign', assignments: [{ id: 'ghost', projectId: 'ofd' }] }, now),
    DomainError,
  );
  assert.ok(parseAction({ type: 'task.assign', assignments: [{ id: 't0', projectId: 'ofd' }] }));
  assert.throws(() =>
    parseAction({
      type: 'task.assign',
      assignments: Array.from({ length: 21 }, (_, i) => ({ id: 't' + i, projectId: 'ofd' })),
    }),
  );
});
test('the coach points at the project a draft belongs to and offers a one-tap move', () => {
  const ctx = { today: '2026-09-07', tasks, projects, goals: [], improvements: [], factor: 1 };
  const draft = {
    id: 'd',
    title: '올드페리도넛 영업자료 완성하는 것',
    projectId: 'bucket',
    duration: 60,
    due: '2026-09-10',
    definition: '자료를 대표에게 발송',
    impact: 3,
    status: 'todo',
  };
  const check = coachTask(draft, ctx).find((c) => c.id === 'project');
  assert.ok(check);
  assert.equal(check.level, 'warn');
  assert.deepEqual(check.fix.patch, { projectId: 'ofd' });
  assert.equal(
    coachTask({ ...draft, projectId: 'ofd' }, ctx).some((c) => c.id === 'project'),
    false,
  );
  const hint = coachTask({ ...draft, title: '피자브랜드 네이밍 확정' }, ctx).find((c) => c.id === 'project');
  assert.equal(hint.level, 'info');
});
test('the connection graph links projects, tasks and keywords and lays them out deterministically', () => {
  const data = {
    ...emptyWorkspace(),
    projects,
    tasks: [...tasks.map((t) => t.id === 't3' ? { ...t, projectId: 'mapdal' } : t), task('done', '올드페리도넛 계약서 서명', 'ofd', { status: 'done' })],
  };
  const graph = buildGraph(data, { notes: false, done: false, goals: true, keywords: true });
  assert.equal(graph.nodes.filter((n) => n.kind === 'project').length, projects.length);
  assert.equal(
    graph.nodes.some((n) => n.id === 'task:done'),
    false,
    'done tasks hidden by default',
  );
  assert.ok(graph.nodes.some((n) => n.kind === 'keyword' && n.label === '멜로우빈'));
  assert.ok(graph.edges.some((e) => e.a === 'keyword:mapdal:멜로우빈' && e.b === 'task:t3'));
  assert.ok(
    graph.edges.every((e) => graph.nodes.some((n) => n.id === e.a) && graph.nodes.some((n) => n.id === e.b)),
  );
  const placed = layoutGraph(graph.nodes, graph.edges, 120);
  assert.ok(placed.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  const again = layoutGraph(graph.nodes, graph.edges, 120);
  assert.deepEqual(
    placed.map((n) => [n.x, n.y]),
    again.map((n) => [n.x, n.y]),
    'same input, same picture',
  );
  const links = keywordLinks(projects[2], tasks);
  assert.deepEqual(links.map((l) => l.keyword).sort(), ['4층', '멜로우빈']);
  const withDone = buildGraph(data, { notes: false, done: true, goals: false, keywords: false });
  assert.ok(withDone.nodes.some((n) => n.id === 'task:done' && n.muted));
});

test('six tasks in a daily bucket produce six reviewable project drafts without pre-created brands', () => {
  const bucket = projects.filter((p) => p.id === 'bucket');
  const plan = assignmentPlan(tasks, bucket);
  assert.deepEqual(plan.projects.map((p) => p.name), ['올드페리도넛', '피자브랜드', '채용·HR', '멜로우빈', '한투파', '재무·자금']);
  assert.equal(plan.assignments.length, 6);
  assert.ok(plan.projects.every((p) => p.goal === '' && p.due === '2026-09-08'));
  assert.equal(projectDraft('프로젝트 자료 정리', '2026-09-08'), undefined);
  assert.equal(projectDraft('오늘 점심 뭐 먹지', '2026-09-08'), undefined);
  const duplicated = assignmentPlan([tasks[0], { ...tasks[0], id: 'second', title: '올드페리도넛 계약 검토' }], bucket);
  assert.equal(duplicated.projects.length, 1);
  assert.equal(new Set(duplicated.assignments.map((a) => a.projectId)).size, 1);
});
test('strong existing matches are reused, learned words cannot move tasks, and ambiguous brands need review', () => {
  assert.equal(assignmentPlan([tasks[0]], projects).projects.length, 0);
  assert.equal(assignmentPlan([tasks[0]], projects).assignments[0].projectId, 'ofd');
  const same = [project('a', '올드페리도넛 서울'), project('b', '올드페리도넛 부산')];
  assert.equal(automaticProject(tasks[0].title, same), undefined);
  assert.deepEqual(assignmentPlan([tasks[0]], same), { projects: [], assignments: [] });
  const learned = [task('a', '영업자료 최종 검수', 'bucket'), task('b', '영업자료 인쇄', 'bucket')];
  assert.equal(automaticProject('영업자료 발송', [projects[4]], learned), undefined);
});
test('project creation and assignment are atomic, preserve facts, deduplicate names and survive repeat application', () => {
  const data = { ...emptyWorkspace(), projects: [projects[4]], tasks: [tasks[0]], events: [{ id: 'block', title: tasks[0].title, date: '2026-09-08', start: 600, end: 660, kind: 'focus', taskId: 't0', projectId: 'bucket' }] };
  const plan = assignmentPlan(data.tasks, data.projects);
  const action = parseAction({ type: 'task.assign', projects: plan.projects, assignments: plan.assignments.map((a) => ({ id: a.taskId, projectId: a.projectId })) });
  const result = applyAction(data, action, now);
  assert.equal(result.projects.length, 2);
  assert.deepEqual(result.tasks[0], { ...tasks[0], projectId: plan.projects[0].id });
  assert.equal(result.events[0].projectId, result.tasks[0].projectId);
  assert.deepEqual(applyAction(result, action, now), result);
  assert.equal(data.projects.length, 1);
  assert.throws(() => applyAction(data, { ...action, assignments: [...action.assignments, { id: 'missing', projectId: 'bucket' }] }, now), DomainError);
  assert.equal(data.projects.length, 1, 'invalid batch does not partially create projects');
  const renamed = { ...data, projects: [...data.projects, project('manual-id', '올드 페리 도넛')] };
  const merged = applyAction(renamed, action, now);
  assert.equal(merged.projects.length, 2);
  assert.equal(merged.tasks[0].projectId, 'manual-id');
  assert.throws(() => applyAction(result, { ...action, projects: [{ ...plan.projects[0], name: '다른 사업' }] }, now), DomainError);
});
test('new task save includes a reviewable project draft; explicit project choices and edits are preserved', () => {
  const data = { ...emptyWorkspace(), projects, tasks: [] };
  const automatic = applyAction(data, parseAction({ type: 'task.upsert', task: tasks[0], autoAssign: true }), now);
  assert.equal(automatic.tasks[0].projectId, 'ofd');
  const manual = applyAction(data, parseAction({ type: 'task.upsert', task: tasks[0], autoAssign: false }), now);
  assert.equal(manual.tasks[0].projectId, 'bucket');
  const edited = applyAction(manual, { type: 'task.upsert', task: { ...tasks[0], title: '올드페리도넛 계약 검토' }, autoAssign: true }, now);
  assert.equal(edited.tasks[0].projectId, 'bucket');
  const draft = projectDraft(tasks[0].title, tasks[0].due);
  const first = applyAction(emptyWorkspace(), parseAction({ type: 'task.upsert', project: draft, task: { ...tasks[0], projectId: draft.id } }), now);
  assert.equal(first.projects[0].name, '올드페리도넛');
  assert.equal(first.tasks[0].projectId, draft.id);
  assert.throws(() => applyAction(emptyWorkspace(), { type: 'task.upsert', project: draft, task: tasks[0] }, now), DomainError);
});
test('project graph and linked list scope keywords to actual membership, including optional completed work', () => {
  const data = { ...emptyWorkspace(), projects: projects.slice(0, 2), tasks: [task('a', '올드페리도넛 자료', 'ofd'), task('b', '올드페리도넛 피자 협업', 'pizza'), task('c', '올드페리도넛 완료', 'ofd', { status: 'done' })] };
  const graph = buildGraph(data, { projectId: 'ofd', done: false, notes: false, goals: true, keywords: true });
  assert.ok(graph.nodes.some((n) => n.kind === 'keyword' && n.projectId === 'ofd'));
  assert.ok(!graph.nodes.some((n) => n.id === 'task:b' || n.id === 'project:pizza' || n.id === 'task:c'));
  assert.ok(graph.edges.some((e) => e.a === 'keyword:ofd:올드페리도넛' && e.b === 'task:a'));
  assert.deepEqual(connectedTasks(data, { projectId: 'ofd', keyword: '올드페리도넛', done: false }).map((t) => t.id), ['a']);
  assert.deepEqual(connectedTasks(data, { projectId: 'ofd', done: true }).map((t) => t.id), ['a', 'c']);
});
