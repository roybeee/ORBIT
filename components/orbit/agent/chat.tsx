'use client';
import {replacePopupRoute} from '@/components/ui/use-popup-history';
import {AnswerFeedback} from './answer-feedback';
import {OrbitMark} from '../brand';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {VoiceInput} from '../phase4/voice';
import {ActivityLibrary} from './activity-library';
import type {WorkOrder} from '@/lib/orbit/agent/orders-schema';
import {OrderRoom,useWorkOrders} from './order-room';
import {Orbit,ArrowUp,ArrowUpRight,Check,Link2,LoaderCircle,Mic,Moon,RefreshCw,Sparkles,Target,Ellipsis,Square} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
import {Connections,agentRequest} from './connections';
import {koreanDate} from '@/lib/orbit/dates';
import type {View,WorkspaceSnapshot} from '@/lib/orbit/model';
import type {AgentAction} from '@/lib/orbit/agent/types';
import {useAttachments} from '../attachments/provider';
import {AttachmentInput,FileCards,FileDrop} from '../attachments/files';
import type {StoredAttachment} from '@/lib/orbit/attachments/types';
import {RuntimePanel} from './runtime-panel';
import {useAgentConversations} from './use-agent-conversations';
import {EvidenceSheet,type RecordTarget} from './evidence-sheet';
import type {AgentSource} from '@/lib/orbit/agent/evidence';
import {ChiefPanel,useChiefSync} from '../coach/chief-panel';
import type {WorkspaceAction} from '@/lib/orbit/validation';
import {ConversationLibrary,ConversationHeading} from './conversation-library';
import {ActionCard,useActionDecisions} from './action-review';
function progressLabel(progress?:string){
 if(!progress||progress==='헤르메스가 기록을 검토하고 있습니다. 화면을 다시 열면 이어서 확인합니다.'||progress==='헤르메스가 기록을 확인하고 다음 단계를 정리하고 있습니다.')return '기록을 확인하고 있어요.';
 return progress;
}
const suggestions=[{icon:Target,title:'오늘의 우선순위',text:'오늘 일정과 프로젝트를 보고, 결과물에 가까워질 우선순위를 제안해 줘.'},{icon:Mic,title:'회의에서 다음 행동으로',text:'최근 Plaud 회의 기록을 찾아 핵심 결정, 개인 위키에 남길 내용과 후속 할 일을 제안해 줘. 프로젝트 연결이 불명확하면 먼저 물어봐 줘.'},{icon:Sparkles,title:'멈춘 프로젝트 점검',text:'진행 중인 프로젝트의 완료 조건과 막힌 일을 확인하고, 다음에 할 일을 제안해 줘.'},{icon:Moon,title:'회고하고 내일 설계',text:'오늘의 성과와 막힌 점을 함께 돌아보고, 내일 하루를 설계해 줘. 먼저 내가 답할 질문부터 해 줘.'}];
export function AgentWorkspace({visible=true,ownerId, demo,displayName,snapshot,onWorkspaceChange,navigate,perform,busy,onGoals,onOpenRecord,onPendingCount,onPendingActions,onOrdersChange}:{onPendingActions?:(actions:AgentAction[])=>void;onOrdersChange?:(orders:WorkOrder[])=>void;onPendingCount?:(count:number)=>void;visible?:boolean;ownerId:string;onOpenRecord:(target:RecordTarget)=>void;perform:(action:WorkspaceAction,message?:string)=>Promise<boolean>;busy:boolean;onGoals:()=>void;demo:boolean;displayName:string;snapshot:WorkspaceSnapshot;onWorkspaceChange:()=>void;navigate:(view:View)=>void}){
 const orders=useWorkOrders(demo),[orderRoom,setOrderRoom]=useState(false),[orderDraft,setOrderDraft]=useState(''),[orderSelection,setOrderSelection]=useState<string|null>(null);
 useEffect(()=>{const id=new URLSearchParams(location.search).get('order');if(id){setOrderSelection(id);setOrderRoom(true)}},[]);
 const chat=useAgentConversations(demo,ownerId),{state,loaded,draft,setDraft,sending,error,setError,older,load}=chat;
 const attachmentScope='chat:'+(chat.selected??'new'),uploads=useAttachments(attachmentScope);
 useEffect(()=>{const received=(event:Event)=>{const detail=(event as CustomEvent<{ownerId:string;conversationId:string;attachmentIds:string[]}>).detail;if(detail.ownerId!==ownerId)return;const scope='chat:'+detail.conversationId;uploads.clearAt(scope,detail.attachmentIds);void uploads.completeShare(scope,detail.attachmentIds).catch(()=>{})};window.addEventListener('orbit:message-received',received);return()=>window.removeEventListener('orbit:message-received',received)},[ownerId,uploads]);
 const [activityOpen,setActivityOpen]=useState(false);
 const [feedback,setFeedback]=useState(''),[settings,setSettings]=useState(false),[runtimeOpen,setRuntimeOpen]=useState(false),[coachOpen,setCoachOpen]=useState(false),[voiceRequest,setVoiceRequest]=useState(0),[acting,setActing]=useState<string|null>(null),[queue,setQueue]=useState(false);
 const [evidence,setEvidence]=useState<AgentSource|null>(null);
 const chiefSyncError=useChiefSync(snapshot.data,demo);
 useEffect(()=>{onOrdersChange?.(orders.orders)},[orders.orders,onOrdersChange]);
 useEffect(()=>{const open=(e:Event)=>{setOrderSelection((e as CustomEvent<{id?:string}>).detail?.id??null);setOrderDraft('');setOrderRoom(true);};window.addEventListener('orbit:orders',open);return()=>window.removeEventListener('orbit:orders',open)},[]);
 useEffect(()=>{if(loaded)onPendingCount?.(state.pendingActions?.length??0)},[loaded,state.pendingActions?.length,onPendingCount]);
 useEffect(()=>{if(loaded&&state.pendingActions)onPendingActions?.(state.pendingActions)},[loaded,state.pendingActions,onPendingActions]);
 useEffect(()=>{const compose=(e:Event)=>{setDraft((e as CustomEvent<{text:string}>).detail.text.slice(0,8000));setQueue(false);setTimeout(()=>input.current?.focus(),0)},connect=()=>setSettings(true),runtime=()=>setRuntimeOpen(true),review=()=>setQueue(true),coach=()=>setCoachOpen(true);window.addEventListener('orbit:review',review);window.addEventListener('orbit:coach-settings',coach);window.addEventListener('orbit:compose',compose);window.addEventListener('orbit:connections',connect);window.addEventListener('orbit:runtime',runtime);return()=>{window.removeEventListener('orbit:review',review);window.removeEventListener('orbit:coach-settings',coach);window.removeEventListener('orbit:compose',compose);window.removeEventListener('orbit:connections',connect);window.removeEventListener('orbit:runtime',runtime)}},[setDraft]);
 const input=useRef<HTMLTextAreaElement>(null),end=useRef<HTMLDivElement>(null),running=!!state.activeRuns?.some(r=>r.conversationId===chat.selected);
 // Size from content, including restored drafts and voice input. A cleared draft
 // returns to a single line; longer messages scroll inside a bounded field.
 useLayoutEffect(()=>{
  const field=input.current;if(!field||!visible)return;
  const resize=()=>{field.style.height='44px';const limit=Math.min(144,Math.max(72,(window.visualViewport?.height??window.innerHeight)*.25));field.style.height=Math.min(limit,Math.max(44,field.scrollHeight))+'px';field.style.overflowY=field.scrollHeight>limit?'auto':'hidden'};
  resize();window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
  return()=>{window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize)};
 },[draft,visible]);
 useEffect(()=>{const url=new URL(location.href),changed=url.searchParams.has('connected')||url.searchParams.has('connection_error');if(url.searchParams.has('connected')){setFeedback('계정 연결을 저장했습니다. 필요한 기록을 대화에서 요청해 보세요.');if(url.searchParams.get('connected')==='google_calendar'&&url.hash!=='#calendar')void agentRequest('/api/integrations/sync','POST',{}).then(()=>onWorkspaceChange()).catch(e=>setError(e.message));url.searchParams.delete('connected')}else if(url.searchParams.has('connection_error')){setError('계정 연결을 마치지 못했습니다. 연결 설정에서 다시 시도해 주세요.');setSettings(true);url.searchParams.delete('connection_error')}if(changed)replacePopupRoute(null,url.pathname+url.search+(url.hash||'#agent'))},[]);
 const refresh=async()=>{await chat.refresh();onWorkspaceChange()};
 async function send(text=draft,id?:string,retryFiles?:StoredAttachment[]){
  if(sending||running||chat.creating)return;
  if(!ready){setSettings(true);return}if(uploads.busy&&!retryFiles)return;const files=retryFiles??uploads.ready;const message=text.trim()||(files.length?'첨부한 자료를 함께 확인해 줘.':'');if(!message)return;setFeedback('');setQueue(false);
  let target=chat.selected;if(!target){const created=await chat.create();if(!created)return;target=created.id;if(!uploads.transfer(attachmentScope,'chat:'+target))return}
  const ok=await chat.send(message,id,files,target);if(ok){uploads.clearAt('chat:'+target,files.map(f=>f.id));await uploads.completeShare('chat:'+target,files.map(f=>f.id));}onWorkspaceChange();
 }
 const activeRun=state.activeRuns?.find(r=>r.conversationId===chat.selected);
 const lastTurn=state.turns.at(-1),failedTurn=!sending&&!running&&lastTurn?.status==='failed'?lastTurn:null;
 async function stopRun(id:string){setActing(id);setError('');try{await agentRequest('/api/agent/run','POST',{id,action:'cancel'});setFeedback('중지를 요청했습니다. 종료되면 알려드릴게요.');await load()}catch(e){setError(e instanceof Error?e.message:'중지 상태를 확인하지 못했습니다.')}finally{setActing(null)}}
 const opened=()=>{setQueue(false);setFeedback('')};
 // The 결재함 decides on the same cards; it asks this single chat instance to reload them.
 const refreshRef=useRef(refresh);
 useLayoutEffect(()=>{refreshRef.current=refresh});
 useEffect(()=>{const handle=(event:Event)=>{const done=(event as CustomEvent<{done?:(error?:unknown)=>void}>).detail?.done;refreshRef.current().then(()=>done?.(),error=>done?.(error??new Error('refresh failed')))};window.addEventListener('orbit:agent-refresh',handle);return()=>window.removeEventListener('orbit:agent-refresh',handle)},[]);
 // Opening a conversation from elsewhere (e.g. the 결재함) shows that conversation, not the review queue.
 useEffect(()=>{const show=()=>setQueue(false);window.addEventListener('orbit:open-chat',show);return()=>window.removeEventListener('orbit:open-chat',show)},[]);
 const askOtherTime=(item:AgentAction)=>{setDraft('“'+item.title+'” 제안을 기존 일정과 겹치지 않는 시간으로 다시 제안해 줘.');setQueue(false);input.current?.focus()};
 const review=useActionDecisions({timeZone:snapshot.data.preferences.timeZone,refresh,load,onStart:()=>setError(''),onFeedback:setFeedback,onAskOther:askOtherTime});

 const ready=state.directChatReady||state.connections.find(c=>c.provider==='hermes')?.connected,pending=state.pendingActions??[];
 const renderAction=(item:AgentAction)=><ActionCard key={item.id} item={item} snapshot={snapshot} review={review} onAskOther={askOtherTime}
  lead={queue&&item.conversationId&&<button className="text-button" onClick={()=>{chat.select(item.conversationId!);opened()}}>원래 대화 열기 <ArrowUpRight size={14}/></button>}
  extra={<>{item.state==='approved'&&item.result?.orderId&&<button className="text-button" onClick={()=>{setOrderDraft('');setOrderSelection(item.result!.orderId!);setOrderRoom(true);void orders.refresh()}}>실행과 결과 확인 <ArrowUpRight size={14}/></button>}{item.state==='approved'&&item.result?.briefDate&&<button className="text-button" onClick={()=>navigate('proposal')}>원페이지 제안 확인 <ArrowUpRight size={14}/></button>}{item.state==='approved'&&item.result?.url&&/^https:\/\/(calendar\.google\.com|www\.google\.com)\//.test(item.result.url)&&<a className="text-button" href={item.result.url} target="_blank" rel="noreferrer">Google에서 일정 보기 <ArrowUpRight size={14}/></a>}</>}/>;
 return <FileDrop className="agent-layout" onFiles={uploads.add} disabled={demo||chat.creating}><ConversationLibrary chat={chat} projects={snapshot.data.projects} demo={demo} onOpen={opened}/><section className="agent-workspace" aria-label="Orbit AI 에이전트"><header className="agent-toolbar"><div className="agent-identity"><span><OrbitMark size={32}/></span><div><strong>ORBIT</strong><small>나의 페이스메이커</small></div></div><div className="agent-tools"><button className={'secondary-button '+(queue?'selected':'')} onClick={()=>setQueue(v=>!v)} aria-pressed={queue}><Check size={15}/><span>검토함</span>{pending.length>0&&<b>{pending.length}</b>}</button><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="icon-button" aria-label="대화 메뉴"><Ellipsis size={22}/></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={demo} onSelect={()=>setActivityOpen(true)}>통합 기록</DropdownMenuItem><DropdownMenuItem disabled={demo} onSelect={()=>{setOrderDraft('');setOrderSelection(null);setOrderRoom(true);void orders.refresh()}}>업무 진행</DropdownMenuItem><DropdownMenuItem disabled={demo} onSelect={()=>setCoachOpen(true)}>나의 페이스 설정</DropdownMenuItem><DropdownMenuItem onSelect={()=>navigate('aside')}>웹 업무 진행</DropdownMenuItem><DropdownMenuItem onSelect={()=>navigate('automation')}>반복 업무</DropdownMenuItem><DropdownMenuItem disabled={demo} onSelect={()=>setSettings(true)}>연결 관리</DropdownMenuItem><DropdownMenuItem disabled={demo} onSelect={()=>setRuntimeOpen(true)}>자동 실행 설정</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></header><ConversationHeading chat={chat} projects={snapshot.data.projects} onOpen={opened}/>
 {!loaded?<div className="agent-loading"><LoaderCircle size={22} className="animate-spin"/>대화를 불러오는 중</div>:queue?<div className="agent-queue"><h2>내가 결정하는 다음 단계</h2><p>반영할 내용을 확인하고 승인하거나, 이유와 검토일을 남겨 보류하세요.</p>{pending.length?pending.map(renderAction):<div className="agent-empty-queue"><Check size={24}/><p>검토를 기다리는 제안이 없습니다.</p><button className="text-button" onClick={()=>setQueue(false)}>대화로 돌아가기</button></div>}</div>:<>
  {!state.turns.length&&<div className="agent-welcome"><h1>무엇을 도와드릴까요?</h1><div className="agent-suggestions">{suggestions.slice(0,2).map(s=><button key={s.title} onClick={()=>{setDraft(s.text);input.current?.focus()}}><s.icon size={18}/><span>{s.title}</span><ArrowUpRight size={15}/></button>)}</div>{demo?<p className="agent-setup-note">체험 화면입니다. 실제 AI 대화는 내 워크스페이스에서 연결 후 시작할 수 있습니다.</p>:!ready&&<div className="agent-setup"><span>대화를 시작하려면 AI 연결이 필요해요.</span><button onClick={()=>setSettings(true)}>연결하기 <ArrowUpRight size={15}/></button></div>}</div>}
  {!!state.turns.length&&<div className="agent-thread" role="log" aria-label="저장된 대화"><div className="agent-thread-head"><span>내 기록을 바탕으로, 다음 행동까지</span><button aria-label="대화 새로 불러오기" className="icon-button" onClick={()=>void refresh().catch(e=>setError(e.message))}><RefreshCw size={15}/></button></div>{state.hasMore&&<button className="text-button agent-older" disabled={older} onClick={()=>void chat.loadOlder()}>이전 대화 불러오기</button>}{state.turns.map(turn=><div className="agent-turn" key={turn.id}><div className="agent-user-message"><span>나</span><p>{turn.input}</p>{!!turn.attachments?.length&&<FileCards files={turn.attachments}/>}</div><div className="agent-assistant-message"><span className="agent-message-mark"><Orbit size={18}/></span><div className="agent-message-body"><strong>Orbit</strong>{turn.status==='running'?<><p className="agent-thinking"><LoaderCircle size={16} className="animate-spin"/>{progressLabel(turn.progress)}</p></>:turn.status==='failed'?<><p className="agent-error">{turn.error}</p><button className="text-button" disabled={sending||running} onClick={()=>void send(turn.input,turn.id,turn.attachments)}>이 메시지 다시 시도</button></>:<><p className="agent-answer">{turn.text}</p>{turn.sources.length>0&&<details className="agent-source-disclosure"><summary>참고한 기록 {turn.sources.length}개</summary><div className="agent-sources" aria-label="참고한 기록">{turn.sources.map((s,i)=>s.id?<button key={s.id} onClick={()=>setEvidence(s)}>{s.title} · {s.label} <ArrowUpRight size={12}/></button>:<span key={i}>{s.title} · {s.label}</span>)}</div></details>}{!demo&&<AnswerFeedback turnId={turn.id}/>} {state.actions.filter(a=>a.turnId===turn.id).map(renderAction)}</>}</div></div></div>)}</div>}
 </>}
 <div ref={end}/><form className="agent-composer" onSubmit={event=>{event.preventDefault();void send()}}><AttachmentInput scope={attachmentScope} disabled={demo||chat.creating||sending} compact extraTools={<button type="button" className="text-button" disabled={!visible||demo||sending||chat.creating} onClick={()=>setVoiceRequest(v=>v+1)}><Mic size={18}/>음성 입력</button>}/><label className="sr-only" htmlFor="orbit-message">Orbit에게 메시지 보내기</label><textarea ref={input} id="orbit-message" disabled={chat.creating} rows={1} maxLength={8000} value={draft} onPaste={e=>{const files=[...e.clipboardData.files];if(files.length){e.preventDefault();uploads.add(files)}}} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&e.keyCode!==229&&(e.metaKey||e.ctrlKey)){e.preventDefault();void send()}}} placeholder="Orbit에게 이야기하세요"/><div className="agent-composer-status" aria-live="polite">
 {chiefSyncError&&<p role="alert" className="agent-error">{chiefSyncError}</p>}
 {error&&<p role="alert" className="agent-error">{error}</p>}
 {!error&&queue&&failedTurn&&<p role="alert" className="agent-error">{failedTurn.error??'응답을 완료하지 못했습니다. 다시 시도해 주세요.'}</p>}
 {feedback&&<p role="status">{feedback}</p>}
 {(error||chat.pendingMessage||(queue&&failedTurn))&&<div className="agent-composer-controls">
 <button type="button" className="text-button" onClick={()=>void refresh().catch(e=>setError(e.message))}>다시 확인</button>
 {queue&&failedTurn&&!chat.pendingMessage&&<button type="button" className="text-button" onClick={()=>void send(failedTurn.input,failedTurn.id,failedTurn.attachments)}>다시 시도</button>}
 {chat.pendingMessage&&!sending&&!running&&<button type="button" className="text-button" onClick={()=>{const p=chat.pendingMessage;if(p)void send(p.message,p.id,p.attachmentIds.map(id=>uploads.ready.find(f=>f.id===id)??({id} as StoredAttachment)))}}>전송 확인 · 재시도</button>}
 </div>}
 </div><VoiceInput menuOnly requestStart={voiceRequest} disabled={!visible||demo||sending||chat.creating} onText={text=>setDraft((draft+' '+text).trim().slice(0,8000))}/><div className="agent-composer-bottom"><span>{demo?'체험 화면':sending?'보내는 중…':''}</span>{activeRun?<button type="button" aria-label="요청 중지" title="요청 중지" disabled={acting===activeRun.id} onClick={()=>void stopRun(activeRun.id)}>{acting===activeRun.id?<LoaderCircle size={19} className="animate-spin"/>:<Square size={17} fill="currentColor"/>}</button>:<button type="submit" aria-label={sending?"메시지 전송 중":"메시지 보내기"} disabled={demo||!loaded||chat.creating||sending||running||uploads.busy||(!draft.trim()&&!uploads.ready.length)}>{sending?<LoaderCircle size={19} className="animate-spin"/>:<ArrowUp size={20}/>}</button>}</div></form>
 {coachOpen&&<Dialog open onOpenChange={setCoachOpen}><DialogContent className="agent-runtime-dialog"><DialogHeader><DialogTitle>나의 페이스 설정</DialogTitle><DialogDescription>목표와 하루의 기준을 관리합니다.</DialogDescription></DialogHeader><ChiefPanel syncError={chiefSyncError} data={snapshot.data} perform={perform} busy={busy} demo={demo} onGoals={()=>{setCoachOpen(false);onGoals()}} onAsk={text=>{setCoachOpen(false);setDraft(text)}}/></DialogContent></Dialog>}
 {runtimeOpen&&<Dialog open onOpenChange={setRuntimeOpen}><DialogContent className="agent-runtime-dialog"><DialogHeader><DialogTitle>자동 실행 설정</DialogTitle><DialogDescription>일정 준비와 연결 상태를 관리합니다.</DialogDescription></DialogHeader><RuntimePanel demo={demo} navigate={view=>{setRuntimeOpen(false);navigate(view)}}/></DialogContent></Dialog>}
 {evidence&&<EvidenceSheet key={evidence.id} source={evidence} onClose={()=>setEvidence(null)} onOpen={onOpenRecord} onConversation={id=>{chat.select(id);opened()}}/>}
 {activityOpen&&<ActivityLibrary projects={snapshot.data.projects} onClose={()=>setActivityOpen(false)}/>}
 {orderRoom&&<OrderRoom key={orderSelection??'all'} room={orders} data={snapshot.data} demo={demo} conversationId={chat.selected} initialText={orderDraft} initialOrderId={orderSelection} onCompose={text=>{setOrderRoom(false);setQueue(false);if(text)setDraft(text);setTimeout(()=>input.current?.focus(),0)}} onClose={()=>setOrderRoom(false)} onAsk={id=>{setOrderRoom(false);setQueue(false);setDraft('업무 지시 '+id+'의 실제 실행 결과와 원래 지시를 읽고 검토해 줘. Google 반복 시리즈 삭제가 도구 부재로 막혔다면 원래 대상·전체 시리즈 범위를 유지해 Orbit의 google.event.deleteSeries 승인 카드로 처리하도록 제안해 줘. 기존 할 일은 변경하지 마. 다른 업무는 완료된 내용과 남은 일을 정리해 줘.');input.current?.focus()}} onComplete={id=>perform({type:'task.status',id,status:'done'},'검토한 결과를 완료로 기록했습니다.')}/>}
 {settings&&<Connections connections={state.connections} onClose={()=>setSettings(false)} onChange={refresh}/>}
 {review.deferDialog}
 </section></FileDrop>;
}
