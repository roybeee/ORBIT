'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {StoredAttachment} from '@/lib/orbit/attachments/types';
import type {AgentState,Conversation,ConversationList} from '@/lib/orbit/agent/types';
import {readDraft,saveDraft,clearDraft} from '@/lib/orbit/device-drafts';
import {agentRequest} from './connections';
const initial:AgentState={turns:[],actions:[],pendingActions:[],activeRun:null,activeRuns:[],conversation:null,connections:[],hasMore:false,nextBefore:null};
const emptyList:ConversationList={items:[],hasMore:false,nextBefore:null};
const message=(error:unknown)=>error instanceof Error?error.message:'대화를 불러오지 못했습니다.';
function listUrl(filter:string,before?:string|null){const q=new URLSearchParams();if(filter==='general')q.set('general','1');else if(filter.startsWith('project:'))q.set('projectId',filter.slice(8));if(before)q.set('before',before);return '/api/agent/conversations?'+q;}
function remember(id:string|null,ownerId:string){try{if(id)sessionStorage.setItem('orbit-conversation:'+ownerId,id);else sessionStorage.removeItem('orbit-conversation:'+ownerId)}catch{}const url=new URL(location.href);url.searchParams.delete('chatProject');if(id)url.searchParams.set('conversation',id);else url.searchParams.delete('conversation');history.replaceState(null,'',url.pathname+url.search+(url.hash||'#agent'));}
export function useAgentConversations(demo:boolean,ownerId:string){
 const [state,setState]=useState<AgentState>(initial),[list,setList]=useState<ConversationList>(emptyList),[selected,setSelected]=useState<string|null>(null),[filter,setFilterState]=useState('all');
 const [loaded,setLoaded]=useState(demo),[listLoading,setListLoading]=useState(!demo),[older,setOlder]=useState(false),[creating,setCreating]=useState(false),[sendingIds,setSendingIds]=useState<Set<string>>(new Set()),[error,setError]=useState(''),[draft,setDraftState]=useState('');
 const selectedRef=useRef<string|null>(null),filterRef=useRef('all'),generation=useRef(0),loadSerial=useRef(0),listSerial=useRef(0),alive=useRef(true),sendLock=useRef(new Set<string>()),createLock=useRef(false),pollLock=useRef(false),pageCount=useRef(1),cache=useRef(new Map<string,AgentState>()),drafts=useRef<Record<string,string>>({});
 type Envelope={id:string;conversationId:string;message:string;attachmentIds:string[]};
 const [pendingMessage,setPendingMessage]=useState<Envelope|null>(null);
 const restore=(id:string|null)=>{const value=readDraft<unknown>(ownerId,'composer',id??'new');return typeof value==='string'?value:'';};
 const persistText=(id:string,value:string)=>{if(!demo)try{saveDraft(ownerId,'composer',id,value)}catch{setError('기기 임시 저장에 실패했습니다. 내용을 복사해 보관해 주세요.');}};
 const sending=sendingIds.has(selected??'new');
 const setDraft=useCallback((value:string)=>{drafts.current[selectedRef.current??'new']=value;setDraftState(value);persistText(selectedRef.current??'new',value)},[ownerId,demo]);
 const load=useCallback(async()=>{if(demo)return;const id=selectedRef.current,serial=++loadSerial.current,epoch=generation.current;try{let next:AgentState=await agentRequest('/api/agent?conversationId='+encodeURIComponent(id??'new'));for(let page=1;page<pageCount.current&&next.nextBefore;page++){if(!alive.current||serial!==loadSerial.current||epoch!==generation.current)return;const prior:AgentState=await agentRequest('/api/agent?conversationId='+encodeURIComponent(id??'new')+'&before='+encodeURIComponent(next.nextBefore));next={...next,turns:[...prior.turns,...next.turns],actions:[...prior.actions,...next.actions],hasMore:prior.hasMore,nextBefore:prior.nextBefore};}if(alive.current&&serial===loadSerial.current&&epoch===generation.current){cache.current.set(id??'new',next);if(cache.current.size>10)cache.current.delete(cache.current.keys().next().value!);setState(next);setLoaded(true);}}catch(e){if(alive.current&&serial===loadSerial.current&&epoch===generation.current){setError(message(e));setLoaded(false)}throw e}},[demo]);
 const loadList=useCallback(async(more=false)=>{if(demo)return emptyList;const value=filterRef.current,serial=++listSerial.current;setListLoading(true);try{const next:ConversationList=await agentRequest(listUrl(value,more?list.nextBefore:null));if(alive.current&&serial===listSerial.current&&value===filterRef.current)setList(old=>more?{...next,items:[...old.items,...next.items.filter(c=>!old.items.some(o=>o.id===c.id))]}:next);return next}catch(e){if(alive.current&&serial===listSerial.current)setError(message(e));throw e}finally{if(alive.current&&serial===listSerial.current)setListLoading(false)}},[demo,list.nextBefore]);
 const select=useCallback((id:string|null)=>{generation.current++;loadSerial.current++;pageCount.current=1;selectedRef.current=id;setSelected(id);const cached=cache.current.get(id??'new');setLoaded(demo||!!cached);setOlder(false);setError('');setState(s=>cached?{...cached,connections:s.connections,pendingActions:s.pendingActions,activeRuns:s.activeRuns,activeRun:s.activeRuns?.find(r=>r.conversationId===id)??null}:{...s,activeRun:s.activeRuns?.find(r=>r.conversationId===id)??null,conversation:null,turns:[],actions:[],hasMore:false,nextBefore:null});drafts.current[id??'new']??=restore(id);setDraftState(drafts.current[id??'new']);setPendingMessage(readDraft<Envelope>(ownerId,'pending-message',id??'new'));remember(id,ownerId);void load().catch(()=>{});},[demo,load,ownerId]);
 useEffect(()=>{alive.current=true;let cancelled=false;const url=new URL(location.href),project=url.searchParams.get('chatProject');let preferred=url.searchParams.get('conversation');try{if(!preferred&&!project)preferred=sessionStorage.getItem('orbit-conversation:'+ownerId)}catch{}const value=project?'project:'+project:'all';filterRef.current=value;setFilterState(value);if(!demo){const epoch=generation.current;void agentRequest(listUrl(value)).then((next:ConversationList)=>{if(cancelled||epoch!==generation.current)return;setList(next);setListLoading(false);select(preferred??next.items[0]?.id??null)}).catch(e=>{if(!cancelled){setError(message(e));setListLoading(false)}})}return()=>{cancelled=true;alive.current=false;loadSerial.current++;listSerial.current++;};},[demo,select]);
 const changeFilter=async(value:string)=>{filterRef.current=value;setFilterState(value);generation.current++;const epoch=generation.current;select(null);const selectionEpoch=generation.current;try{const next=await loadList();if(alive.current&&filterRef.current===value&&generation.current===selectionEpoch&&generation.current>epoch)select(next.items[0]?.id??null)}catch{}};
 useEffect(()=>{const open=(event:Event)=>{const detail=(event as CustomEvent<{id?:string;projectId?:string;text?:string}>).detail;if(detail.projectId)void changeFilter('project:'+detail.projectId);else if(detail.id){select(detail.id);if(detail.text)setDraft([drafts.current[detail.id],detail.text].filter(Boolean).join('\n\n').slice(0,8000));void loadList().catch(()=>{});}};window.addEventListener('orbit:open-chat',open);return()=>window.removeEventListener('orbit:open-chat',open)},[select,setDraft,loadList]);
 const refresh=async()=>{await Promise.all([load(),loadList()]);};
 const create=async()=>{if(demo||createLock.current)return null;createLock.current=true;setCreating(true);generation.current++;loadSerial.current++;const epoch=generation.current,value=filterRef.current;try{const old=readDraft<{id:string;title:string;projectId:string|null}>(ownerId,'conversation-create');const envelope=old&&typeof old.id==='string'&&typeof old.title==='string'?old:{id:crypto.randomUUID(),title:'새 대화',projectId:value.startsWith('project:')?value.slice(8):null};saveDraft(ownerId,'conversation-create','',envelope);const conversation:Conversation=await agentRequest('/api/agent/conversations','POST',envelope);clearDraft(ownerId,'conversation-create');if(alive.current){if(epoch===generation.current){if(selectedRef.current===null){drafts.current[conversation.id]=drafts.current.new??'';drafts.current.new='';persistText(conversation.id,drafts.current[conversation.id]);clearDraft(ownerId,'composer','new');}select(conversation.id)}await loadList().catch(()=>{})}return conversation}catch(e){if(alive.current&&epoch===generation.current)setError(message(e));return null}finally{createLock.current=false;if(alive.current)setCreating(false)}};
 const send=async(text:string,id?:string,attachments:StoredAttachment[]=[],targetId?:string)=>{
  const sendKey=targetId??selectedRef.current??'new';
  if(demo||sendLock.current.has(sendKey)||createLock.current||!text.trim())return false;
  sendLock.current.add(sendKey);setSendingIds(s=>new Set([...s,sendKey]));setError('');let conversationId=targetId??selectedRef.current;
  try{
   if(!conversationId){const c=await create();if(!c||!alive.current)return false;conversationId=c.id;}
   const target=conversationId,stored=readDraft<Envelope>(ownerId,'pending-message',target);
   const envelope:Envelope=stored??{id:id??crypto.randomUUID(),conversationId:target,message:text.trim(),attachmentIds:attachments.map(f=>f.id)};
   if(stored&&(stored.message!==text.trim()||(id&&id!==stored.id)||JSON.stringify(stored.attachmentIds)!==JSON.stringify(attachments.map(f=>f.id)))){setError('이전 전송 결과를 먼저 확인해 주세요. 새 입력은 임시 보관했습니다.');return false;}
   saveDraft(ownerId,'pending-message',target,envelope);if(selectedRef.current===target)setPendingMessage(envelope);
   const receipt=await agentRequest('/api/agent','POST',envelope);
   if(alive.current&&receipt.status==='running'){
    // Show the durable receipt immediately; external work continues through the poller.
    setState(s=>({...s,activeRuns:[...(s.activeRuns??[]).filter(r=>r.id!==envelope.id),{id:envelope.id,conversationId:target}],...(selectedRef.current===target?{activeRun:{id:envelope.id,conversationId:target},turns:s.turns.some(t=>t.id===envelope.id)?s.turns.map(t=>t.id===envelope.id?{...t,status:'running' as const,error:undefined,progress:'메시지를 접수했습니다. 업무와 일정을 확인합니다.'}:t):[...s.turns,{id:envelope.id,conversationId:target,input:envelope.message,attachments,status:'running' as const,text:'',sources:[],createdAt:new Date().toISOString(),progress:'메시지를 접수했습니다. 업무와 일정을 확인합니다.'}]}:{})}));
   }
   clearDraft(ownerId,'pending-message',target);if(selectedRef.current===target)setPendingMessage(null);
   if((drafts.current[target]??'').trim()===envelope.message){drafts.current[target]='';clearDraft(ownerId,'composer',target);if(selectedRef.current===target)setDraftState('');}
   if(alive.current)void refresh().catch(()=>{});return true;
  }catch(e){if(alive.current){setError(message(e));void refresh().catch(()=>{});}return false;}
  finally{sendLock.current.delete(sendKey);if(alive.current)setSendingIds(s=>{const next=new Set(s);next.delete(sendKey);return next})}
 };
 const retryPending=async()=>{const p=readDraft<Envelope>(ownerId,'pending-message',selectedRef.current??'new');if(!p)return;await send(p.message,p.id,p.attachmentIds.map(id=>({id}) as StoredAttachment),p.conversationId);};
 const loadOlder=async()=>{if(older||!state.nextBefore||!selectedRef.current)return;const id=selectedRef.current,epoch=generation.current;setOlder(true);try{const prior:AgentState=await agentRequest('/api/agent?conversationId='+encodeURIComponent(id)+'&before='+encodeURIComponent(state.nextBefore));if(alive.current&&epoch===generation.current){pageCount.current++;loadSerial.current++;setState(s=>({...s,turns:[...prior.turns.filter(t=>!s.turns.some(o=>o.id===t.id)),...s.turns],actions:[...prior.actions.filter(a=>!s.actions.some(o=>o.id===a.id)),...s.actions],hasMore:prior.hasMore,nextBefore:prior.nextBefore}));}}catch(e){if(alive.current&&epoch===generation.current)setError(message(e))}finally{if(alive.current&&epoch===generation.current)setOlder(false)}};
 const save=async(input:{title:string;projectId:string|null})=>{const c=state.conversation;if(!c)return;const epoch=generation.current;try{await agentRequest('/api/agent/conversations','PATCH',{id:c.id,...input,expectedRevision:c.revision});if(alive.current){if(epoch===generation.current){filterRef.current='all';setFilterState('all');await load()}await loadList()}}catch(e){if(alive.current&&epoch===generation.current)setError(message(e));throw e}};
 const runsRef=useRef(state.activeRuns??[]);runsRef.current=state.activeRuns??[];
 const runningIds=(state.activeRuns??[]).map(r=>r.id).sort().join('|');
 useEffect(()=>{if(!runningIds||demo)return;let cancelled=false;
  const tick=async()=>{if(pollLock.current||document.visibilityState!=='visible')return;pollLock.current=true;
   try{
    // Reconcile every running conversation, regardless of the currently open thread.
    const pending=[...runsRef.current];let index=0;
    const worker=async()=>{while(index<pending.length&&!cancelled){const run=pending[index++];try{await agentRequest('/api/agent/run','POST',{id:run.id,action:'poll'})}catch(e){if(!cancelled&&selectedRef.current===run.conversationId)setError(message(e))}}};
    await Promise.all([worker(),worker(),worker(),worker()]);
    if(!cancelled){await load();await loadList()}
   }catch(e){if(!cancelled)setError(message(e))}finally{pollLock.current=false}
  };const timer=setInterval(()=>void tick(),4000);void tick();return()=>{cancelled=true;clearInterval(timer)};
 },[runningIds,demo,load,loadList]);
 useEffect(()=>{const resume=()=>{if(document.visibilityState==='visible'){void load().catch(()=>{});void loadList().catch(()=>{})}};document.addEventListener('visibilitychange',resume);return()=>document.removeEventListener('visibilitychange',resume)},[load,loadList]);
 return {pendingMessage,retryPending,state,list,selected,filter,loaded,listLoading,older,creating,sending,error,draft,setDraft,setError,select,changeFilter,load,loadList,refresh,create,send,loadOlder,save};
}
