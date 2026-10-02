import {addDays} from './dates.ts';
import {goalDescendants} from './pacemaker.ts';
import type {WorkspaceData} from './model.ts';

// 히스토리: one chronological feed of what already happened — finished and attempted work,
// meetings, notes (incl. Plaud and Gmail imports), reviews, decisions, routines and habits.
// Everything comes from records Orbit already keeps; the owner types nothing extra.

export type HistoryKind = 'done' | 'attempt' | 'meeting' | 'note' | 'event' | 'review' | 'decision' | 'routine' | 'habit';
export const historyKindLabel: Record<HistoryKind, string> = {
  done: '완료', attempt: '시도', meeting: '회의록', note: '메모·문서', event: '일정', review: '회고', decision: '결정', routine: '루틴', habit: '습관',
};
export type HistoryFilter = 'all' | 'work' | 'meetings' | 'notes' | 'reflection';
const FILTER: Record<HistoryFilter, HistoryKind[] | null> = {
  all: null,
  work: ['done', 'attempt'],
  meetings: ['meeting', 'event'],
  notes: ['note'],
  reflection: ['review', 'decision', 'routine', 'habit'],
};
export interface HistoryItem {
  kind: HistoryKind;
  id: string;
  // The record to open: task, note, event, or the review date.
  target?: { kind: 'task' | 'note' | 'event'; id: string } | { kind: 'review'; date: string };
  date: string;
  minute?: number;
  title: string;
  detail?: string;
  minutes?: number;
  projectId?: string;
  goalId?: string;
  source?: string;
}
export interface HistoryDay { date: string; items: HistoryItem[]; done: number; minutes: number; meetings: number }

const reasonWord: Record<string, string> = { time: '시간 부족', waiting: '외부 대기', priority: '우선순위 변경', scope: '범위 과대', energy: '에너지 부족', other: '기타' };
const kindOrder: Record<HistoryKind, number> = { review: 0, done: 1, attempt: 2, meeting: 3, event: 4, decision: 5, note: 6, routine: 7, habit: 8 };

export function historyItems(data: WorkspaceData, through: string): HistoryItem[] {
  const goalOf = new Map<string, string>();
  for (const p of data.projects) if (p.goalId) goalOf.set(p.id, p.goalId);
  const items: HistoryItem[] = [];
  const push = (item: HistoryItem) => { if (item.date <= through) items.push({ ...item, goalId: item.projectId ? goalOf.get(item.projectId) : undefined }); };
  for (const t of data.tasks) {
    if (t.status === 'done' && t.completedOn)
      push({ kind: 'done', id: 'done:' + t.id, target: { kind: 'task', id: t.id }, date: t.completedOn, title: t.title, minutes: t.actualMinutes ?? undefined, projectId: t.projectId, detail: t.result || (t.actualMinutes ? `실제 ${t.actualMinutes}분 · 예상 ${t.outcomeEstimateMinutes ?? t.duration}분` : undefined) });
    else if (t.outcome && t.outcome !== 'done' && t.outcomeOn)
      push({ kind: 'attempt', id: 'attempt:' + t.id, target: { kind: 'task', id: t.id }, date: t.outcomeOn, title: t.title, minutes: t.actualMinutes ?? undefined, projectId: t.projectId, detail: `${t.outcome === 'partial' ? '부분 △' : '못함 ✗'}${t.outcomeReason ? ' · ' + (reasonWord[t.outcomeReason] ?? t.outcomeReason) : ''}` });
  }
  for (const n of data.notes)
    push({ kind: n.kind === 'meeting' ? 'meeting' : 'note', id: 'note:' + n.id, target: { kind: 'note', id: n.id }, date: n.updated, title: n.title, detail: n.summary || undefined, projectId: n.projectId, source: n.source?.provider === 'plaud' ? 'Plaud' : n.source?.provider === 'gmail' ? 'Gmail' : n.tags.includes('빠른 기록') ? '빠른 기록' : undefined });
  for (const e of data.events)
    if (e.kind === 'meeting' && !e.taskId)
      push({ kind: 'event', id: 'event:' + e.id, target: { kind: 'event', id: e.id }, date: e.date, minute: e.allDay ? undefined : e.start, title: e.title, minutes: e.allDay ? undefined : e.end - e.start, projectId: e.projectId, source: e.google ? 'Google' : undefined });
  for (const r of data.reviews)
    push({ kind: 'review', id: 'review:' + r.date, target: { kind: 'review', date: r.date }, date: r.date, title: r.highlight || r.win || '하루 회고', detail: [r.stats ? `실행률 ${Math.round(r.stats.executionRate)}%` : '', r.block ? `막힌 점: ${r.block}` : '', r.carry ? `내일 규칙: ${r.carry}` : ''].filter(Boolean).join(' · ') || undefined });
  for (const d of data.decisions ?? [])
    push({ kind: 'decision', id: 'decision:' + d.id, date: d.createdAt.slice(0, 10), title: d.title, detail: d.choice, projectId: d.projectId });
  for (const r of data.careRoutines ?? [])
    for (const date of r.log) push({ kind: 'routine', id: `routine:${r.id}:${date}`, date, title: r.title, minutes: r.minutes });
  for (const h of data.habits ?? [])
    for (const date of h.log) push({ kind: 'habit', id: `habit:${h.id}:${date}`, date, title: h.mode === 'keep' ? h.title : `${h.title} 참기` });
  return items;
}

export interface HistoryQuery { through: string; days?: number; filter?: HistoryFilter; projectId?: string; goalId?: string; text?: string }
// Days with at least one matching record, newest first, inside [through - days + 1, through].
export function historyFeed(data: WorkspaceData, query: HistoryQuery) {
  const days = query.days ?? 14, from = addDays(query.through, -(days - 1));
  const kinds = FILTER[query.filter ?? 'all'];
  const goalIds = query.goalId ? goalDescendants(data, query.goalId) : null;
  const text = query.text?.trim().toLowerCase();
  const all = historyItems(data, query.through);
  const matched = all.filter(i =>
    i.date >= from &&
    (!kinds || kinds.includes(i.kind)) &&
    (!query.projectId || i.projectId === query.projectId) &&
    (!goalIds || (!!i.goalId && goalIds.has(i.goalId))) &&
    (!text || `${i.title} ${i.detail ?? ''}`.toLowerCase().includes(text)));
  const byDay = new Map<string, HistoryItem[]>();
  for (const i of matched) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
  const feed: HistoryDay[] = [...byDay].sort((a, b) => b[0].localeCompare(a[0])).map(([date, items]) => ({
    date,
    items: items.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || (a.minute ?? 0) - (b.minute ?? 0) || a.title.localeCompare(b.title)),
    done: items.filter(i => i.kind === 'done').length,
    minutes: items.reduce((s, i) => s + (i.kind === 'done' || i.kind === 'routine' || i.kind === 'event' ? i.minutes ?? 0 : 0), 0),
    meetings: items.filter(i => i.kind === 'meeting' || i.kind === 'event').length,
  }));
  const older = all.some(i => i.date < from && (!kinds || kinds.includes(i.kind)));
  return { from, feed, total: matched.length, older };
}
