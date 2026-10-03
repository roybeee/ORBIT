'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {CalendarDays,CheckCheck,FileText,Mic,MessagesSquare,PenLine,Send,Sparkles,Square,X} from 'lucide-react';
import {toast} from 'sonner';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {VoiceInput,type DictationState} from './phase4/voice';
import {readDraft,saveDraft,clearDraft} from '@/lib/orbit/device-drafts';
import {readCapture,captureAction,captureFollowUps,followUpAction,captureKindLabel,CAPTURE_INBOX_ID,type CaptureKind} from '@/lib/orbit/quick-capture';
import {batchItems,organizedItems,type BatchItem} from '@/lib/orbit/capture-batch';
import {formatTime,durationText,type WorkspaceData} from '@/lib/orbit/model';
import {koreanDate} from '@/lib/orbit/dates';
import type {WorkspaceAction} from '@/lib/orbit/validation';

const kinds:CaptureKind[]=['note','task','event','meeting'];
const kindIcon={note:FileText,task:CheckCheck,event:CalendarDays,meeting:MessagesSquare} as const;
const typing=(target:EventTarget|null)=>target instanceof HTMLElement&&(target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target.tagName));

// "N" anywhere outside a text field opens 빠른 기록 (KeyN also covers the Korean ㅜ key).
export function useCaptureShortcut(open:()=>void){
 useEffect(()=>{
  const onKey=(e:KeyboardEvent)=>{
   if(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey||e.repeat||typing(e.target))return;
   if(e.target instanceof Element&&e.target.closest('[role="dialog"],[role="alertdialog"],[role="menu"]'))return;
   if(e.code==='KeyN'||e.key==='n'||e.key==='ㅜ'){e.preventDefault();open();}
  };
  window.addEventListener('keydown',onKey);
  return()=>window.removeEventListener('keydown',onKey);
 },[open]);
}

type Props={
 // Incremented by "말로 기록": the sheet opens straight into voice input.
 voiceRequest?:number;
 open:boolean;onOpenChange:(open:boolean)=>void;data:WorkspaceData;today:string;nowMinute:number;
 demo:boolean;ownerId:string;disabled:boolean;
 perform:(action:WorkspaceAction)=>Promise<boolean>;
 onOpenRecord:(target:{kind:'task'|'event';id:string})=>void;
};
export function QuickCapture({voiceRequest=0,open,onOpenChange,data,today,nowMinute,demo,ownerId,disabled,perform,onOpenRecord}:Props){
 const [text,setText]=useState('');
 const [override,setOverride]=useState<CaptureKind|null>(null);
 const [projectChoice,setProjectChoice]=useState<string>('auto');
 const [saving,setSaving]=useState(false);
 const [kept,setKept]=useState<string[]>([]);
 const area=useRef<HTMLTextAreaElement>(null);
 const idRef=useRef('');
 // Dictation: the text before 말로 기록 started, what is still being recognized, and a 종료 request.
 const dictationBase=useRef<string|null>(null);
 const [live,setLive]=useState<DictationState|null>(null);
 const [stopRequest,setStopRequest]=useState(0);
 // Several things in one go: reviewed as a list, each with its own title and kind.
 const [review,setReview]=useState(false);
 const [single,setSingle]=useState(false);
 const [ai,setAi]=useState<{text:string;items:BatchItem[]}|null>(null);
 const [organizing,setOrganizing]=useState<'idle'|'busy'|'local'>('idle');
 const [edits,setEdits]=useState<{key:string;rows:Record<number,{kind?:CaptureKind;title?:string;skip?:boolean}>}>({key:'',rows:{}});
 const textRef=useRef('');
 // Restore an unsent draft when the sheet opens; the draft is per device and owner.
 // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the device draft (localStorage) only happens on open
 useEffect(()=>{if(!open)return;idRef.current=crypto.randomUUID();const saved=demo?null:readDraft<{text:string}>(ownerId,'capture','current');setText(typeof saved?.text==='string'?saved.text:'');setOverride(null);setProjectChoice('auto');setKept([]);setReview(false);setSingle(false);setAi(null);setOrganizing('idle');setLive(null);dictationBase.current=null;},[open,demo,ownerId]);
 useEffect(()=>{if(!open||demo)return;try{if(text.trim())saveDraft(ownerId,'capture','current',{text});else clearDraft(ownerId,'capture','current');}catch{/* typing continues; the draft is a convenience */}},[open,demo,ownerId,text]);
 const ctx=useMemo(()=>({today,projects:data.projects,tasks:data.tasks,notes:data.notes}),[today,data.projects,data.tasks,data.notes]);
 const reading=useMemo(()=>readCapture(text,ctx),[text,ctx]);
 const kind=override??reading.kind;
 useEffect(()=>{textRef.current=text},[text]);
 // The local split is instant; the server's reading replaces it while the text is unchanged.
 const localItems=useMemo(()=>batchItems(text,ctx),[text,ctx]);
 const items=ai&&ai.text===text?ai.items:localItems;
 const batch=!single&&!!text.trim()&&(items.length>=2||review);
 const itemsKey=items.map(i=>i.source).join('\u0000');
 const rows=edits.key===itemsKey?edits.rows:{};
 const edit=(index:number,change:{kind?:CaptureKind;title?:string;skip?:boolean})=>setEdits(current=>{const base=current.key===itemsKey?current.rows:{};return {key:itemsKey,rows:{...base,[index]:{...base[index],...change}}};});
 const chosenItems=items.map((item,index)=>({item,index,kind:rows[index]?.kind??item.kind,title:(rows[index]?.title??item.title).trim()||item.title,skip:!!rows[index]?.skip})).filter(row=>!row.skip);
 async function organize(source:string){
  if(demo||!source.trim())return;
  setOrganizing('busy');
  try{
   const response=await fetch('/api/capture/organize',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','x-orbit-owner':ownerId},body:JSON.stringify({text:source,today})});
   const result=response.ok?organizedItems((await response.json()).answer,source,ctx):null;
   if(result&&textRef.current===source){setAi({text:source,items:result});setOrganizing('idle');}
   else setOrganizing('local');
  }catch{setOrganizing('local')}
 }
 function onDictation(spoken:string,state:DictationState){
  if(dictationBase.current===null)dictationBase.current=textRef.current.trimEnd();
  const base=dictationBase.current;
  const next=(base&&spoken?base+'\n':base)+spoken;
  setText(next);textRef.current=next;
  setLive(state.done?null:state);
  if(state.done){dictationBase.current=null;if(next.trim()){setReview(true);setSingle(false);void organize(next);}}
 }
 // Follow-ups written inside a meeting note or memo are registered with it (unticked ones are skipped).
 const followUps=useMemo(()=>kind==='note'||kind==='meeting'?captureFollowUps(text,today):[],[kind,text,today]);
 const [skipped,setSkipped]=useState<Set<number>>(()=>new Set());
 const chosenFollowUps=followUps.filter(f=>!skipped.has(f.line));
 const activeProjects=data.projects.filter(p=>p.status!=='completed');
 const chosen=projectChoice==='auto'?reading.project:projectChoice==='inbox'?undefined:{projectId:projectChoice,matched:[]};
 const projectName=chosen?data.projects.find(p=>p.id===chosen.projectId)?.name:undefined;
 const destination=kind==='event'?(projectName?`→ ${projectName}`:'프로젝트는 일정 제목으로 자동 연결'):`→ ${projectName??'빠른 기록함'}`;
 const when=kind==='event'
  ?`${koreanDate(reading.date??today)} ${formatTime(reading.start??Math.min(1380,Math.ceil((nowMinute+1)/30)*30))}${reading.minutes?` · ${durationText(reading.minutes)}`:''}`
  :kind==='task'?`${reading.date&&reading.date>=today?koreanDate(reading.date)+' 마감':'오늘 마감'}${reading.minutes?` · ${durationText(reading.minutes)}`:''}`:'';
 const empty=!text.trim();
 async function saveBatch(){
  if(empty||saving||disabled||live||!chosenItems.length)return;
  setSaving(true);
  try{
   const counts:Partial<Record<CaptureKind,number>>={};let saved=0;
   for(const row of chosenItems){
    const chosenProject=projectChoice==='auto'?row.item.reading.project:projectChoice==='inbox'?undefined:{projectId:projectChoice,matched:[]};
    const action=captureAction({...row.item.reading,title:row.title,kind:row.kind,project:chosenProject},row.kind,{id:crypto.randomUUID(),today,data,nowMinute});
    if(await perform(action)){saved++;counts[row.kind]=(counts[row.kind]??0)+1;}
   }
   if(!saved)return;
   if(!demo)clearDraft(ownerId,'capture','current');
   const summary=kinds.filter(k=>counts[k]).map(k=>`${captureKindLabel[k]} ${counts[k]}`).join(' · ');
   toast.success(`저장됨 · ${saved}건`,{description:summary});
   idRef.current=crypto.randomUUID();
   setText('');setOverride(null);setProjectChoice('auto');setSkipped(new Set());setReview(false);setSingle(false);setAi(null);setOrganizing('idle');
   onOpenChange(false);
  }finally{setSaving(false)}
 }
 async function save(keepOpen:boolean){
  if(batch)return saveBatch();
  if(empty||saving||disabled||live)return;
  setSaving(true);
  try{
   const id=idRef.current||crypto.randomUUID();
   const action=captureAction({...reading,project:chosen},kind,{id,today,data,nowMinute});
   const ok=await perform(action);
   if(!ok)return;
   if(!demo)clearDraft(ownerId,'capture','current');
   let linked=0;
   if(action.type==='note.upsert')for(const item of chosenFollowUps){if(await perform(followUpAction(item,{id:crypto.randomUUID(),noteId:id,noteTitle:reading.title,projectId:action.note.projectId,today})))linked++;}
   const label=`${captureKindLabel[kind]} · ${reading.title}${linked?` + 할 일 ${linked}`:''}`;
   const target=kind==='task'?{kind:'task' as const,id}:kind==='event'?{kind:'event' as const,id}:null;
   toast.success(`저장됨 · ${label}`,{description:kind==='event'?when:destination,...(target?{action:{label:'열기',onClick:()=>onOpenRecord(target)}}:{})});
   idRef.current=crypto.randomUUID();
   setText('');setOverride(null);setProjectChoice('auto');setSkipped(new Set());setReview(false);setAi(null);
   if(keepOpen){setKept(list=>[label,...list].slice(0,5));requestAnimationFrame(()=>area.current?.focus());}
   else onOpenChange(false);
  }finally{setSaving(false)}
 }
 return <Dialog open={open} onOpenChange={next=>{if(!saving)onOpenChange(next)}}>
  <DialogContent className="quick-capture-dialog" showCloseButton={false} onOpenAutoFocus={e=>{e.preventDefault();area.current?.focus();}}>
   <DialogHeader className="quick-capture-head">
    <DialogTitle><PenLine size={18}/>빠른 기록</DialogTitle>
    <DialogDescription>{demo?'예시 체험의 변경은 저장되지 않습니다.':'적으면 바로 저장되고, 메모·할 일·일정과 프로젝트는 자동으로 정리됩니다.'}</DialogDescription>
    <button type="button" className="icon-button quick-capture-close" aria-label="닫기" onClick={()=>onOpenChange(false)}><X size={18}/></button>
   </DialogHeader>
   <form onSubmit={e=>{e.preventDefault();void save(false);}}>
    <textarea ref={area} className="quick-capture-input" value={text} onChange={e=>setText(e.target.value)} rows={4} maxLength={20000} aria-label="빠른 기록 내용"
     placeholder={'생각나는 그대로 적으세요\n예) 내일 3시 성수 파트너 미팅 · 금요일까지 IR 덱 보내기'}
     onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.nativeEvent.isComposing){e.preventDefault();void save(e.shiftKey);}}}/>
    {live&&<div className="capture-listening" role="status" aria-live="polite">
     <span className="capture-listening-dot" aria-hidden="true"/>
     <div><strong>듣고 있어요</strong><small>여러 건을 이어서 말해도 됩니다. 다 말한 뒤 종료를 누르세요.</small>{live.interim&&<p>{live.interim}</p>}</div>
     <button type="button" className="primary-button capture-listening-stop" onClick={()=>setStopRequest(n=>n+1)}><Square size={15} fill="currentColor"/>종료</button>
    </div>}
    {batch?<section className="capture-batch" aria-label={`여러 건으로 등록 ${chosenItems.length}/${items.length}`}>
     <div className="capture-batch-head"><strong>{items.length>1?`${items.length}건으로 나눠 등록`:'요약해서 등록'}</strong>
      {organizing==='busy'?<small role="status">AI가 정리하는 중…</small>:organizing==='local'?<small>기기에서 정리했어요</small>:ai?.text===text?<small>AI가 정리했어요</small>:null}
      <span className="capture-batch-actions">{!demo&&organizing!=='busy'&&!live&&<button type="button" className="text-button" onClick={()=>void organize(text)}><Sparkles size={14}/>AI로 정리</button>}<button type="button" className="text-button" onClick={()=>{setSingle(true);setReview(false)}}>한 건으로</button></span>
     </div>
     <ol>{items.map((item,index)=>{const row=rows[index]??{},rowKind=row.kind??item.kind,skip=!!row.skip,r=item.reading;
      const when=rowKind==='event'?`${koreanDate(r.date??today)} ${formatTime(r.start??Math.min(1380,Math.ceil((nowMinute+1)/30)*30))}${r.minutes?` · ${durationText(r.minutes)}`:''}`:rowKind==='task'?`${r.date&&r.date>=today?koreanDate(r.date)+' 마감':'오늘 마감'}`:'';
      return <li key={index} className={skip?'is-skipped':''}>
       <label className="capture-batch-include"><input type="checkbox" checked={!skip} onChange={()=>edit(index,{skip:!skip})} aria-label={`${index+1}번 등록`}/></label>
       <div className="capture-batch-body">
        <input className="capture-batch-title" value={row.title??item.title} maxLength={120} onChange={e=>edit(index,{title:e.target.value})} aria-label={`${index+1}번 제목`} disabled={skip}/>
        <div className="capture-batch-kinds" role="radiogroup" aria-label={`${index+1}번 저장 형식`}>{kinds.map(k=>{const Icon=kindIcon[k];return <button key={k} type="button" role="radio" aria-checked={rowKind===k} className={rowKind===k?'is-active':''} disabled={skip} onClick={()=>edit(index,{kind:k})}><Icon size={14}/>{captureKindLabel[k]}</button>;})}</div>
        <small className="capture-batch-source">{when&&<b>{when} · </b>}“{item.source}”</small>
       </div>
      </li>;})}</ol>
    </section>:<>
    <div className="quick-capture-kinds" role="radiogroup" aria-label="저장 형식">
     {kinds.map(k=>{const Icon=kindIcon[k];return <button key={k} type="button" role="radio" aria-checked={kind===k} className={'quick-capture-kind'+(kind===k?' is-active':'')} onClick={()=>setOverride(k===reading.kind?null:k)}><Icon size={15}/>{captureKindLabel[k]}{k===reading.kind&&!override&&!empty&&<small>자동</small>}</button>;})}
    </div>
    {!empty&&<div className="quick-capture-preview" aria-live="polite">
     <strong>{reading.title}</strong>
     <span>{[when,destination].filter(Boolean).join(' · ')}{projectChoice==='auto'&&reading.project?.matched.length?` (‘${reading.project.matched[0]}’)`:''}</span>
    </div>}
    {followUps.length>0&&<fieldset className="quick-capture-followups"><legend>함께 등록할 할 일 {chosenFollowUps.length}/{followUps.length}</legend>
     {followUps.map(f=><label key={f.line}><input type="checkbox" checked={!skipped.has(f.line)} onChange={()=>setSkipped(set=>{const next=new Set(set);if(next.has(f.line))next.delete(f.line);else next.add(f.line);return next;})}/><span>{f.title}</span>{f.date&&<small>{f.date.slice(5).replace('-','/')}까지</small>}</label>)}
    </fieldset>}
    {single&&items.length>=2&&<button type="button" className="text-button" onClick={()=>setSingle(false)}>여러 건으로 나누기 ({items.length}건)</button>}
    {!single&&!review&&!demo&&text.trim().length>=40&&items.length<2&&<button type="button" className="text-button" onClick={()=>{setReview(true);void organize(text)}}><Sparkles size={14}/>AI로 요약·나누기</button>}
    </>}
    <div className="quick-capture-bar">
     <VoiceInput compact dictation stopRequest={stopRequest} requestStart={voiceRequest} disabled={disabled||saving} onDictation={onDictation} onText={spoken=>setText(current=>(current.trim()?current.trimEnd()+'\n':'')+spoken)}/>
     <select className="quick-capture-project" aria-label="연결할 프로젝트" value={projectChoice} onChange={e=>setProjectChoice(e.target.value)}>
      <option value="auto">프로젝트 자동</option>
      {kind!=='event'&&<option value="inbox">빠른 기록함</option>}
      {activeProjects.filter(p=>p.id!==CAPTURE_INBOX_ID).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
     </select>
     {!batch&&<button type="button" className="secondary-button quick-capture-more" disabled={empty||saving||disabled||!!live} onClick={()=>void save(true)} title="저장하고 이어서 적기 (⌘⇧↵)">계속 적기</button>}
     <button type="submit" className="primary-button" disabled={empty||saving||disabled||!!live||(batch&&!chosenItems.length)} title="저장 (⌘↵)"><Send size={16}/>{batch?`${chosenItems.length}건 저장`:'저장'}</button>
    </div>
    {kept.length>0&&<ul className="quick-capture-kept" aria-label="방금 저장한 기록">{kept.map((k,i)=><li key={i}>✓ {k}</li>)}</ul>}
   </form>
  </DialogContent>
 </Dialog>;
}

// The floating button steps aside while reading down a list and comes back on the way up;
// on 오늘 it waits until the entry bar has scrolled away, so only one capture entry shows at a time.
export function QuickCaptureButton({onOpen,hidden}:{onOpen:()=>void;hidden?:boolean}){
 const [tucked,setTucked]=useState(false);
 useEffect(()=>{
  let last=window.scrollY;
  const onScroll=()=>{const y=window.scrollY;if(y>last+8&&y>160)setTucked(true);else if(y<last-8||y<=160)setTucked(false);if(Math.abs(y-last)>8||y<=160)last=y;};
  window.addEventListener('scroll',onScroll,{passive:true});
  return()=>window.removeEventListener('scroll',onScroll);
 },[]);
 if(hidden)return null;
 return <button type="button" className={'quick-capture-fab'+(tucked?' is-tucked':'')} onClick={onOpen} aria-label="빠른 기록 (N)" title="빠른 기록 (N)"><PenLine size={22}/></button>;
}

const visibleBars=new Set<Element>();
export function QuickCaptureBar({onOpen,onVoice,disabled}:{onOpen:()=>void;onVoice?:()=>void;disabled?:boolean}){
 const row=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const el=row.current,root=document.documentElement;
  if(!el||typeof IntersectionObserver==='undefined')return;
  // Counted per bar: a remounting 오늘 can unmount the old bar after the new one reported itself.
  const sync=()=>{if(visibleBars.size)root.dataset.captureBar='visible';else delete root.dataset.captureBar;};
  const io=new IntersectionObserver(([entry])=>{if(entry?.isIntersecting)visibleBars.add(el);else visibleBars.delete(el);sync();});
  io.observe(el);
  return()=>{io.disconnect();visibleBars.delete(el);sync();};
 },[]);
 return <div className="quick-capture-entry-row" ref={row}>
  <button type="button" className="quick-capture-bar-entry" onClick={onOpen} disabled={disabled}>
   <PenLine size={18}/><span>무엇이든 적어 두세요 — 메모 · 할 일 · 일정</span><kbd>N</kbd>
  </button>
  {onVoice&&<button type="button" className="quick-capture-voice-entry" onClick={onVoice} disabled={disabled} aria-label="말로 기록"><Mic size={20}/></button>}
 </div>;
}
