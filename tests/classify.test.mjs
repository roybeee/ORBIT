import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestProject, autoAssignments, keywordLinks, projectTerms } from '../lib/orbit/classify.ts';
import { applyAction, DomainError } from '../lib/orbit/reducer.ts';
import { coachTask } from '../lib/orbit/coach.ts';
import { buildGraph, layoutGraph } from '../lib/orbit/graph.ts';
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
    tasks: [...tasks, task('done', '올드페리도넛 계약서 서명', 'ofd', { status: 'done' })],
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
