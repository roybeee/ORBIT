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
  window.addEventListener('focus',resume);window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
  return()=>{sync.stop();poller.current=null;window.removeEventListener('focus',resume);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume)};
 },[]);
 useEffect(()=>{void poller.current?.wake()},[active,demo,loaded,date,paused,connections]);
 async function loadConnections(){const response=await agentRequest('/api/integrations');setConnections(response.connections)}
 async function openConnections(){setOpening(true);try{await loadConnections()}catch(e){setError(e instanceof Error?e.message:'연결 설정을 열지 못했습니다.')}finally{setOpening(false)}}
 if(!active)return null;
 const lastChecked=result?.updatedAt?new Date(result.updatedAt).toLocaleTimeString('ko-KR',{timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';
 return <>
  <section className="calendar-sync-panel" aria-label="Google 캘린더 동기화">
   <div className="calendar-sync-copy"><strong><CalendarDays size={19}/>Google 캘린더</strong>
    <p role="status">{demo?'예시 일정입니다. 내 계정에서 Google 캘린더를 연결할 수 있습니다.':!loaded?'저장된 일정을 불러오는 중…':checking?'변경된 일정을 확인하는 중…':paused?'작성 중인 내용을 저장하면 자동 갱신을 이어갑니다.':result?.connected===false?'Google 계정을 연결하면 일정이 자동으로 갱신됩니다.':'화면을 보는 동안 자동 갱신 · 30초 간격'}</p>
    {lastChecked&&<p>Google 확인 {lastChecked}</p>}
    {error&&<p role="alert" className="calendar-sync-error">{error} 저장된 일정은 유지됩니다.</p>}
   </div>
   <div className="calendar-sync-actions"><button className="secondary-button" disabled={demo||!loaded||checking||paused||workspaceBusy} onClick={()=>void poller.current?.wake()}><RefreshCw size={16} className={checking?'animate-spin':''}/>새로고침</button><button className="secondary-button" disabled={demo||!loaded||opening||checking} onClick={()=>void openConnections()}><Link2 size={16}/>{opening?'여는 중…':result?.connected===false?'Google 연결':'연결 관리'}</button></div>
  </section>
  {connections&&<Connections calendarOnly connections={connections} onClose={()=>setConnections(null)} onChange={loadConnections}/>}
 </>;
}
