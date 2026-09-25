'use client';
import {useState} from 'react';
import {Check} from 'lucide-react';
import type {AgentAction} from '@/lib/orbit/agent/types';
import {normalize} from '@/lib/orbit/classify';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {ItemColorPicker} from './item-color-picker';

export type MeetingOverrides={title?:string;color?:string|null;projectId?:string|null;newProject?:{name:string}};
type Props={
 item:AgentAction;projects:{id:string;name:string}[];drafts:{id:string;name:string}[];busy:boolean;error:string;
 onApprove:(overrides:MeetingOverrides)=>void;onLink:(projectId:string)=>void;onClose:()=>void;
};
const NEW='__new__';

// "수정 후 등록": the proposal is prefilled; the owner changes only the name, colour
// and project. A new-project card can instead go to an existing project, and a task
// or event can be registered under a project created from a typed name.
export function MeetingEditDialog({item,projects,drafts,busy,error,onApprove,onLink,onClose}:Props){
 const a=item.action;
 const kind=a.type==='project.upsert'?'project':'item';
 const initial=a.type==='project.upsert'?{title:a.project.name,color:a.project.color as string|null,projectId:''}
  :a.type==='task.upsert'?{title:a.task.title,color:a.task.color??null,projectId:a.task.projectId??''}
  :a.type==='event.upsert'?{title:a.event.title,color:a.event.color??null,projectId:a.event.projectId??''}
  :{title:item.title,color:null,projectId:''};
 const [title,setTitle]=useState(initial.title),[color,setColor]=useState(initial.color),[projectId,setProjectId]=useState(initial.projectId);
 const [newName,setNewName]=useState(''),[mode,setMode]=useState<'new'|'link'>('new'),[linkTo,setLinkTo]=useState('');
 const newProjectCard=a.type==='project.upsert'&&!projects.some(p=>p.id===a.project.id);
 const draft=drafts.find(d=>d.id===projectId);
 const sameName=projectId===NEW&&newName.trim()?projects.find(p=>normalize(p.name)===normalize(newName)):undefined;
 const linking=newProjectCard&&mode==='link';
 const blocked=linking?!linkTo:!title.trim()||!!draft||projectId===NEW&&!newName.trim();
 function submit(){
  if(linking)return onLink(linkTo);
  const project=kind!=='item'?{}:projectId===NEW?{newProject:{name:newName.trim()}}:{projectId:projectId||null};
  onApprove({title:title.trim(),...(kind==='item'||color?{color}:{}),...project});
 }
 return <Dialog open onOpenChange={o=>{if(!o)onClose()}}><DialogContent className="approve-dialog">
  <DialogHeader><DialogTitle>수정 후 등록</DialogTitle><DialogDescription>이름과 색, 연결할 프로젝트를 정한 뒤 등록합니다. 나머지 내용은 결재안 그대로 등록됩니다.</DialogDescription></DialogHeader>
  <form onSubmit={e=>{e.preventDefault();submit()}}>
   {newProjectCard&&<div className="meeting-edit-mode" role="radiogroup" aria-label="등록 방식">
    <button type="button" role="radio" aria-checked={mode==='new'} onClick={()=>setMode('new')}>새 프로젝트로 등록</button>
    <button type="button" role="radio" aria-checked={mode==='link'} disabled={!projects.length} onClick={()=>setMode('link')}>기존 프로젝트에 연결</button>
   </div>}
   {linking?<>
    <label>연결할 프로젝트<select className="form-field" autoFocus required value={linkTo} onChange={e=>setLinkTo(e.target.value)}><option value="">프로젝트 선택</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <p className="form-hint">새 프로젝트를 만들지 않습니다. 기존 프로젝트의 목표·목표일은 그대로 두고, 이 회의의 할 일·일정만 그 프로젝트로 연결합니다.</p>
   </>:<>
    <label>등록할 이름<input className="form-field" autoFocus required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    {kind==='item'&&<label>프로젝트<select className="form-field" value={projectId} onChange={e=>setProjectId(e.target.value)}>
     <option value="">연결 안 함</option>
     {draft&&<option value={draft.id}>{draft.name} · 신규 프로젝트 결재안</option>}
     {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
     <option value={NEW}>＋ 새 프로젝트 만들기</option>
    </select></label>}
    {draft&&<p className="form-hint">「{draft.name}」은 아직 승인 전인 신규 프로젝트입니다. 그 결재안을 먼저 승인하거나, 다른 프로젝트를 골라 주세요.</p>}
    {projectId===NEW&&<label>새 프로젝트 이름<input className="form-field" required maxLength={160} value={newName} placeholder="예: 엑스더리그 글로벌 확장" onChange={e=>setNewName(e.target.value)}/></label>}
    {sameName&&<p className="form-hint">같은 이름의 「{sameName.name}」 프로젝트가 있어 새로 만들지 않고 그 프로젝트에 연결합니다.</p>}
    <ItemColorPicker label="표시 색" value={color} defaultColor={kind==='project'?'#7067eb':'#5484ed'} onChange={setColor}/>
   </>}
   {error&&<p role="alert" className="note-error">{error}</p>}
   <div className="sheet-actions"><button className="primary-button" type="submit" disabled={busy||blocked}><Check size={15}/>{linking?'연결':'등록'}</button><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>취소</button></div>
  </form>
 </DialogContent></Dialog>;
}
