import type {Improvement,Preferences} from './model.ts';

// 규칙 ★ → 계획: the rules the owner wrote in reviews ("다음부터 지킬 규칙") change the next
// deterministic plan, not only the AI's reading of it. Each rule maps to at most a few
// conservative, explainable effects; a rule that names nothing the planner can act on is
// left to the AI brief and never guessed into a constraint.

export type RuleEffectKind = 'buffer' | 'estimate' | 'limit' | 'external-window' | 'decline';
export interface RuleEffect { id: string; rule: string; kind: RuleEffectKind; note: string }
export interface PlanRules {
  breakMinutes?: number;
  bufferFraction?: number;
  // Lowest estimate factor to use when calibration has no evidence of its own.
  minFactor?: number;
  focusLimit?: number;
  // External work (meetings, calls) only inside [after, before).
  externalAfter?: number;
  externalBefore?: number;
  // Urgent-but-not-important (C) work that is not due today goes to the delegate list.
  declineC?: boolean;
  applied: RuleEffect[];
}

const EXTERNAL = /(미팅|회의|통화|전화|외부|약속|콜(?![가-힣])|미팅을|면담)/;
const NEGATE = /(금지|안\s*잡|잡지\s*않|않|없이|빼|피하|말기|말자|X)/;
const hourOf = (text: string) => {
  const m = /(오전|오후)?\s*(\d{1,2})\s*시/.exec(text);
  if (!m) return undefined;
  let h = Number(m[2]);
  if (m[1] === '오후' && h < 12) h += 12;
  else if (!m[1] && h >= 1 && h <= 7) h += 12;
  return h >= 0 && h <= 23 ? h * 60 : undefined;
};

export function planRules(improvements: Improvement[] | undefined, preferences: Preferences): PlanRules {
  const out: PlanRules = { applied: [] };
  const lunchStart = preferences.rhythm?.lunchStart ?? 720, lunchEnd = preferences.rhythm?.lunchEnd ?? 780;
  const add = (i: Improvement, kind: RuleEffectKind, note: string) => out.applied.push({ id: i.id, rule: i.rule, kind, note });
  // Newest rules first so a later, stricter rule is the one cited.
  const active = (improvements ?? []).filter(i => i.active).sort((a, b) => b.createdOn.localeCompare(a.createdOn));
  for (const i of active) {
    const text = i.rule.replace(/\s+/g, ' ');
    if (i.kind === 'buffer' || /(버퍼|여유\s*시간|쉬는\s*시간|이동\s*시간|간격|텀을)/.test(text)) {
      const minutes = Number(/(\d{1,2})\s*분/.exec(text)?.[1] ?? 15);
      const gap = Math.min(60, Math.max(preferences.breakMinutes ?? 10, minutes));
      if (gap > (out.breakMinutes ?? preferences.breakMinutes ?? 10)) {
        out.breakMinutes = gap;
        out.bufferFraction = Math.min(0.4, Math.max(out.bufferFraction ?? preferences.bufferFraction ?? 0.2, (preferences.bufferFraction ?? 0.2) + 0.05));
        add(i, 'buffer', `블록 사이 ${gap}분과 여유 시간을 더 두었습니다`);
      }
    }
    if (i.kind === 'estimate' || /(예상|과소|오래\s*걸|넉넉|여유\s*있게\s*잡)/.test(text)) {
      const times = /(\d(?:\.\d)?)\s*배/.exec(text)?.[1] ?? (/(두\s*배)/.test(text) ? '2' : undefined);
      const factor = Math.min(2, Math.max(1.1, times ? Number(times) : 1.25));
      if (factor > (out.minFactor ?? 1)) { out.minFactor = factor; add(i, 'estimate', `실측 표본이 없는 일은 예상의 ${factor}배로 잡았습니다`); }
    }
    const count = /(?:하루|핵심|결과물|중요한\s*일|큰\s*일)[^\d\n]{0,8}(\d)\s*개/.exec(text) ?? /(\d)\s*개(?:만|까지|만\s*하기)/.exec(text);
    if (count) {
      const n = Math.max(1, Number(count[1]));
      if (n < (out.focusLimit ?? preferences.focusLimit ?? 3)) { out.focusLimit = n; add(i, 'limit', `핵심 결과물을 ${n}개까지만 두었습니다`); }
    }
    if (EXTERNAL.test(text)) {
      if (/(오전|아침)/.test(text) && NEGATE.test(text)) {
        const after = hourOf(text) ?? lunchStart;
        if (after > (out.externalAfter ?? 0)) { out.externalAfter = after; add(i, 'external-window', `외부 일정은 ${Math.floor(after / 60)}시 이후에만 두었습니다`); }
      } else if (/오후/.test(text) && /(몰아|모아|에만|만\s*잡)/.test(text)) {
        if (lunchEnd > (out.externalAfter ?? 0)) { out.externalAfter = lunchEnd; add(i, 'external-window', '외부 일정은 오후에 모았습니다'); }
      } else if (/(저녁|늦게|\d+\s*시\s*(이후|넘어서|넘어))/.test(text) && NEGATE.test(text)) {
        const before = hourOf(text);
        if (before !== undefined && before < (out.externalBefore ?? 1440)) { out.externalBefore = before; add(i, 'external-window', `외부 일정은 ${Math.floor(before / 60)}시 전까지만 두었습니다`); }
      }
    }
    if (i.kind === 'decline' || /(거절|위임|맡기|안\s*하기로|버리)/.test(text)) {
      if (!out.declineC) { out.declineC = true; add(i, 'decline', '급하지만 중요하지 않은(C) 일은 위임 후보로 돌렸습니다'); }
    }
  }
  return out;
}
