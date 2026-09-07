import { getDatabase } from '@/db/storage';
import { readReview, listReviews } from '@/db/repository';
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
