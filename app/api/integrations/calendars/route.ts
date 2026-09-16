import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {calendarSelection,listGoogleCalendars,setCalendarSelection} from '@/lib/orbit/agent/calendar-settings';
import {syncCalendar} from '@/lib/orbit/agent/calendar';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner(),db=getDatabase();return json({calendars:await listGoogleCalendars(db,user.id,env),selectedIds:(await calendarSelection(db,user.id)).ids})}catch(e){return failure(e)}}
export async function PUT(request:Request){try{const user=await owner(request),input=z.object({ids:z.array(z.string().min(1).max(1000)).min(1).max(10)}).strict().safeParse(await body(request,15000));if(!input.success)throw new AgentError('캘린더 선택을 확인해 주세요.');await setCalendarSelection(getDatabase(),user.id,env,input.data.ids);return json(await syncCalendar(getDatabase(),user.id,env))}catch(e){return failure(e)}}
