import type {WorkspaceData} from './model.ts';

export const WORKSPACE_LIMIT_BYTES = 950_000;
export const jsonBytes = (value:unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

// Bodies and external calendar cache live in separate tables. Measure the exact
// persisted workspace shape, including metadata introduced on first save.
export function persistedWorkspace(data:WorkspaceData):WorkspaceData {
  return {...data,schemaVersion:3,
    events:data.events.filter(e=>!e.id.startsWith('google:')),
    notes:data.notes.map(n=>({...n,body:'',bodyStored:true,revision:n.revision??1})),
  };
}
export function workspaceUsage(data:WorkspaceData) {
  const stored=persistedWorkspace(data),bytes=jsonBytes(stored);
  const sections=Object.entries(stored).filter(([,value])=>Array.isArray(value))
    .map(([key,value])=>({key,count:(value as unknown[]).length,bytes:jsonBytes(value)}))
    .sort((a,b)=>b.bytes-a.bytes);
  return {bytes,limit:WORKSPACE_LIMIT_BYTES,ratio:bytes/WORKSPACE_LIMIT_BYTES,sections};
}
