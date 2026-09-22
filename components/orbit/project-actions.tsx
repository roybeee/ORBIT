'use client';
import {useEffect,useRef,useState} from 'react';
import {Pencil,CalendarDays,Trash2,RotateCcw,ChevronRight} from 'lucide-react';
import {toast} from 'sonner';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {WorkspaceSnapshot,View} from '@/lib/orbit/model';
import {projectStatus,projectDisplayStatus,projectStatusLabel} from '@/lib/orbit/project-management';
import {projectTrashPreview} from '@/lib/orbit/project-trash';
import {planDataTrash,planDataRestore,recordTitle,type TrashRecord} from '@/lib/orbit/data-manager';
import {agentRequest} from './agent/connections';
export type ProjectIntent='overview'|'tasks'|'settings'|'complete'|'resume';
type Target={id:string;mode:'menu'|'delete'};
type Receipt={name:string;ids:string[]};
type Props={target:Target|null;onClose:()=>void;snapshot:WorkspaceSnapshot;busy:boolean;demo:boolean;demoTrash:TrashRecord[];setDemoTrash:React.Dispatch<React.SetStateAction<TrashRecord[]>>;onSnapshot:(snapshot:WorkspaceSnapshot)=>void;onRefresh:()=>Promise<void>;onOpen:(id:string,intent:ProjectIntent)=>void;onEdit:(id:string)=>void;onChat:(id:string)=>void;onDeleted:(id:string)=>void;onNavigate:(view:View)=>void;onWorking:(working:boolean)=>void};
export function ProjectActions(props:Props){
  const {target,snapshot,busy,demo,demoTrash,setDemoTrash,onSnapshot,onClose,onWorking}=props;
  const [mode,setMode]=useState('menu'),[working,setWorking]=useState(false),[error,setError]=useState('');
  const [confirmation,setConfirmation]=useState<{revision:number;preview:ReturnType<typeof projectTrashPreview>}|null>(null);
  const [undo,setUndo]=useState<Receipt|null>(null),pending=useRef<Record<string,unknown>|null>(null),lock=useRef(false);
  // Render-facing mirror of pending.current: refs must not be read during render.
  const [hasPending,setHasPending]=useState(false);
  const project=snapshot.data.projects.find(p=>p.id===target?.id);
  // Reset the dialog state as soon as a new target arrives (adjusting state during render); the ref itself is cleared after commit.
  const [seenTarget,setSeenTarget]=useState<Target|null>(null);
  if(target!==seenTarget){setSeenTarget(target);if(target){setMode(target.mode);setError('');setHasPending(false);setUndo(null);setConfirmation(target.mode==='delete'?{revision:snapshot.revision,preview:projectTrashPreview(snapshot.data,target.id)}:null)}}
  useEffect(()=>{if(target)pending.current=null},[target]);
  useEffect(()=>{onWorking(!!target||!!undo||working);return()=>onWorking(false)},[target,undo,working,onWorking]);
  function askDelete(){if(!target)return;setError('');setConfirmation({revision:snapshot.revision,preview:projectTrashPreview(snapshot.data,target.id)});setMode('delete')}
  function close(){if(working||pending.current)return;setUndo(null);onClose()}
  async function execute(){
    if(lock.current||busy)return;
    if(!undo&&(!target||!project||!confirmation||confirmation.preview.error))return;
    lock.current=true;setWorking(true);setError('');
    const request=pending.current??{operationId:crypto.randomUUID(),expectedRevision:undo?snapshot.revision:confirmation!.revision,action:undo?'restore':'trash',...(undo?{trashIds:undo.ids}:{selection:confirmation!.preview.selection})};
    pending.current=request;setHasPending(true);
    try{
      let ids:string[]=[];
      if(demo){
        if(undo){const selected=demoTrash.filter(t=>undo.ids.includes(t.id));if(selected.length!==undo.ids.length)throw new Error('휴지통이 변경되었습니다.');onSnapshot({...snapshot,revision:snapshot.revision+1,data:planDataRestore(snapshot.data,selected)});setDemoTrash(old=>old.filter(t=>!undo.ids.includes(t.id)))}
        else{const plan=planDataTrash(snapshot.data,confirmation!.preview.selection);const entries=plan.records.map((r,i)=>({id:request.operationId+':'+i,category:r.category,recordId:r.record.id,title:recordTitle(r.record),record:r.record,deletedAt:new Date().toISOString()}));ids=entries.map(r=>r.id);setDemoTrash(old=>[...entries,...old]);onSnapshot({...snapshot,revision:snapshot.revision+1,data:plan.next})}
      }else{const response=await agentRequest('/api/data','POST',request);onSnapshot(response.snapshot);ids=response.trashIds??[];}
      pending.current=null;setHasPending(false);
      if(undo){toast.success('프로젝트와 연결된 항목을 복원했습니다.');setUndo(null);onClose()}
      else{const receipt={name:project!.name,ids};props.onDeleted(target!.id);onClose();toast.success('프로젝트를 휴지통으로 옮겼습니다.',{duration:12000,action:ids.length?{label:'실행 취소',onClick:()=>{if(lock.current||pending.current){toast('진행 중인 요청의 결과를 먼저 확인해 주세요.');return;}onClose();setError('');setUndo(receipt);setMode('undo')}}:undefined});}
    }catch(e){const code=(e as {code?:string}).code;if(demo||['INPUT','CONFLICT','AUTH','SESSION_CHANGED','ORIGIN'].includes(code??'')){pending.current=null;setHasPending(false);}setError((e as Error).message||'처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.');}
    finally{lock.current=false;setWorking(false)}
  }
  const go=(run:()=>void)=>{onClose();run()};
  const counts=confirmation?.preview.counts;
  return <Dialog open={!!target||!!undo} onOpenChange={open=>{if(!open)close()}}><DialogContent className="project-action-dialog" onEscapeKeyDown={e=>{if(working||pending.current)e.preventDefault()}} onInteractOutside={e=>{if(working||pending.current)e.preventDefault()}}><DialogHeader><DialogTitle>{undo?'프로젝트를 복원할까요?':mode==='delete'?'프로젝트를 삭제할까요?':'프로젝트 관리'}</DialogTitle><DialogDescription>{undo?undo.name:mode==='delete'?project?.name:project?`${project.name} · ${projectStatusLabel[projectDisplayStatus(project,snapshot.data.tasks)]}`:''}</DialogDescription></DialogHeader>
    {mode==='menu'&&project&&<><div className="project-action-list">{[
      {label:'프로젝트 수정',icon:Pencil,run:()=>props.onEdit(project.id)},
      {label:'기한·우선순위 변경',icon:CalendarDays,run:()=>props.onOpen(project.id,'settings')},
      {label:projectStatus(project)==='active'?'보류·완료 관리':'다시 진행하기',icon:RotateCcw,run:()=>props.onOpen(project.id,projectStatus(project)==='active'?'settings':'resume')},
    ].map(({label,icon:Icon,run})=><button key={label} disabled={busy} onClick={()=>go(run)}><Icon size={19}/><span>{label}</span><ChevronRight size={16}/></button>)}<button className="project-delete-action" disabled={busy} onClick={askDelete}><Trash2 size={19}/><span>프로젝트 삭제</span></button></div><button className="secondary-button" onClick={close}>닫기</button></>}
    {(mode==='delete'||undo)&&<>
      {!undo&&counts&&<><p className="project-delete-explainer">프로젝트와 아래 항목을 함께 휴지통으로 옮깁니다. 나중에 복원할 수 있습니다.</p><div className="project-delete-counts"><span>할 일 <strong>{counts.tasks}</strong></span><span>기록 <strong>{counts.notes}</strong></span><span>일정 <strong>{counts.events}</strong></span>{counts.decisions+counts.delegations>0&&<span>결정·위임 <strong>{counts.decisions+counts.delegations}</strong></span>}</div>{counts.events>0&&<p className="form-hint">Google 캘린더에 등록된 원본 일정은 유지됩니다.</p>}</>}
      {undo&&<p className="project-delete-explainer">프로젝트와 함께 삭제한 할 일·기록을 다시 가져옵니다. 이전 집중 타이머는 재개하지 않습니다.</p>}
      {confirmation?.preview.error&&!undo&&<div className="project-action-error" role="alert"><p>{confirmation.preview.error}</p><button className="text-button" onClick={()=>go(()=>props.onNavigate(confirmation.preview.view))}>연결 항목 확인<ChevronRight size={15}/></button></div>}
      {error&&<p className="project-action-error" role="alert">{error}</p>}
      {error&&!hasPending&&<button className="text-button" disabled={working||busy} onClick={async()=>{await props.onRefresh();onClose();setUndo(null)}}>최신 목록으로 돌아가기</button>}
      <div className="project-action-footer"><button className="secondary-button" disabled={working||hasPending} onClick={close}>취소</button><button className={undo?'primary-button':'project-delete-confirm'} disabled={working||busy||!undo&&!!confirmation?.preview.error} onClick={()=>void execute()}>{working?'처리 중…':hasPending?'처리 결과 다시 확인':undo?'복원하기':'휴지통으로 이동'}</button></div>
    </>}
  </DialogContent></Dialog>;
}
