'use client';
import type {WorkspaceData,Proposal} from '@/lib/orbit/model';
import type {WorkspaceAction} from '@/lib/orbit/validation';
// Which of the owner's rules shaped this plan, the experience each came from, and a way to retire it.
// Engine rules are applied by Orbit's scheduler; cited rules are the ones the one-page analysis named.
export function AppliedRules({data,plan,busy,perform,onExperiments}:{data:WorkspaceData;plan:Proposal;busy:boolean;perform:(a:WorkspaceAction,m?:string)=>Promise<boolean>;onExperiments:()=>void}){
 const cited=(plan.brief?.evidence??[]).filter(e=>e.kind==='rule').map(e=>e.recordId);
 const ids=[...new Set([...(plan.rules??[]).map(r=>r.id),...cited])];
 if(!ids.length)return null;
 return <section className="brief-progress-notes" aria-label="이 계획에 적용한 규칙"><h3>이 계획에 적용한 규칙 ★</h3>{ids.map(id=>{
  const rule=(data.improvements??[]).find(i=>i.id===id),engine=plan.rules?.find(r=>r.id===id),experiment=(data.experiments??[]).find(x=>x.id===(rule?.experimentId??engine?.experimentId));
  return <div key={id}><p>{rule?.rule??engine?.rule??id}</p>
   {engine&&<small>{engine.meetings?`회의 ${engine.meetings}개 뒤에 ${engine.minutes}분씩 비워 두고 시간을 배치했습니다.`:'이 날은 회의가 없어 비워 둘 곳이 없었습니다.'}</small>}
   {cited.includes(id)&&<small> 원페이지 분석이 이 규칙을 근거로 인용했습니다.</small>}
   <p>{experiment?<>근거: 실험 ‘{experiment.title}’ 결과를 보고 채택 <button className="text-button" onClick={onExperiments}>실험 결과 보기</button></>:'근거: 직접 정한 규칙'}</p>
   {rule?.active?<button className="text-button" disabled={busy} onClick={()=>void perform({type:'improvement.retire',id},'규칙을 해제했습니다. 이 계획에서도 빼려면 다시 분석하거나 계획을 다시 만들어 주세요.')}>이 규칙 해제</button>:<small>해제한 규칙입니다. 다음에 만드는 계획부터 적용하지 않습니다.</small>}
  </div>})}</section>;
}
