'use client';
// Proposal cards and the approve / defer / reject flow, shared by the Orbit chat's
// review queue and the 결재함 so both use one implementation of the safety checks
// (calendar overlap confirmation, receipt recovery after a lost connection, defer reason).
import {useRef,useState,type ReactNode} from 'react';
import {Check,ChevronDown,Clock3,LoaderCircle,ArrowUpRight,X} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {isConnectionError,scopedRequest,decisionReceiptMatches} from '@/lib/orbit/agent/client-request';
import {AgentRequestError,type OverlapDetails} from '@/lib/orbit/agent/approval-feedback';
import {addDays,todayInZone} from '@/lib/orbit/dates';
import {formatTime,type WorkspaceSnapshot} from '@/lib/orbit/model';
import type {AgentAction} from '@/lib/orbit/agent/types';
import {agentRequest} from './connections';

const names:Record<string,string>={domain:'목표 분야',strain:'느끼는 부담',minutes:'실천 시간(분)',days:'요일(0=일요일)',baseline:'시작 수치',current:'현재 수치',target:'목표 수치',unit:'단위',startedOn:'시작일',updatedOn:'진척 확인일',active:'사용 여부',title:'제목',name:'이름',goal:'결과물',due:'기한',priority:'우선순위',symbol:'표시',color:'색상',projectId:'프로젝트',status:'진행 상태',duration:'예상 소요(분)',impact:'중요도',focus:'오늘 집중',definition:'완료 조건',blocker:'막힌 점',checkDate:'확인일',planHoldUntil:'보류 기한',dependsOn:'선행 업무',completedOn:'완료일',kind:'종류',summary:'요약',body:'본문',tags:'태그',updated:'기록 날짜',date:'날짜',start:'시작',end:'종료',timeZone:'시간대',description:'설명',win:'성과',block:'장애물',energy:'에너지',itemId:'계획 항목',reason:'이유',revisitDate:'다시 검토할 날짜',workStart:'업무 시작',workEnd:'업무 종료',breakStart:'휴식 시작',breakEnd:'휴식 종료',workDays:'업무 요일',focusLimit:'핵심 결과물 개수',breakMinutes:'휴식 간격(분)',bufferFraction:'여유 시간 비율',focusDate:'집중 날짜',noteId:'연결 문서',revision:'문서 버전',line:'원문 행',quote:'근거',result:'결과',planHoldReason:'보류 이유',planHoldProposalId:'보류한 계획',dailyBudget:'집중 예산',taskId:'할 일'};
const values:Record<string,string>={work:'일·사업',health:'건강',mind:'마음·회복',learning:'학습',life:'삶',light:'여유 있음',heavy:'버거움',active:'진행 중',paused:'보류',achieved:'달성',todo:'할 일',doing:'진행 중',waiting:'대기',done:'완료',meeting:'회의',wiki:'위키',knowledge:'지식',normal:'보통',low:'낮음',high:'높음'};
export function ActionPreview({item,snapshot}:{item:AgentAction;snapshot:WorkspaceSnapshot}){
 const action=item.action;
 if(action.type==='google.event.deleteSeries')return <div className="agent-change"><p><strong>Google 반복 시리즈 전체 삭제</strong></p><p>{action.verified?.title??action.expectedTitle}</p><p>범위: 전체 회차 (과거·향후 포함)</p><p>기존 할 일의 상태와 내용은 그대로 유지합니다.</p><details><summary>확인한 대상 ID</summary><p style={{overflowWrap:'anywhere'}}>캘린더: {action.verified?.calendarId}<br/>반복 시리즈: {action.verified?.seriesId}</p></details>{item.result?.calendarDeletion&&<p role="status">{item.result.calendarDeletion.message}</p>}</div>;
 if(action.type==='agent.dispatch')return <details className="agent-change"><summary>실행할 지시 확인 <ChevronDown size={14}/></summary><p>{action.instruction}</p><p>{action.mode==='research'?'Orbit에 연결된 Plaud와 개인 위키를 읽어 분석합니다. 위키 수정이나 외부 전송은 하지 않습니다.':'Hermes의 연결된 도구와 에이전트로 실제 실행합니다.'} 진행·중단·결과는 실행실에서 확인합니다.</p><p>연결 프로젝트: {snapshot.data.projects.find(p=>p.id===action.projectId)?.name??"일반 업무"}</p>{action.taskIds.map(id=><p key={id}>연결 업무: {snapshot.data.tasks.find(t=>t.id===id)?.title??id}</p>)}{action.eventIds?.map(id=>{const event=snapshot.data.events.find(e=>e.id===id);return <p key={id}>참고 일정: {event?.title??id}{event&&<> · {event.date} · {formatTime(event.start)}–{formatTime(event.end)}</>}</p>})}</details>;
 if(action.type==='quest.plan')return <details className="agent-change"><summary>퀘스트와 선후 관계 확인 <ChevronDown size={14}/></summary><p>목표: {snapshot.data.goals?.find(g=>g.id===action.goalId)?.sentence??action.goalId}</p>{action.project&&<p>함께 만들 프로젝트: {action.project.name}</p>}<ol>{action.tasks.map(t=><li key={t.id}><strong>{t.title}</strong><p>{t.definition}</p><small>{t.due} · {t.duration}분 · {action.project?.id===t.projectId?action.project.name:snapshot.data.projects.find(p=>p.id===t.projectId)?.name}</small>{!!t.dependsOn?.length&&<p>먼저 완료: {t.dependsOn.map(id=>action.tasks.find(x=>x.id===id)?.title??snapshot.data.tasks.find(x=>x.id===id)?.title??id).join(', ')}</p>}</li>)}</ol></details>;
 if(action.type==='memory.upsert')return <details className="agent-change"><summary>기억할 내용 확인 <ChevronDown size={14}/></summary><p>{action.memory.statement}</p><p>{action.memory.kind==='reflection'?'자기 탐색에만 참고합니다.':'다음 대화와 하루 제안에 참고합니다.'}</p>{action.memory.sources.map((s,i)=><p key={i}>연결 기록: {s.kind==='note'?snapshot.data.notes.find(n=>n.id===s.id)?.title:s.kind==='task'?snapshot.data.tasks.find(t=>t.id===s.id)?.title:s.id+' 회고'}{s.revision?' · v'+s.revision:''}</p>)}</details>;
 const drafts=action.type==='task.upsert'&&action.project?[action.project]:action.type==='task.assign'?action.projects??[]:[];
 const projectName=(id:unknown)=>snapshot.data.projects.find(p=>p.id===id)?.name??drafts.find(p=>p.id===id)?.name??'새 프로젝트 · 선행 제안 승인 필요';
 const entries=(record:Record<string,unknown>):[string,unknown][]=>Object.entries(record).flatMap(([key,value]):[string,unknown][]=>['type','id','expectedNoteRevision','autoAssign'].includes(key)?[]:value&&typeof value==='object'&&!Array.isArray(value)?entries(value as Record<string,unknown>):[[key,value]]);
 const rows=action.type==='task.upsert'?entries(action.task as unknown as Record<string,unknown>):action.type==='task.assign'?action.assignments.map((a):[string,unknown]=>['할 일 연결',`${snapshot.data.tasks.find(t=>t.id===a.id)?.title??a.id} → ${projectName(a.projectId)}`]):entries(action as unknown as Record<string,unknown>);
 const targetId='id' in action?action.id:undefined;const target=snapshot.data.tasks.find(t=>t.id===targetId)?.title;if(target)rows.unshift(['taskId',target]);
 return <details className="agent-change"><summary>반영할 내용 확인 <ChevronDown size={14}/></summary>
 {drafts.map(p=><p key={p.id}><strong>함께 생성할 프로젝트: {p.name}</strong><br/>키워드: {p.keywords?.join(', ')||'없음'} · 목표일: {p.due}{p.goal&&<><br/>{p.goal}</>}</p>)}
 <dl>{rows.map(([key,value],i)=>{let text=typeof value==='boolean'?(value?'예':'아니요'):Array.isArray(value)?value.map(v=>v&&typeof v==='object'?Object.entries(v).map(([k,x])=>(names[k]??k)+': '+String(x??'')).join(' · '):snapshot.data.tasks.find(t=>t.id===v)?.title??snapshot.data.notes.find(n=>n.id===v)?.title??v).join(' / '):String(value??'없음');if(['start','end','workStart','workEnd','breakStart','breakEnd'].includes(key)&&typeof value==='number')text=formatTime(value);if(key==='projectId')text=projectName(value);if(key==='itemId')text=snapshot.data.tasks.find(t=>t.id===snapshot.data.proposals.flatMap(p=>p.items).find(i=>i.id===value)?.taskId)?.title??text;if(key==='taskId')text=snapshot.data.tasks.find(t=>t.id===value)?.title??text;return <div key={key+i} className={key==='body'?'agent-change-body':''}><dt>{names[key]??key}</dt><dd>{values[text]??text}</dd></div>})}</dl></details>;
}


export type ActionDecision='approve'|'defer'|'reconsider'|'reject';
type Notice={message:string;success?:boolean;overlap?:OverlapDetails};

export function useActionDecisions({timeZone,refresh,load,onStart,onFeedback,onAskOther}:{timeZone:string;refresh:()=>Promise<void>;load:()=>Promise<unknown>;onStart?:()=>void;onFeedback?:(message:string)=>void;onAskOther?:(item:AgentAction)=>void}){
 const [acting,setActing]=useState<string|null>(null),[deferred,setDeferred]=useState<AgentAction|null>(null),[reason,setReason]=useState(''),[revisit,setRevisit]=useState(()=>addDays(todayInZone(timeZone),1));
 const [notices,setNotices]=useState<Record<string,Notice>>({});
 const lock=useRef(false);
 async function decide(item:AgentAction,decision:ActionDecision,overlapConfirmation?:string){
  if(lock.current||acting)return;lock.current=true;setActing(item.id);onStart?.();
  setNotices(previous=>({...previous,[item.id]:{message:'처리 중입니다…'}}));
  try{
   let result;const request=scopedRequest(agentRequest);
   try{result=await request('/api/agent','PATCH',{id:item.id,decision,...(overlapConfirmation?{overlapConfirmation}:{}),...(decision==='defer'?{reason,revisitDate:revisit}:{})});}catch(error){
    if(!isConnectionError(error))throw error;
    const check=await request('/api/agent?actionReceipt='+encodeURIComponent(item.id));
    if(!decisionReceiptMatches(check.receipt,{decision,reason,revisitDate:revisit}))throw error;
    result=decision==='approve'&&check.receipt.refreshTurnId&&check.receipt.state!=='approved'?{ok:true,refreshing:true}:{ok:true};
   }
   if(result.refreshing){setNotices(previous=>({...previous,[item.id]:{message:'관련 기록이 변경되어 최신 내용으로 제안을 다시 준비하고 있습니다. 새 제안을 확인한 뒤 승인해 주세요.',success:true}}));await refresh().catch(()=>{});return;}
   setDeferred(null);
   const message=decision==='approve'?(item.action.type==='agent.dispatch'?'업무 지시를 저장했습니다. 실행실에서 접수와 진행을 확인하세요.':'승인한 내용을 반영했습니다.'):decision==='defer'?'검토할 날짜와 보류 이유를 저장했습니다.':decision==='reject'?'제안을 닫았습니다.':'다시 검토할 수 있습니다.';
   setNotices(previous=>({...previous,[item.id]:{message,success:true}}));onFeedback?.(message);
   try{await refresh()}catch{setNotices(previous=>({...previous,[item.id]:{message:message+' 목록을 새로 불러오지 못했습니다. 대화 새로 불러오기를 누르면 결과를 확인할 수 있습니다.',success:true}}))}
  }catch(e){
   const message=e instanceof Error?e.message:'변경을 완료하지 못했습니다.';
   setNotices(previous=>({...previous,[item.id]:{message,overlap:e instanceof AgentRequestError&&e.code==='CALENDAR_OVERLAP'?e.details:undefined}}));
   await load().catch(()=>{});
  }finally{lock.current=false;setActing(null)}
 }
 const openDefer=(item:AgentAction)=>{setDeferred(item);setReason('');setRevisit(addDays(todayInZone(timeZone),1))};
 const notice=(item:AgentAction,onAskOther?:(item:AgentAction)=>void)=>{
  const current=notices[item.id];if(!current)return null;
  return <div role={current.success||acting===item.id?'status':'alert'} className={current.success?'agent-feedback':'agent-error'}>
   <p>{current.message}</p>
   {current.overlap&&item.state!=='approved'&&<>
    <ul className="agent-overlap-list">{current.overlap.conflicts.map((event,index)=><li key={index}><strong>{event.title}</strong><span>{event.date} · {formatTime(event.start)}–{formatTime(event.end)}</span></li>)}</ul>
    {current.overlap.total>current.overlap.conflicts.length&&<p>외 {current.overlap.total-current.overlap.conflicts.length}개 일정이 더 겹칩니다.</p>}
    <div className="agent-overlap-options"><button className="primary-button" disabled={!!acting} onClick={()=>void decide(item,'approve',current.overlap!.overlapConfirmation)}>겹침을 확인하고 등록</button>{onAskOther&&<button className="secondary-button" disabled={!!acting} onClick={()=>onAskOther(item)}>다른 시간 요청하기</button>}</div>
   </>}
  </div>;
 };
 const deferDialog=deferred&&<Dialog open onOpenChange={open=>{if(!open)setDeferred(null)}}><DialogContent><DialogHeader><DialogTitle>지금은 보류하기</DialogTitle><DialogDescription>{deferred.title}</DialogDescription></DialogHeader><form className="dialog-form agent-defer-form" onSubmit={e=>{e.preventDefault();void decide(deferred,'defer')}}><label>보류하는 이유<textarea className="form-field" value={reason} onChange={e=>setReason(e.target.value)} required maxLength={2000} placeholder="선행 자료가 도착한 뒤 진행하기"/></label><label>다시 검토할 날짜<input className="form-field" type="date" min={addDays(todayInZone(timeZone),1)} value={revisit} onChange={e=>setRevisit(e.target.value)} required/></label>{notice(deferred,onAskOther)}<button className="primary-button" disabled={!!acting||!reason.trim()}>이유를 남기고 보류</button></form></DialogContent></Dialog>;
 return {acting,decide,openDefer,notice,deferDialog};
}
export type ActionReview=ReturnType<typeof useActionDecisions>;

export const actionKind=(item:AgentAction)=>item.action.type==='agent.dispatch'?'맡길 업무':item.action.type==='memory.upsert'?'기억 제안':item.action.type==='quest.plan'?'목표 퀘스트':item.action.type.startsWith('google.event.')?'GOOGLE 일정':item.action.type.startsWith('note.')?'기록 제안':item.action.type.startsWith('proposal.')||item.action.type.startsWith('review.')?'하루 설계':'업무 제안';

export function ActionCard({item,snapshot,review,lead,extra,onAskOther}:{item:AgentAction;snapshot:WorkspaceSnapshot;review:ActionReview;lead?:ReactNode;extra?:ReactNode;onAskOther?:(item:AgentAction)=>void}){
 const {acting,decide,openDefer,notice}=review;
 return <article className={'agent-action '+item.state}><div className="agent-action-top"><span>{actionKind(item)}</span><small>{({pending:'승인 대기',applying:'적용 중',approved:'반영 완료',deferred:'보류',rejected:'닫힘'})[item.state]}</small></div>{lead}<h3>{item.title}</h3><p>{item.reason}</p><ActionPreview item={item} snapshot={snapshot}/>{notice(item,onAskOther)}{item.note&&<p className="agent-defer-note">{item.revisitDate} 다시 검토 · {item.note}</p>}{extra}{['pending','applying'].includes(item.state)&&<div className="agent-action-buttons"><button className="primary-button" disabled={!!acting} onClick={()=>void decide(item,'approve')}>{acting===item.id?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/>} {item.state==='applying'?'결과 확인 / 재시도':item.action.type==='agent.dispatch'?'승인하고 실행':'승인하고 반영'}</button><button className="secondary-button" disabled={!!acting||item.state==='applying'} onClick={()=>openDefer(item)}><Clock3 size={15}/> 보류</button><button className="icon-button" aria-label={item.title+' 제안 닫기'} disabled={!!acting||item.state==='applying'} onClick={()=>void decide(item,'reject')}><X size={16}/></button></div>}{item.state==='deferred'&&<button className="text-button" disabled={!!acting} onClick={()=>void decide(item,'reconsider')}>다시 검토하기 <ArrowUpRight size={14}/></button>}</article>;
}
