'use client';
import {LoaderCircle} from 'lucide-react';
import {useState} from 'react';
import {toast} from 'sonner';
import type {AgentAction} from '@/lib/orbit/agent/types';
import {scopedRequest} from '@/lib/orbit/agent/client-request';
import {bulkReject,meetingRejectIds} from '@/lib/orbit/meeting-decisions';
import {agentRequest} from '../agent/connections';
import {agentRefresh} from '../agent/refresh';

interface Props {meetings:readonly string[];items:readonly AgentAction[];picked:ReadonlySet<string>;onPick:(next:Set<string>)=>void}

// Above the meeting groups: whole meetings, collapsed or open, are picked by their header checkbox
// and every open card in them is rejected in one server call (two clicks, like 나머지 반려).
export function MeetingBulkReject({meetings,items,picked,onPick}:Props){
 const [confirm,setConfirm]=useState(false);
 const [running,setRunning]=useState(false);
 const chosen=new Set(meetings.filter(id=>picked.has(id)));
 const ids=meetingRejectIds(items,chosen);
 const all=meetings.length>0&&chosen.size===meetings.length;
 const label=`선택한 회의 ${chosen.size}개 · 결재안 ${ids.length}건 반려`;

 async function reject(){
  setRunning(true);
  try{
   const {rejected,skipped}=await bulkReject(ids,scopedRequest(agentRequest));
   toast([`반려 ${rejected}건`,skipped?`이미 처리된 ${skipped}건 제외`:''].filter(Boolean).join(' · '));
   onPick(new Set());
  }catch(error){toast(error instanceof Error?error.message:'반려하지 못했습니다. 다시 시도해 주세요.')}
  finally{
   setConfirm(false);
   await agentRefresh().catch(()=>toast('목록을 새로 불러오지 못했습니다. 잠시 후 다시 열어 주세요.'));
   setRunning(false);
  }
 }

 return <div className="decision-bulk meeting-bulk-reject" aria-label="회의 단위 일괄 반려">
  <label className="decision-select-all"><input type="checkbox" checked={all} disabled={running||!meetings.length} onChange={()=>{setConfirm(false);onPick(all?new Set():new Set(meetings))}}/> 모든 회의 선택</label>
  <button className={'secondary-button'+(confirm?' decision-reject-confirm':'')} disabled={running||!ids.length} onClick={()=>{if(!confirm){setConfirm(true);return}void reject()}}>{running&&<LoaderCircle size={15} className="animate-spin"/>}{confirm?'한 번 더 누르면 '+label:label}</button>
  {confirm&&!running&&<button className="text-button" onClick={()=>setConfirm(false)}>취소</button>}
 </div>;
}
