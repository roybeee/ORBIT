import {z} from 'zod';
import {readWorkspace} from '@/db/repository';
import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {collectMetrics} from '@/lib/orbit/metric-collector';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{const user=await owner(request),input=z.object({metricId:z.string().min(1).max(100)}).strict().safeParse(await body(request,1000));if(!input.success)throw new AgentError('수집할 지표를 선택하세요.');const db=getDatabase(),metrics=((await readWorkspace(db,user.id)).data.operatingMetrics??[]).filter(m=>m.collector&&m.collector.enabled!==false),index=metrics.findIndex(m=>m.id===input.data.metricId);if(index<0)throw new AgentError('선택한 지표의 ODA 수집 연결을 먼저 켜세요.');return json(await collectMetrics(db,user.id,env,index));}catch(e){return failure(e)}}
