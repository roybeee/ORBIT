// DB-free helpers for the incremental analysis pipeline: the planning catalog is split into
// content-addressable source units plus an uncached synthesis frame; merge levels are planned
// by key prefix; leaf manifests detect added/modified/deleted record groups between runs.
import type {Analysis} from './batches.ts';
import {addDays} from '../dates.ts';

export const FRAME_CHARS=12000;
export const SMALL_NOTE_CHARS=6000;
export const MERGE_CHARS=30000;
export const PLANNING_TURN_PREFIX='원페이지 실행 제안 · ';
export interface Unit {key:string;value:unknown}
export interface CatalogSplit {frame:Record<string,unknown>;units:Unit[]}
export interface LevelItem {key:string;analysis:Analysis}
export interface LevelGroup {key:string;children:LevelItem[]}
export interface ManifestDiff {added:number;modified:number;deleted:number;keys:string[]}

type Rec=Record<string,any>;
const CHIEF_KEYS=['today','energy','quiet','paused','meeting','capacity','demand','timeBudget','overloaded','primary','care'];
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const str=(v:unknown)=>v==null?'':String(v);
const month=(v:unknown)=>typeof v==='string'&&v.length>=7?v.slice(0,7):'0000-00';
const year=(v:unknown)=>typeof v==='string'&&v.length>=4?v.slice(0,4):'0000';
const list=(v:unknown):Rec[]=>Array.isArray(v)?v:[];
const size=(v:unknown)=>JSON.stringify(v).length;
const sortBy=<T>(items:T[],...keys:((item:T)=>string)[])=>[...items].sort((a,b)=>keys.reduce((c,key)=>c||compare(key(a),key(b)),0));
function groupBy<T>(items:T[],keyOf:(item:T)=>string):[string,T[]][]{
 const groups=new Map<string,T[]>();
 for(const item of items)groups.set(keyOf(item),[...(groups.get(keyOf(item))??[]),item]);
 return [...groups.entries()].sort(([a],[b])=>compare(a,b));
}
const bucketUnits=<T>(prefix:string,items:T[],bucketOf:(item:T)=>string,order:(items:T[])=>T[]):Unit[]=>groupBy(items,bucketOf).map(([bucket,members])=>({key:prefix+'/'+bucket,value:order(members)}));

export const enc=(s:string)=>encodeURIComponent(s).replace(/[~.]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());

function noteUnits(notes:Rec[]):Unit[]{
 const large=notes.filter(n=>size(n)>SMALL_NOTE_CHARS).map(n=>({key:`note/${month(n.updated)}/${str(n.updated)}.${enc(str(n.id))}`,value:n}));
 const small=notes.filter(n=>size(n)<=SMALL_NOTE_CHARS);
 return [...large,...bucketUnits('notes',small,n=>month(n.updated),members=>sortBy(members,n=>str(n.updated),n=>str(n.id)))];
}
function projectUnits(projects:Rec[],tasks:Rec[]):Unit[]{
 const open=tasks.filter(t=>t.status!=='done'),known=new Set(projects.map(p=>str(p.id)));
 const ordered=(items:Rec[])=>sortBy(items,t=>str(t.due),t=>str(t.id));
 const units=projects.map(p=>({key:`project/${enc(str(p.id))}`,value:{project:p,tasks:ordered(open.filter(t=>t.projectId===p.id))}}));
 const orphans=ordered(open.filter(t=>!known.has(str(t.projectId))));
 return orphans.length?[...units,{key:'project/-',value:{tasks:orphans}}]:units;
}
function recordUnits(catalog:Rec):Unit[]{
 const byId=(items:Rec[])=>sortBy(items,r=>str(r.id));
 const memories=list(catalog.personal?.confirmed),chief=catalog.chief??{};
 const hasChief=list(chief.responses).length>0||list(chief.careRoutines).length>0;
 return [
  ...(list(catalog.decisions).length?[{key:'records/decisions',value:byId(list(catalog.decisions))}]:[]),
  ...(list(catalog.delegations).length?[{key:'records/delegations',value:byId(list(catalog.delegations))}]:[]),
  ...(memories.length?[{key:'records/memories',value:byId(memories)}]:[]),
  ...(hasChief?[{key:'records/chief',value:{responses:chief.responses,careRoutines:chief.careRoutines}}]:[]),
 ];
}
// Analyse the newest material first. A run that is cut short then leaves the records the owner is
// working from cached, instead of the oldest month of conversations. Undated units (projects with
// their open tasks, decisions, delegations, memories) lead: they are the current state, not history.
// Order is total and deterministic - the date embedded in the key, then the key itself.
// A key carries its bucket and then its record: `note/2026-09/2026-09-22.<id>` holds both the month
// and the day. Take the most specific one so a day-level unit sorts ahead of its own month bucket.
const KEY_DATE=/\/(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/g;
export function keyRecency(key:string):string{
 let best='';
 for(const m of key.matchAll(KEY_DATE)){
  const value=`${m[1]}-${m[2]??'00'}-${m[3]??'00'}`;
  if(value>best)best=value;
 }
 return best;
}
export function orderUnits(units:Unit[]):Unit[]{
 return [...units].sort((a,b)=>{
  const ra=keyRecency(a.key),rb=keyRecency(b.key);
  if(Boolean(ra)!==Boolean(rb))return ra?1:-1;
  return compare(rb,ra)||compare(a.key,b.key);
 });
}
export function splitCatalog(catalog:Record<string,any>):CatalogSplit{
 const conversations=list(catalog.conversations).filter(c=>!str(c.user).startsWith(PLANNING_TURN_PREFIX));
 const units:Unit[]=[
  ...noteUnits(list(catalog.notes)),
  ...projectUnits(list(catalog.projects),list(catalog.tasks)),
  ...bucketUnits('done',list(catalog.tasks).filter(t=>t.status==='done'),t=>month(t.completedOn),members=>sortBy(members,t=>str(t.completedOn),t=>str(t.id))),
  ...bucketUnits('review',list(catalog.reviews),r=>year(r.date),members=>sortBy(members,r=>str(r.date),r=>str(r.id))),
  ...bucketUnits('event',list(catalog.events),e=>month(e.date),members=>sortBy(members,e=>str(e.date),e=>str(e.start),e=>str(e.id))),
  ...bucketUnits('conversation',conversations,c=>`${month(c.date)}/${str(c.date).slice(0,10)}`,members=>sortBy(members,c=>str(c.date),c=>str(c.evidence))),
  ...bucketUnits('meetings',list(catalog.meetingResults),m=>m.projectId?enc(str(m.projectId)):'-',members=>sortBy(members,m=>str(m.id))),
  ...recordUnits(catalog),
 ];
 return {frame:frameFor(catalog),units:orderUnits(units)};
}

const compactPlan=(p:Rec)=>({id:p.id,date:p.date,energy:p.energy,budget:p.budget,laser:p.laser,unscheduled:p.unscheduled,items:list(p.items).map(i=>({id:i.id,taskId:i.taskId,state:i.state,start:i.start,end:i.end,role:i.role,draftTask:i.draftTask?{title:i.draftTask.title,projectId:i.draftTask.projectId,duration:i.draftTask.duration}:undefined}))});
const pick=(value:Rec,keys:string[])=>Object.fromEntries(keys.filter(k=>k in value).map(k=>[k,value[k]]));
function initialFrame(catalog:Rec):Rec{
 const {responses:_responses,careRoutines:_careRoutines,...chief}=catalog.chief??{};
 const personal=catalog.personal??{},cutoff=catalog.cutoff;
 const recent=typeof cutoff==='string'&&cutoff?[addDays(cutoff,-1),cutoff,catalog.targetDate]:[];
 return {
  preferences:catalog.preferences,chief,brainy:catalog.brainy,
  personal:{...personal,confirmed:list(personal.confirmed).map(m=>({id:m.id,statement:m.statement,evidence:m.evidence}))},
  weeklyAllocation:catalog.weeklyAllocation,
  operating:list(catalog.operating).map(({hypothesis:_hypothesis,...signal})=>signal),
  followups:{
   decisions:list(catalog.decisions).filter(d=>d.status!=='closed').map(d=>({id:d.id,title:d.title,projectId:d.projectId,status:d.status,reviewDate:d.reviewDate,evidence:d.evidence})),
   delegations:list(catalog.delegations).filter(d=>!['verified','cancelled'].includes(d.status)).map(d=>({id:d.id,title:d.title,projectId:d.projectId,status:d.status,due:d.due,checkDate:d.checkDate,evidence:d.evidence})),
  },
  recentPlans:list(catalog.previousPlans).filter(p=>recent.includes(p.date)).map(compactPlan),
  availableWindows:catalog.availableWindows,budget:catalog.budget,
  plaudTools:list(catalog.plaudTools).map(t=>({name:t.name,note:'schema omitted; call plaud_tools for the full input schema'})),
  trimmed:[],
 };
}
const TRIM_LADDER:[string,(frame:Rec)=>Rec][]=[
 ['personal.confirmed',f=>({...f,personal:{...f.personal,confirmed:list(f.personal?.confirmed).map(m=>str(m.evidence))}})],
 ['operating',f=>({...f,operating:list(f.operating).filter(s=>s.state!=='normal').map(s=>({metricId:s.metricId,name:s.name,state:s.state,delta:s.delta,percent:s.percent,question:s.question,evidence:s.evidence}))})],
 ['brainy.goals',f=>({...f,brainy:{...f.brainy,goals:list(f.brainy?.goals).map(g=>({id:g.id,kind:g.kind,sentence:g.sentence,parentId:g.parentId,deadline:g.deadline,evidence:g.evidence}))}})],
 ['recentPlans',f=>({...f,recentPlans:list(f.recentPlans).map(p=>({...p,items:list(p.items).map(i=>({taskId:i.taskId,state:i.state,role:i.role}))}))})],
 ['chief',f=>({...f,chief:pick(f.chief??{},CHIEF_KEYS)})],
 ['followups',f=>({...f,followups:{decisions:list(f.followups?.decisions).slice(0,20),delegations:list(f.followups?.delegations).slice(0,20)}})],
 ['brainy.habits',f=>({...f,brainy:{...f.brainy,habits:list(f.brainy?.habits).slice(0,12),risks:list(f.brainy?.risks).slice(0,12)}})],
];
export function frameFor(catalog:Record<string,any>,limit=FRAME_CHARS):Record<string,unknown>{
 return TRIM_LADDER.reduce((frame,[name,step])=>size(frame)>limit?{...step(frame),trimmed:[...list(frame.trimmed),name]}:frame,initialFrame(catalog));
}

export const baseKey=(key:string)=>key.replace(/#\d+$/,'').replace(/~g\d+$/,'');
export const prefixOf=(key:string,depth:number)=>depth<=0?'':baseKey(key).split('/').slice(0,depth).join('/');
export const depthFor=(stage:number)=>Math.max(0,4-stage/2);
const chunkSize=(chunk:LevelItem[])=>size(chunk.map(c=>({key:c.key,...c.analysis})));
function chunkChildren(children:LevelItem[],limit:number):LevelItem[][]{
 return children.reduce<LevelItem[][]>((chunks,child)=>{
  const last=chunks[chunks.length-1];
  if(last&&chunkSize([...last,child])<=limit)return [...chunks.slice(0,-1),[...last,child]];
  return [...chunks,[child]];
 },[]);
}
export function planLevel(items:LevelItem[],depth:number,limit=MERGE_CHARS):LevelGroup[]{
 return groupBy(sortBy(items,i=>i.key),i=>prefixOf(i.key,depth)).flatMap(([prefix,children])=>{
  const chunks=chunkChildren(children,limit);
  return chunks.map((chunk,i)=>({key:chunks.length===1?prefix:`${prefix}~g${i}`,children:chunk}));
 });
}

export const diffKey=(key:string)=>{const b=baseKey(key),m=/^note\/[^/]+\/[^/]+\.(.+)$/.exec(b);return m?'note/'+m[1]:b};
// Sorted first: the manifest identifies content, so it must not change when the processing order does.
export function manifestOf(leaves:{key:string;hash:string}[]):Record<string,string>{
 return sortBy(leaves,l=>l.key).reduce<Record<string,string>>((manifest,leaf)=>{const k=diffKey(leaf.key);return {...manifest,[k]:(manifest[k]??'')+leaf.hash.slice(0,16)}},{});
}
export function diffManifest(prev:Record<string,string>,current:Record<string,string>):ManifestDiff{
 const added=Object.keys(current).filter(k=>!(k in prev)).sort(compare);
 const deleted=Object.keys(prev).filter(k=>!(k in current)).sort(compare);
 const modified=Object.keys(current).filter(k=>k in prev&&prev[k]!==current[k]).sort(compare);
 return {added:added.length,modified:modified.length,deleted:deleted.length,keys:[...deleted,...modified,...added].slice(0,60)};
}

// Never split a surrogate pair when binding Unicode text to SQLite (db/workspace-storage.ts pattern).
export function textChunks(text:string,size=16000):string[]{
 const chunks:string[]=[];
 for(let offset=0;offset<text.length;){
  const cut=Math.min(offset+size,text.length),last=text.charCodeAt(cut-1);
  const end=cut<text.length&&last>=0xd800&&last<=0xdbff?cut-1:cut;
  chunks.push(text.slice(offset,end));offset=end;
 }
 return chunks;
}
export const joinChunks=(rows:{content:string}[])=>rows.map(r=>r.content).join('');
