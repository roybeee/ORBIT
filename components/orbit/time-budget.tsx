'use client';
import {useId} from 'react';
import {ArrowRight,CalendarDays,Clock3,Settings2} from 'lucide-react';
import type {chiefOfStaff} from '@/lib/orbit/chief';
import {durationText,formatTime} from '@/lib/orbit/model';

type Props={state:ReturnType<typeof chiefOfStaff>;onCalendar:()=>void;onAdjust:()=>void;onSettings:()=>void;onTask:(id:string)=>void;disabled?:boolean;embedded?:boolean;className?:string};
export function TimeBudget({state,onCalendar,onAdjust,onSettings,onTask,disabled=false,embedded=false,className=''}:Props){
 const heading=useId(),{timeBudget:b,capacity,demand}=state;
 const canPlan=b.phase==='open'||b.phase==='before',difference=capacity-demand;
 const over=canPlan&&difference<0,max=Math.max(1,demand,capacity);
 const overdue=b.tasks.filter(t=>t.overdue).length;
 const status=b.phase==='off'?'오늘은 설정한 쉬는 날이에요':b.phase==='ended'?'오늘 업무 시간이 끝났어요':!demand?'추가로 배치할 할 일이 없어요':over?`${durationText(-difference)} 조정이 필요해요`:difference===0?'남은 시간에 맞게 채워져 있어요':`${durationText(difference)} 여유가 있어요`;
 return <section className={`time-budget ${over?'is-over':'is-calm'} ${embedded?'is-embedded':''} ${className}`} aria-labelledby={heading}>
  <div className="time-budget-heading"><h3 id={heading}><Clock3 size={18}/>오늘의 시간</h3><span>예상</span></div>
  <p className="time-budget-window">{b.phase==='off'?'설정한 업무일이 아닙니다':b.phase==='ended'?`${formatTime(b.end)} 업무 종료`:`${formatTime(b.start)}–${formatTime(b.end)}${b.phase==='before'?' 업무 시작 전':' · 지금부터'}`}</p>
  <div className="time-budget-metrics">
   <div><span>할 일 예상</span><strong>{durationText(demand)}</strong><div className="time-budget-track" aria-hidden="true"><i className="time-budget-demand" style={{width:`${demand/max*100}%`}}/></div><small>일정에 없는 {b.tasks.length}개{overdue>0?` · 기한 지난 ${overdue}개 포함`:''}</small></div>
   <div><span>쓸 수 있는 시간</span><strong>{durationText(capacity)}</strong><div className="time-budget-track" aria-hidden="true"><i className="time-budget-capacity" style={{width:`${capacity/max*100}%`}}/></div><small>일정·휴식·여유분 제외</small></div>
  </div>
  <p className="time-budget-status">{status}</p>
  <details className="time-budget-details"><summary>계산 근거 · 포함된 할 일</summary>
   <dl><div><dt>계산 구간의 업무 시간</dt><dd>{durationText(b.windowMinutes)}</dd></div><div><dt>일정·점심·이동·보호 시간</dt><dd>− {durationText(b.occupiedMinutes)}</dd></div><div><dt>비워 둘 여유분</dt><dd>− {durationText(b.bufferMinutes)}</dd></div><div className="time-budget-total"><dt>할 일에 쓸 수 있는 시간</dt><dd>{durationText(capacity)}</dd></div></dl>
   <p>등록된 예상 시간 기준입니다. 오늘 지정한 일과 기한 지난 실행 가능한 일 중, 오늘 일정에 연결된 일은 제외합니다. 실제 진행률을 측정한 값은 아닙니다.</p>
   {b.tasks.length>0&&<ul>{b.tasks.map(t=><li key={t.id}><button onClick={()=>onTask(t.id)}><span>{t.title}{t.overdue&&<small>기한 지남</small>}</span><strong>{durationText(t.minutes)}</strong></button></li>)}</ul>}
   <button className="text-button" onClick={onSettings}><Settings2 size={16}/>업무 시간·여유분 설정</button>
  </details>
  <div className="time-budget-actions">{over&&<button className="primary-button" disabled={disabled} onClick={onAdjust}>오늘 할 일 조정<ArrowRight size={17}/></button>}<button className="secondary-button" onClick={canPlan?onCalendar:onSettings}>{canPlan?<CalendarDays size={17}/>:<Settings2 size={17}/>}{canPlan?'일정 확인':'업무 시간 설정'}</button></div>
 </section>;
}
