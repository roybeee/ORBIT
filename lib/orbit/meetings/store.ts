import {enqueueMeetingStatement} from './review.ts';
import {readWorkspace,readNote,writeCommand,type Database} from '../../../db/repository.ts';
import {todayInZone} from '../dates.ts';
import {AgentError} from '../agent/errors.ts';
import type {Recording} from './plaud-data.ts';
import {meetingParts,projectMatches} from './plaud-data.ts';
import type {Note} from '../model.ts';
export const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
type ImportState={title:string;summary?:string;hasComplete?:boolean;noteIds:string[];bodyHashes:string[];status:string;matches:ReturnType<typeof projectMatches>;manualProject?:string;autoPrimary?:string;error?:string};
export async function importRecording(db:Database,owner:string,record:Recording){
 const previous=await db.prepare('SELECT hash,state_json FROM orbit_plaud_imports WHERE owner_id=? AND external_id=?').bind(owner,record.id).first<{hash:string;state_json:string}>();
 const old:ImportState|undefined=previous?JSON.parse(previous.state_json):undefined;
 const hash=await digest(record);
 // A removal is persistent. Neither automatic nor manual re-sync resurrects deleted records.
 const baseId='plaud:'+(record.id.length>80?(await digest(record.id)).slice(0,40):record.id);
 const ids=meetingParts(record).map((_,i)=>baseId+(i?':'+(i+1):''));
 const exclude=async()=>{if(old)await saveImport(db,owner,record.id,previous!.hash,{...old,status:'excluded'});return {status:'excluded',changed:false};};
 for(const id of [...ids,...(old?.noteIds??[])])if(await db.prepare("SELECT id FROM orbit_data_trash WHERE owner_id=? AND category='notes' AND record_id=?").bind(owner,id).first())return exclude();
 let snapshot=await readWorkspace(db,owner);
 if(old?.noteIds.some(id=>!snapshot.data.notes.some(n=>n.id===id)))return exclude();
 if(previous?.hash===hash)return {status:old!.status,changed:false};
 if(record.pending&&old?.hasComplete){await saveImport(db,owner,record.id,'',{...old,status:'pending'});return {status:'pending',changed:false};}
 // Nothing ready yet: retain the metadata and revisit; never create an empty evidence note.
 if(!record.transcript&&!record.summary){await saveImport(db,owner,record.id,hash,{title:record.title,noteIds:[],bodyHashes:[],matches:[],status:'pending'});return {status:'pending',changed:false};}
 const manual=old?.manualProject?snapshot.data.projects.find(p=>p.id===old.manualProject):undefined;
 const matches=manual?[{projectId:manual.id,name:manual.name,matched:['사용자 수정']}]:projectMatches(record,snapshot.data.projects),primary=old?.manualProject??(matches.length===1?matches[0].projectId:'plaud-inbox');
 if(!snapshot.data.projects.some(p=>p.id===primary)){
  if(primary!=='plaud-inbox')throw new AgentError('연결 프로젝트가 삭제되었습니다. 회의록의 프로젝트를 다시 선택해 주세요.','PROJECT',409);
  snapshot=await writeCommand(db,owner,{operationId:crypto.randomUUID(),expectedRevision:snapshot.revision,action:{type:'project.upsert',project:{id:'plaud-inbox',name:'회의 보관함',goal:'프로젝트 연결을 확인할 회의 기록',color:'#7067eb',symbol:'P',due:todayInZone(snapshot.data.preferences.timeZone),priority:1}}});
 }
 const parts=meetingParts(record),bodyHashes:string[]=[...(old?.bodyHashes??[])],noteIds:string[]=[...(old?.noteIds??[])];
 if(old&&old.noteIds.length>parts.length)throw new AgentError('원문 분할 수가 줄었습니다. 기존 기록 보존을 위해 수동 확인이 필요합니다.','PLAUD_REVIEW',409);
 for(let i=0;i<parts.length;i++){
  snapshot=await readWorkspace(db,owner);const id=ids[i],meta=snapshot.data.notes.find(n=>n.id===id),current=meta?await readNote(db,owner,id):null;
  const bodyHash=await digest(parts[i]);bodyHashes[i]=bodyHash;if(!noteIds.includes(id))noteIds.push(id);
  const currentHash=current?await digest(current.body):null;
  // User text edits are never overwritten by a later source revision.
  if(current&&currentHash!==bodyHash&&currentHash!==current.source?.importHash&&(!old?.bodyHashes[i]||currentHash!==old.bodyHashes[i]))throw new AgentError('직접 수정한 회의록이 있습니다. 원문 변경 내용을 확인해 주세요.','PLAUD_REVIEW',409);
  const sourceTitle=(record.title.slice(0,145)+(parts.length>1?` (${i+1}/${parts.length})`:'')).slice(0,160);
  const oldTitle=old?(old.title.slice(0,145)+(old.noteIds.length>1?` (${i+1}/${old.noteIds.length})`:'')):'';
  const title=current&&old&&current.title!==oldTitle?current.title:sourceTitle;
  const sourceSummary=('Plaud AI 요약 · '+(record.summary||'전사 원문 수집됨 · 요약 준비 중')).slice(0,500);
  const summary=current&&old?.summary&&current.summary!==old.summary?current.summary:sourceSummary;
  const projectId=current&&current.projectId!==old?.autoPrimary?current.projectId:primary;
  const tags=[...new Set(['Plaud',record.pending?'전사·요약 준비 중':matches.length===1||old?.manualProject?'프로젝트 연결됨':'프로젝트 확인 필요',...matches.map(m=>m.name.slice(0,40)),...(current?.tags.filter(t=>!['Plaud','전사·요약 준비 중','프로젝트 연결됨','프로젝트 확인 필요',...(old?.matches.map(m=>m.name.slice(0,40))??[])].includes(t))??[])])].slice(0,20);
  const sourceDate=/^\d{4}-\d{2}-\d{2}/.test(record.started)?record.started.slice(0,10):todayInZone(snapshot.data.preferences.timeZone);
  const note:Note={id,title,kind:'meeting',projectId,summary,body:parts[i],tags,updated:sourceDate,source:{provider:'plaud',externalId:record.id,date:sourceDate,importHash:bodyHash}};
  // Replay after partial commit: same body/title already stored, keep its exact revision.
  if(!(currentHash===bodyHash&&current?.title===title))await writeCommand(db,owner,{operationId:'plaud:'+record.id+':'+hash+':'+i,expectedRevision:snapshot.revision,action:{type:'note.upsert',note,...(meta?{expectedNoteRevision:meta.revision??1}:{})}});
  await saveImport(db,owner,record.id,'',{title:record.title,hasComplete:old?.hasComplete||!record.pending,summary:sourceSummary,noteIds:[...noteIds],bodyHashes:[...bodyHashes],matches,autoPrimary:primary,...(old?.manualProject?{manualProject:old.manualProject}:{}),status:'partial'});
 }
 if(!record.pending)for(const id of noteIds){const note=await readNote(db,owner,id);await enqueueMeetingStatement(db,owner,note).run();}
 await saveImport(db,owner,record.id,hash,{title:record.title,hasComplete:old?.hasComplete||!record.pending,summary:('Plaud AI 요약 · '+(record.summary||'전사 원문 수집됨 · 요약 준비 중')).slice(0,500),noteIds,bodyHashes,matches,autoPrimary:primary,...(old?.manualProject?{manualProject:old.manualProject}:{}),status:record.pending?'pending':'ready'});
 return {status:record.pending?'pending':'ready',changed:true};
}
async function saveImport(db:Database,owner:string,id:string,hash:string,state:ImportState){await db.prepare('INSERT INTO orbit_plaud_imports(owner_id,external_id,hash,state_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,external_id) DO UPDATE SET hash=excluded.hash,state_json=excluded.state_json,updated_at=excluded.updated_at').bind(owner,id,hash,JSON.stringify(state),new Date().toISOString()).run()}
export async function retagMeeting(db:Database,owner:string,id:string,projectId:string,keyword:string){
 await db.prepare("INSERT OR IGNORE INTO orbit_plaud_sync(owner_id,state_json,lease_until) VALUES(?,'{}',0)").bind(owner).run();
 const lease=Date.now()+120000,claim=await db.prepare('UPDATE orbit_plaud_sync SET lease_until=? WHERE owner_id=? AND lease_until<?').bind(lease,owner,Date.now()).run();if(claim.meta?.changes!==1)throw new AgentError('회의 수집 중입니다. 잠시 후 프로젝트를 수정해 주세요.','BUSY',409);
 try{
 const row=await db.prepare('SELECT hash,state_json FROM orbit_plaud_imports WHERE owner_id=? AND external_id=?').bind(owner,id).first<{hash:string;state_json:string}>();if(!row)throw new AgentError('회의록을 찾지 못했습니다.','NOT_FOUND',404);
 const state:ImportState=JSON.parse(row.state_json);let snapshot=await readWorkspace(db,owner);const project=snapshot.data.projects.find(p=>p.id===projectId);if(!project)throw new AgentError('프로젝트를 선택해 주세요.');
 for(const noteId of state.noteIds){snapshot=await readWorkspace(db,owner);const note=await readNote(db,owner,noteId);await writeCommand(db,owner,{operationId:crypto.randomUUID(),expectedRevision:snapshot.revision,action:{type:'note.upsert',note:{...note,projectId,tags:[...new Set(['Plaud','프로젝트 연결됨',project.name.slice(0,40),...note.tags.filter(t=>!['프로젝트 확인 필요','프로젝트 연결됨',...state.matches.map(m=>m.name.slice(0,40))].includes(t))])].slice(0,20)},expectedNoteRevision:note.revision??1}});}
 if(keyword.trim()){snapshot=await readWorkspace(db,owner);const latest=snapshot.data.projects.find(p=>p.id===projectId)!;await writeCommand(db,owner,{operationId:crypto.randomUUID(),expectedRevision:snapshot.revision,action:{type:'project.upsert',project:{...latest,keywords:[...new Set([...(latest.keywords??[]),keyword.trim()])].slice(-12)}}});}
 state.manualProject=projectId;await saveImport(db,owner,id,row.hash,state);
 }finally{await db.prepare('UPDATE orbit_plaud_sync SET lease_until=0 WHERE owner_id=? AND lease_until=?').bind(owner,lease).run();}
}
