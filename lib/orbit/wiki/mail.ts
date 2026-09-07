import {readWorkspace,writeCommand,type Database} from '../../../db/repository.ts';
import {accessToken,fetchJson,type Runtime} from '../agent/integrations.ts';
import {automaticProject} from '../classify.ts';
import {AgentError} from '../agent/errors.ts';
import {todayInZone} from '../dates.ts';
export function mailText(payload:any):string {
 const pieces:string[]=[];
 const walk=(part:any)=>{if(part?.mimeType==='text/plain'&&part.body?.data){try{const bytes=Uint8Array.from(atob(part.body.data.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));pieces.push(new TextDecoder().decode(bytes))}catch{}}for(const child of part?.parts??[])walk(child)};
 walk(payload);return pieces.join('\n').slice(0,80000);
}
export async function syncWikiMail(db:Database,owner:string,env:Runtime) {
 const row=await db.prepare("SELECT public_json FROM orbit_integrations WHERE owner_id=? AND provider='google_mail'").bind(owner).first<{public_json:string}>();
 const state=row?JSON.parse(row.public_json):{};if(!state.connected)return {connected:false,count:0};
 if(Date.now()-(state.wikiSyncAt??0)<60000)return {connected:true,count:0,more:!!state.wikiPage};
 const token=await accessToken(db,owner,'google_mail',env),headers={Authorization:'Bearer '+token};
 const base='https://gmail.googleapis.com/gmail/v1/users/me/messages';
 const params=new URLSearchParams({q:'newer_than:30d -in:spam -in:trash',maxResults:'10',...(state.wikiPage?{pageToken:state.wikiPage}:{})});
 const listed=await fetchJson(base+'?'+params,{headers});
 if(!listed.response.ok)throw new AgentError('Gmail 조회를 완료하지 못했습니다. API 사용 설정과 읽기 권한을 확인해 주세요.','MAIL',502);
 let count=0;
 for(const item of listed.data.messages??[]) {
  if(typeof item.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(item.id))continue;
  let snapshot=await readWorkspace(db,owner);const id='gmail:'+item.id;if(snapshot.data.notes.some(n=>n.id===id))continue;
  const detail=await fetchJson(base+'/'+encodeURIComponent(item.id)+'?format=full',{headers});if(!detail.response.ok)throw new AgentError('메일 원문을 가져오지 못했습니다. 다음 동기화에서 재시도합니다.','MAIL',502);
  const m=detail.data,header=(key:string)=>String(m.payload?.headers?.find((h:any)=>String(h.name).toLowerCase()===key)?.value??'').slice(0,2000);
  const title=(header('subject')||'제목 없는 메일').slice(0,160),text=mailText(m.payload),day=Number.isFinite(Number(m.internalDate))?todayInZone(snapshot.data.preferences.timeZone,new Date(Number(m.internalDate))):todayInZone(snapshot.data.preferences.timeZone);
  const projectId=automaticProject(title,snapshot.data.projects,snapshot.data.tasks,snapshot.data.notes)?.projectId??snapshot.data.projects.find(p=>p.id==='personal-wiki')?.id??snapshot.data.projects[0]?.id;
  if(!projectId)return {connected:true,count,needsProject:true};
  await writeCommand(db,owner,{operationId:'wiki-mail:'+item.id,expectedRevision:snapshot.revision,action:{type:'note.upsert',note:{id,title,kind:'meeting',projectId,summary:String(m.snippet??'').slice(0,500),body:`발신: ${header('from')}\n수신: ${header('to')}\n날짜: ${header('date')}\n\n${text||m.snippet||'본문 없음'}${text?'':'\n\n[텍스트 본문이 없어 메일 요약만 수집했습니다.]'}`,tags:['메일','Gmail'],updated:day,source:{provider:'gmail',externalId:item.id,date:day,url:'https://mail.google.com/mail/u/0/#all/'+item.id}}}});count++;
 }
 await db.prepare("UPDATE orbit_integrations SET public_json=json_set(public_json,'$.wikiSyncAt',?,'$.wikiPage',?) WHERE owner_id=? AND provider='google_mail'").bind(Date.now(),listed.data.nextPageToken??null,owner).run();
 return {connected:true,count,more:!!listed.data.nextPageToken};
}
