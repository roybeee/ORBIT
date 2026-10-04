'use client';
import {useState} from 'react';
import {X} from 'lucide-react';
import type {WorkspaceAction} from '@/lib/orbit/validation';

export function RejectProposal({date,itemId,disabled,perform}:{date:string;itemId:string;disabled:boolean;perform:(action:WorkspaceAction,message?:string)=>Promise<boolean>}){
 const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[saving,setSaving]=useState(false);
 if(!open)return <button type="button" className="secondary-button" data-testid="reject-proposal" disabled={disabled} onClick={()=>setOpen(true)}><X size={15}/>반려</button>;
 return <form className="inbox-defer" onSubmit={async e=>{
  e.preventDefault();if(saving||disabled)return;setSaving(true);
  try{if(await perform({type:'proposal.reject',date,itemId,reason:reason.trim()},'이 날짜의 제안을 반려했습니다. 원래 할 일과 일정은 유지됩니다.')){setOpen(false);setReason('');}}
  finally{setSaving(false)}
 }}>
  <p>이 날짜의 제안을 종료합니다. 같은 날짜에 대안을 다시 계산해도 다시 제안하지 않으며, 원래 할 일·프로젝트·일정은 삭제하지 않습니다.</p>
  <label>반려 이유 (선택)<textarea className="form-field" data-testid="reject-reason" rows={2} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  <div className="inbox-card-actions"><button className="primary-button" data-testid="confirm-reject-proposal" disabled={disabled||saving}>{saving?'저장 중…':'반려 확정'}</button><button type="button" className="secondary-button" data-testid="cancel-reject-proposal" disabled={saving} onClick={()=>{setOpen(false);setReason('')}}>취소</button></div>
 </form>;
}
