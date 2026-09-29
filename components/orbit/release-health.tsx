'use client';
import {useEffect,useState} from 'react';
import type {Report} from '@/lib/orbit/release/health';
type State={status:'verified'|'failed'|'pending';reason?:string;lastCheck:Report|null;schemaChecks?:Report['checks']};
export function ReleaseHealth({demo}:{demo:boolean}){
 const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function check(run=false){setBusy(true);setError('');try{
  const r=await fetch('/api/release-health',{cache:'no-store',...(run?{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}:{})});
  const result=await r.json();if(!r.ok&&!(run&&r.status===409&&Array.isArray(result.checks)))throw new Error();
  setState(run?{status:result.status,lastCheck:result}:result);
 }catch{setState(null);setError('운영 상태를 읽지 못했습니다. 검증 완료로 처리하지 않습니다.');}finally{setBusy(false)}}
 useEffect(()=>{if(!demo)void check()},[demo]);
 const failed=[...(state?.schemaChecks??[]),...(state?.lastCheck?.checks??[])].filter(c=>c.status!=='passed');
 return <details className="workspace-more"><summary>운영 건강</summary><div className="dialog-form">
  <p role="status">게시됨 · {state?.status==='verified'?'운영 검증 완료':state?.status==='failed'?'운영 계약 실패':'검증 대기'}</p>
  {state?.reason&&<p>{state.reason}</p>}{error&&<p role="alert">{error}</p>}
  <p>마지막 검사: {state?.lastCheck?new Date(state.lastCheck.checkedAt).toLocaleString('ko-KR'):'기록 없음'}</p>
  {state?.lastCheck&&<p>Slack 접수: {state.status==='verified'&&state.lastCheck.features.slackRequests?'준비 완료':'확인 필요'} · GoTEM 측정: {state.status==='verified'&&state.lastCheck.features.gotem?'준비 완료':'확인 필요'}</p>}
  {!!failed.length&&<ul>{[...new Map(failed.map(c=>[c.id,c])).values()].map(c=><li key={c.id}>{c.reason}</li>)}</ul>}
  <button type="button" className="secondary-button" disabled={demo||busy} onClick={()=>void check(true)}>{busy?'검사 중…':'운영 상태 다시 검사'}</button>
 </div></details>;
}
