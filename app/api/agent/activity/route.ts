import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {listActivity,activityDetail,syncActivity,classifyActivity,activityCategories} from '@/lib/orbit/agent/activity';
export const dynamic='force-dynamic';
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('sync')}).strict(),
 z.object({action:z.literal('classify'),id:z.string().regex(/^[a-f0-9]{64}$/),projectId:z.string().max(100).nullable(),category:z.enum(activityCategories)}).strict(),
]);
export async function GET(request:Request){try{const user=await owner(),p=new URL(request.url).searchParams,offset=Math.min(100000,Math.max(0,Number(p.get('offset'))||0));return json(p.has('id')?await activityDetail(getDatabase(),user.id,p.get('id')!,offset):await listActivity(getDatabase(),user.id,{query:(p.get('q')??'').slice(0,200),source:(p.get('source')??'').slice(0,100),project:(p.get('project')??'').slice(0,100),offset}));}catch(e){return failure(e)}}
export async function POST(request:Request){try{const user=await owner(request),v=input.safeParse(await body(request));if(!v.success)throw new AgentError('기록 요청을 확인해 주세요.');if(v.data.action==='sync')return json(await syncActivity(getDatabase(),user.id,env));await classifyActivity(getDatabase(),user.id,v.data.id,v.data.projectId,v.data.category);return json({saved:true});}catch(e){return failure(e)}}
