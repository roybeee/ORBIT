import {applyAction} from './reducer.ts';
import type {WorkspaceData, WorkspaceSnapshot} from './model.ts';
import {commandSchema, type WorkspaceAction} from './validation.ts';

type Command = {operationId:string; expectedRevision:number; action:WorkspaceAction};
type Basis = {revision:number; entity:unknown};
export type QueuedWrite = {command:Command; basis:Basis; attempted:boolean; blocked?:boolean};
type Failure = {code:string; message:string};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function instantAction(action:WorkspaceAction) {
  return ['project.upsert','task.upsert','event.upsert','task.status','task.focus'].includes(action.type);
}
function entity(data:WorkspaceData, action:WorkspaceAction):unknown {
  switch(action.type) {
    case 'project.upsert': return data.projects.find(x=>x.id===action.project.id)??null;
    case 'task.upsert': return data.tasks.find(x=>x.id===action.task.id)??null;
    case 'event.upsert': return data.events.find(x=>x.id===action.event.id)??null;
    case 'task.status': case 'task.focus': return data.tasks.find(x=>x.id===action.id)??null;
    default:return null;
  }
}
// Merge only fields edited by this user. Deletes, competing edits and complex
// decisions fail closed; the server still validates relationships and overlap.
export function rebaseWrite(action:WorkspaceAction,basis:Basis,current:WorkspaceSnapshot):WorkspaceAction|null {
  if(!instantAction(action))return current.revision===basis.revision?action:null;
  const live=entity(current.data,action);
  if(equal(live,basis.entity))return action;
  const field=action.type==='project.upsert'?'project':action.type==='task.upsert'?'task':action.type==='event.upsert'?'event':null;
  if(!field||!basis.entity||!live)return null;
  const before=basis.entity as Record<string,unknown>, next=(action as unknown as Record<string,Record<string,unknown>>)[field], remote=live as Record<string,unknown>;
  const merged={...remote};
  for(const key of new Set([...Object.keys(before),...Object.keys(next)])) {
    if(equal(before[key],next[key]))continue;
    if(!equal(remote[key],before[key])&&!equal(remote[key],next[key]))return null;
    if(key in next)merged[key]=next[key];else delete merged[key];
  }
  return {...action,[field]:merged} as WorkspaceAction;
}

export function restoreWrites(value:unknown):QueuedWrite[] {
  if(!Array.isArray(value))return [];
  return value.flatMap(row=>{
    const parsed=commandSchema.safeParse(row?.command);
    return parsed.success&&Number.isInteger(row?.basis?.revision)&&row.basis.revision>=0
      ? [{command:parsed.data,basis:row.basis,attempted:row.attempted===true,blocked:row.blocked===true}]:[];
  });
}

export class WorkspaceWrites {
  snapshot:WorkspaceSnapshot;
  queue:QueuedWrite[]=[];
  running=false;
  private currentFailure:Failure|null=null;
  get failure():Failure|null {
    return this.currentFailure??(this.queue.some(entry=>entry.blocked)
      ? {code:'CONFLICT',message:'확인이 필요한 저장 요청이 있습니다. 보관된 입력을 확인해 주세요.'}:null);
  }
  set failure(value:Failure|null){this.currentFailure=value;}
  stopped=false;
  private waiters=new Map<string,(ok:boolean)=>void>();
  private io:{
    post:(command:Command)=>Promise<WorkspaceSnapshot>;
    read:()=>Promise<WorkspaceSnapshot>;
    persist:(queue:QueuedWrite[])=>void;
    change:()=>void;
    online:()=>boolean;
  };
  constructor(snapshot:WorkspaceSnapshot,io:WorkspaceWrites['io']){this.snapshot=snapshot;this.io=io;}
  get view() {
    let data=this.snapshot.data;
    for(const entry of this.queue)if(!entry.blocked&&instantAction(entry.command.action)) {
      try{data=applyAction(data,entry.command.action);}catch{/* dependent rejected edit remains in recovery */}
    }
    return {...this.snapshot,data};
  }
  get blocking(){return this.queue.some(x=>!instantAction(x.command.action));}
  accept(snapshot:WorkspaceSnapshot){if(snapshot.revision>=this.snapshot.revision)this.snapshot=snapshot;this.io.change();}
  enqueue(action:WorkspaceAction):Promise<boolean> {
    // Validate locally before acknowledging device persistence or closing a form.
    try{applyAction(this.view.data,action);}catch(error){this.failure={code:'INPUT',message:(error as Error).message};this.io.change();return Promise.resolve(false);}
    const entry:QueuedWrite={command:{operationId:crypto.randomUUID(),expectedRevision:this.snapshot.revision,action},basis:{revision:this.snapshot.revision,entity:structuredClone(entity(this.view.data,action))},attempted:false};
    try{this.io.persist([...this.queue,entry]);}catch{this.failure={code:'DRAFT',message:'기기에 입력을 보관하지 못했습니다. 작성한 내용을 유지하고 다시 시도해 주세요.'};this.io.change();return Promise.resolve(false);}
    this.queue.push(entry);
    const result=instantAction(action)?Promise.resolve(true):new Promise<boolean>(resolve=>this.waiters.set(entry.command.operationId,resolve));
    this.io.change();void this.flush();return result;
  }
  async flush() {
    if(this.running||this.stopped)return;
    if(!this.io.online()){this.failure={code:'OFFLINE',message:'기기에 저장됨 · 연결되면 자동으로 동기화합니다.'};this.io.change();return;}
    this.running=true;this.io.change();
    try {
      while(this.queue.some(x=>!x.blocked)) {
        const entry=this.queue.find(x=>!x.blocked)!;
        if(this.stopped)break;
        const waiterId=entry.command.operationId;
        try {
          // A previously sent request MUST replay unchanged before any rebase:
          // its reply may have been lost after the server committed it.
          if(!entry.attempted){
            const action=rebaseWrite(entry.command.action,entry.basis,this.snapshot);
            if(!action)throw {code:'CONFLICT',message:'같은 항목의 내용이 변경되었습니다. 작성한 입력은 기기에 보관했습니다.'};
            entry.command={...entry.command,action,expectedRevision:this.snapshot.revision};
            entry.basis={revision:this.snapshot.revision,entity:structuredClone(entity(this.snapshot.data,action))};
          }
          let result:WorkspaceSnapshot|undefined;
          for(let attempt=0;attempt<3;attempt++) {
            entry.attempted=true;this.io.persist(this.queue);
            try{result=await this.io.post(entry.command);break;}
            catch(error){
              const err=error as Failure;
              if(err.code!=='CONFLICT'||attempt===2)throw error;
              const latest=await this.io.read();this.accept(latest);
              const action=rebaseWrite(entry.command.action,entry.basis,latest);
              if(!action)throw {code:'CONFLICT',message:'같은 항목의 내용이 변경되었습니다. 작성한 입력은 기기에 보관했습니다.'};
              // A definitive 409 made no write. A changed payload gets a new id.
              entry.command={operationId:equal(action,entry.command.action)?entry.command.operationId:crypto.randomUUID(),expectedRevision:latest.revision,action};
              entry.basis={revision:latest.revision,entity:structuredClone(entity(latest.data,action))};
            }
          }
          if(!result)throw {code:'NETWORK',message:'저장 결과를 확인하고 있습니다.'};
          this.queue=this.queue.filter(x=>x!==entry);
          if(result.revision>=this.snapshot.revision)this.snapshot=result;
          this.failure=this.queue.some(x=>x.blocked)?this.failure:null;
          this.waiters.get(waiterId)?.(true);this.waiters.delete(waiterId);
          this.io.persist(this.queue);this.io.change();
        }catch(error){
          const err=error as Failure;
          this.failure={code:err.code||'NETWORK',message:err.message||'기기에 저장됨 · 서버 저장 결과를 다시 확인합니다.'};
          const definitive=['CONFLICT','INPUT','AUTH','SESSION_CHANGED','ORIGIN','CALENDAR_OVERLAP'].includes(this.failure.code);
          if(definitive)entry.blocked=true;
          this.waiters.get(waiterId)?.(false);this.waiters.delete(waiterId);
          try{this.io.persist(this.queue);}catch{/* Existing durable copy remains available. */}
          this.io.change();
          if(!definitive)break; // Unknown outcome: preserve ordering and operation id.
        }
      }
    }finally{this.running=false;this.io.change();}
  }
  async retry(){for(const entry of this.queue)entry.blocked=false;await this.flush();return this.queue.length===0;}
}
