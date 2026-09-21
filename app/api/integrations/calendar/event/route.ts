import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {readCalendarEdit,saveCalendarEdit,calendarEditSchema} from '@/lib/orbit/agent/calendar-edit';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await owner(),id=new URL(request.url).searchParams.get('id');if(!id||id.length>2500)throw new AgentError('수정할 일정을 선택해 주세요.');return json(await readCalendarEdit(getDatabase(),user.id,env,id))}catch(error){return failure(error)}}
export async function PATCH(request:Request){try{const user=await owner(request),input=calendarEditSchema.safeParse(await body(request,100000));if(!input.success)throw new AgentError('일정 제목과 시작·종료 날짜 및 시간을 확인해 주세요.');return json(await saveCalendarEdit(getDatabase(),user.id,env,input.data))}catch(error){return failure(error)}}
