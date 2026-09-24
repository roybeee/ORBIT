'use client';
// Records tab card for the Slack GoTEM loop effect check (GET /api/gotem/metrics, owner only).
import {useEffect,useState} from 'react';
import {BellRing} from 'lucide-react';
import {agentRequest} from '@/components/orbit/agent/connections';
import type {GotemMetrics,MorningDay} from '@/lib/orbit/slack/gotem-metrics';

const shortDate=(date:string)=>`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`;
function dayState(d:MorningDay){return d.minutes===null?'is-none':d.within60?'is-within':'is-late'}

export function GotemMetricsView({metrics}:{metrics:GotemMetrics}){
 const {morning,carry}=metrics;
 return <section className="gotem-metrics" aria-labelledby="gotem-metrics-title">
  <div className="gotem-metrics-heading"><BellRing size={18} aria-hidden="true"/><div><strong id="gotem-metrics-title">Slack 알림 효과</strong><p>최근 14일 · {shortDate(metrics.from)}–{shortDate(metrics.to)}</p></div></div>
  <div className="gotem-metric">
   <span>오전 메시지 후 60분 안 시작</span>
   {morning.sent?<strong>{morning.rate}% <small>{morning.within60}/{morning.sent}일</small></strong>:<p className="muted">아직 발송된 오전 메시지가 없어요.</p>}
   {morning.medianMinutes!==null&&<p className="muted">시작까지 중앙값 {morning.medianMinutes}분 · 시작한 날 {morning.started}일</p>}
   {morning.days.length>0&&<ul className="gotem-days" aria-label="오전 메시지별 시작">{morning.days.map(d=><li key={d.date} className={`gotem-day ${dayState(d)}`}>{shortDate(d.date)}<b>{d.minutes===null?'시작 없음':`${d.minutes}분`}</b></li>)}</ul>}
  </div>
  <div className="gotem-metric">
   <span>회고 개선점 반영</span>
   {carry.eligible?<strong>{carry.rate}% <small>{carry.reflected}/{carry.eligible}건</small></strong>:<p className="muted">개선점을 적은 회고가 다음 날 아침이 지나면 계산돼요.</p>}
  </div>
  <p className="muted gotem-metrics-note">메시지에 적힌 1순위 업무를 시작한 시각 기준입니다. 이전 GoTEM 메시지의 기준값은 없고, 기록은 9/25부터 쌓입니다.</p>
 </section>;
}

export function GotemMetricsCard(){
 const [metrics,setMetrics]=useState<GotemMetrics|null>(null);
 const [failed,setFailed]=useState(false);
 useEffect(()=>{
  let active=true;
  void agentRequest('/api/gotem/metrics')
   .then((m:GotemMetrics)=>{if(active)setMetrics(m)})
   .catch(()=>{if(active)setFailed(true)});
  return()=>{active=false};
 },[]);
 if(failed)return <section className="gotem-metrics" role="status"><p className="muted">Slack 알림 효과를 불러오지 못했어요. 잠시 후 다시 열어 주세요.</p></section>;
 if(!metrics)return null;
 return <GotemMetricsView metrics={metrics}/>;
}
