'use client';
import {useEffect,useMemo,useState} from 'react';
import {ArrowRight,Check,CheckCheck,History,LoaderCircle,Pencil,Plus,RotateCcw,Trash2} from 'lucide-react';
import {Checkbox} from '@/components/ui/checkbox';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import {meetingCandidates} from '@/lib/orbit/meeting';
import type {Note,NoteRevision,Task} from '@/lib/orbit/model';
import type {WorkspaceAction} from '@/lib/orbit/validation';
interface Props {meta:Note;tasks:Task[];demo:boolean;busy:boolean;defaultDue:string;projectName?:string;onAction:(action:WorkspaceAction,message?:string)=>Promise<boolean>;onEdit:(note:Note)=>void;onDelete:()=>void;onTask:(id:string)=>void;onProject:()=>void;onNewTask:()=>void}
async function fetchNote<T>(params:Record<string,string>,signal?:AbortSignal):Promise<T>{
 const response=await fetch('/api/notes?'+new URLSearchParams(params),{cache:'no-store',signal});const data=await response.json();if(!response.ok)throw new Error(data.error||'기록을 불러오지 못했습니다.');return data;
}
export function NoteDetail({meta,tasks,demo,busy,defaultDue,projectName,onAction,onEdit,onDelete,onTask,onProject,onNewTask}:Props){
 const [note,setNote]=useState<Note|null>(meta.bodyStored?null:meta),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const [historyOpen,setHistoryOpen]=useState(false),[versions,setVersions]=useState<NoteRevision[]>([]),[nextBefore,setNextBefore]=useState<number|null>(null),[historyBusy,setHistoryBusy]=useState(false),[historyError,setHistoryError]=useState('');
 const [previous,setPrevious]=useState<Note|null>(null),[restoreOpen,setRestoreOpen]=useState(false);
 useEffect(()=>{if(!meta.bodyStored){setNote(meta);return}const controller=new AbortController();setError('');void fetchNote<Note>({id:meta.id,revision:String(meta.revision??1)},controller.signal).then(setNote).catch(error=>{if(!controller.signal.aborted)setError(error.message)});return()=>controller.abort()},[meta.id,meta.revision,meta.bodyStored,attempt]);
 async function loadHistory(before?:number){if(demo)return;setHistoryBusy(true);setHistoryError('');try{const result=await fetchNote<{items:NoteRevision[];nextBefore:number|null}>({id:meta.id,history:'1',...(before?{before:String(before)}:{})});setVersions(old=>before?[...old,...result.items]:result.items);setNextBefore(result.nextBefore);setHistoryOpen(true)}catch(error){setHistoryError((error as Error).message)}finally{setHistoryBusy(false)}}
 async function selectVersion(revision:number){setHistoryBusy(true);setHistoryError('');try{setPrevious(await fetchNote<Note>({id:meta.id,revision:String(revision)}))}catch(error){setHistoryError((error as Error).message)}finally{setHistoryBusy(false)}}
 if(!note)return <div className="note-loading" role="status">{error?<><p>{error}</p><button className="secondary-button" onClick={()=>setAttempt(v=>v+1)}><RotateCcw size={16}/>다시 불러오기</button></>:<><LoaderCircle size={22} className="animate-spin"/><p>기록을 불러오는 중</p></>}</div>;
 const linked=tasks.filter(t=>t.noteId===meta.id);
 return <>
  <div className="section-title"><button className="secondary-button" disabled={busy} onClick={()=>onEdit(note)}><Pencil size={14}/>내용 수정</button><button className="text-button danger-text" disabled={busy} onClick={onDelete}><Trash2 size={14}/>삭제</button></div>
  <div className="note-version"><span>{projectName??'개인 기록'}</span><span>버전 {note.revision??1} · {note.updated}</span></div>
  <h3>본문</h3><div className="note-document">{note.body||'아직 작성한 본문이 없습니다.'}</div>
  <button className="secondary-button full-width note-history-toggle" disabled={historyBusy||demo} onClick={()=>historyOpen?setHistoryOpen(false):void loadHistory()}><History size={16}/>{demo?'변경 이력은 실제 기록에서 제공됩니다':historyBusy?'이력 불러오는 중':historyOpen?'변경 이력 접기':'이전 내용 확인 · 복원'}</button>
  {historyError&&<p className="note-error" role="alert">{historyError}</p>}
  {historyOpen&&<section className="note-history"><h3>변경 이력</h3><p className="form-hint">이전 내용을 선택해 현재 내용과 비교하세요. 복원하면 새 버전으로 저장됩니다.</p><div className="revision-list">{versions.map(v=><button key={v.revision} className={previous?.revision===v.revision?'selected':''} disabled={historyBusy} onClick={()=>void selectVersion(v.revision)}><span>버전 {v.revision}{v.revision===(meta.revision??1)?' · 현재':''}</span><strong>{v.title}</strong><small>{new Date(v.updatedAt).toLocaleString('ko-KR')}</small></button>)}</div>{nextBefore&&<button className="text-button" disabled={historyBusy} onClick={()=>void loadHistory(nextBefore)}>이전 이력 더 보기</button>}
   {previous&&<div className="revision-compare"><h4>선택한 버전 {previous.revision}</h4><strong>{previous.title}</strong><div className="note-document">{previous.body||'본문 없음'}</div><h4>현재 버전 {note.revision??1}</h4><strong>{note.title}</strong><div className="note-document">{note.body||'본문 없음'}</div>{previous.revision!==(note.revision??1)&&<button className="secondary-button" disabled={busy||historyBusy} onClick={()=>setRestoreOpen(true)}><RotateCcw size={15}/>선택한 내용으로 복원</button>}</div>}
  </section>}
  {note.kind==='meeting'&&<MeetingActions key={`${note.id}:${note.revision??1}`} note={note} tasks={tasks} busy={busy} defaultDue={defaultDue} onAction={onAction}/>}
  <h3>연결된 행동 <span className="muted">{linked.length}</span></h3>{linked.map(t=><button className="link-card" key={t.id} onClick={()=>onTask(t.id)}><CheckCheck size={16}/><span style={{flex:1}}>{t.title}</span><span className="muted">{t.status==='done'?'완료':'진행 확인'}</span></button>)}
  <div className="sheet-actions"><button className="secondary-button" onClick={onNewTask}><Plus size={16}/>다음 행동 직접 추가</button><button className="text-button" onClick={onProject}>프로젝트<ArrowRight size={15}/></button></div>
  <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>선택한 내용으로 복원할까요?</AlertDialogTitle><AlertDialogDescription>버전 {previous?.revision}의 제목·본문·프로젝트·태그를 새 버전으로 저장합니다. 현재 내용과 기존 이력도 남습니다. 연결된 할 일은 유지됩니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={async event=>{event.preventDefault();if(previous&&await onAction({type:'note.restore',id:note.id,revision:previous.revision!,expectedNoteRevision:note.revision??1},'이전 내용을 새 버전으로 복원했습니다.'))setRestoreOpen(false)}}>복원하여 저장</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </>;
}
function MeetingActions({note,tasks,busy,defaultDue,onAction}:{note:Note;tasks:Task[];busy:boolean;defaultDue:string;onAction:Props['onAction']}){
 const candidates=useMemo(()=>meetingCandidates(note),[note]);
 const [drafts,setDrafts]=useState(()=>candidates.map(c=>({...c,id:crypto.randomUUID(),selected:false,due:defaultDue,duration:45,definition:'완료 후 결과물 확인'})));
 const [page,setPage]=useState(1);
 const accepted=(line:number)=>tasks.some(t=>t.noteId===note.id&&t.noteCitation&&(t.noteCitation.quote===candidates.find(c=>c.line===line)?.quote||(t.noteCitation.revision===(note.revision??1)&&t.noteCitation.line===line)));
 const selected=drafts.filter(d=>d.selected&&!accepted(d.line));
 const patch=(line:number,value:Partial<typeof drafts[number]>)=>setDrafts(old=>old.map(d=>d.line===line?{...d,...value}:d));
 async function approve(){const items=selected.map(({id,line,title,definition,due,duration})=>({id,line,title,definition,due,duration}));if(await onAction({type:'meeting.acceptActions',noteId:note.id,expectedNoteRevision:note.revision??1,items},'선택한 행동을 할 일에 등록했습니다.'))setDrafts(old=>old.map(d=>({...d,selected:false})))}
 return <section className="meeting-candidates"><div className="section-title"><h3>회의록에서 다음 행동으로</h3><span className="status status-blue">{candidates.length}개 후보</span></div><p className="form-hint">‘할 일:’, ‘TODO:’, ‘- [ ]’로 적은 항목을 찾습니다. 원문을 확인하고 실행할 항목을 선택하세요.</p>
  {drafts.length===0?<p className="candidate-empty">아직 명시한 할 일이 없습니다.<br/>예: 할 일: 제안서 초안 작성</p>:<>
   {drafts.slice(0,page*10).map(d=><article key={d.line} className={`meeting-candidate ${accepted(d.line)?'accepted':''}`}><label className="candidate-check"><Checkbox checked={accepted(d.line)||d.selected} disabled={busy||accepted(d.line)||(!d.selected&&selected.length>=20)} onCheckedChange={value=>patch(d.line,{selected:value===true})}/><strong>{accepted(d.line)?'등록 완료':`원문 ${d.line}행`}</strong>{accepted(d.line)&&<Check size={15}/>}</label><blockquote>{d.quote}</blockquote>{!accepted(d.line)&&d.selected&&<div className="candidate-form"><label>할 일 제목<input className="form-field" maxLength={160} value={d.title} onChange={event=>patch(d.line,{title:event.target.value})}/></label><div className="field-grid"><label>마감일<input type="date" className="form-field" value={d.due} onChange={event=>patch(d.line,{due:event.target.value})}/></label><label>예상 시간 · 분<input type="number" min={5} max={480} className="form-field" value={d.duration} onChange={event=>patch(d.line,{duration:Number(event.target.value)})}/></label></div><label>완료 기준<input className="form-field" maxLength={4000} value={d.definition} onChange={event=>patch(d.line,{definition:event.target.value})}/></label></div>}</article>)}
   {drafts.length>page*10&&<button className="text-button" onClick={()=>setPage(p=>p+1)}>후보 더 보기</button>}
   <button className="primary-button full-width" disabled={busy||selected.length===0||selected.some(d=>!d.title.trim()||!d.due||d.duration<5||d.duration>480)} onClick={()=>void approve()}><CheckCheck size={16}/>선택한 {selected.length}개를 할 일로 등록</button><p className="form-hint">한 번에 최대 20개. 선택하지 않은 후보는 회의록에 남습니다.</p>
  </>}
 </section>;
}
