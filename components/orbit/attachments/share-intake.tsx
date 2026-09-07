'use client';
import {useEffect,useRef,useState} from 'react';
import {Share2,FileText,LoaderCircle,ArrowLeft,Trash2} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {sharedDrafts,removeShare,type ShareDraft} from '@/lib/orbit/share-drafts';
import type {StoredAttachment} from '@/lib/orbit/attachments/types';
import type {WorkspaceSnapshot} from '@/lib/orbit/model';
import type {Conversation} from '@/lib/orbit/agent/types';
import {useAttachments} from './provider';
import {AttachmentInput} from './files';
import {agentRequest} from '../agent/connections';
interface Props {
 snapshot:WorkspaceSnapshot;demo:boolean;
 onChat:(id:string|null,files:StoredAttachment[],shareId:string)=>Promise<void>;
 onEvent:(id:string|null,files:StoredAttachment[],shareId:string)=>Promise<boolean>;
}
export function ShareIntake(props:Props){
 const [open,setOpen]=useState(false),[drafts,setDrafts]=useState<ShareDraft[]>([]),[selected,setSelected]=useState<ShareDraft|null>(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const forgetSelection=()=>{setSelected(null);const url=new URL(location.href);url.searchParams.delete('draft');history.replaceState(null,'',url.pathname+url.search+url.hash)};
 async function refresh(){setError('');try{const list=await sharedDrafts();setDrafts(list);const id=new URL(location.href).searchParams.get('draft');setSelected(id?list.find(d=>d.id===id)??null:null)}catch{setError('공유 파일을 읽지 못했습니다. 파일 첨부 버튼으로 다시 선택해 주세요.')}}
 useEffect(()=>{if(location.pathname==='/share'){setOpen(true);void refresh()}},[]);
 const close=()=>{setOpen(false);setSelected(null);const url=new URL(location.href);url.searchParams.delete('draft');history.replaceState(null,'',(url.pathname==='/share'?'/':url.pathname)+url.search+(url.hash||'#agent'))};
 return <>
  <button className="share-intake-button" disabled={props.demo} onClick={()=>{setOpen(true);void refresh()}}><Share2 size={15}/> 받은 파일</button>
  <Dialog open={open} onOpenChange={value=>{if(!value&&!saving)close()}}><DialogContent className="share-intake-dialog">
   <DialogHeader><DialogTitle>공유받은 파일</DialogTitle><DialogDescription>대화나 일정을 골라 보관하세요. 대화 메시지는 보내기 전에 확인할 수 있습니다.</DialogDescription></DialogHeader>
   {error&&<p role="alert" className="agent-error">{error}</p>}
   {selected?<SharedItem key={selected.id} {...props} draft={selected} saving={saving} setSaving={setSaving} onBack={forgetSelection} onDiscard={async()=>{await removeShare(selected.id);forgetSelection();await refresh()}} onDone={async(committed)=>{if(committed)await removeShare(selected.id);close()}}/>:
    <div className="shared-drafts">{drafts.length?drafts.map(d=><button key={d.id} className="link-card" onClick={()=>setSelected(d)}><FileText size={18}/><span>{d.files[0]?.file.name??'공유한 파일'}<small>{d.files.length}개 · {new Date(d.createdAt).toLocaleString('ko-KR')}</small></span></button>):
     <div className="file-no-preview"><Share2 size={28}/><p>갤러리나 파일 앱에서 공유 → Orbit을 선택하세요.</p><p className="form-hint">갤럭시에서는 Chrome으로 설치한 앱을 사용해 주세요. iPhone에서는 대화·일정의 파일 첨부 버튼을 이용할 수 있습니다.</p><a className="text-button" href="/install#share-setup">공유 목록에 Orbit이 없나요?</a></div>}
    </div>}
   <p className="file-hint">공유 원본은 이 기기에 최대 24시간 임시 보관됩니다. 대화 보내기나 일정 저장을 마치면 목록에서 정리됩니다.</p>
  </DialogContent></Dialog>
 </>;
}
function SharedItem({draft,snapshot,onChat,onEvent,onDone,onBack,onDiscard,saving,setSaving}:Props&{draft:ShareDraft;saving:boolean;setSaving:(value:boolean)=>void;onDone:(committed:boolean)=>Promise<void>;onBack:()=>void;onDiscard:()=>Promise<void>}){
 const scope='share:'+draft.id,upload=useAttachments(scope),started=useRef(false),[conversations,setConversations]=useState<Conversation[]>([]),[destination,setDestination]=useState('chat:new'),[error,setError]=useState('');
 useEffect(()=>{if(!started.current){started.current=true;upload.add(draft.files.map(f=>f.file),draft.files.map(f=>f.id))}void agentRequest('/api/agent/conversations').then(r=>setConversations(r.items)).catch(()=>{})},[]);
 const alreadySaved=upload.ready.some(f=>f.targetId);
 async function handoff(){
  setSaving(true);setError('');const files=[...upload.ready],target=destination;
  try{const id=target.slice(target.indexOf(':')+1);let committed=false;
   if(target.startsWith('chat:'))await onChat(id==='new'?null:id,files,draft.id);
   else{if(!await onEvent(id==='new'?null:id,files,draft.id))return;committed=id!=='new'}
   upload.clear(files.map(f=>f.id));await onDone(committed);
  }catch(e){setError(e instanceof Error?e.message:'파일 보관을 확인하지 못했습니다.')}finally{setSaving(false)}
 }
 return <div className="share-review">
  <div className="attachment-buttons"><button className="text-button" disabled={saving} onClick={onBack}><ArrowLeft size={16}/> 목록</button><button className="text-button" disabled={saving} onClick={async()=>{setSaving(true);try{await onDiscard()}catch{setError('목록을 정리하지 못했습니다. 다시 시도해 주세요.')}finally{setSaving(false)}}}><Trash2 size={15}/> 받은 목록에서 정리</button></div>
  <AttachmentInput scope={scope} disabled={saving}/>
  {alreadySaved&&<p className="agent-feedback">이미 대화나 일정에 보관된 파일이 있습니다. 해당 기록에서 확인하고 받은 목록에서 정리해 주세요. 저장된 원본은 유지됩니다.</p>}
  <label className="form-label">보관할 위치</label>
  <Select value={destination} onValueChange={setDestination} disabled={saving}><SelectTrigger className="conversation-filter" aria-label="공유 파일 보관 위치"><SelectValue/></SelectTrigger><SelectContent>
   <SelectItem value="chat:new">새 대화</SelectItem>{conversations.map(c=><SelectItem key={c.id} value={'chat:'+c.id}>대화 · {c.title}</SelectItem>)}
   <SelectItem value="event:new">새 일정</SelectItem>{snapshot.data.events.slice(0,100).map(e=><SelectItem key={e.id} value={'event:'+e.id}>{e.date} · {e.title}</SelectItem>)}
  </SelectContent></Select>
  {error&&<p className="agent-error" role="alert">{error}</p>}
  <button className="primary-button" disabled={saving||upload.busy||!upload.ready.length||alreadySaved} onClick={()=>void handoff()}>{saving&&<LoaderCircle className="animate-spin" size={16}/>} {destination.startsWith('chat:')?'대화에서 이어가기':destination==='event:new'?'일정 작성하기':'일정에 보관'}</button>
 </div>;
}
