// How a bulk approve/close of one meeting's decisions runs.
// Approval stays per card on the server (same checks as a single approval); this only orders it.
type Item={id:string;state:string;guard?:{meeting?:{needsDue?:boolean}};action:{type:string;task?:{projectId?:string;due?:string};event?:{projectId?:string;date?:string;start?:number};project?:{id:string;name:string;due?:string}}};
export type Blocked<T>={item:T;reason:string};

const projectOf=(item:Item)=>item.action.task?.projectId??item.action.event?.projectId;
// A task or event may point at a project proposed in the same meeting; that card must be approved first.
const proposedProject=<T extends Item>(item:T,items:readonly T[])=>{const id=projectOf(item);return id?items.find(x=>x.action.type==='project.upsert'&&x.action.project?.id===id&&x.id!==item.id):undefined};

export function bulkPlan<T extends Item>(items:readonly T[],selected:ReadonlySet<string>,{rejectRest,dueOf=()=>undefined}:{rejectRest:boolean;dueOf?:(item:T)=>string|undefined}){
 const open=items.filter(i=>i.state==='pending');
 const approve:T[]=[],blocked:Blocked<T>[]=[],setDue:{item:T;due:string}[]=[];
 for(const item of open.filter(i=>selected.has(i.id))){
  const prerequisite=proposedProject(item,open);
  const due=item.guard?.meeting?.needsDue?dueOf(item):undefined;
  if(item.guard?.meeting?.needsDue&&!due)blocked.push({item,reason:'마감일을 먼저 지정해 주세요.'});
  else if(prerequisite&&!selected.has(prerequisite.id))blocked.push({item,reason:'함께 제안된 새 프로젝트를 먼저 선택해 주세요.'});
  else{approve.push(item);if(due)setDue.push({item,due})}
 }
 approve.sort((a,b)=>Number(b.action.type==='project.upsert')-Number(a.action.type==='project.upsert'));
 // Chosen-but-blocked cards stay for the owner; only the cards left unchosen are closed.
 const reject=rejectRest?open.filter(i=>!selected.has(i.id)):[];
 return {approve,reject,blocked,setDue};
}

export function summarizeResults(results:readonly {decision:'approve'|'reject';ok:boolean}[]){
 const count=(test:(r:{decision:string;ok:boolean})=>boolean)=>results.filter(test).length;
 const parts=[['승인',count(r=>r.ok&&r.decision==='approve')],['반려',count(r=>r.ok&&r.decision==='reject')],['실패',count(r=>!r.ok)]] as const;
 return parts.filter(([,n])=>n>0).map(([label,n])=>`${label} ${n}건`).join(' · ');
}
