'use client';
import {replacePopupRoute} from '@/components/ui/use-popup-history';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {StoredAttachment} from '@/lib/orbit/attachments/types';
import type {AgentState,Conversation,ConversationList} from '@/lib/orbit/agent/types';
import {readDraft,saveDraft,clearDraft} from '@/lib/orbit/device-drafts';
import {agentRequest} from './connections';
import {deliverMessage,reconcileMessage,isConnectionError,matchesReceipt,scopedRequest,requestSession,uncertainDelivery,type MessageEnvelope} from '@/lib/orbit/agent/client-request';
import {watchAgent} from '@/lib/orbit/agent/stream-client';
const initial:AgentState={turns:[],actions:[],pendingActions:[],activeRun:null,activeRuns:[],conversation:null,connections:[],hasMore:false,nextBefore:null};
const emptyList:ConversationList={items:[],hasMore:false,nextBefore:null};
const message=(error:unknown)=>error instanceof Error?error.message:'대화를 불러오지 못했습니다.';
function listUrl(filter:string,before?:string|null){const q=new URLSearchParams();if(filter==='general')q.set('general','1');else if(filter.startsWith('project:'))q.set('projectId',filter.slice(8));if(before)q.set('before',before);return '/api/agent/conversations?'+q;}
function remember(id:string|null,ownerId:string){try{if(id)sessionStorage.setItem('orbit-conversation:'+ownerId,id);else sessionStorage.removeItem('orbit-conversation:'+ownerId)}catch{}const url=new URL(location.href);url.searchParams.delete('chatProject');if(id)url.searchParams.set('conversation',id);else url.searchParams.delete('conversation');replacePopupRoute(null,url.pathname+url.search+(url.hash||'#today'));}
export function useAgentConversations(demo:boolean,ownerId:string){
 const [state,setState]=useState<AgentState>(initial),[list,setList]=useState<ConversationList>(emptyList),[selected,setSelected]=useState<string|null>(null),[filter,setFilterState]=useState('all');
 const [loaded,setLoaded]=useState(demo),[listLoading,setListLoading]=useState(!demo),[older,setOlder]=useState(false),[creating,setCreating]=useState(false),[sendingIds,setSendingIds]=useState<Set<string>>(new Set()),[error,setError]=useState(''),[connectionError,setConnectionError]=useState(''),[draft,setDraftState]=useState('');
 const selectedRef=useRef<string|null>(null),filterRef=useRef('all'),generation=useRef(0),loadSerial=useRef(0),listSerial=useRef(0),alive=useRef(true),sendLock=useRef(new Set<string>()),createLock=useRef(false),pollLock=useRef(false),pageCount=useRef(1),cache=useRef(new Map<string,AgentState>()),drafts=useRef<Record<string,string>>({});
 type Envelope=MessageEnvelope;
 const recoveryLock=useRef(false),initialSelection=useRef(false),pollBackoff=useRef(0),pollAfter=useRef(0);
 const reportError=useCallback((error:unknown)=>{if(isConnectionError(error))setConnectionError(message(error));else setError(message(error))},[]);
 const [pendingMessage,setPendingMessage]=useState<Envelope|null>(null);
 const restore=(id:string|null)=>{const value=readDraft<unknown>(ownerId,'composer',id??'new');return typeof value==='string'?value:'';};
 const persistText=(id:string,value:string)=>{if(!demo)try{saveDraft(ownerId,'composer',id,value)}catch{setError('기기 임시 저장에 실패했습니다. 내용을 복사해 보관해 주세요.');}};
 const sending=sendingIds.has(selected??'new');
 const setDraft=useCallback((value:string)=>{drafts.current[selectedRef.current??'new']=value;setDraftState(value);persistText(selectedRef.current??'new',value)},[ownerId,demo]);
 const acknowledge=useCallback((envelope:Envelope)=>{
  const stored=readDraft<Envelope>(ownerId,'pending-message',envelope.conversationId);
  if(stored?.id===envelope.id){clearDraft(ownerId,'pending-message',envelope.conversationId);clearDraft(ownerId,'pending-paused',envelope.conversationId);if(selectedRef.current===envelope.conversationId)setPendingMessage(null)}
  if((drafts.current[envelope.conversationId]??'').trim()===envelope.message){drafts.current[envelope.conversationId]='';clearDraft(ownerId,'composer',envelope.conversationId);if(selectedRef.current===envelope.conversationId)setDraftState('')}
  window.dispatchEvent(new CustomEvent('orbit:message-received',{detail:{ownerId,conversationId:envelope.conversationId,attachmentIds:envelope.attachmentIds}}));
 },[ownerId]);
 const load=useCallback(async()=>{if(demo)return;const id=selectedRef.current,serial=++loadSerial.current,epoch=generation.current;try{let next:AgentState=await agentRequest('/api/agent?conversationId='+encodeURIComponent(id??'new'));for(let page=1;page<pageCount.current&&next.nextBefore;page++){if(!alive.current||serial!==loadSerial.current||epoch!==generation.current)return;const prior:AgentState=await agentRequest('/api/agent?conversationId='+encodeURIComponent(id??'new')+'&before='+encodeURIComponent(next.nextBefore));next={...next,turns:[...prior.turns,...next.turns],actions:[...prior.actions,...next.actions],hasMore:prior.hasMore,nextBefore:prior.nextBefore};}if(alive.current&&serial===loadSerial.current&&epoch===generation.current){cache.current.set(id??'new',next);if(cache.current.size>10)cache.current.delete(cache.current.keys().next().value!);setState(next);setLoaded(true);setConnectionError('');const pending=readDraft<Envelope>(ownerId,'pending-message',id??'new');const turn=pending?next.turns.find(t=>t.id===pending.id):undefined;if(pending&&turn&&matchesReceipt(pending,{id:turn.id,conversationId:turn.conversationId??'legacy',input:turn.input,attachmentIds:(turn.attachments??[]).map(a=>a.id),status:turn.status}))acknowledge(pending);}}catch(e){if(alive.current&&serial===loadSerial.current&&epoch===generation.current){reportError(e)}throw e}},[demo,ownerId,acknowledge,reportError]);
 const loadList=useCallback(async(more=false)=>{if(demo)return emptyList;const value=filterRef.current,serial=++listSerial.current;setListLoading(true);try{const next:ConversationList=await agentRequest(listUrl(value,more?list.nextBefore:null));if(alive.current&&serial===listSerial.current&&value===filterRef.current)setList(old=>more?{...next,items:[...old.items,...next.items.filter(c=>!old.items.some(o=>o.id===c.id))]}:next);return next}catch(e){if(alive.current&&serial===listSerial.current)reportError(e);throw e}finally{if(alive.current&&serial===listSerial.current)setListLoading(false)}},[demo,list.nextBefore]);
 const select=useCallback((id:string|null)=>{initialSelection.current=true;generation.current++;loadSerial.current++;pageCount.current=1;selectedRef.current=id;setSelected(id);const cached=cache.current.get(id??'new');setLoaded(demo||!!cached);setOlder(false);setError('');setState(s=>cached?{...cached,connections:s.connections,pendingActions:s.pendingActions,activeRuns:s.activeRuns,activeRun:s.activeRuns?.find(r=>r.conversationId===id)??null}:{...s,activeRun:s.activeRuns?.find(r=>r.conversationId===id)??null,conversation:null,turns:[],actions:[],hasMore:false,nextBefore:null});drafts.current[id??'new']??=restore(id);setDraftState(drafts.current[id??'new']);setPendingMessage(readDraft<Envelope>(ownerId,'pending-message',id??'new'));remember(id,ownerId);void load().catch(()=>{});},[demo,load,ownerId]);
 useEffect(()=>{alive.current=true;let cancelled=false;const url=new URL(location.href),project=url.searchParams.get('chatProject');let preferred=url.searchParams.get('conversation');try{if(!preferred&&!project)preferred=sessionStorage.getItem('orbit-conversation:'+ownerId)}catch{}const value=project?'project:'+project:'all';filterRef.current=value;setFilterState(value);if(!demo){const epoch=generation.current;void agentRequest(listUrl(value)).then((next:ConversationList)=>{if(cancelled||epoch!==generation.current)return;setList(next);setListLoading(false);select(preferred??next.items[0]?.id??null)}).catch(e=>{if(!cancelled){reportError(e);setListLoading(false)}})}return()=>{cancelled=true;alive.current=false;loadSerial.current++;listSerial.current++;};},[demo,select]);
 const changeFilter=async(value:string)=>{filterRef.current=value;setFilterState(value);generation.current++;const epoch=generation.current;select(null);const selectionEpoch=generation.current;try{const next=await loadList();if(alive.current&&filterRef.current===value&&generation.current===selectionEpoch&&generation.current>epoch)select(next.items[0]?.id??null)}catch{}};
 useEffect(()=>{const open=(event:Event)=>{const detail=(event as CustomEvent<{id?:string;projectId?:string;text?:string}>).detail;if(detail.projectId)void changeFilter('project:'+detail.projectId);else if(detail.id){select(detail.id);if(detail.text)setDraft([drafts.current[detail.id],detail.text].filter(Boolean).join('\n\n').slice(0,8000));void loadList().catch(()=>{});}};window.addEventListener('orbit:open-chat',open);return()=>window.removeEventListener('orbit:open-chat',open)},[select,setDraft,loadList]);
 const refresh=async()=>{await Promise.all([load(),loadList()]);};
 const create=async()=>{if(demo||createLock.current)return null;createLock.current=true;setCreating(true);generation.current++;loadSerial.current++;const epoch=generation.current,value=filterRef.current;try{const old=readDraft<{id:string;title:string;projectId:string|null}>(ownerId,'conversation-create');const envelope=old&&typeof old.id==='string'&&typeof old.title==='string'?old:{id:crypto.randomUUID(),title:'새 대화',projectId:value.startsWith('project:')?value.slice(8):null};saveDraft(ownerId,'conversation-create','',envelope);const conversation:Conversation=await agentRequest('/api/agent/conversations','POST',envelope);clearDraft(ownerId,'conversation-create');if(alive.current){if(epoch===generation.current){if(selectedRef.current===null){drafts.current[conversation.id]=drafts.current.new??'';drafts.current.new='';persistText(conversation.id,drafts.current[conversation.id]);clearDraft(ownerId,'composer','new');}select(conversation.id)}await loadList().catch(()=>{})}return conversation}catch(e){if(alive.current&&epoch===generation.current)reportError(e);return null}finally{createLock.current=false;if(alive.current)setCreating(false)}};
 const send=async(text:string,id?:string,attachments:StoredAttachment[]=[],targetId?:string)=>{
  const sendKey=targetId??selectedRef.current??'new';
  if(demo||sendLock.current.has(sendKey)||createLock.current||!text.trim())return false;
  sendLock.current.add(sendKey);setSendingIds(s=>new Set([...s,sendKey]));setError('');let conversationId=targetId??selectedRef.current;let delivery:Envelope|undefined;
  try{
   if(!conversationId){const c=await create();if(!c||!alive.current)return false;conversationId=c.id;}
   const target=conversationId,stored=readDraft<Envelope>(ownerId,'pending-message',target);
   const envelope:Envelope=stored??{id:id??crypto.randomUUID(),conversationId:target,message:text.trim(),attachmentIds:attachments.map(f=>f.id)};
   if(stored&&(stored.message!==text.trim()||(id&&id!==stored.id)||JSON.stringify(stored.attachmentIds)!==JSON.stringify(attachments.map(f=>f.id)))){setError('이전 전송 결과를 먼저 확인해 주세요. 새 입력은 임시 보관했습니다.');return false;}
   delivery=envelope;clearDraft(ownerId,'pending-paused',target);saveDraft(ownerId,'pending-message',target,envelope);if(selectedRef.current===target)setPendingMessage(envelope);
   const check=requestSession();const receipt=await deliverMessage(envelope,agentRequest,!!id&&!stored);check();
   if(alive.current&&receipt.status==='running'){
    // Show the durable receipt immediately; the server advances the independent job.
    setState(s=>({...s,activeRuns:[...(s.activeRuns??[]).filter(r=>r.id!==envelope.id),{id:envelope.id,conversationId:target}],...(selectedRef.current===target?{activeRun:{id:envelope.id,conversationId:target},turns:s.turns.some(t=>t.id===envelope.id)?s.turns.map(t=>t.id===envelope.id?{...t,status:'running' as const,error:undefined,progress:'메시지를 접수했습니다. 업무와 일정을 확인합니다.'}:t):[...s.turns,{id:envelope.id,conversationId:target,input:envelope.message,attachments,status:'running' as const,text:'',sources:[],createdAt:new Date().toISOString(),progress:'메시지를 접수했습니다. 업무와 일정을 확인합니다.'}]}:{})}));
   }
   acknowledge(envelope);setConnectionError('');
   if(alive.current)void refresh().catch(()=>{});return true;
  }catch(e){if(alive.current){if(!isConnectionError(e)&&delivery){if(!uncertainDelivery(e)&&e instanceof Error&&'code' in e&&['INPUT','CONFLICT','BUSY'].includes(String(e.code))){clearDraft(ownerId,'pending-message',delivery.conversationId);if(selectedRef.current===delivery.conversationId)setPendingMessage(null)}else saveDraft(ownerId,'pending-paused',delivery.conversationId,delivery.id)}reportError(e);void refresh().catch(()=>{});}return false;}
  finally{sendLock.current.delete(sendKey);if(alive.current)setSendingIds(s=>{const next=new Set(s);next.delete(sendKey);return next})}
 };
 const retryPending=async()=>{const p=readDraft<Envelope>(ownerId,'pending-message',selectedRef.current??'new');if(!p)return;await send(p.message,p.id,p.attachmentIds.map(id=>({id}) as StoredAttachment),p.conversationId);};
 const loadOlder=async()=>{if(older||!state.nextBefore||!selectedRef.current)return;const id=selectedRef.current,epoch=generation.current;setOlder(true);try{const prior:AgentState=await agentRequest('/api/agent?conversationId='+encodeURIComponent(id)+'&before='+encodeURIComponent(state.nextBefore));if(alive.current&&epoch===generation.current){pageCount.current++;loadSerial.current++;setState(s=>({...s,turns:[...prior.turns.filter(t=>!s.turns.some(o=>o.id===t.id)),...s.turns],actions:[...prior.actions.filter(a=>!s.actions.some(o=>o.id===a.id)),...s.actions],hasMore:prior.hasMore,nextBefore:prior.nextBefore}));}}catch(e){if(alive.current&&epoch===generation.current)reportError(e)}finally{if(alive.current&&epoch===generation.current)setOlder(false)}};
 const save=async(input:{title:string;projectId:string|null})=>{const c=state.conversation;if(!c)return;const epoch=generation.current;try{await agentRequest('/api/agent/conversations','PATCH',{id:c.id,...input,expectedRevision:c.revision});if(alive.current){if(epoch===generation.current){filterRef.current='all';setFilterState('all');await load()}await loadList()}}catch(e){if(alive.current&&epoch===generation.current)reportError(e);throw e}};
 const runsRef=useRef(state.activeRuns??[]);runsRef.current=state.activeRuns??[];
 const runningIds=(state.activeRuns??[]).map(r=>r.id).sort().join('|');
 useEffect(()=>{if(!runningIds||demo)return;let cancelled=false;const controller=new AbortController();
  const tick=async()=>{if(pollLock.current||document.visibilityState!=='visible'||!navigator.onLine||Date.now()<pollAfter.current)return;pollLock.current=true;
   try{
    // Reconcile every running conversation, regardless of the currently open thread.
    const pending=[...runsRef.current];let index=0;
    const worker=async()=>{while(index<pending.length&&!cancelled){const run=pending[index++],watch=new AbortController(),abort=()=>watch.abort();controller.signal.addEventListener('abort',abort,{once:true});const timeout=setTimeout(abort,75000);try{
     await watchAgent(run.id,watch.signal,progress=>{
      if(cancelled)return;
      setState(s=>({...s,turns:s.turns.map(t=>t.id===run.id&&t.status==='running'?{...t,progress:progress.progress}:t)}));
      if(progress.status!=='running'){void load().catch(()=>{});void loadList().catch(()=>{});}
     });
    }catch(e){if(!cancelled){try{await agentRequest('/api/agent/run','POST',{id:run.id,action:'poll'})}catch(fallback){if(isConnectionError(fallback)){pollBackoff.current=Math.min(5,pollBackoff.current+1);pollAfter.current=Date.now()+Math.min(60000,4000*2**pollBackoff.current)}if(selectedRef.current===run.conversationId)reportError(fallback)}}}finally{clearTimeout(timeout);controller.signal.removeEventListener('abort',abort)}
    if(!cancelled)await load().catch(()=>{});
   }};
    await Promise.all([worker(),worker(),worker(),worker()]);
    if(!cancelled){await Promise.all([load(),loadList()]);if(Date.now()>=pollAfter.current){pollBackoff.current=0;pollAfter.current=0}}
   }catch(e){if(!cancelled)reportError(e)}finally{pollLock.current=false}
  };const timer=setInterval(()=>void tick(),1200);void tick();return()=>{cancelled=true;controller.abort();clearInterval(timer)};
 },[runningIds,demo,load,loadList]);
 useEffect(()=>{
  let cancelled=false;
  const resume=async()=>{
   if(demo||!navigator.onLine||document.visibilityState!=='visible'||recoveryLock.current)return;
   recoveryLock.current=true;pollAfter.current=0;let locked:string|undefined,pending:Envelope|null=null;
   let epoch=generation.current;
   const valid=()=>{if(cancelled||!alive.current||epoch!==generation.current)throw new Error('RECOVERY_CANCELLED')};
   const request=scopedRequest(agentRequest,valid);
   try{
    if(!initialSelection.current){const next=await loadList();valid();if(!initialSelection.current){let preferred=new URL(location.href).searchParams.get('conversation');try{preferred??=sessionStorage.getItem('orbit-conversation:'+ownerId)}catch{}select(preferred??next.items[0]?.id??null);epoch=generation.current}}
    valid();pending=readDraft<Envelope>(ownerId,'pending-message',selectedRef.current??'new');
    if(pending&&!sendLock.current.has(pending.conversationId)){
     locked=pending.conversationId;sendLock.current.add(locked);setSendingIds(s=>new Set([...s,locked!]));
     const receipt=await reconcileMessage(pending,request);valid();
     if(receipt){valid();acknowledge(pending)}else if(readDraft<string>(ownerId,'pending-paused',pending.conversationId)!==pending.id){await deliverMessage(pending,request);valid();acknowledge(pending)}
    }
    valid();await load();valid();await loadList();valid();setConnectionError('');
   }catch(error){if(!cancelled&&alive.current&&epoch===generation.current){if(pending&&!isConnectionError(error))saveDraft(ownerId,'pending-paused',pending.conversationId,pending.id);reportError(error)}}finally{if(locked){sendLock.current.delete(locked);if(alive.current)setSendingIds(s=>{const next=new Set(s);next.delete(locked!);return next})}recoveryLock.current=false}
  };
  const trigger=()=>{void resume()};window.addEventListener('online',trigger);document.addEventListener('visibilitychange',trigger);
  const timer=setInterval(()=>{const p=readDraft<Envelope>(ownerId,'pending-message',selectedRef.current??'new');if(p&&readDraft<string>(ownerId,'pending-paused',p.conversationId)!==p.id)trigger()},15000);
  return()=>{cancelled=true;window.removeEventListener('online',trigger);document.removeEventListener('visibilitychange',trigger);clearInterval(timer)};
 },[demo,ownerId,load,loadList,select,acknowledge,reportError]);

 return {pendingMessage,retryPending,state,list,selected,filter,loaded,listLoading,older,creating,sending,error:error||connectionError,draft,setDraft,setError,select,changeFilter,load,loadList,refresh,create,send,loadOlder,save};
}
