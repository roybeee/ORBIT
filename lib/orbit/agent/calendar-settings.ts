import {prepareWorkspace} from '../../../db/workspace-storage.ts';
import {readWorkspace,RevisionConflict,type Database} from '../../../db/repository.ts';
import {accessToken,fetchJson,type Runtime} from './integrations.ts';
import {AgentError} from './errors.ts';
import {recordSource} from '../source-status.ts';
import type {GoogleCalendarEntry} from './calendar.ts';
export async function calendarSelection(db:Database,owner:string){const row=await db.prepare('SELECT selected_json,updated_at FROM orbit_calendar_settings WHERE owner_id=?').bind(owner).first<{selected_json:string;updated_at:string}>();return {ids:row?JSON.parse(row.selected_json) as string[]:['primary'],version:row?.updated_at??''};}
export async function listGoogleCalendars(db:Database,owner:string,env:Runtime){
 const token=await accessToken(db,owner,'google_calendar',env),items:{id:string;label:string;primary:boolean}[]=[];let page='';
 for(let n=0;n<20;n++){const url=new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');url.search=new URLSearchParams({maxResults:'250',...(page?{pageToken:page}:{})}).toString();const {response,data}=await fetchJson<{items?:GoogleCalendarEntry[];nextPageToken?:string}>(url.href,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new AgentError('캘린더 목록을 불러오지 못했습니다. Google을 다시 연결해 주세요.','CALENDAR',502);for(const c of data.items??[])if(['owner','writer','reader'].includes(c.accessRole)&&!c.deleted)items.push({id:c.primary?'primary':c.id,label:c.summaryOverride??c.summary??c.id,primary:!!c.primary});page=data.nextPageToken??'';if(!page)return items;}
 throw new AgentError('캘린더 목록이 너무 많아 확인을 마치지 못했습니다.');
}
export async function setCalendarSelection(db:Database,owner:string,env:Runtime,ids:string[]){
 const choices=await listGoogleCalendars(db,owner,env);ids=[...new Set(ids)];if(!ids.length||ids.length>10||ids.some(id=>!choices.some(c=>c.id===id)))throw new AgentError('조회할 캘린더를 1~10개 선택해 주세요.');
 const snapshot=await readWorkspace(db,owner),version=new Date().toISOString(),mutation=crypto.randomUUID(),storage=prepareWorkspace({...snapshot.data,events:snapshot.data.events.filter(e=>!e.id.startsWith('google:'))});
 const result=await db.batch([
 db.prepare('INSERT INTO orbit_workspaces(owner_id,revision,state_json,mutation_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json,mutation_id=excluded.mutation_id,updated_at=excluded.updated_at WHERE orbit_workspaces.revision=?').bind(owner,snapshot.revision+1,storage.stateJson,mutation,version,snapshot.revision),
 ...storage.statements(db,owner,'EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND mutation_id=?)',[owner,mutation]),
 db.prepare('INSERT INTO orbit_calendar_settings(owner_id,selected_json,updated_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND mutation_id=?) ON CONFLICT(owner_id) DO UPDATE SET selected_json=excluded.selected_json,updated_at=excluded.updated_at').bind(owner,JSON.stringify(ids),version,owner,mutation)]);
 if(result[0].meta?.changes!==1)throw new RevisionConflict('캘린더 선택 중 기록이 변경됐습니다. 다시 저장해 주세요.');
 await recordSource(db,owner,'google_calendar',{state:'partial',detail:'캘린더 선택이 변경되었습니다. 동기화 전까지 이전 일정이 표시됩니다.',targets:ids});return {ids,version};
}
