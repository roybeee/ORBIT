import {decodeWorkspace} from '../../db/workspace-storage.ts';
import {settingsFromBackup} from './backup-settings.ts';
import {streamHasher} from './stream-hash.ts';
import {Zip,ZipPassThrough,strToU8} from 'fflate';
import type {Database} from '../../db/repository.ts';
import type {Bucket} from './attachments/storage.ts';
import {emptyWorkspace,type Note} from './model.ts';
import {digest} from './backup.ts';
// Product data only. Authentication secrets, live leases and runnable queues are not restored.
const tables=['orbit_workspaces','orbit_workspace_chunks','orbit_workspace_projects','orbit_data_trash','orbit_note_revisions','orbit_reviews','orbit_conversations','orbit_agent_turns','orbit_agent_actions','orbit_agent_orders','orbit_order_reviews','orbit_order_reads','orbit_attachments','orbit_sound_state','orbit_calendar_settings','orbit_daily_runs','orbit_aside_jobs','orbit_source_status','orbit_calendar_exports','orbit_daily_runtime','orbit_chief_jobs','orbit_calendar_cache','orbit_activity_sessions','orbit_activity_messages'] as const;
export async function backupArchive(db:Database,owner:string,bucket:Bucket){
 const capturedAt=new Date().toISOString(),batches=await db.batch(tables.map(table=>db.prepare(`SELECT * FROM ${table} WHERE owner_id=?`).bind(owner)));
 const rows=Object.fromEntries(tables.map((table,i)=>[table,batches[i].results??[]])) as Record<string,any[]>;
 const stored=rows.orbit_workspaces[0],data=stored?decodeWorkspace(stored.state_json,rows.orbit_workspace_chunks):emptyWorkspace();
 const history=rows.orbit_note_revisions.map(r=>JSON.parse(r.note_json) as Note);
 data.notes=data.notes.map((n:Note)=>{const full=n.bodyStored?history.find(h=>h.id===n.id&&(h.revision??1)===(n.revision??1)):n;if(!full)throw Error('Missing note body');return {...full,bodyStored:false}});
 const payload={format:'orbit-backup/v2',capturedAt,data,noteHistory:history,reviewDetails:rows.orbit_reviews.map(r=>JSON.parse(r.review_json))};
 const checksum=await digest(payload),core=JSON.stringify({payload,checksum});
 if(new TextEncoder().encode(core).length>25000000)throw Error('Backup metadata exceeds the 25 MB limit');
 const objects:{key:string;path:string;size?:number}[]=[];
 for(const r of rows.orbit_attachments){if(r.object_key)objects.push({key:r.object_key,path:`files/${encodeURIComponent(r.id)}/original`,size:r.size});if(r.preview_key)objects.push({key:r.preview_key,path:`files/${encodeURIComponent(r.id)}/preview.jpg`});}
 for(const r of rows.orbit_order_reads)objects.push({key:r.object_key,path:`research/${encodeURIComponent(r.order_id)}/${encodeURIComponent(r.id)}.json`});
 const manifest={format:'orbit-archive/v2',capturedAt,checksum,records:Object.fromEntries(tables.map(t=>[t,rows[t].length])),files:objects.map(({key,...x})=>x),restore:'workspace.json에서 선택한 내용만 추가 복원합니다. 같은 번호의 기존 기록은 유지합니다. 대화·실행 결과·첨부 원본은 별도 복원 화면에서 추가 복구합니다. 실행 작업·승인·인증 정보는 자동 재개하지 않습니다.',excluded:['인증 토큰과 로그인 정보','PC 연결 키','기기 임시 초안','진행 중인 실행의 재개 상태']};
 const stream=new TransformStream<Uint8Array,Uint8Array>(),writer=stream.writable.getWriter();
 if(objects.length+tables.length+2>60000||objects.reduce((sum,x)=>sum+(x.size??0),0)>3*1024**3)throw Error('Archive exceeds the 3 GB export limit');
 let pending=Promise.resolve(),archiveBytes=0;
 const zip=new Zip((error,chunk,final)=>{
   pending=pending.then(async()=>{if(error)throw error;archiveBytes+=chunk.length;if(archiveBytes>3*1024**3)throw Error('Archive exceeds the 3 GB export limit');await writer.ready;await writer.write(chunk);if(final)await writer.close();});
 });
 const add=async(path:string,value:unknown)=>{const file=new ZipPassThrough(path);zip.add(file);file.push(strToU8(JSON.stringify(value)),true);await pending;};
 void(async()=>{try{
   await add('manifest.json',manifest);const settings=settingsFromBackup(data,capturedAt,rows);await add('settings.json',{payload:settings,checksum:await digest(settings)});const file=new ZipPassThrough('workspace.json');zip.add(file);file.push(strToU8(core),true);await pending;
   for(const table of tables)await add(`history/${table}.json`,rows[table].map(({owner_id,lease_until,...row})=>row));
   const checksums:Record<string,string>={};
   for(const item of objects){const object=await bucket.get(item.key);if(!object?.body)throw Error('Backup object missing');const entry=new ZipPassThrough(item.path);zip.add(entry);await pending;const hash=await streamHasher();let bytes=0;const reader=object.body.getReader();try{for(;;){const read=await reader.read();if(read.done)break;bytes+=read.value.length;await hash.update(read.value);entry.push(read.value,false);await pending;}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}if(item.size!==undefined&&item.size!==bytes)throw Error('Backup file size mismatch');checksums[item.path]=await hash.end();entry.push(new Uint8Array(),true);await pending;}
   await add('file-checksums.json',checksums);
   zip.end();await pending;
 }catch(error){zip.terminate();await writer.abort(error).catch(()=>{});}})();
 return stream.readable;
}
