'use client';
import {useEffect,useRef,useState} from 'react';
import {Sparkles,LoaderCircle,Check,Pause,ArrowRight,RefreshCw,Clock3,ChevronDown,FileText} from 'lucide-react';
import {agentRequest} from '../agent/connections';
import {formatTime,durationText,quadrantLabel,cognitionLabel,withDefaults,type WorkspaceSnapshot,type View,type Proposal} from '@/lib/orbit/model';
import {Crosshair} from 'lucide-react';
import type {BriefRun,BriefEvidence} from '@/lib/orbit/brief/schema';
import type {WorkspaceAction} from '@/lib/orbit/validation';
import {addDays,koreanDate,todayInZone,validDate} from '@/lib/orbit/dates';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
interface Props {snapshot:WorkspaceSnapshot;date:string;setDate:(date:string)=>void;energy:Proposal['energy'];setEnergy:(energy:Proposal['energy'])=>void;busy:boolean;demo:boolean;refresh:()=>Promise<void>;perform:(action:WorkspaceAction,message?:string)=>Promise<boolean>;navigate:(view:View)=>void;open:(kind:'task'|'note'|'project'|'event',id:string)=>void;launch?:{date:string;id:string}}
export function DailyBriefPanel({snapshot,date,setDate,energy,setEnergy,busy,demo,refresh,perform,navigate,open,launch}:Props){
 const [run,setRun]=useState<BriefRun|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[starting,setStarting]=useState(false),[defer,setDefer]=useState<string|null>(null),[reason,setReason]=useState(''),[revisit,setRevisit]=useState(addDays(date,1));
 const refreshedRun=useRef(''),onRefresh=useRef(refresh);onRefresh.current=refresh;
 const currentDate=useRef(date),request=useRef<{id:string;date:string;energy:Proposal['energy']}|null>(null),launched=useRef(''),startingRef=useRef(false);currentDate.current=date;
 const plan=snapshot.data.proposals.find(p=>p.date===date),brief=plan?.brief,running=run?.status==='running',locked=busy||starting||running;
 const today=todayInZone(snapshot.data.preferences.timeZone),historical=date<today;
 const dayLabel=date===today?'오늘':date===addDays(today,1)?'내일':date===addDays(today,-1)?'어제':koreanDate(date,false);
 const savedDates=[...snapshot.data.proposals].sort((a,b)=>b.date.localeCompare(a.date));
 const changeDate=(value:string)=>{if(!validDate(value))return;request.current=null;setNotice('');setError('');setDefer(null);setRun(null);setDate(value)};
 async function start(explicitId?:string){
  if(demo){setError('체험 화면에서는 헤르메스 분석을 실행하지 않습니다. 내 워크스페이스에서 시작해 주세요.');return}
  if(!validDate(date)){setError('유효한 계획 날짜를 선택해 주세요.');return}
  if(startingRef.current||running)return;startingRef.current=true;setStarting(true);setError('');
  const payload=request.current&&request.current.date===date&&request.current.energy===energy?request.current:{id:explicitId??crypto.randomUUID(),date,energy};request.current=payload;
  try{const started=await agentRequest('/api/brief','POST',payload);if(started?.local){setNotice('Hermes가 연결되어 있지 않아 Orbit의 규칙 기반 계획(Goal Laser 우선 → 반드시 종결 → B → A → C)으로 시간을 배치했습니다. 연결하면 근거 기반 원페이지 제안을 받을 수 있습니다.');request.current=null;await onRefresh.current();return}setNotice('');if(currentDate.current===payload.date)setRun({id:payload.id,status:'running',progress:`${payload.date} 제안을 위해 진척과 회의 기록을 모으고 있습니다.`})}catch(e){setError(e instanceof Error?e.message:'분석을 시작하지 못했습니다.');try{const state=await agentRequest('/api/brief?date='+payload.date);if(currentDate.current===payload.date)setRun(state.run)}catch{}}finally{startingRef.current=false;setStarting(false)}
 }
 useEffect(()=>{if(!launch||launch.date!==date||launched.current===launch.id)return;launched.current=launch.id;void start(launch.id)},[launch,date]);
 useEffect(()=>{
  if(demo)return;let active=true,timer:ReturnType<typeof setTimeout>;setRun(null);setError('');refreshedRun.current='';
  const poll=async()=>{try{
   const result=await agentRequest('/api/brief?date='+date);if(!active)return;setRun(result.run);
   if(result.run?.status==='running'){try{await agentRequest('/api/agent/run','POST',{id:result.run.id,action:'poll'})}catch(e){if(active)setError(e instanceof Error?e.message:'연결을 다시 확인합니다.')}}
   else if(result.run?.status==='completed'){request.current=null;if(refreshedRun.current!==result.run.id){refreshedRun.current=result.run.id;await onRefresh.current()}}
   else if(result.run?.status==='failed'){request.current=null;}
  }catch(e){if(active)setError(e instanceof Error?e.message:'분석 상태를 불러오지 못했습니다.')}finally{if(active)timer=setTimeout(poll,3000)}};
  void poll();return()=>{active=false;clearTimeout(timer)};
 },[date,demo]);
 const evidence=(ids:string[])=>brief?<details className="brief-evidence"><summary>판단 근거 <ChevronDown size={13}/></summary><ul>{ids.map(id=>{const source=brief.evidence.find(e=>e.id===id);if(!source)return null;return <li key={id}><button onClick={()=>openEvidence(source)}><FileText size={13}/>{source.title}{source.revision?' · v'+source.revision:''}</button>{source.excerpt&&<p>{source.excerpt}</p>}</li>})}</ul></details>:null;
 const openEvidence=(source:BriefEvidence)=>{if(['task','note','project','event'].includes(source.kind))open(source.kind as 'task'|'note'|'project'|'event',source.recordId);else if(source.kind==='review')navigate('review');else navigate('agent')};
 const approve=async(id:string)=>{setError('');if(!await perform({type:'proposal.approve',date,itemId:id},'승인한 결과물과 집중 시간을 Orbit 일정에 반영했습니다.'))setError('승인을 완료하지 못했습니다. 화면 위의 저장 안내를 확인해 주세요.')};
 const decisionButtons=(id:string)=>{const item=plan?.items.find(i=>i.id===id);if(!item)return null;if(historical)return <div className="brief-decisions"><span>{({pending:'검토용 제안',approved:'승인된 기록',deferred:'보류된 기록'})[item.state]}</span><small>지난 날짜의 제안은 확인·재생성할 수 있습니다. 일정에 새로 반영하려면 오늘 이후 날짜를 선택해 주세요.</small></div>;return <div className="brief-decisions">{item.state==='pending'?<><button className="primary-button" disabled={busy||running} onClick={()=>void approve(id)}><Check size={15}/>승인하고 일정에 반영</button><button className="secondary-button" disabled={busy||running} onClick={()=>{setDefer(id);setReason('');setRevisit(addDays(date,1))}}><Pause size={15}/>보류</button></>:item.state==='approved'?<><span className="brief-approved"><Check size={15}/>승인됨</span><button className="text-button" onClick={()=>navigate('calendar')}>일정 보기 <ArrowRight size={14}/></button><button className="text-button" disabled={busy||running} onClick={()=>void perform({type:'proposal.revoke',date,itemId:id},'승인한 집중 시간을 취소했습니다.')}>승인 취소</button></>:<><span>보류 · {item.revisitDate} · {item.deferReason}</span><button className="text-button" disabled={busy||running} onClick={()=>void perform({type:'proposal.reconsider',date,itemId:id})}>다시 검토</button></>}</div>};
 const mapped=new Set<string>();
 return <section className="daily-brief-surface">
  <div className="brief-toolbar"><div><label>계획 날짜<input aria-label="계획 날짜" type="date" value={date} onChange={e=>changeDate(e.target.value)}/></label><label>예상 컨디션<select value={energy} onChange={e=>setEnergy(e.target.value as Proposal['energy'])}><option value="low">여유롭게</option><option value="normal">평소처럼</option><option value="high">집중해서</option></select></label></div><button className="primary-button" disabled={locked||!validDate(date)} onClick={()=>void start()}>{starting||running?<LoaderCircle size={17} className="animate-spin"/>:<Sparkles size={17}/>} {starting||running?'진척 분석 중':brief?'최신 진척으로 다시 분석':'원페이지 제안 만들기'}</button></div>
  <div className="brief-date-navigation" aria-label="제안 날짜 이동">
    <button className="secondary-button" aria-label="이전 날짜" onClick={()=>changeDate(addDays(date,-1))}>← 전날</button>
    {([-1,0,1] as const).map(offset=><button key={offset} className="secondary-button" aria-pressed={date===addDays(today,offset)} onClick={()=>changeDate(addDays(today,offset))}>{offset===-1?'어제':offset===0?'오늘':'내일'}</button>)}
    <button className="secondary-button" aria-label="다음 날짜" onClick={()=>changeDate(addDays(date,1))}>다음 날 →</button>
    <select className="form-field" aria-label="저장된 제안 날짜" value={plan?date:''} onChange={e=>e.target.value&&changeDate(e.target.value)}>
      <option value="" disabled>저장된 제안 {savedDates.length}개</option>
      {savedDates.map(p=><option key={p.date} value={p.date}>{p.date} · {p.brief?'원페이지 제안':'시간 계획'}</option>)}
    </select>
  </div>
  {historical&&<div className="brief-notice"><Clock3 size={15}/><span>이전 날짜의 제안을 확인하거나 다시 만들 수 있습니다. 새로 생성할 때는 현재 저장된 기록으로 재작성하며, 당시의 업무 상태를 복원하는 것은 아닙니다.</span></div>}
  {notice&&<div className="brief-notice" role="status"><Crosshair size={15}/><span>{notice}</span></div>}
  {plan?.laser&&plan.laser.status!=='placed'&&plan.laser.status!=='none'&&<div className="brief-notice is-warn" role="status"><Crosshair size={15}/><span>Goal Laser를 놓지 못했습니다 · {plan.laser.note}</span></div>}
  {(error||run?.status==='failed')&&<div className="brief-alert" role="alert"><strong>분석을 완료하지 못했습니다</strong><p>{error||run?.error}</p><button className="text-button" onClick={()=>void start()} disabled={locked}><RefreshCw size={14}/>다시 시도</button><button className="text-button" onClick={()=>navigate('agent')}>헤르메스·연결 확인</button></div>}
  {(running||starting)&&<div className="brief-progress" role="status"><LoaderCircle size={20} className="animate-spin"/><div><strong>{dayLabel}의 실행 제안을 만들고 있습니다</strong><p>{run?.progress??'회의록·일정·완료와 미완료 업무·회고를 모으고 있습니다.'}</p><small>이 화면을 다시 열어도 분석을 이어서 확인할 수 있습니다.</small></div>{run&&<button className="text-button" onClick={async()=>{try{await agentRequest('/api/agent/run','POST',{id:run.id,action:'cancel'})}catch(e){setError(e instanceof Error?e.message:'중지 상태 확인 실패')}}}>중지</button>}</div>}
  {brief?<article className="brief-paper">
   <header className="brief-paper-header"><span>ORBIT / DAILY BRIEF</span><time>{koreanDate(date)}</time><h2>{brief.headline}</h2><p>{brief.assessment}</p><small>{brief.cutoff}까지의 기록 · {new Date(brief.generatedAt).toLocaleString('ko-KR',{timeZone:snapshot.data.preferences.timeZone})} 분석</small></header>
   <section className="brief-progress-notes"><h3>기록에서 확인한 진척</h3>{brief.progress.map((item,i)=><div key={i}><p>{item.text}</p>{evidence(item.evidence)}</div>)}</section>
   <section className="brief-priorities"><div className="brief-section-heading"><h3>{dayLabel}의 우선순위와 실행 방안</h3><span>추가 집중 예산 {durationText(plan?.budget??0)}</span></div>
    {brief.priorities.map((priority,index)=>{
     const item=plan?.items.find(i=>priority.taskId?i.taskId===priority.taskId:i.taskId===`brief:${brief.sourceTurnId}:${index}`);if(item)mapped.add(item.id);
     const project=snapshot.data.projects.find(p=>p.id===priority.projectId);
     return <section className="brief-priority" key={index}><div className="brief-priority-title"><b>{String(index+1).padStart(2,'0')}</b><div><span>{project?.name}</span><h4>{priority.title}</h4></div><span className="brief-time"><Clock3 size={14}/>{item?formatTime(item.start)+'–'+formatTime(item.end):'시간 배치 필요'}</span></div>
      <div className="brief-brainy">{item?.role==='laser'&&<span className="brainy-badge is-laser"><Crosshair size={12}/>Goal Laser · {item.end-item.start}분 연속{item.end-item.start<withDefaults(snapshot.data.preferences).laserMinutes?' (목표 '+withDefaults(snapshot.data.preferences).laserMinutes+'분)':''}</span>}{item?.role==='must'&&<span className="brainy-badge is-must">반드시 종결</span>}{(priority.quadrant??item?.quadrant)&&<span className="brainy-badge">{quadrantLabel[(priority.quadrant??item!.quadrant)!]}</span>}{(priority.cognition??item?.cognition)&&<span className={'brainy-badge cog-'+(priority.cognition??item!.cognition)}>{cognitionLabel[(priority.cognition??item!.cognition)!]}</span>}{item?.factor&&item.factor!==1?<span className="brainy-badge">보정 ×{item.factor}</span>:null}</div>
      <div className="brief-priority-body"><div><label>목표에 대한 기여</label><p>{priority.whyNow}</p><label>{dayLabel}의 목표 결과물</label><p className="brief-outcome">{priority.outcome}</p></div><div><label>이렇게 진행</label><ol>{priority.approach.map((step,i)=><li key={i}>{step}</li>)}</ol></div></div>
      {evidence(priority.evidence)}{item?decisionButtons(item.id):<p className="brief-capacity">고정 일정·보류·선행 작업·집중 개수 제한으로 시간을 배치하지 않았습니다. 기존 계획을 조정한 뒤 다시 분석해 주세요.</p>}
     </section>;
    })}
    {!brief.priorities.length&&<p className="brief-capacity">현재 기록과 가용 시간으로 확정할 실행 항목이 없습니다. 아래 확인할 질문과 제약을 먼저 검토해 주세요.</p>}
   </section>
   <div className="brief-tradeoffs"><section><h3>{dayLabel}에 뒤로 미룰 일</h3>{brief.tradeoffs.length?brief.tradeoffs.map((item,i)=><div key={i}><h4>{item.title}</h4><p>{item.reason}</p>{evidence(item.evidence)}</div>):<p>추가로 미룰 업무를 제안하지 않았습니다.</p>}</section><section><h3>막히면 이렇게 대응</h3>{brief.risks.length?brief.risks.map((item,i)=><div key={i}><h4>{item.risk}</h4><p>{item.response}</p>{evidence(item.evidence)}</div>):<p>확인된 추가 장애물이 없습니다.</p>}</section></div>
   <footer className="brief-success"><span>{dayLabel}의 성공 기준</span><p>{brief.success}</p></footer>
   {brief.questions.length>0&&<section className="brief-questions"><h3>판단을 위해 확인할 것</h3><ul>{brief.questions.map((question,i)=><li key={i}>{question}</li>)}</ul></section>}
   <details className="brief-coverage"><summary>분석에 사용한 기록과 범위 <ChevronDown size={14}/></summary><p>프로젝트 {brief.coverage.projects} · 업무 {brief.coverage.tasks}(완료 {brief.coverage.completed} / 미완료 {brief.coverage.incomplete}) · 기록 {brief.coverage.notes}(원문 전체 {brief.coverage.noteBodies}) · 회고 {brief.coverage.reviews} · 일정 {brief.coverage.events}</p><p>{brief.coverage.google}<br/>{brief.coverage.plaud}</p>{brief.coverage.warnings.map((warning,i)=><p key={i}>{warning}</p>)}</details>
  </article>:!running&&!starting&&<div className="brief-empty"><Sparkles size={28}/><h2>{dayLabel}, 무엇을 왜 먼저 해야 할까요?</h2><p>프로젝트의 목표와 오늘까지의 진척, 회의에서 남은 결정과 실제 가용 시간을 함께 검토해 한 장의 실행안을 만듭니다.</p><div><span>진척과 미결 판단</span><ArrowRight size={15}/><span>우선순위와 실행 방법</span><ArrowRight size={15}/><span>승인한 결과물</span></div></div>}
  {!!plan?.items.filter(i=>!mapped.has(i.id)).length&&<section className="brief-retained"><h3>{brief?'유지한 기존 계획':'규칙 기반 시간 계획'}</h3>{plan.items.filter(i=>!mapped.has(i.id)).map(item=><article key={item.id}><strong>{item.role==='laser'&&<Crosshair size={13}/>}{snapshot.data.tasks.find(t=>t.id===item.taskId)?.title??item.draftTask?.title??'저장된 실행 항목'}</strong><span>{formatTime(item.start)}–{formatTime(item.end)}{item.role==='laser'?' · Goal Laser':item.role==='must'?' · 반드시 종결':''}</span>{item.reason&&!brief&&<p className="brief-reason">{item.reason}</p>}{decisionButtons(item.id)}</article>)}</section>}
  <p className="brief-footnote">승인한 항목만 할 일·집중 시간에 반영됩니다. 외부 연락과 Google 일정 등록은 별도 승인이 필요합니다.</p>
  {defer&&<Dialog open onOpenChange={v=>!v&&setDefer(null)}><DialogContent><DialogHeader><DialogTitle>지금은 보류하기</DialogTitle><DialogDescription>이유와 다시 검토할 날짜를 다음 분석에 반영합니다.</DialogDescription></DialogHeader><form className="dialog-form" onSubmit={async e=>{e.preventDefault();if(await perform({type:'proposal.defer',date,itemId:defer,reason,revisitDate:revisit},'보류 이유를 저장했습니다.'))setDefer(null)}}><label>보류 이유<textarea className="form-field" required value={reason} onChange={e=>setReason(e.target.value)}/></label><label>다시 검토할 날짜<input className="form-field" type="date" min={addDays(date,1)} required value={revisit} onChange={e=>setRevisit(e.target.value)}/></label><button className="primary-button" disabled={busy}>보류 저장</button></form></DialogContent></Dialog>}
 </section>;
}
