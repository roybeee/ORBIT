import type {Database, SqlValue} from './repository.ts';
import type {WorkspaceData} from '../lib/orbit/model.ts';

// Keep every bound value/row small, even when a workspace or a single record
// exceeds SQLite's row limit. No content is shortened to fit a storage budget.
const CHUNK_UNITS = 32_768;
const FORMAT = 'orbit-workspace/chunks-v1';
export interface WorkspaceChunk {generation:string; part:number; content:string}

export function decodeWorkspace(stateJson:string, rows:WorkspaceChunk[]):WorkspaceData {
  const header = JSON.parse(stateJson);
  if (!('_orbitStorage' in header)) return header as WorkspaceData; // legacy aggregate
  if (header._orbitStorage !== FORMAT || typeof header.generation !== 'string' ||
      !Number.isSafeInteger(header.parts) || header.parts < 1 ||
      !Number.isSafeInteger(header.length) || header.length < 1)
    throw new Error('Unsupported workspace storage');
  const parts = [...rows].sort((a,b)=>a.part-b.part);
  if (parts.length !== header.parts || parts.some((p,i)=>p.part!==i || p.generation!==header.generation || typeof p.content!=='string'))
    throw new Error('Incomplete workspace storage');
  const text = parts.map(p=>p.content).join('');
  if (text.length !== header.length) throw new Error('Incomplete workspace storage');
  return JSON.parse(text) as WorkspaceData;
}

export function prepareWorkspace(data:WorkspaceData) {
  const text = JSON.stringify(data), generation = crypto.randomUUID(), chunks:string[] = [];
  for (let offset=0; offset<text.length;) {
    let end = Math.min(offset+CHUNK_UNITS,text.length);
    // Never split a surrogate pair when binding Unicode text to SQLite.
    const last = text.charCodeAt(end-1);
    if (end<text.length && last>=0xd800 && last<=0xdbff) end--;
    chunks.push(text.slice(offset,end)); offset=end;
  }
  const stateJson = JSON.stringify({_orbitStorage:FORMAT,generation,parts:chunks.length,length:text.length});
  return {stateJson, statements(db:Database,owner:string,gate:string,values:readonly SqlValue[]) {
    // Caller must put these after the revision-CAS header update and before
    // its receipt, in the SAME batch. Failed CAS never changes content/indexes.
    // Concurrent replays can share an operation ID/revision. Only the attempt
    // whose manifest actually won CAS may replace its content.
    gate = `(${gate}) AND EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND state_json=?)`;
    values = [...values,owner,stateJson];
    const statements = [
      db.prepare(`DELETE FROM orbit_workspace_chunks WHERE owner_id=? AND ${gate}`).bind(owner,...values),
      db.prepare(`DELETE FROM orbit_workspace_projects WHERE owner_id=? AND ${gate}`).bind(owner,...values),
      ...chunks.map((content,part)=>db.prepare(`INSERT INTO orbit_workspace_chunks(owner_id,generation,part,content) SELECT ?,?,?,? WHERE ${gate}`).bind(owner,generation,part,content,...values)),
    ];
    // A bounded project-ID index supports atomic conversation reference checks.
    for (let i=0;i<data.projects.length;i+=100) statements.push(db.prepare(
      `INSERT INTO orbit_workspace_projects(owner_id,project_id) SELECT ?,value FROM json_each(?) WHERE ${gate}`,
    ).bind(owner,JSON.stringify(data.projects.slice(i,i+100).map(p=>p.id)),...values));
    return statements;
  }};
}
