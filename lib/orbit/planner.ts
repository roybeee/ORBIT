import {
  withDefaults,
  DEFAULT_PREFERENCES,
  type Task,
  type CalendarEvent,
  type ProposalItem,
  type Proposal,
  type Preferences,
  type Quadrant,
  type Cognition,
} from './model.ts';
import { addDays } from './dates.ts';
export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && a.end > b.start;
}
export function availableWindows(events: CalendarEvent[], date: string, workStart = 540, workEnd = 1080) {
  const busy = events
    .filter((e) => e.date === date && e.end > workStart && e.start < workEnd)
    .map((e) => ({ start: Math.max(workStart, e.start), end: Math.min(workEnd, e.end) }))
    .sort((a, b) => a.start - b.start);
  let cursor = workStart;
  const windows: { start: number; end: number }[] = [];
  for (const event of busy) {
    if (event.start > cursor) windows.push({ start: cursor, end: event.start });
    cursor = Math.max(cursor, event.end);
  }
  if (cursor < workEnd) windows.push({ start: cursor, end: workEnd });
  return windows;
}
// GoTEM Eisenhower quadrant. Explicit user choice wins; otherwise impact and due date decide.
export function inferQuadrant(task: Task, date: string): Quadrant {
  if (task.quadrant) return task.quadrant;
  const important = task.impact >= 4;
  const urgent = task.due <= addDays(date, 2);
  return important ? (urgent ? 'A' : 'B') : urgent ? 'C' : 'D';
}
export const taskCognition = (task: Task): Cognition => task.cognition ?? 'mid';
const QUADRANT_ORDER: Record<Quadrant, number> = { B: 0, A: 1, C: 2, D: 3 };
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};
// PAFI improvement: median(actual / estimate) of recent completed work of the same kind.
// Falls back from project+cognition to cognition to everything; needs five samples to act.
export function calibrationFactor(tasks: Task[], task: Task, date: string) {
  const since = addDays(date, -30);
  const samples = tasks.filter(
    (t) =>
      t.id !== task.id &&
      t.outcome === 'done' &&
      typeof t.actualMinutes === 'number' &&
      t.actualMinutes > 0 &&
      t.duration > 0 &&
      (t.completedOn ?? '') >= since && (t.completedOn ?? '') <= date,
  );
  const ratios = (list: Task[]) => list.map((t) => t.actualMinutes! / t.duration);
  const cognition = taskCognition(task);
  const tiers = [
    samples.filter((t) => t.projectId === task.projectId && taskCognition(t) === cognition),
    samples.filter((t) => taskCognition(t) === cognition),
    samples,
  ];
  for (const tier of tiers)
    if (tier.length >= 5) return Math.round(Math.min(2, Math.max(0.5, median(ratios(tier)))) * 100) / 100;
  return 1;
}
export const calibrate = (duration: number, factor: number) =>
  Math.min(480, Math.max(5, Math.round((duration * factor) / 5) * 5));
export interface PlannerOptions {
  dominoProjectId?: string;
  calibration?: (task: Task) => number;
  // Strategic ranking from the one-page brief: only these tasks, in this order.
  ordered?: string[];
  // Explicit Goal Laser choice (the brief's first priority); otherwise the domino heuristic decides.
  laserTaskId?: string;
}
const quadrantWord: Record<Quadrant, string> = {
  A: '중요하고 급한 A',
  B: '중요하지만 급하지 않은 B',
  C: '급하지만 중요하지 않은 C',
  D: 'D',
};
const cognitionWord: Record<Cognition, string> = {
  high: '고위 인지 업무라 집중이 가장 좋은 구간',
  mid: '중위 인지 업무라 오후 구간',
  low: '저위 인지 업무라 자투리 구간',
  external: '외부 일정이라 집중 구간 밖',
};
type Window = { start: number; end: number };
export function generateProposal(
  tasks: Task[],
  events: CalendarEvent[],
  date: string,
  energy: Proposal['energy'] = 'normal',
  previous?: Proposal,
  preferences?: Preferences,
  options: PlannerOptions = {},
): Proposal {
  const prefs = withDefaults(preferences ?? DEFAULT_PREFERENCES);
  const workStart = preferences?.workStart ?? 540,
    workEnd = preferences?.workEnd ?? 1080,
    focusLimit = preferences?.focusLimit ?? 3,
    breakMinutes = preferences?.breakMinutes ?? 10,
    bufferFraction = preferences?.bufferFraction ?? 0.2;
  const retained = previous?.date === date ? previous.items.filter((i) => i.state !== 'pending') : [];
  const reserved = retained
    .filter((i) => i.state === 'approved')
    .map((i) => ({
      id: i.id,
      title: '승인한 집중 시간',
      date,
      start: i.start,
      end: i.end,
      kind: 'focus' as const,
      taskId: i.taskId,
    }));
  const reservations: CalendarEvent[] = events
    .filter((e) => !reserved.some((r) => r.taskId === e.taskId && e.date === date))
    .concat(reserved);
  // GoTEM: fill meals and travel before anything else. Lunch and meeting travel become busy time.
  const synthetic: CalendarEvent[] = [];
  if (prefs.rhythm.lunchEnd > prefs.rhythm.lunchStart)
    synthetic.push({
      id: 'lunch',
      title: '점심',
      date,
      start: prefs.rhythm.lunchStart,
      end: prefs.rhythm.lunchEnd,
      kind: 'break',
    });
  if (prefs.travelMinutes > 0)
    for (const e of reservations.filter((e) => e.date === date && e.kind === 'meeting'))
      synthetic.push(
        {
          id: `travel-before:${e.id}`,
          title: '이동',
          date,
          start: Math.max(0, e.start - prefs.travelMinutes),
          end: e.start,
          kind: 'break',
        },
        {
          id: `travel-after:${e.id}`,
          title: '이동',
          date,
          start: e.end,
          end: Math.min(1440, e.end + prefs.travelMinutes),
          kind: 'break',
        },
      );
  const workday = new Date(date + 'T12:00:00Z').getUTCDay();
  const windows: Window[] =
    preferences && !preferences.workDays.includes(workday)
      ? []
      : availableWindows([...reservations, ...synthetic], date, workStart, workEnd);
  const free = windows.reduce((sum, w) => sum + w.end - w.start, 0);
  const budget = Math.floor(
    free *
      {
        low: Math.min(0.5, 1 - bufferFraction),
        normal: 1 - bufferFraction,
        high: 1 - bufferFraction,
      }[energy],
  );
  let remaining = budget;
  const isReady = (t: Task) =>
    t.status !== 'waiting' &&
    t.status !== 'done' &&
    (!t.planHoldUntil || t.planHoldUntil <= date) &&
    !(t.dependsOn ?? []).some((id) => tasks.find((t) => t.id === id)?.status !== 'done');
  const ordered = options.ordered;
  const rank = (id: string) => (ordered ? ordered.indexOf(id) : 0);
  const candidates = tasks.filter(
    (t) =>
      (!ordered || ordered.includes(t.id)) &&
      isReady(t) &&
      Number.isFinite(t.duration) &&
      t.duration >= 1 &&
      !retained.some((i) => i.taskId === t.id) &&
      !events.some((e) => e.date === date && e.taskId === t.id),
  );
  const score = (t: Task) =>
    t.impact * 10 +
    (t.due <= date ? 30 : 0) +
    (t.focus ? 15 : 0) +
    (t.must ? 12 : 0) +
    (t.status === 'doing' ? 5 : 0) +
    (energy === 'high' && t.duration >= 60 ? 8 : energy === 'low' && t.duration <= 30 ? 8 : 0);
  const factorOf = (t: Task) => options.calibration?.(t) ?? 1;
  const planned = (t: Task) => calibrate(t.duration, factorOf(t));
  const items: ProposalItem[] = [...retained];
  const unscheduled: string[] = [];
  const delegate: string[] = [];
  const count = () => items.filter((i) => i.state !== 'deferred').length;
  const peak = { start: prefs.rhythm.peakStart, end: prefs.rhythm.peakEnd };
  const fitting = (w: Window, minutes: number) => w.end - w.start >= minutes;
  const inPeak = (w: Window) => overlaps(w, peak);
  const afterLunch = (w: Window) => w.start >= prefs.rhythm.lunchEnd;
  // Placement preference follows an explicit cognition level only; unlabelled work takes the earliest slot.
  const preferredWindows = (cognition: Cognition | undefined, minutes: number): Window[] => {
    const ok = windows.filter((w) => fitting(w, minutes));
    const byStart = (a: Window, b: Window) => a.start - b.start;
    const byLength = (a: Window, b: Window) => a.end - a.start - (b.end - b.start);
    if (!cognition) return [...ok].sort(byStart);
    if (cognition === 'high')
      return [...ok.filter(inPeak).sort(byStart), ...ok.filter((w) => !inPeak(w)).sort(byStart)];
    if (cognition === 'external')
      return [...ok.filter((w) => !inPeak(w)).sort(byStart), ...ok.filter(inPeak).sort(byStart)];
    if (cognition === 'low') return [...ok].sort(byLength);
    return [...ok.filter(afterLunch).sort(byStart), ...ok.filter((w) => !afterLunch(w)).sort(byStart)];
  };
  const take = (w: Window, minutes: number) => {
    const start = w.start,
      end = start + minutes;
    w.start = end + breakMinutes;
    if (w.end - w.start < 5) windows.splice(windows.indexOf(w), 1);
    return { start, end };
  };
  // Says where the block actually landed: the preferred window may have been full.
  const placementWord = (c: Cognition | undefined, slot: Window) => {
    if (!c) return '가장 이른 빈 구간에 두었습니다.';
    const placedInPeak = overlaps(slot, peak);
    if (c === 'high' && !placedInPeak)
      return '고위 인지 업무지만 집중 구간이 이미 찼거나 짧아 그다음 빈 구간에 두었습니다.';
    if (c === 'external' && placedInPeak)
      return '외부 일정이지만 다른 빈 구간이 없어 집중 구간에 두었습니다.';
    if (c === 'mid' && !afterLunch(slot)) return '중위 인지 업무를 오전 빈 구간에 두었습니다.';
    return cognitionWord[c] + '에 두었습니다.';
  };
  const reasonFor = (
    t: Task,
    q: Quadrant,
    c: Cognition | undefined,
    minutes: number,
    factor: number,
    role: ProposalItem['role'],
    slot: Window,
  ) =>
    `${role === 'laser' ? '오늘의 Goal Laser입니다. ' : ''}${quadrantWord[q]} 업무${t.due <= date ? '로 마감이 도래했습니다' : '입니다'}. ${placementWord(c, slot)}${
      factor !== 1
        ? ` 최근 같은 종류의 일이 예상의 ${factor}배 걸려 ${minutes}분으로 보정했습니다.`
        : ` 고정 일정과 겹치지 않는 ${minutes}분을 확보했습니다.`
    }${t.status === 'doing' ? ' 진행하던 일을 마무리하면 작업 전환을 줄일 수 있습니다.' : ''}${energy === 'low' ? ' 낮은 에너지를 반영해 여유 시간을 늘렸습니다.' : ''}`;
  const placeTask = (t: Task) => {
    const q = inferQuadrant(t, date),
      c = t.cognition,
      must = !!t.must || t.due <= date;
    const minutes = planned(t);
    const factor = factorOf(t);
    const w = preferredWindows(c, minutes)[0];
    if (minutes > remaining || !w || count() >= focusLimit) {
      unscheduled.push(t.id);
      return;
    }
    const slot = take(w, minutes);
    items.push({
      id: `${date}:${t.id}`,
      taskId: t.id,
      start: slot.start,
      end: slot.end,
      state: 'pending',
      role: must ? 'must' : 'fill',
      quadrant: q,
      cognition: taskCognition(t),
      factor,
      estimate: t.duration,
      reason: reasonFor(t, q, c, minutes, factor, must ? 'must' : 'fill', slot),
    });
    remaining -= minutes;
  };
  // 0. Priorities the brief ranked above the Goal Laser (quick unblockers) keep their earlier slots.
  if (ordered && options.laserTaskId && ordered.indexOf(options.laserTaskId) > 0)
    for (const id of ordered.slice(0, ordered.indexOf(options.laserTaskId))) {
      const t = candidates.find((x) => x.id === id);
      if (t) placeTask(t);
    }
  // 1. Goal Laser: the domino project's best ready task takes the peak window first.
  let laser: Proposal['laser'] = {
    status: 'none',
    minutes: 0,
    note: options.ordered
      ? '제안의 우선순위 중 연속 집중이 필요한 고위 인지 업무가 없어 Goal Laser를 두지 않았습니다.'
      : '도미노 프로젝트가 지정되지 않았습니다.',
  };
  const retainedLaser = retained.find((i) => i.role === 'laser');
  if (retainedLaser)
    laser = {
      taskId: retainedLaser.taskId,
      status: 'placed',
      minutes: retainedLaser.end - retainedLaser.start,
      note: '이전 결정을 유지했습니다.',
    };
  else if (options.laserTaskId || (options.dominoProjectId && !options.ordered)) {
    const chosen = options.laserTaskId ? candidates.find((t) => t.id === options.laserTaskId) : undefined;
    const pool = candidates
      .filter((t) => t.projectId === options.dominoProjectId)
      .sort(
        (a, b) =>
          Number(taskCognition(b) === 'high') - Number(taskCognition(a) === 'high') ||
          score(b) - score(a) ||
          a.due.localeCompare(b.due) ||
          a.id.localeCompare(b.id),
      );
    const task = chosen ?? (options.laserTaskId ? undefined : pool[0]);
    if (!task)
      laser = {
        status: 'none',
        minutes: 0,
        note: options.laserTaskId
          ? '제안의 1순위 업무를 지금 배치할 수 없어 Goal Laser를 두지 않았습니다.'
          : '도미노 프로젝트에 지금 진행할 수 있는 할 일이 없습니다.',
      };
    else {
      const need = planned(task);
      const longest = windows.reduce((m, w) => Math.max(m, w.end - w.start), 0);
      const factor = factorOf(task);
      if (need > remaining || need > longest)
        laser = {
          taskId: task.id,
          status: 'failed',
          minutes: 0,
          note: `가장 긴 빈 구간이 ${longest}분이고 예산이 ${remaining}분이라 ${need}분짜리 Goal Laser를 놓지 못했습니다. 회의를 옮기거나 일을 쪼개 주세요.`,
        };
      else {
        const target = Math.min(Math.max(need, prefs.laserMinutes), remaining, longest);
        const preferred = [
          ...windows.filter((w) => fitting(w, target) && inPeak(w)),
          ...windows.filter((w) => fitting(w, target) && !inPeak(w)),
        ];
        const w = preferred[0];
        const slot = take(w, target);
        items.push({
          id: `${date}:${task.id}`,
          taskId: task.id,
          start: slot.start,
          end: slot.end,
          state: 'pending',
          role: 'laser',
          quadrant: inferQuadrant(task, date),
          cognition: taskCognition(task),
          factor,
          estimate: task.duration,
          reason: reasonFor(
            task,
            inferQuadrant(task, date),
            taskCognition(task),
            target,
            factor,
            'laser',
            slot,
          ),
        });
        remaining -= target;
        laser = {
          taskId: task.id,
          status: 'placed',
          minutes: target,
          note:
            (target >= prefs.laserMinutes
              ? `${target}분을 연속으로 확보했습니다.`
              : `목표 ${prefs.laserMinutes}분 중 ${target}분만 확보했습니다.`) +
            (options.dominoProjectId && task.projectId !== options.dominoProjectId
              ? ' 제안의 1순위가 도미노 프로젝트 밖의 업무라 그대로 따랐습니다.'
              : ''),
        };
      }
    }
  }
  // 2. Everything else: must-close first, then B → A → C by score. D is never scheduled.
  const rest = candidates
    .filter((t) => !items.some((i) => i.taskId === t.id) && !unscheduled.includes(t.id))
    .map((t) => ({ t, q: inferQuadrant(t, date), c: t.cognition, must: !!t.must || t.due <= date }));
  // An explicit 반드시 종결 mark is the user's commitment for the day and overrides D delegation.
  for (const { t, q, must } of rest) if (q === 'D' && !must) delegate.push(t.id);
  rest
    .filter(({ q, must }) => q !== 'D' || must)
    .sort(
      (a, b) =>
        rank(a.t.id) - rank(b.t.id) ||
        Number(b.must) - Number(a.must) ||
        QUADRANT_ORDER[a.q] - QUADRANT_ORDER[b.q] ||
        score(b.t) - score(a.t) ||
        a.t.due.localeCompare(b.t.due) ||
        a.t.id.localeCompare(b.t.id),
    )
    .forEach(({ t }) => placeTask(t));
  return {
    ...(previous?.brief ? { brief: previous.brief, draftTasks: previous.draftTasks } : {}),
    id: `plan:${date}`,
    date,
    items: items.sort((a, b) => a.start - b.start),
    unscheduled,
    budget,
    energy,
    laser,
    delegate,
  };
}
export function approveProposalItem(
  proposal: Proposal,
  itemId: string,
  tasks: Task[],
  events: CalendarEvent[],
): { proposal: Proposal; events: CalendarEvent[]; error?: string } {
  const item = proposal.items.find((i) => i.id === itemId);
  const task = tasks.find((t) => t.id === item?.taskId);
  if (!item || !task) return { proposal, events, error: '항목을 찾을 수 없습니다.' };
  if (item.state === 'approved') return { proposal, events };
  if (item.state !== 'pending') return { proposal, events, error: '보류한 항목을 먼저 다시 검토해 주세요.' };
  if (
    task.status === 'done' ||
    task.status === 'waiting' ||
    (task.planHoldUntil && task.planHoldUntil > proposal.date) ||
    (task.dependsOn ?? []).some((id) => tasks.find((t) => t.id === id)?.status !== 'done')
  )
    return { proposal, events, error: '업무 상태가 바뀌었습니다. 제안을 다시 생성해 주세요.' };
  // The estimate the block was planned from must still hold (calibrated and Laser blocks differ from it).
  if (task.duration !== (item.estimate ?? item.end - item.start))
    return { proposal, events, error: '업무의 예상 시간이 변경됐습니다. 최신 진척으로 다시 분석해 주세요.' };
  if (events.some((e) => e.date === proposal.date && overlaps(e, item)))
    return { proposal, events, error: '다른 일정과 겹칩니다. 제안을 다시 생성해 주세요.' };
  const event: CalendarEvent = {
    id: `approved:${item.id}`,
    title: task.title,
    date: proposal.date,
    start: item.start,
    end: item.end,
    kind: 'focus',
    projectId: task.projectId,
    taskId: task.id,
  };
  return {
    proposal: {
      ...proposal,
      items: proposal.items.map((i) => (i.id === itemId ? { ...i, state: 'approved' } : i)),
    },
    events: [...events, event],
  };
}
