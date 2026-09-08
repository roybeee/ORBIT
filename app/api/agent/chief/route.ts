import { env } from 'cloudflare:workers';
import { getDatabase } from '@/db/storage';
import { owner, body, json, failure, AgentError } from '@/lib/orbit/agent/http';
import { chiefScheduleStatus, changeChiefSchedule, scheduleInput } from '@/lib/orbit/agent/chief-jobs';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner();return json(await chiefScheduleStatus(getDatabase(),user.id,env));}catch(error){return failure(error);}}
export async function POST(request:Request){try{const user=await owner(request),parsed=scheduleInput.safeParse(await body(request));if(!parsed.success)throw new AgentError('예약 간격과 전달 방식을 확인해 주세요.');return json(await changeChiefSchedule(getDatabase(),user.id,parsed.data,env));}catch(error){return failure(error);}}
