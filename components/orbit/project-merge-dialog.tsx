'use client';
import {useMemo,useState} from 'react';
import {Merge,Search} from 'lucide-react';
import type {WorkspaceData} from '@/lib/orbit/model';
import {MAX_SOURCES,duplicateProjectGroups,projectMergePreview,projectMergeProblem} from '@/lib/orbit/project-merge';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';

export type ProjectMergeAction={type:'project.merge';targetId:string;sourceIds:string[];name:string};
type Props={data:WorkspaceData;busy:boolean;onMerge:(action:ProjectMergeAction)=>Promise<boolean>;onClose:()=>void};
const CUSTOM='__custom__';

// Two or more projects become one: the kept project's goal, due date, priority,
// status and colour stay; its name is picked from the merged names or typed.
export function ProjectMergeDialog({data,busy,onMerge,onClose}:Props){
 const groups=useMemo(()=>duplicateProjectGroups(data.projects),[data.projects]);
 const [selected,setSelected]=useState<string[]>([]),[targetId,setTargetId]=useState(''),[nameChoice,setNameChoice]=useState(''),[customName,setCustomName]=useState('');
 const [query,setQuery]=useState(''),[confirming,setConfirming]=useState(false);
 const taskCount=(id:string)=>data.tasks.filter(t=>t.projectId===id).length;
 function choose(ids:string[]){
  // The project with the most work is the natural one to keep.
  const keep=ids.includes(targetId)?targetId:[...ids].sort((a,b)=>taskCount(b)-taskCount(a))[0]??'';
  setSelected(ids);setTargetId(keep);setNameChoice(nameChoice===CUSTOM||ids.includes(nameChoice)?nameChoice:keep);setConfirming(false);
 }
 const toggle=(id:string)=>choose(selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]);
 const picked=data.projects.filter(p=>selected.includes(p.id));
 const name=nameChoice===CUSTOM?customName:data.projects.find(p=>p.id===nameChoice)?.name??'';
 const sourceIds=selected.filter(id=>id!==targetId);
 const action:ProjectMergeAction={type:'project.merge',targetId,sourceIds,name:name.trim()};
 const problem=selected.length<2?'':projectMergeProblem(data,action);
 const moving=projectMergePreview(data,sourceIds);
 const visible=data.projects.filter(p=>`${p.name} ${p.goal}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 async function submit(){if(!confirming){setConfirming(true);return}if(await onMerge(action))onClose()}
 return <Dialog open onOpenChange={o=>{if(!o&&!busy)onClose()}}><DialogContent className="approve-dialog project-merge-dialog">
  <DialogHeader><DialogTitle>프로젝트 합치기</DialogTitle><DialogDescription>같은 일을 나눠 관리하던 프로젝트를 하나로 합칩니다. 할 일·일정·기록·대화가 남길 프로젝트로 옮겨지고, 나머지 프로젝트는 목록에서 사라집니다.</DialogDescription></DialogHeader>
  <form onSubmit={e=>{e.preventDefault();void submit()}}>
   {groups.length>0&&<section className="project-merge-suggest" aria-label="중복 의심 프로젝트"><strong>중복 의심</strong>{groups.map(g=><button type="button" key={g.map(p=>p.id).join('|')} className="secondary-button" disabled={busy} onClick={()=>choose(g.map(p=>p.id))}>{g.map(p=>p.name).join(' · ')}</button>)}</section>}
   <label className="project-search"><Search size={16}/><input aria-label="합칠 프로젝트 검색" placeholder="프로젝트 검색" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <fieldset className="project-merge-list"><legend>합칠 프로젝트 · 2개 이상</legend>{visible.map(p=><label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} disabled={busy||!selected.includes(p.id)&&selected.length>MAX_SOURCES} onChange={()=>toggle(p.id)}/><span>{p.name}</span><small>할 일 {taskCount(p.id)}</small></label>)}</fieldset>
   {picked.length>=2&&<>
    <label>남길 프로젝트<select className="form-field" value={targetId} disabled={busy} onChange={e=>{setTargetId(e.target.value);setConfirming(false)}}>{picked.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <p className="form-hint">목표·목표일·우선순위·상태·색은 남길 프로젝트의 것을 그대로 씁니다. 흡수되는 프로젝트 이름은 검색 키워드로 남아 관련 일정이 계속 연결됩니다.</p>
    <label>합친 이름<select className="form-field" value={nameChoice} disabled={busy} onChange={e=>{setNameChoice(e.target.value);setConfirming(false)}}>{picked.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}<option value={CUSTOM}>직접 입력</option></select></label>
    {nameChoice===CUSTOM&&<label>새 이름<input className="form-field" required maxLength={160} value={customName} disabled={busy} onChange={e=>{setCustomName(e.target.value);setConfirming(false)}}/></label>}
    <p role="status" className="project-merge-preview">옮겨지는 항목 · 할 일 {moving.tasks} · 일정 {moving.events} · 기록 {moving.notes}{moving.others?` · 결정·위임 등 ${moving.others}`:''}</p>
   </>}
   {problem&&<p role="alert" className="note-error">{problem}</p>}
   {confirming&&!problem&&<p role="alert" className="note-error">합치면 되돌릴 수 없습니다. {picked.filter(p=>p.id!==targetId).map(p=>`「${p.name}」`).join(', ')}이(가) 「{name.trim()}」으로 합쳐집니다.</p>}
   <div className="sheet-actions"><button className="primary-button" type="submit" disabled={busy||selected.length<2||!!problem}><Merge size={15}/>{confirming?'합치기 확정':'합치기'}</button><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>취소</button></div>
  </form>
 </DialogContent></Dialog>;
}
