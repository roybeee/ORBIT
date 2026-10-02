import {readWorkspace,writeCommand,RevisionConflict,type Database} from '../../db/repository.ts';
import {notify} from './notifications/store.ts';
import {minuteInZone} from './dates.ts';
import type {Preferences,WorkspaceData} from './model.ts';

// 계획 자동 승인 (owner opt-in, preferences.autoApprovePlan): once each workday morning the
// runtime approves today's still-future plan blocks through the ordinary proposal.approve
// command. A block the reducer refuses — an overlap, the focus limit, a task that changed —
// stays pending in the 결재함. One notice reports the result and marks the day as done.

export const autoApproveMarker = (date: string) => `plan-auto:${date}`;
// From 90 minutes before work starts until the end of the workday.
export const inAutoApproveWindow = (p: Pick<Preferences, 'workStart' | 'workEnd'>, minute: number) =>
  minute >= Math.max(0, p.workStart - 90) && minute < p.workEnd;
export function autoApproveCandidates(data: WorkspaceData, date: string, minute: number) {
  const plan = data.proposals.find(p => p.date === date);
  return (plan?.items ?? []).filter(i => i.state === 'pending' && i.start >= minute + 5).sort((a, b) => a.start - b.start).map(i => i.id);
}

export async function autoApproveToday(db: Database, owner: string, today: string, now = new Date()) {
  let snapshot = await readWorkspace(db, owner);
  const prefs = snapshot.data.preferences;
  if (!prefs.autoApprovePlan) return { skipped: 'off' as const };
  const minute = minuteInZone(prefs.timeZone, now);
  if (!inAutoApproveWindow(prefs, minute)) return { skipped: 'window' as const };
  const marker = autoApproveMarker(today);
  if (await db.prepare('SELECT 1 AS seen FROM orbit_notifications WHERE owner_id=? AND id=?').bind(owner, marker).first()) return { skipped: 'done' as const };
  const ids = autoApproveCandidates(snapshot.data, today, minute);
  // No plan yet: try again on a later tick instead of marking the day.
  if (!ids.length) return { skipped: snapshot.data.proposals.some(p => p.date === today) ? 'none' as const : 'no-plan' as const };
  let approved = 0, held = 0;
  for (const itemId of ids) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        snapshot = await writeCommand(db, owner, { operationId: `${marker}:${itemId}`, expectedRevision: snapshot.revision, action: { type: 'proposal.approve', date: today, itemId } }, now);
        approved++;
        break;
      } catch (error) {
        if (error instanceof RevisionConflict && attempt === 0) { snapshot = await readWorkspace(db, owner); continue; }
        held++;
        break;
      }
    }
  }
  await notify(db, owner, {
    id: marker, kind: 'info',
    title: approved ? `오늘 계획 ${approved}건을 자동 승인했습니다` : '오늘 계획을 자동 승인하지 못했습니다',
    body: held ? `${held}건은 겹치는 일정이나 바뀐 할 일 때문에 결재함에 남겼습니다.` : '승인한 집중 시간이 일정에 반영되었습니다. 바꾸려면 일정이나 내일 제안 화면에서 조정하세요.',
    href: held ? '/#inbox' : '/#calendar', createdAt: now.toISOString(),
  });
  return { approved, held };
}
