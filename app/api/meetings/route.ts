import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {meetingStatus,setMeetingSync,syncMeetings} from '@/lib/orbit/meetings/sync';
import {retagMeeting} from '@/lib/orbit/meetings/store';
export const dynamic='force-dynamic';
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('sync')}).strict(),
 z.object({action:z.literal('settings'),enabled:z.boolean()}).strict(),
 z.object({action:z.literal('retag'),id:z.string().regex(/^[-\w]{1,160}$/),projectId:z.string().min(1).max(100),keyword:z.string().trim().max(40).default('')}).strict(),
]);
export async function GET(){try{const user=await owner();return json(await meetingStatus(getDatabase(),user.id,env))}catch(e){return failure(e)}}
export async function POST(request:Request){try{const user=await owner(request),parsed=input.safeParse(await body(request,4000));if(!parsed.success)throw new AgentError('회의록 요청을 확인해 주세요.');const db=getDatabase(),value=parsed.data;
 if(value.action==='sync')await syncMeetings(db,user.id,env,true);
 if(value.action==='settings')await setMeetingSync(db,user.id,value.enabled);
 if(value.action==='retag')await retagMeeting(db,user.id,value.id,value.projectId,value.keyword);
 return json(await meetingStatus(db,user.id,env));
}catch(e){return failure(e)}}
