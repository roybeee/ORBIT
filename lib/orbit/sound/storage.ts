import type {Database} from '../../../db/repository.ts';
import {AgentError} from '../agent/errors.ts';
import {emptySound,reduceSound,type SoundState,type SoundAction} from './state.ts';
export async function readSound(db:Database,ownerId:string){
  const row=await db.prepare('SELECT revision,state_json FROM orbit_sound_state WHERE owner_id=?').bind(ownerId).first<{revision:number;state_json:string}>();
  return {revision:row?.revision??0,state:row?JSON.parse(row.state_json) as SoundState:emptySound()};
}
export async function writeSound(db:Database,ownerId:string,action:SoundAction){
  for(let attempt=0;attempt<4;attempt++){
    const current=await readSound(db,ownerId);
    let next:SoundState;
    try{next=reduceSound(current.state,action)}catch(error){throw new AgentError((error as Error).message,'CONFLICT',409)}
    const value=JSON.stringify(next),date=new Date().toISOString();
    if(new TextEncoder().encode(value).byteLength>1800000)throw new AgentError('사운드 기록이 너무 큽니다. 백업한 뒤 오래된 기록을 정리해 주세요.','INPUT',413);
    const written=current.revision===0
      ?await db.prepare('INSERT OR IGNORE INTO orbit_sound_state (owner_id,revision,state_json,updated_at) VALUES (?,1,?,?)').bind(ownerId,value,date).run()
      :await db.prepare('UPDATE orbit_sound_state SET revision=revision+1,state_json=?,updated_at=? WHERE owner_id=? AND revision=?').bind(value,date,ownerId,current.revision).run();
    if(written.meta?.changes)return {revision:current.revision+1,state:next};
  }
  throw new AgentError('다른 기기에서 기록이 바뀌고 있습니다. 잠시 후 다시 시도해 주세요.','CONFLICT',409);
}
