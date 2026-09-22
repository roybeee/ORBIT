import { APP_BUILD, APP_TREE } from '@/lib/orbit/app-version';
import { owner, json, failure } from '@/lib/orbit/agent/http';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { await owner(request); return json({ build: APP_BUILD, tree: APP_TREE }); }
  catch (error) { return failure(error); }
}
