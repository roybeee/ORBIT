'use client';
import {useEffect,useState} from 'react';
import {clientRequest} from '@/lib/orbit/agent/client-request';
import {DEFAULT_EVENING_HOUR} from '@/lib/orbit/day-mode';

type RuntimeStatus={config?:{eveningHour?:unknown}};
const hourOf=(status:RuntimeStatus|undefined)=>{const value=status?.config?.eveningHour;return typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=23?value:null;};

// The owner's "내일 제안 준비 시각" (나 → 자동 실행). Falls back to the server default and
// follows changes saved in the runtime panel without a reload.
export function useEveningHour(demo:boolean){
 const [hour,setHour]=useState(DEFAULT_EVENING_HOUR);
 useEffect(()=>{
  if(demo)return;
  const controller=new AbortController();
  clientRequest('/api/runtime','GET',undefined,{fetcher:(input,init)=>fetch(input,{...init,signal:controller.signal})}).then((status:RuntimeStatus)=>{const value=hourOf(status);if(value!==null)setHour(value);}).catch(()=>{});
  const updated=(event:Event)=>{const value=hourOf((event as CustomEvent<RuntimeStatus>).detail);if(value!==null)setHour(value);};
  window.addEventListener('orbit:runtime-updated',updated);
  return()=>{controller.abort();window.removeEventListener('orbit:runtime-updated',updated);};
 },[demo]);
 return hour;
}
