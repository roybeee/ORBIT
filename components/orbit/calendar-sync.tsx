'use client';
import {useEffect,useRef,useState} from 'react';
import {CalendarDays,RefreshCw,Link2} from 'lucide-react';
import {Connections,agentRequest} from './agent/connections';
import {createCalendarLiveSync,type CalendarSyncResult} from '@/lib/orbit/calendar-live';
import type {Connection} from '@/lib/orbit/agent/types';

export function CalendarSyncStatus({active,demo,loaded,date,timeZone,paused,workspaceBusy,onSynced}:{active:boolean;demo:boolean;loaded:boolean;date:string;timeZone:string;paused:boolean;workspaceBusy:boolean;onSynced:(automatic?:boolean)=>Promise<void>}){
 const [result,setResult]=useState<CalendarSyncResult>(),[checking,setChecking]=useState(false),[error,setError]=useState('');
 const [connections,setConnections]=useState<Connection[]|null>(null),[opening,setOpening]=useState(false);
 const context=useRef({active,demo,loaded,date,paused,workspaceBusy,onSynced,settings:!!connections});
 context.current={active,demo,loaded,date,paused,workspaceBusy,onSynced,settings:!!connections};
 const poller=useRef<ReturnType<typeof createCalendarLiveSync>|null>(null);
 useEffect(()=>{
  const sync=createCalendarLiveSync({
   context:()=>{const c=context.current;return {enabled:c.active&&c.loaded&&!c.demo,paused:c.paused||c.workspaceBusy||c.settings,visible:document.visibilityState==='visible',online:navigator.onLine,date:c.date}},
   request:day=>agentRequest('/api/integrations/sync','POST',{date:day}),
   onStart:()=>setChecking(true),
   onSuccess:async value=>{setResult(value);setError('');const c=context.current;if(value.connected&&!c.paused&&!c.workspaceBusy&&!c.settings)await c.onSynced(true)},
   onError:e=>setError(e instanceof Error?e.message:'Google 일정을 확인하지 못했습니다. 다시 시도해 주세요.'),
   onSettled:()=>setChecking(false),
  });
  poller.current=sync;
  const resume=()=>{void sync.wake()};
  window.addEventListener('focus',resume);window.addEventListener('online',resume);window.addEventListener('orbit:calendar-changed',resume);document.addEventListener('visibilitychange',resume);
  return()=>{sync.stop();poller.current=null;window.removeEventListener('focus',resume);window.removeEventListener('online',resume);window.removeEventListener('orbit:calendar-changed',resume);document.removeEventListener('visibilitychange',resume)};
 },[]);
 useEffect(()=>{void poller.current?.wake()},[active,demo,loaded,date,paused,connections]);
 async function loadConnections(){const response=await agentRequest('/api/integrations');setConnections(response.connections)}
 async function openConnections(){setOpening(true);try{await loadConnections()}catch(e){setError(e instanceof Error?e.message:'연결 설정을 열지 못했습니다.')}finally{setOpening(false)}}
 if(!active)return null;
 const lastChecked=result?.updatedAt?new Date(result.updatedAt).toLocaleTimeString('ko-KR',{timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';
 return <>
  <section className="calendar-sync-panel calendar-sync-compact" aria-label="Google 캘린더 동기화">
   <div className="calendar-sync-line"><CalendarDays size={18}/><strong>Google 캘린더</strong><span role="status">{demo?'체험 중':error||result?.delivery?.failed?'확인 필요':!loaded||(!result&&checking)?'연결 확인 중':result?.connected===false?'연결 필요':result?.delivery?.pending?'반영 중':result?.connected?'연결됨':'연결 확인 대기'}</span>
    <button className="icon-button" aria-label="Google 일정 새로고침" title="새로고침" disabled={demo||!loaded||checking||paused||workspaceBusy} onClick={()=>void poller.current?.wake()}><RefreshCw size={16} className={checking?'animate-spin':''}/></button>
   </div>
   <details className="calendar-sync-details"><summary>동기화 상세</summary><div className="calendar-sync-copy">
    <p>{demo?'예시 일정입니다.':checking?'변경된 일정을 확인하는 중…':paused?'시간 변경 후 자동으로 동기화합니다.':result?.connected===false?'Google 계정을 연결하면 저장한 일정도 자동 등록됩니다.':'일정과 색상 변경을 Google에도 반영합니다.'}</p>
    {lastChecked&&<p>마지막 확인 {lastChecked}</p>}
    {!!result?.delivery?.pending&&<p>Google 반영 대기 {result.delivery.pending}건</p>}
    <button className="text-button" disabled={demo||!loaded||opening} onClick={()=>void openConnections()}><Link2 size={16}/>{opening?'여는 중…':result?.connected===false?'Google 연결':'연결 관리'}</button>
   </div></details>
   {(error||result?.delivery?.message)&&<p role="alert" className="calendar-sync-error">{error||result?.delivery?.message} ORBIT 일정은 유지됩니다.</p>}
   {!demo&&result?.connected===false&&<button className="text-button" disabled={opening} onClick={()=>void openConnections()}>Google 연결하기</button>}
  </section>
  {connections&&<Connections calendarOnly connections={connections} onClose={()=>setConnections(null)} onChange={loadConnections}/>}
 </>;
}
