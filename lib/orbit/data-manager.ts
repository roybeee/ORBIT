import type { WorkspaceData, Note } from './model.ts';
import { DomainError, validateLinks } from './reducer.ts';
import { overlaps } from './planner.ts';

export const dataCategories = ['projects', 'tasks', 'notes', 'events', 'goals', 'memories', 'habits', 'decisions', 'delegations'] as const;
export type DataCategory = typeof dataCategories[number];
export type DataRecord = { id: string; [key: string]: unknown };
export type DataSelection = { category: DataCategory; id: string };
export type TrashRecord = { id: string; category: DataCategory; recordId: string; title: string; deletedAt: string; record: DataRecord };
export const dataLabels: Record<DataCategory, string> = { projects: '프로젝트', tasks: '할 일', notes: '문서·회의록', events: '일정', goals: '목표', memories: '나에 대한 기록', habits: '습관', decisions: '의사결정', delegations: '위임 기록' };
export const categoryDescriptions: Record<DataCategory, string> = {
  projects: '할 일과 문서를 묶는 업무 단위', tasks: '진행 상태와 기한이 있는 실행 항목', notes: '회의록, 개인 위키, 참고 지식', events: '직접 등록한 일정과 연결한 캘린더', goals: '프로젝트가 향하는 목표', memories: '확인한 선호, 제약과 운영 원칙', habits: '지키거나 바꿀 습관', decisions: '선택한 내용과 판단의 근거', delegations: '담당자에게 맡긴 일과 결과',
};
export function recordsOf(data: WorkspaceData, category: DataCategory): DataRecord[] { return (data[category] ?? []) as unknown as DataRecord[]; }
export function recordTitle(record: DataRecord): string { return String(record.name ?? record.title ?? record.sentence ?? record.statement ?? record.id); }
export function recordSource(category: DataCategory, record: DataRecord): string {
  if (category === 'events' && record.id.startsWith('google:')) return 'Google Calendar';
  const source = record.source as Note['source'];
  if (source?.provider === 'plaud') return 'Plaud';
  if (source?.provider === 'gmail') return 'Gmail';
  if ((record.wiki as Note['wiki'])?.importedFrom) return '가져온 문서';
  return 'ORBIT';
}
export function editableRecord(category: DataCategory, record: DataRecord) { return category !== 'events' || !/^(google:|approved:)/.test(record.id); }
export function relatedRecords(data: WorkspaceData, selection: DataSelection): (DataSelection & { title: string })[] {
  const matches: (DataSelection & { title: string })[] = [];
  for (const category of dataCategories) for (const record of recordsOf(data, category)) {
    if (category === selection.category && record.id === selection.id) continue;
    const refs = selection.category === 'projects' ? record.projectId === selection.id
      : selection.category === 'goals' ? record.goalId === selection.id || category === 'goals' && record.parentId === selection.id
      : selection.category === 'tasks' ? record.taskId === selection.id || (record.dependsOn as string[] | undefined)?.includes(selection.id)
      : selection.category === 'notes' ? record.noteId === selection.id || (record.wiki as Note['wiki'])?.parentId === selection.id || (record.wiki as Note['wiki'])?.links.includes(selection.id)
      : false;
    const sources = record.sources as { kind: string; id: string }[] | undefined;
    if (refs || Array.isArray(sources) && sources.some(s => s.id === selection.id && s.kind === (selection.category === 'notes' ? 'note' : selection.category === 'tasks' ? 'task' : ''))) matches.push({ category, id: record.id, title: recordTitle(record) });
  }
  return matches;
}
export function planDataTrash(current: WorkspaceData, selection: DataSelection[]): { next: WorkspaceData; records: { category: DataCategory; record: DataRecord }[] } {
  if (!selection.length || selection.length > 100) throw new DomainError('한 번에 1~100개 항목을 선택해 주세요.');
  const keys = new Set(selection.map(s => s.category + ':' + s.id));
  if (keys.size !== selection.length) throw new DomainError('같은 항목을 중복 선택할 수 없습니다.');
  const records = selection.map(s => {
    const record = recordsOf(current, s.category).find(r => r.id === s.id);
    if (!record) throw new DomainError('항목이 변경되었거나 이미 삭제되었습니다. 목록을 새로고침해 주세요.');
    if (!editableRecord(s.category, record)) throw new DomainError(record.id.startsWith('google:') ? 'Google 일정은 일정 화면에서 원본을 관리해 주세요.' : '승인한 집중 시간은 내일 제안에서 승인을 취소해 주세요.');
    const related = relatedRecords(current, s).filter(r => !keys.has(r.category + ':' + r.id));
    if (related.length) throw new DomainError(`${recordTitle(record)}에 연결된 ${related.length}개 항목을 먼저 정리해 주세요: ${related.slice(0, 3).map(r => r.title).join(', ')}`);
    return { category: s.category, record: structuredClone(record) };
  });
  const next = structuredClone(current);
  for (const category of dataCategories) (next as unknown as Record<string, unknown>)[category] = recordsOf(next, category).filter(r => !keys.has(category + ':' + r.id));
  if (next.dominoProjectId && keys.has('projects:' + next.dominoProjectId)) delete next.dominoProjectId;
  const taskIds = new Set(selection.filter(s => s.category === 'tasks').map(s => s.id));
  next.proposals = next.proposals.map(p => ({ ...p, items: p.items.filter(i => !taskIds.has(i.taskId)), unscheduled: p.unscheduled.filter(id => !taskIds.has(id)), delegate: p.delegate?.filter(id => !taskIds.has(id)), laser: p.laser?.taskId && taskIds.has(p.laser.taskId) ? { status: 'none', minutes: 0, note: '삭제된 할 일입니다. 제안을 다시 생성해 주세요.' } : p.laser }));
  validateLinks(next);
  return { next, records };
}
export function planDataRestore(current: WorkspaceData, entries: TrashRecord[]): WorkspaceData {
  const next = structuredClone(current);
  for (const entry of entries) {
    const list = recordsOf(next, entry.category);
    if (list.some(r => r.id === entry.recordId)) throw new DomainError('같은 번호의 항목이 이미 있습니다. 기존 데이터를 덮어쓰지 않았습니다.');
    const record = structuredClone(entry.record);
    if (entry.category === 'tasks') for (const key of ['startedAt', 'focusDate', 'laserDate', 'planHoldUntil', 'planHoldReason', 'planHoldProposalId']) delete record[key];
    if (entry.category === 'tasks') record.focus = false;
    if (entry.category === 'events') {
      if (!editableRecord(entry.category, record)) throw new DomainError('외부 일정과 승인 시간은 복원할 수 없습니다.');
      if (next.events.some(e => e.date === record.date && overlaps(e, record as unknown as { start: number; end: number }))) throw new DomainError('복원할 시간에 다른 일정이 있습니다. 현재 일정을 먼저 조정해 주세요.');
    }
    (next as unknown as Record<string, unknown>)[entry.category] = [...list, record];
  }
  validateLinks(next);
  // References not covered by the general workspace validator are also preserved.
  for (const entry of entries) {
    const record = entry.record;
    if (entry.category === 'notes') {
      const wiki = record.wiki as Note['wiki'];
      if (wiki?.parentId && !next.notes.some(n => n.id === wiki.parentId)) throw new DomainError('상위 문서를 먼저 복원해 주세요.');
      if (wiki?.links.some(id => !next.notes.some(n => n.id === id))) throw new DomainError('연결 문서를 함께 복원해 주세요.');
    }
    if (entry.category === 'memories') for (const source of (record.sources ?? []) as { kind: string; id: string }[]) {
      const found = source.kind === 'note' ? next.notes.some(n => n.id === source.id) : source.kind === 'task' ? next.tasks.some(t => t.id === source.id) : next.reviews.some(r => r.date === source.id);
      if (!found) throw new DomainError('근거 기록을 먼저 복원해 주세요.');
    }
  }
  return next;
}
