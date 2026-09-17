import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {settingsSchema,settingsSelection,previewSettings,restoreSettings} from '@/lib/orbit/backup-settings';
import {digest} from '@/lib/orbit/backup';
import {listGoogleCalendars} from '@/lib/orbit/agent/calendar-settings';
export const dynamic='force-dynamic';
const input=z.object({action:z.enum(['preview','restore']),payload:z.unknown(),checksum:z.string().regex(/^[a-f0-9]{64}$/),selection:settingsSelection,basis:z.string().optional(),operationId:z.string().uuid()}).strict();
export async function POST(request:Request){try{const user=await owner(request),p=input.safeParse(await body(request,25000000));if(!p.success)throw new AgentError('설정 복원 요청을 확인하세요.');const x=p.data,db=getDatabase();if(await digest(x.payload)!==x.checksum)throw new AgentError('백업 검증값이 다릅니다.');if(x.selection.includes('calendar')){const source=settingsSchema.parse(x.payload),choices=await listGoogleCalendars(db,user.id,env);if(source.calendar?.some(id=>!choices.some(c=>c.id===id)))throw new AgentError('현재 Google 계정에서 백업의 캘린더를 찾을 수 없습니다. 캘린더 선택을 제외하고 복원하거나 계정 연결을 확인하세요.');}return json(x.action==='preview'?await previewSettings(db,user.id,x.payload,x.selection):await restoreSettings(db,user.id,x.payload,x.selection,x.basis??'',x.operationId,x.checksum));}catch(e){return failure(e)}}
