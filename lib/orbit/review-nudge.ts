import type {WorkspaceData} from './model.ts';

// One gentle evening notice per day so the loop closes without the owner remembering to open
// Orbit: only after the evening hour, only when the day has something to close, never twice
// (the id is per date and notifications are insert-once).
export function reviewNudge(data: WorkspaceData, today: string, afterEvening: boolean, now = new Date()) {
  if (!afterEvening || data.reviews.some(r => r.date === today)) return null;
  const done = data.tasks.filter(t => t.status === 'done' && t.completedOn === today).length;
  const planned = data.proposals.find(p => p.date === today)?.items.filter(i => i.state === 'approved').length ?? 0;
  const touched = data.tasks.filter(t => t.outcomeOn === today && t.outcome !== 'done').length;
  if (!done && !planned && !touched) return null;
  const parts = [done ? `완료 ${done}건` : '', planned ? `계획 ${planned}건` : '', touched ? `미완료 ${touched}건` : ''].filter(Boolean).join(' · ');
  return {
    id: `review-nudge:${today}`,
    kind: 'info' as const,
    title: '1분 회고로 오늘을 닫을까요?',
    body: `${parts}. 오늘 기록으로 결과를 미리 채워 두었습니다. 맞음·수정만 눌러 확인하면 내일 계획에 반영됩니다.`,
    href: '/#review',
    createdAt: now.toISOString(),
  };
}
