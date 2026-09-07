import type { Project, Task, Note } from './model.ts';
// Keyword-based project assignment (프로젝트 자동 안분). Deterministic and local: a task's title and
// completion criterion are matched against each project's name, its manual keywords and the
// vocabulary its existing tasks and notes already use. Korean has no reliable word boundaries,
// so matching works on whitespace-free strings with longest-common-substring fallbacks.
export interface ProjectSuggestion {
  projectId: string;
  score: number;
  matched: string[];
  confidence: 'high' | 'low';
}
export interface Assignment {
  taskId: string;
  projectId: string;
  matched: string[];
  from: string;
}
// Generic words that describe work in any project; they never identify one.
const GENERIC = new Set(
  '프로젝트 업무 할일 작업 정리 확인 작성 완성 완료 진행 준비 검토 회의 미팅 자료 계획 일정 관리 운영 정하기 확정 마무리 시작 핵심 실행 오늘 내일 이번주 다음주 관련 위한 대한 및 그리고 하기 하는 하고 넘기는 넘어가는 잡는 마치는 계산 방법 강구 나의 우리 개인 신규 기본 최종 초안 문서 목록 정보 내용 결과 사항 항목 건 것'.split(
    ' ',
  ),
);
export const normalize = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
const tokens = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .map((t) => t.replace(/(들|을|를|은|는|이|가|의|에|에서|으로|로|과|와|도|만)$/u, ''))
    .filter((t) => t.length >= 2 && !GENERIC.has(t) && !/^\d+(월|일|년|주|차|시|분)?$/.test(t));
// Longest common substring (characters); short texts, so quadratic DP is fine.
function lcs(a: string, b: string) {
  if (!a || !b) return '';
  let best = '',
    prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best.length) best = a.slice(i - cur[j], i);
      }
    }
    prev = cur;
  }
  return best;
}
interface Term {
  text: string;
  weight: number;
  manual: boolean;
}
// A project's identifying vocabulary: manual keywords (strongest), name tokens, then words that
// recur in its own tasks and notes (learned, weakest).
export function projectTerms(project: Project, tasks: Task[] = [], notes: Note[] = []): Term[] {
  const terms = new Map<string, Term>();
  const add = (raw: string, weight: number, manual = false) => {
    const text = normalize(raw);
    if (text.length < 2 || GENERIC.has(text)) return;
    const existing = terms.get(text);
    if (!existing || existing.weight < weight)
      terms.set(text, { text, weight, manual: manual || !!existing?.manual });
  };
  for (const k of project.keywords ?? []) add(k, 3, true);
  add(project.name, 2.5);
  for (const t of tokens(project.name)) add(t, 2);
  const counts = new Map<string, number>();
  for (const t of tasks.filter((t) => t.projectId === project.id))
    for (const tok of new Set(tokens(t.title))) counts.set(tok, (counts.get(tok) ?? 0) + 1);
  for (const n of notes.filter((n) => n.projectId === project.id))
    for (const tok of new Set([...tokens(n.title), ...n.tags.flatMap(tokens)]))
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
  for (const [tok, count] of counts) if (count >= 2 && tok.length >= 3) add(tok, 0.8);
  return [...terms.values()];
}
export function scoreProject(text: string, project: Project, tasks: Task[] = [], notes: Note[] = []) {
  const haystack = normalize(text);
  let score = 0,
    high = false;
  const matched: string[] = [];
  if (!haystack) return { score, matched, high };
  for (const term of projectTerms(project, tasks, notes)) {
    if (haystack.includes(term.text)) {
      score += term.text.length * term.text.length * term.weight;
      matched.push(term.text);
      if (term.manual || term.text.length >= 3) high = true;
      continue;
    }
    const common = lcs(term.text, haystack);
    if (common.length >= 2 && !GENERIC.has(common)) {
      score += common.length * common.length * term.weight * 0.35;
      matched.push(common);
    }
  }
  return { score, matched: [...new Set(matched)].sort((a, b) => b.length - a.length).slice(0, 4), high };
}
export function suggestProject(
  text: string,
  projects: Project[],
  tasks: Task[] = [],
  notes: Note[] = [],
): ProjectSuggestion[] {
  return projects
    .map((p) => {
      const { score, matched, high } = scoreProject(text, p, tasks, notes);
      return {
        projectId: p.id,
        score: Math.round(score * 10) / 10,
        matched,
        confidence: high ? 'high' : 'low',
      } as const;
    })
    .filter((s) => s.score >= 4)
    .sort((a, b) => b.score - a.score || a.projectId.localeCompare(b.projectId));
}
// Tasks whose current project has no keyword hold on them but another project clearly does.
// Only high-confidence moves are proposed; the user reviews the list before anything changes.
export function autoAssignments(tasks: Task[], projects: Project[], notes: Note[] = []): Assignment[] {
  const out: Assignment[] = [];
  for (const task of tasks) {
    if (task.status === 'done') continue;
    const text = `${task.title} ${task.definition}`;
    const ranked = suggestProject(text, projects, tasks, notes);
    const best = ranked[0];
    if (!best || best.projectId === task.projectId || best.confidence !== 'high') continue;
    const current = ranked.find((s) => s.projectId === task.projectId);
    if (current && current.confidence === 'high' && current.score * 1.5 >= best.score) continue;
    out.push({ taskId: task.id, projectId: best.projectId, matched: best.matched, from: task.projectId });
  }
  return out;
}
// Graph edges through shared keywords: project ↔ keyword ↔ tasks whose text carries it.
export function keywordLinks(project: Project, tasks: Task[]) {
  const terms = projectTerms(project).filter((t) => t.manual || t.text.length >= 2);
  const links: { keyword: string; taskIds: string[] }[] = [];
  for (const term of terms) {
    const ids = tasks
      .filter((t) => normalize(`${t.title} ${t.definition}`).includes(term.text))
      .map((t) => t.id);
    if (ids.length) links.push({ keyword: term.text, taskIds: ids });
  }
  // A shorter term that only ever appears inside a longer matching term adds nothing to the picture.
  return links.filter(
    (l) =>
      !links.some(
        (o) =>
          o.keyword !== l.keyword &&
          o.keyword.includes(l.keyword) &&
          o.taskIds.length === l.taskIds.length &&
          o.taskIds.every((id) => l.taskIds.includes(id)),
      ),
  );
}
