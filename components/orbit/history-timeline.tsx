'use client';
import {useMemo,useState} from 'react';
import {CalendarDays,CheckCheck,CircleDashed,FileText,Flag,Heart,History,MessagesSquare,Moon,PenLine,Repeat,Search} from 'lucide-react';
import {historyFeed,historyKindLabel,type HistoryFilter,type HistoryItem,type HistoryKind} from '@/lib/orbit/history';
import {durationText,formatTime,type WorkspaceData} from '@/lib/orbit/model';
import {koreanDate} from '@/lib/orbit/dates';

const icons:Record<HistoryKind,typeof CheckCheck>={done:CheckCheck,attempt:CircleDashed,meeting:MessagesSquare,note:FileText,event:CalendarDays,review:Moon,decision:Flag,routine:Repeat,habit:Heart};
const filters:[HistoryFilter,string][]=[['all','전체'],['work','실행'],['meetings','회의'],['notes','메모'],['reflection','회고·루틴']];
type Open=(target:{kind:'task'|'note'|'event';id:string})=>void;

// 기록 탭의 첫 화면: what already happened, newest first, gathered from every saved record.
export function HistoryTimeline({data,today,onOpen,onReview,onCapture}:{data:WorkspaceData;today:string;onOpen:Open;onReview:(date:string)=>void;onCapture:()=>void}){
 const [filter,setFilter]=useState<HistoryFilter>('all');
 const [scope,setScope]=useState('');
 const [text,setText]=useState('');
 const [days,setDays]=useState(14);
 const goals=(data.goals??[]).filter(g=>(g.status??'active')!=='achieved');
 const projects=data.projects.filter(p=>p.status!=='completed');
 const result=useMemo(()=>historyFeed(data,{through:today,days,filter,text,...(scope.startsWith('goal:')?{goalId:scope.slice(5)}:scope.startsWith('project:')?{projectId:scope.slice(8)}:{})}),[data,today,days,filter,text,scope]);
 const projectName=(id?:string)=>id?data.projects.find(p=>p.id===id)?.name:undefined;
 const goalName=(id?:string)=>id?data.goals?.find(g=>g.id===id)?.sentence:undefined;
 const open=(item:HistoryItem)=>{if(!item.target)return;if(item.target.kind==='review')onReview(item.target.date);else onOpen(item.target);};
 const totals=result.feed.reduce((s,d)=>({done:s.done+d.done,minutes:s.minutes+d.minutes,meetings:s.meetings+d.meetings}),{done:0,minutes:0,meetings:0});
 return <div className="history-view">
  <div className="history-summary" aria-label="기간 요약">
   <History size={18}/><span><strong>최근 {days}일</strong> · 완료 {totals.done} · 실행 {durationText(totals.minutes)} · 회의 {totals.meetings} · 기록 {result.total}</span>
   <button type="button" className="secondary-button" onClick={onCapture}><PenLine size={15}/>빠른 기록</button>
  </div>
  <div className="history-filters">
   <div className="history-chips" role="radiogroup" aria-label="기록 종류">{filters.map(([id,label])=><button key={id} type="button" role="radio" aria-checked={filter===id} className={filter===id?'is-active':''} onClick={()=>setFilter(id)}>{label}</button>)}</div>
   <select className="form-field" aria-label="목표·프로젝트" value={scope} onChange={e=>setScope(e.target.value)}>
    <option value="">모든 목표·프로젝트</option>
    {goals.length>0&&<optgroup label="목표">{goals.map(g=><option key={g.id} value={'goal:'+g.id}>{g.sentence}</option>)}</optgroup>}
    <optgroup label="프로젝트">{projects.map(p=><option key={p.id} value={'project:'+p.id}>{p.name}</option>)}</optgroup>
   </select>
   <label className="history-search"><Search size={15}/><input value={text} onChange={e=>setText(e.target.value)} placeholder="기록 안에서 찾기" aria-label="기록 안에서 찾기"/></label>
  </div>
  {result.feed.length?<ol className="history-days">{result.feed.map(day=><li key={day.date} className="history-day">
   <div className="history-day-head"><h3>{day.date===today?'오늘':koreanDate(day.date)}</h3><span>{[day.done?`완료 ${day.done}`:'',day.minutes?durationText(day.minutes):'',day.meetings?`회의 ${day.meetings}`:''].filter(Boolean).join(' · ')}</span></div>
   <ul>{day.items.map(item=>{const Icon=icons[item.kind];const project=projectName(item.projectId),goal=goalName(item.goalId);
    const body=<><span className={`history-icon is-${item.kind}`}><Icon size={15}/></span><span className="history-main"><span className="history-title"><small>{historyKindLabel[item.kind]}{item.minute!==undefined?` · ${formatTime(item.minute)}`:''}</small>{item.title}</span>{item.detail&&<span className="history-detail">{item.detail}</span>}<span className="history-meta">{[project,goal?`목표: ${goal}`:'',item.minutes?durationText(item.minutes):'',item.source].filter(Boolean).join(' · ')}</span></span></>;
    return <li key={item.id}>{item.target?<button type="button" onClick={()=>open(item)}>{body}</button>:<div>{body}</div>}</li>;})}</ul>
  </li>)}</ol>:<div className="history-empty"><History size={28}/><h3>{text||filter!=='all'||scope?'조건에 맞는 기록이 없습니다':'아직 쌓인 기록이 없습니다'}</h3><p>할 일을 끝내거나, 회의를 기록하거나, 빠른 기록으로 한 줄만 적어도 여기에 날짜별로 쌓입니다. Plaud·Gmail·Google 일정을 연결하면 자동으로 들어옵니다.</p></div>}
  {result.older&&<button type="button" className="secondary-button history-more" onClick={()=>setDays(d=>d+30)}>이전 30일 더 보기</button>}
 </div>;
}
