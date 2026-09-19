'use client';
import {useEffect,useState} from 'react';
import {agentRequest} from './connections';
import type {CalendarExport} from '@/lib/orbit/agent/calendar-export';
export function CalendarSelection(){const [items,setItems]=useState<{id:string;label:string;primary:boolean}[]>([]),[ids,setIds]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');useEffect(()=>{void agentRequest('/api/integrations/calendars').then(r=>{setItems(r.calendars);setIds(r.selectedIds)}).catch(e=>setMessage(e.message))},[]);return <div className="calendar-selection"><p>일정에 표시할 캘린더 · 최대 10개</p>{items.map(c=><label key={c.id}><input type="checkbox" checked={ids.includes(c.id)} disabled={busy} onChange={e=>setIds(old=>e.target.checked?[...old,c.id]:old.filter(id=>id!==c.id))}/>{c.label}{c.primary?' · 기본':''}</label>)}<button className="secondary-button" disabled={busy||!ids.length||ids.length>10} onClick={async()=>{setBusy(true);try{const r=await agentRequest('/api/integrations/calendars','PUT',{ids});setMessage(r.count+'개 일정을 동기화했습니다.')}catch(e){setMessage(e instanceof Error?e.message:'동기화 실패')}finally{setBusy(false)}}}>선택 저장 · 동기화</button>{message&&<p role="status">{message}</p>}</div>}
export function CalendarEventDelivery({eventId,demo,allowManual=false}:{eventId:string;demo:boolean;allowManual?:boolean}){
 const [receipt,setReceipt]=useState<CalendarExport>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(demo)return;let alive=true,timer:ReturnType<typeof setTimeout>;
  const load=async()=>{try{const r=await agentRequest('/api/integrations/calendar-exports');if(alive)setReceipt(r.exports.find((e:CalendarExport)=>e.eventId===eventId))}catch{}finally{if(alive)timer=setTimeout(load,5000)}};
  void load();return()=>{alive=false;clearTimeout(timer)};
 },[eventId,demo]);
 if(!receipt&&!allowManual)return null;
 return <div className="focus-calendar-receipt">
  {receipt&&<small role="status">{receipt.status==='verified'?'Google 등록 완료':receipt.status==='pending'||receipt.status==='publishing'?'ORBIT 저장 완료 · Google 반영 중':receipt.status==='cancelled'?'Google 등록 중단':'ORBIT 저장 완료 · Google 반영 확인 필요'}</small>}
  {receipt?.message&&receipt.status==='uncertain'&&<p role="alert">{receipt.message}</p>}
  <button className="text-button" disabled={demo||busy||receipt?.status==='publishing'} onClick={async()=>{setBusy(true);setError('');try{setReceipt(await agentRequest('/api/integrations/calendar-exports','POST',{eventId}))}catch(e){setError(e instanceof Error?e.message:'등록 결과 확인 필요')}finally{setBusy(false)}}}>{busy?'Google 확인 중…':receipt?.status==='verified'?'등록 상태 확인':receipt?'등록 다시 확인':'Google에도 등록'}</button>
  {receipt?.status==='verified'&&<small>ORBIT에서 삭제하거나 승인을 취소해도 Google 일정은 유지됩니다.</small>}
  {receipt?.url&&/^https:\/\/(calendar\.google\.com|www\.google\.com)\//.test(receipt.url)&&<a href={receipt.url} target="_blank" rel="noreferrer">Google에서 보기</a>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
export function FocusCalendarButton(props:{eventId:string;demo:boolean}){return <CalendarEventDelivery {...props} allowManual/>}
