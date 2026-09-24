'use client';
import {useMemo,type CSSProperties} from 'react';
import {ArrowRight,Check,Clock3,Play,Plus,ChevronRight,Moon,Headphones,Orbit,CheckCheck,Flag,ArrowUpRight} from 'lucide-react';
import {illustrationTheme,screenIllustration} from '@/lib/orbit/city-themes';
import {projectWorld} from '@/lib/orbit/project-world';
import {workspaceDashboard} from '@/lib/orbit/dashboard';
import {protectedEvents} from '@/lib/orbit/allocation-policy';
import {addDays} from '@/lib/orbit/dates';
import {questReadiness} from '@/lib/orbit/pacemaker';
import {orderActive,orderStatusLabel,type WorkOrder} from '@/lib/orbit/agent/orders-schema';
import {TimeBudget} from './time-budget';
import {AiHoldBanner} from './brief/ai-hold-banner';
import {Progress} from '@/components/ui/progress';
import {formatTime,type WorkspaceData,type View} from '@/lib/orbit/model';
import type {WorkspaceAction} from '@/lib/orbit/validation';
import {experimentsToReview} from '@/lib/orbit/experiment-review';

type Props={orders?:WorkOrder[];onOrder?:(id?:string)=>void;data:WorkspaceData;now:Date;busy:boolean;demo:boolean;pendingAI:number|null;perform:(action:WorkspaceAction,message?:string)=>Promise<boolean>;onOpen:(target:{kind:'task'|'project'|'note'|'event';id:string})=>void;navigate:(view:View)=>void;onCreate:()=>void;onAsk:(text:string)=>void;onCalendar:(date:string)=>void;onProposal:(date:string)=>void;onReview:()=>void;onTimeSettings:()=>void};
export function TodayHome({orders=[],onOrder,data,now,busy,demo,pendingAI,perform,onOpen,navigate,onCreate,onAsk,onCalendar,onProposal,onReview,onTimeSettings}:Props){
 const d=useMemo(()=>workspaceDashboard(data,now),[data,now]);
 const primary=d.chief.primary;
 const loadSignal=primary.key===`load:${d.today}`;
 const next=d.active??(primary.taskId?data.tasks.find(t=>t.id===primary.taskId):loadSignal?d.ready[0]:undefined);
 const actionableOrders=orders.filter(o=>orderActive(o.status)||(o.status==='completed'&&o.review!=='accepted')).sort((a,b)=>Number(b.status==='waiting_for_approval')-Number(a.status==='waiting_for_approval')||Number(b.status==='completed')-Number(a.status==='completed')||b.updatedAt.localeCompare(a.updatedAt));
 const timeCard=<TimeBudget state={d.chief} embedded={false} disabled={demo} onCalendar={()=>onCalendar(d.today)} onSettings={onTimeSettings} onTask={id=>onOpen({kind:'task',id})} onAdjust={()=>onAsk(`오늘 일정에 없는 할 일 예상 ${d.chief.demand}분, 쓸 수 있는 시간 ${d.chief.capacity}분을 기준으로 오늘 할 일을 조정해 줘. 반드시 할 일, 미룰 일, 위임할 일을 구분하고 변경 전 승인할 수 있게 제안해 줘.`)}/>;
 const ready=next?questReadiness(data,next,d.today):null;
 const experiments=experimentsToReview(data,d.today);
 const plans=data.proposals.filter(p=>p.items.some(i=>i.state==='pending')).sort((a,b)=>a.date.localeCompare(b.date));
 const minutes=Number(new Intl.DateTimeFormat('en-GB',{timeZone:data.preferences.timeZone,hour:'2-digit',hourCycle:'h23'}).format(now))*60+Number(new Intl.DateTimeFormat('en-GB',{timeZone:data.preferences.timeZone,minute:'2-digit'}).format(now));
 const protectedTime=Array.from({length:8},(_,i)=>protectedEvents(data,addDays(d.today,i))).flat();
 const events=[...d.todayEvents,...d.upcoming,...protectedTime].filter(e=>e.date>d.today||e.end>minutes).sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start).slice(0,3);
 const priorities=[...d.focusTasks.filter(t=>t.status!=='done'),...d.ready].filter((t,i,list)=>list.findIndex(x=>x.id===t.id)===i).slice(0,3);
 const registered=d.projects.reduce((sum,p)=>sum+p.total,0),finished=d.projects.reduce((sum,p)=>sum+p.done,0);
 const progress=registered?Math.round(finished/registered*100):0;
 const weekMax=Math.max(1,...d.week.map(day=>day.count)),weekTotal=d.week.reduce((sum,day)=>sum+day.count,0);
 return <div className="today-home mission-dashboard">
  <div className="mission-overview execution-overview">
  <section className={`today-next mission-hero ${loadSignal?'has-time-budget':''}`} aria-labelledby="today-next-title">
   <img className="mission-hero-art" src={illustrationTheme(screenIllustration(data.preferences,'today')).image} width="1536" height="864" alt="" fetchPriority="high"/>
   <div className="mission-copy">
   <span className="today-eyebrow"><Orbit size={16}/> TODAY’S MISSION</span>{!loadSignal&&<p className="mission-intro">{d.active?'몰입의 궤도를 이어가세요':'오늘, 한 걸음 더 멀리'}</p>}
   <h2 id="today-next-title">{next?.title??primary.title}</h2>
   <p className="mission-reason">{primary.reason}</p>
   {next&&<div className="today-meta"><span>{data.projects.find(p=>p.id===next.projectId)?.name??'개인'}</span><span><Clock3 size={15}/>{next.duration}분</span></div>}
   {<div className="today-actions">
    {next&&!d.active&&!ready?.canStart?<button className="primary-button" onClick={()=>onOpen({kind:'task',id:next.id})}>{primary.kind==='followup'?'대기 조건 확인':'시작 조건 확인'}<ArrowRight size={17}/></button>:next?<button className="primary-button" disabled={busy||demo||(!d.active&&!ready?.canStart)} onClick={async()=>{if(d.active||await perform({type:'task.start',id:next.id},'집중을 시작했습니다.'))onOpen({kind:'task',id:next.id})}}><Play size={17}/>{d.active?'이어서 하기':'집중 시작'}</button>:primary.kind==='care'&&primary.routineId?<button className="primary-button" disabled={busy||demo} onClick={()=>void perform({type:'care.check',id:primary.routineId!,checked:true},'오늘의 실천을 기록했습니다.')}><Check size={17}/>실천 완료</button>:<button className="primary-button" disabled={demo} onClick={()=>onAsk(primary.ask)}>Orbit과 정리하기<ArrowRight size={17}/></button>}
    {next&&primary.kind==='followup'&&<button className="text-button" disabled={demo} onClick={()=>onAsk(primary.ask)}>해결 방법 정리</button>}{next&&<button className="text-button" onClick={()=>onOpen({kind:'task',id:next.id})}>내용 보기</button>}
   </div>
   }
   {next&&!ready?.canStart&&!d.active&&<p className="form-hint">{ready?.reason}</p>}
   </div>
  </section>

  </div>
  <AiHoldBanner demo={demo} timeZone={data.preferences.timeZone} onPlan={()=>onProposal(d.today)} onNote={id=>onOpen({kind:'note',id})}/>
  {(plans.length>0||(pendingAI??0)>0||experiments.length>0)&&<section className="today-review" aria-label="확인할 제안"><h2>확인할 제안</h2>{experiments.length>0&&<button className="today-row" onClick={()=>navigate('experiments')}><span><strong>검토할 실험 {experiments.length}개</strong><small>결과를 기록하고 계속 적용·재시도·중단을 정하세요</small></span><ChevronRight size={19}/></button>}{(pendingAI??0)>0&&<button className="today-row" onClick={onReview}><span><strong>Orbit 제안 {pendingAI}개</strong><small>변경 내용을 확인하고 반영하세요</small></span><ChevronRight size={19}/></button>}{plans.slice(0,2).map(p=><button key={p.id} className="today-row" onClick={()=>onProposal(p.date)}><span><strong>{p.date===d.today?'오늘':p.date} 일정 제안</strong><small>{p.items.filter(i=>i.state==='pending').length}개 확인 필요</small></span><ChevronRight size={19}/></button>)}</section>}
  <div className="today-columns">
   <section className="today-section"><div className="section-title"><h2>오늘의 할 일</h2><button className="text-button" onClick={()=>navigate('tasks')}>전체 보기<ChevronRight size={15}/></button></div>{priorities.length?priorities.map(t=><button key={t.id} className="today-row" onClick={()=>onOpen({kind:'task',id:t.id})}><span><strong>{t.title}</strong><small>{t.startedAt?'진행 중':questReadiness(data,t,d.today).reason} · {t.duration}분</small></span><ChevronRight size={19}/></button>):<p className="today-empty">지금 시작할 일이 없어요. 할 일을 추가하거나 Orbit과 정리해 보세요.</p>}<button className="text-button today-add" disabled={busy||demo} onClick={onCreate}><Plus size={16}/>{data.projects.length?'할 일 추가':'프로젝트 추가'}</button>{d.attention.length>0&&<details className="today-attention"><summary>다시 확인할 일 {d.attention.length}개</summary>{d.attention.slice(0,5).map(t=><button key={t.id} className="today-row" onClick={()=>onOpen({kind:'task',id:t.id})}><span><strong>{t.title}</strong><small>{t.due<d.today?'기한 지남 · ':''}{questReadiness(data,t,d.today).reason}</small></span><ChevronRight size={18}/></button>)}</details>}</section>
   <section className="today-section mission-agenda"><div className="section-title"><h2>다가오는 일정</h2><button className="text-button" onClick={()=>onCalendar(d.today)}>전체 일정<ChevronRight size={15}/></button></div>{events.length?events.map(e=><button key={e.id} className="today-row" onClick={()=>e.id.startsWith('protected:')?navigate('portfolio'):onOpen({kind:'event',id:e.id})}><span className="mission-event-time">{formatTime(e.start)}<small>{e.date===d.today?'오늘':e.date.slice(5).replace('-','/')}</small></span><span><strong>{e.title}</strong><small>{e.date===d.today?'오늘':e.date} · {formatTime(e.start)}–{formatTime(e.end)}</small></span></button>):<p className="today-empty">저장된 다음 일정이 없어요.</p>}</section>
  </div>
  {actionableOrders.length>0&&<section className="today-review" aria-label="맡긴 업무"><div className="section-title"><h2>맡긴 업무 · 다음 확인</h2><button className="text-button" onClick={()=>onOrder?.()}>전체 보기</button></div>{actionableOrders.slice(0,3).map(o=><button key={o.id} className="today-row" onClick={()=>onOrder?.(o.id)}><span><strong>{o.title}</strong><small>{o.status==='completed'?(o.review==='needs_work'?'보완 실행이 필요해요':'결과를 확인해 주세요'):orderStatusLabel[o.status]}</small></span><ChevronRight size={19}/></button>)}</section>}
  {timeCard}
  <div className="mission-stats" aria-label="오늘의 현황">
   <button onClick={()=>navigate('projects')}><span className="mission-stat-icon violet"><Orbit size={20}/></span><span>진행 중 프로젝트<strong>{d.projects.length}<small>개</small></strong></span><ArrowUpRight size={18}/></button>
   <button onClick={()=>navigate('review')}><span className="mission-stat-icon mint"><CheckCheck size={20}/></span><span>오늘 완료<strong>{d.completed.length}<small>개</small></strong></span><ArrowUpRight size={18}/></button>
   <button onClick={()=>navigate('tasks')}><span className="mission-stat-icon peach"><Flag size={20}/></span><span>확인할 할 일<strong>{d.attention.length}<small>개</small></strong></span><ArrowUpRight size={18}/></button>
  </div>
  <section className="today-section today-projects" aria-labelledby="today-projects-title">
   <div className="section-title"><h2 id="today-projects-title">진행 중인 프로젝트 <span>{d.projects.length}</span></h2><button className="text-button" onClick={()=>navigate('projects')}>프로젝트 관리<ChevronRight size={15}/></button></div>
   <div className="today-project-grid">{d.projects.slice(0,4).map(({project:p,total,done})=><button className="today-project-card" key={p.id} onClick={()=>onOpen({kind:'project',id:p.id})}>
    <img className="today-project-art" src={projectWorld(p.id,data.preferences).image} width="960" height="720" loading="lazy" alt=""/><div className="today-project-name"><strong>{p.name}</strong><ArrowUpRight size={18}/></div><span>{p.due.slice(5).replace('-','/')} 목표 · {total?`${done}/${total} 완료`:'첫 할 일을 정해 보세요'}</span>
    <Progress value={total?done/total*100:0} aria-label={`${p.name} 등록 업무 ${done}/${total} 완료`}/>
   </button>)}</div>
   {!d.projects.length&&<p className="today-empty">진행 중인 프로젝트가 없어요. 프로젝트 관리에서 새로 시작하거나 완료된 결과를 확인하세요.</p>}
   {d.projects.length>4&&<button className="text-button today-add" onClick={()=>navigate('projects')}>진행 중인 프로젝트 {d.projects.length}개 모두 보기<ChevronRight size={15}/></button>}
  </section>

  <details className="workspace-more"><summary>나의 진행 상황 · 최근 7일</summary>  <section className="mission-pulse" aria-labelledby="mission-pulse-title">
   <div className="section-title"><h2 id="mission-pulse-title">나의 진행 상황</h2><Orbit size={18}/></div>
   <div className="mission-progress"><div className="mission-ring" style={{'--progress':`${progress}%`} as CSSProperties} role="img" aria-label={`진행 중 프로젝트의 등록 할 일 ${finished}/${registered} 완료, ${progress}%`}><div><strong>{registered?progress:'—'}<small>{registered?'%':''}</small></strong><span>등록 할 일 완료</span></div></div><div className="mission-progress-detail"><strong>{finished}<span> / {registered}</span></strong><p>진행 중 프로젝트<br/>등록 할 일</p><button className="text-button" onClick={()=>navigate('projects')}>프로젝트 보기<ArrowUpRight size={16}/></button></div></div>
   <div className="mission-week-heading"><span>최근 7일 완료</span><strong>{weekTotal}개</strong></div>
   <div className="mission-week" role="img" aria-label={`최근 7일 완료한 할 일: ${d.week.map(day=>`${day.date} ${day.count}개`).join(', ')}`}>
    {d.week.map((day,i)=><div key={day.date} className={i===6?'is-today':''}><span className="mission-bar-track"><span style={{height:`${day.count/weekMax*100}%`}}/></span><span data-label={day.date.slice(8)}>{i===6?'오늘':day.date.slice(5).replace('-','/')}</span></div>)}
   </div>
  </section></details>
  <section className="today-evening"><div><h2>{minutes>=1080?'하루를 마무리할까요?':'내일을 준비하기'}</h2><p>오늘 완료한 일 {d.completed.length}개</p></div><button className="secondary-button" onClick={()=>navigate('review')}><Moon size={16}/>하루 회고</button><button className="text-button" onClick={()=>navigate('proposal')}>내일 계획</button></section>
  <details className="workspace-more"><summary>집중과 돌아보기</summary><div className="workspace-links"><button onClick={()=>navigate('dashboard')}>전체 현황·관계 보기</button><button onClick={()=>navigate('voice')}>브리핑 듣기</button><button onClick={()=>navigate('sound')}><Headphones size={16}/>집중 사운드</button><button onClick={()=>navigate('monthly')}>월간 돌아보기</button><button onClick={()=>navigate('learning')}>계획 개선 기록</button></div></details>
 </div>;
}
