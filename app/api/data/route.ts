import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDatabase } from '@/db/storage';
import { changeData, dataCommandSchema, dataStorageOverview, listDataTrash } from '@/db/data-manager';
import { DomainError } from '@/lib/orbit/reducer';
import { RevisionConflict } from '@/db/repository';
export const dynamic = 'force-dynamic';
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' } });
async function identity(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return response({ error: '로그인이 필요합니다.', code: 'AUTH' }, 401);
  const expected = request.headers.get('x-orbit-owner');
  if (expected && expected !== user.id) return response({ error: '로그인 계정이 변경되었습니다. 화면을 새로고침해 주세요.', code: 'SESSION_CHANGED' }, 409);
  return user;
}
export async function GET(request: Request) {
  const user = await identity(request); if (user instanceof Response) return user;
  const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) return response({ error: '목록 위치를 확인해 주세요.' }, 400);
  try { const db = getDatabase(); const [trash, storage] = await Promise.all([listDataTrash(db, user.id, offset), dataStorageOverview(db, user.id)]); return response({ trash, storage, checkedAt: new Date().toISOString() }); }
  catch { console.error('Orbit data manager read unavailable'); return response({ error: '데이터 현황을 불러오지 못했습니다. 다시 시도해 주세요.' }, 503); }
}
export async function POST(request: Request) {
  const user = await identity(request); if (user instanceof Response) return user;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return response({ error: '요청 출처를 확인할 수 없습니다.', code: 'ORIGIN' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return response({ error: '요청 형식을 확인해 주세요.', code: 'INPUT' }, 415);
  const bytes = await request.arrayBuffer(); if (bytes.byteLength > 40000) return response({ error: '한 번에 처리할 항목을 줄여 주세요.', code: 'INPUT' }, 413);
  let parsed;
  try { parsed = dataCommandSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes))); } catch { return response({ error: '입력 내용을 확인해 주세요.', code: 'INPUT' }, 400); }
  if (!parsed.success) return response({ error: parsed.error.issues[0]?.message ?? '처리할 항목을 확인해 주세요.', code: 'INPUT' }, 400);
  try { return response(await changeData(getDatabase(), user.id, parsed.data)); }
  catch (e) {
    if (e instanceof RevisionConflict) return response({ error: e.message, code: 'CONFLICT' }, 409);
    if (e instanceof DomainError) return response({ error: e.message, code: 'INPUT' }, 422);
    console.error('Orbit data manager write unavailable'); return response({ error: '처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.', code: 'STORAGE' }, 503);
  }
}
