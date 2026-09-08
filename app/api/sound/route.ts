import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {soundAction} from '@/lib/orbit/sound/state';
import {readSound,writeSound} from '@/lib/orbit/sound/storage';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner();return json(await readSound(getDatabase(),user.id))}catch(error){return failure(error)}}
export async function POST(request:Request){try{
  const user=await owner(request),parsed=soundAction.safeParse(await body(request,1800000));
  if(!parsed.success)throw new AgentError('사운드 기록 형식을 확인해 주세요.','INPUT',422);
  return json(await writeSound(getDatabase(),user.id,parsed.data));
}catch(error){return failure(error)}}
