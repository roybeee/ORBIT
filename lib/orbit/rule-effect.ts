import {addDays} from './dates.ts';
import type {Improvement,WorkspaceData} from './model.ts';

// Did the rule help? Compare the daily execution rate from saved reviews in the 14 days before
// the rule with the days since (up to 14). Needs three reviewed days on each side.
export function ruleEffect(data: WorkspaceData, rule: Pick<Improvement, 'createdOn'>, today: string) {
  const rate = (from: string, to: string) => data.reviews
    .filter(r => r.date >= from && r.date <= to && r.stats && r.stats.planned > 0)
    .map(r => r.stats!.executionRate);
  const before = rate(addDays(rule.createdOn, -14), addDays(rule.createdOn, -1));
  const after = rate(rule.createdOn, [addDays(rule.createdOn, 13), today].sort()[0]);
  if (before.length < 3 || after.length < 3) return null;
  // Review stats store the rate as a percentage (0–100).
  const mean = (v: number[]) => Math.round(v.reduce((s, x) => s + x, 0) / v.length);
  const b = mean(before), a = mean(after);
  return { before: b, after: a, delta: a - b, days: { before: before.length, after: after.length } };
}
