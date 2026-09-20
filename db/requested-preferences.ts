import {readWorkspace,writeCommand,RevisionConflict,type Database} from './repository.ts';

// Owner's explicit 2026-09-20 request: finish the workday at 19:00.
// Apply through the normal revision-checked command path, once per request.
// The durable receipt lets subsequent settings edits remain authoritative.
const requestedOwner = 'sKibsOUhWF6NEYA1xneShn25agzo4eAVZZ0yvy5bVoEAZMlpCn53ky';
const operationId = 'ac0f2c6b-2026-4920-8700-019000000001';

export async function workspaceWithRequestedPreferences(db:Database,ownerId:string){
  for(let attempt=0;attempt<3;attempt++){
    const snapshot=await readWorkspace(db,ownerId);
    if(ownerId!==requestedOwner)return snapshot;
    const applied=await db.prepare('SELECT revision FROM orbit_mutations WHERE owner_id=? AND operation_id=?').bind(ownerId,operationId).first();
    if(applied)return snapshot;
    try{
      return await writeCommand(db,ownerId,{
        operationId,expectedRevision:snapshot.revision,
        action:{type:'preferences.update',preferences:{...snapshot.data.preferences,workEnd:19*60}},
      });
    }catch(error){if(!(error instanceof RevisionConflict)||attempt===2)throw error;}
  }
  throw new RevisionConflict('업무 시간 설정을 다시 확인해 주세요.');
}
