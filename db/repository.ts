import {emptyWorkspace,type WorkspaceData,type WorkspaceSnapshot} from '../lib/orbit/model.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import type {WorkspaceAction} from '../lib/orbit/validation.ts';
export type SqlValue=string|number|null;
export interface QueryResult {results?:unknown[];meta?:{changes?:number};success?:boolean}
export interface Statement {bind(...values:SqlValue[]):Statement;first<T>():Promise<T|null>;all<T>():Promise<{results:T[]}>;run():Promise<QueryResult>}
export interface Database {prepare(sql:string):Statement;batch(statements:Statement[]):Promise<QueryResult[]>}
interface Row {revision:number;state_json:string;updated_at:string}
interface Receipt {action_hash:string;revision:number}
export class RevisionConflict extends Error{}
export async function readWorkspace(db:Database,ownerId:string):Promise<WorkspaceSnapshot>{
 const row=await db.prepare('SELECT revision, state_json, updated_at FROM orbit_workspaces WHERE owner_id = ?').bind(ownerId).first<Row>();
 if(!row)return {data:emptyWorkspace(),revision:0,updatedAt:null};
 const data=JSON.parse(row.state_json) as WorkspaceData;
 if(data.schemaVersion!==2)throw new Error('Unsupported workspace schema');
 return {data,revision:row.revision,updatedAt:row.updated_at};
}
async function receipt(db:Database,owner:string,operationId:string){return db.prepare('SELECT action_hash, revision FROM orbit_mutations WHERE owner_id = ? AND operation_id = ?').bind(owner,operationId).first<Receipt>()}
export async function writeCommand(db:Database,ownerId:string,command:{operationId:string;expectedRevision:number;action:WorkspaceAction},now=new Date()):Promise<WorkspaceSnapshot>{
 const hashBytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(command.action)));
 const hash=[...new Uint8Array(hashBytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
 const existing=await receipt(db,ownerId,command.operationId);
 if(existing){if(existing.action_hash!==hash)throw new RevisionConflict('같은 요청 번호에 다른 변경이 들어왔습니다. 새로 시도해 주세요.');return readWorkspace(db,ownerId)}
 const current=await readWorkspace(db,ownerId);
 if(current.revision!==command.expectedRevision)throw new RevisionConflict('다른 기기에서 내용이 변경됐습니다. 최신 내용을 불러온 뒤 다시 적용해 주세요.');
 const next=applyAction(current.data,command.action,now);
 const timestamp=now.toISOString(),revision=current.revision+1;
 const update=db.prepare(`INSERT INTO orbit_workspaces (owner_id, revision, state_json, mutation_id, updated_at)
 VALUES (?, ?, ?, ?, ?)
 ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision, state_json=excluded.state_json, mutation_id=excluded.mutation_id, updated_at=excluded.updated_at
 WHERE orbit_workspaces.revision = ?`).bind(ownerId,revision,JSON.stringify(next),command.operationId,timestamp,command.expectedRevision);
 const record=db.prepare(`INSERT INTO orbit_mutations (owner_id, operation_id, action_hash, revision, created_at)
 SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orbit_workspaces WHERE owner_id = ? AND mutation_id = ? AND revision = ?)
 ON CONFLICT(owner_id, operation_id) DO NOTHING`).bind(ownerId,command.operationId,hash,revision,timestamp,ownerId,command.operationId,revision);
 // D1 batch is transactional. Receipt creation is gated on the winning CAS write.
 const results=await db.batch([update,record]);
 if(results[0]?.meta?.changes!==1){
  const replay=await receipt(db,ownerId,command.operationId);
  if(!replay||replay.action_hash!==hash)throw new RevisionConflict('다른 기기에서 먼저 저장했습니다. 최신 내용을 불러온 뒤 다시 적용해 주세요.');
 }
 return readWorkspace(db,ownerId);
}
