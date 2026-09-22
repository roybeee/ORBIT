'use client';
import {useEffect,useState} from 'react';
import {agentRequest} from '../agent/connections';
import type {PlanStatus} from '@/lib/orbit/brief/status-model';

// Observes GET /api/brief/status only; it never drives the analysis (daily-brief and the runtime already do).
export function usePlanStatus(demo:boolean):{status:PlanStatus|null;error:string}{
 const [status,setStatus]=useState<PlanStatus|null>(null),[error,setError]=useState('');
 const running=status?.analysis.state==='running';
 useEffect(()=>{
  if(demo)return;
  let active=true;
  const load=async()=>{try{const next=await agentRequest('/api/brief/status') as PlanStatus;if(!active)return;setStatus(next);setError('')}catch(e){if(active)setError(e instanceof Error?e.message:'상태를 불러오지 못했습니다.')}};
  const visible=()=>document.visibilityState==='visible';
  void load();
  const timer=setInterval(()=>{if(visible())void load()},running?5000:30000);
  const onVisibility=()=>{if(visible())void load()};
  document.addEventListener('visibilitychange',onVisibility);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',onVisibility)};
 },[demo,running]);
 return {status,error};
}
