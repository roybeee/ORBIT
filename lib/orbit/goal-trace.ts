import {addDays} from './dates.ts';
import {goalDescendants} from './pacemaker.ts';
import type {Goal,WorkspaceData} from './model.ts';

// 궤도 추적: what the owner's own history — finished tasks, executed minutes, meetings,
// notes and care routines — has contributed to each goal, with no extra input. Counts are
// derived from saved records only; nothing here changes a goal's measured result.

export type TraceKind = 'task' | 'meeting' | 'note' | 'event' | 'routine';
export interface TraceItem { kind: TraceKind; id: string; title: string; date: string; minutes?: number; projectId?: string }
export interface TraceTotals { done: number; minutes: number; meetings: number; notes: number; routines: number }
export type Momentum = 'rising' | 'steady' | 'falling' | 'idle' | 'new';
export interface GoalTrace {
  goal: Goal;
  projectIds: string[];
  current: TraceTotals;
  previous: TraceTotals;
  momentum: Momentum;
  lastActivity?: string;
  idleDays?: number;
  recent: TraceItem[];
}
export interface Alignment {
  done: number;
  aligned: number;
  ratio: number | null;
  minutes: number;
  alignedMinutes: number;
  unlinked: { projectId: string; name: string; done: number; minutes: number }[];
}

const empty = (): TraceTotals => ({ done: 0, minutes: 0, meetings: 0, notes: 0, routines: 0 });
const score = (t: TraceTotals) => t.done + t.minutes / 30 + (t.meetings + t.notes) * 0.5 + t.routines * 0.5;
const dayNumber = (date: string) => Math.round(Date.parse(date + 'T00:00:00Z') / 86400000);

// Every dated record that can be attributed to a project or goal.
export function activity(data: WorkspaceData, through: string): TraceItem[] {
  const items: TraceItem[] = [];
  for (const t of data.tasks)
    if (t.status === 'done' && t.completedOn && t.completedOn <= through)
      items.push({ kind: 'task', id: t.id, title: t.title, date: t.completedOn, minutes: t.actualMinutes ?? t.duration, projectId: t.projectId });
  for (const n of data.notes)
    if (n.updated <= through) items.push({ kind: n.kind === 'meeting' ? 'meeting' : 'note', id: n.id, title: n.title, date: n.updated, projectId: n.projectId });
  for (const e of data.events)
    if (e.kind === 'meeting' && e.date <= through && e.projectId && !e.taskId)
      items.push({ kind: 'event', id: e.id, title: e.title, date: e.date, minutes: e.allDay ? undefined : e.end - e.start, projectId: e.projectId });
  return items;
}

function routineItems(data: WorkspaceData, goalIds: Set<string>, through: string): TraceItem[] {
  return (data.careRoutines ?? []).filter(r => r.goalId && goalIds.has(r.goalId))
    .flatMap(r => r.log.filter(date => date <= through).map(date => ({ kind: 'routine' as const, id: `${r.id}:${date}`, title: r.title, date, minutes: r.minutes })));
}

function totals(items: TraceItem[], from: string, to: string): TraceTotals {
  const out = empty();
  for (const i of items) {
    if (i.date < from || i.date > to) continue;
    if (i.kind === 'task') { out.done++; out.minutes += i.minutes ?? 0; }
    else if (i.kind === 'meeting') out.meetings++;
    else if (i.kind === 'event') { out.meetings++; out.minutes += i.minutes ?? 0; }
    else if (i.kind === 'note') out.notes++;
    else { out.routines++; out.minutes += i.minutes ?? 0; }
  }
  return out;
}

function momentum(current: TraceTotals, previous: TraceTotals, hasHistory: boolean): Momentum {
  const now = score(current), before = score(previous);
  if (!now) return hasHistory ? 'idle' : 'new';
  if (!before) return 'rising';
  if (now > before * 1.25 + 0.5) return 'rising';
  if (now < before * 0.75 - 0.5) return 'falling';
  return 'steady';
}

export function goalTrace(data: WorkspaceData, today: string, days = 7): { goals: GoalTrace[]; alignment: Alignment } {
  const from = addDays(today, -(days - 1)), prevFrom = addDays(from, -days), prevTo = addDays(from, -1);
  const all = activity(data, today);
  const goals = (data.goals ?? []).map(goal => {
    const ids = goalDescendants(data, goal.id);
    const projectIds = data.projects.filter(p => p.goalId && ids.has(p.goalId)).map(p => p.id);
    const set = new Set(projectIds);
    const items = [...all.filter(i => i.projectId && set.has(i.projectId)), ...routineItems(data, ids, today)]
      .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
    const current = totals(items, from, today), previous = totals(items, prevFrom, prevTo);
    const lastActivity = items[0]?.date;
    return {
      goal, projectIds, current, previous,
      momentum: momentum(current, previous, !!lastActivity),
      lastActivity,
      idleDays: lastActivity ? dayNumber(today) - dayNumber(lastActivity) : undefined,
      recent: items.filter(i => i.date >= from).slice(0, 6),
    };
  });
  // Alignment: how much of this window's finished work served an active goal.
  const activeGoalIds = new Set((data.goals ?? []).filter(g => (g.status ?? 'active') === 'active').flatMap(g => [...goalDescendants(data, g.id)]));
  const aligned = new Set(data.projects.filter(p => p.goalId && activeGoalIds.has(p.goalId)).map(p => p.id));
  const finished = all.filter(i => i.kind === 'task' && i.date >= from && i.date <= today);
  const byProject = new Map<string, { done: number; minutes: number }>();
  for (const i of finished) if (!aligned.has(i.projectId!)) {
    const row = byProject.get(i.projectId!) ?? { done: 0, minutes: 0 };
    row.done++; row.minutes += i.minutes ?? 0; byProject.set(i.projectId!, row);
  }
  const alignedItems = finished.filter(i => aligned.has(i.projectId!));
  const minutes = finished.reduce((s, i) => s + (i.minutes ?? 0), 0), alignedMinutes = alignedItems.reduce((s, i) => s + (i.minutes ?? 0), 0);
  return {
    goals,
    alignment: {
      done: finished.length, aligned: alignedItems.length,
      ratio: finished.length && activeGoalIds.size ? alignedItems.length / finished.length : null,
      minutes, alignedMinutes,
      unlinked: [...byProject].map(([projectId, v]) => ({ projectId, name: data.projects.find(p => p.id === projectId)?.name ?? '프로젝트', ...v }))
        .sort((a, b) => b.minutes - a.minutes || b.done - a.done).slice(0, 3),
    },
  };
}

// The one sentence Today and the AI brief share: where the week's effort went and which
// active goal has gone quiet. Null when there is nothing to say.
export function orbitCheck(data: WorkspaceData, today: string) {
  const { goals, alignment } = goalTrace(data, today);
  const active = goals.filter(g => (g.goal.status ?? 'active') === 'active');
  if (!active.length) return null;
  const quiet = active.filter(g => g.momentum === 'idle' && (g.idleDays ?? 0) >= 7 || g.momentum === 'new')
    .sort((a, b) => (b.idleDays ?? 999) - (a.idleDays ?? 999));
  const falling = active.filter(g => g.momentum === 'falling');
  return { alignment, quiet, falling, active };
}

// Compact form for the AI brief: lets the next-day plan favour a goal that has gone quiet.
export function goalMomentumSummary(data: WorkspaceData, today: string) {
  const { goals, alignment } = goalTrace(data, today);
  return {
    window: `${addDays(today, -6)}~${today}`,
    alignedShare: alignment.ratio === null ? null : Math.round(alignment.ratio * 100) / 100,
    goals: goals.filter(g => (g.goal.status ?? 'active') === 'active').map(g => ({
      goalId: g.goal.id, sentence: g.goal.sentence, momentum: g.momentum, idleDays: g.idleDays ?? null,
      last7: { done: g.current.done, minutes: g.current.minutes, meetings: g.current.meetings, notes: g.current.notes },
    })),
  };
}

const INBOXES = new Set(['capture-inbox', 'plaud-inbox']);
const words = (text: string) => new Set(text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 2));
// Projects with recent activity that no goal claims yet, each with the goal whose words overlap
// most (a suggestion only; the owner links with one tap).
export function unlinkedProjects(data: WorkspaceData, today: string, days = 14) {
  const from = addDays(today, -(days - 1));
  const active = (data.goals ?? []).filter(g => (g.status ?? 'active') === 'active');
  if (!active.length) return [];
  const recent = activity(data, today).filter(i => i.date >= from && i.projectId);
  return data.projects
    .filter(p => !p.goalId && !INBOXES.has(p.id) && p.status !== 'completed')
    .map(p => {
      const items = recent.filter(i => i.projectId === p.id);
      const text = words([p.name, p.goal, ...(p.keywords ?? []), ...items.map(i => i.title)].join(' '));
      const ranked = active.map(g => ({ goal: g, score: [...words(g.sentence)].filter(w => [...text].some(t => t.includes(w) || w.includes(t))).length }))
        .sort((a, b) => b.score - a.score);
      return { project: p, count: items.length, minutes: items.reduce((s, i) => s + (i.minutes ?? 0), 0), suggested: ranked[0]?.score ? ranked[0].goal : undefined };
    })
    .filter(r => r.count > 0)
    .sort((a, b) => b.minutes - a.minutes || b.count - a.count);
}

// Monday's look back at the previous week (Mon–Sun), for one notice per week.
export function weeklyOrbitReport(data: WorkspaceData, today: string) {
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  if (dow !== 1) return null;
  const lastSunday = addDays(today, -1);
  const { goals, alignment } = goalTrace(data, lastSunday, 7);
  const active = goals.filter(g => (g.goal.status ?? 'active') === 'active');
  if (!active.length && !alignment.done) return null;
  const quiet = active.filter(g => !g.current.done && !g.current.minutes && !g.current.meetings && !g.current.notes);
  const best = [...active].sort((a, b) => b.current.done - a.current.done || b.current.minutes - a.current.minutes)[0];
  const share = alignment.ratio === null ? null : Math.round(alignment.ratio * 100);
  const lines = [
    `완료 ${alignment.done}건${share === null ? '' : ` · 목표로 이어진 비율 ${share}%`}`,
    best && (best.current.done || best.current.minutes) ? `가장 많이 나아간 목표: ‘${best.goal.sentence}’ (완료 ${best.current.done})` : '',
    quiet.length ? `기록이 없던 목표: ${quiet.slice(0, 2).map(g => `‘${g.goal.sentence}’`).join(', ')}` : '',
  ].filter(Boolean);
  return { id: `weekly-orbit:${today}`, kind: 'info' as const, title: '지난주 궤도 리포트', body: lines.join('\n'), href: '/#goals' };
}
