import { getDatabase } from '@/db/storage';
import { readReview, listReviews, readWorkspace, readNoteBodies } from '@/db/repository';
import { evidenceNotes, reviewCandidates } from '@/lib/orbit/review-evidence';
import { todayInZone } from '@/lib/orbit/dates';
import { owner, json, failure, AgentError } from '@/lib/orbit/agent/http';
import { addDays, validDate } from '@/lib/orbit/dates';
export const dynamic = 'force-dynamic';
// Evening review details: one date, or a bounded range for weekly summaries.
export async function GET(request: Request) {
  try {
    const user = await owner();
    const params = new URL(request.url).searchParams;
    const date = params.get('date');
    if (date) {
      if (!validDate(date)) throw new AgentError('회고 날짜를 확인해 주세요.');
      if (params.get('evidence') === '1') {
        // Result candidates with their source lines; note bodies live outside the workspace aggregate.
        const db = getDatabase(), snapshot = await readWorkspace(db, user.id), now = new Date();
        const today = todayInZone(snapshot.data.preferences.timeZone, now);
        if (date > today) throw new AgentError('미래 날짜의 회고는 아직 기록할 수 없습니다.');
        const metas = evidenceNotes(snapshot.data.notes, date).map((r) => r.note);
        const notes = await readNoteBodies(db, user.id, metas);
        return json({ candidates: reviewCandidates(snapshot.data, date, today, now, notes), revision: snapshot.revision });
      }
      return json({ detail: await readReview(getDatabase(), user.id, date) });
    }
    const to = params.get('to') ?? '',
      from = params.get('from') ?? (validDate(to) ? addDays(to, -6) : '');
    if (!validDate(from) || !validDate(to) || from > to || addDays(from, 61) < to)
      throw new AgentError('조회 기간은 62일 이내로 지정해 주세요.');
    return json({ details: await listReviews(getDatabase(), user.id, from, to) });
  } catch (error) {
    return failure(error);
  }
}
