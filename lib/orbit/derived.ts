import type { WorkspaceData, Habit, Task, DailyReview } from './model.ts';
import { addDays } from './dates.ts';
export function focusIds(data: WorkspaceData, date: string) {
  return new Set([
    ...data.tasks.filter((t) => (t.focus && t.focusDate === date) || t.laserDate === date).map((t) => t.id),
    ...data.events
      .filter((e) => e.date === date && e.taskId && e.id.startsWith('approved:'))
      .map((e) => e.taskId!),
  ]);
}
// D+ streak: consecutive checked days ending today or yesterday (today may still be open).
export function habitStreak(habit: Habit, today: string) {
  const log = new Set(habit.log);
  let day = log.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (log.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}
export const habitDays = (habit: Habit) => habit.log.length;
export interface WeeklyStats {
  from: string;
  to: string;
  reviewedDays: number;
  planned: number;
  done: number;
  executionRate: number | null;
  predictionAccuracy: number | null;
  laserDays: number;
  laserMinutes: number;
  topReasons: { reason: NonNullable<Task['outcomeReason']>; count: number }[];
  newRules: number;
}
export function weeklyStats(data: WorkspaceData, endDate: string): WeeklyStats {
  const from = addDays(endDate, -6);
  const inRange = (d?: string) => !!d && d >= from && d <= endDate;
  const reviews: DailyReview[] = data.reviews.filter((r) => inRange(r.date) && r.stats);
  const planned = reviews.reduce((s, r) => s + (r.stats?.planned ?? 0), 0);
  const done = reviews.reduce((s, r) => s + (r.stats?.done ?? 0), 0);
  const ratios = data.tasks
    .filter((t) => t.outcome === 'done' && inRange(t.completedOn) && t.actualMinutes && t.duration)
    .map((t) => t.actualMinutes! / t.duration)
    .sort((a, b) => a - b);
  const median = ratios.length
    ? ratios.length % 2
      ? ratios[(ratios.length - 1) / 2]
      : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2
    : null;
  const reasons = new Map<NonNullable<Task['outcomeReason']>, number>();
  for (const t of data.tasks)
    if (t.outcomeReason && t.outcome !== 'done' && inRange(t.completedOn ?? t.due))
      reasons.set(t.outcomeReason, (reasons.get(t.outcomeReason) ?? 0) + 1);
  return {
    from,
    to: endDate,
    reviewedDays: reviews.length,
    planned,
    done,
    executionRate: planned ? Math.round((done / planned) * 100) : null,
    predictionAccuracy: median === null ? null : Math.round(median * 100) / 100,
    laserDays: reviews.filter((r) => (r.stats?.laserMinutes ?? 0) > 0).length,
    laserMinutes: reviews.reduce((s, r) => s + (r.stats?.laserMinutes ?? 0), 0),
    topReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3),
    newRules: (data.improvements ?? []).filter((i) => inRange(i.createdOn)).length,
  };
}
