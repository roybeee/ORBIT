import {readWorkspace,type Database} from '../../../db/repository.ts';
import {dispatchOrder} from './orders.ts';
import {readOrderReview,outputHash} from './order-review.ts';
import type {Runtime} from './integrations.ts';
import {AgentError} from './errors.ts';

export async function dispatchRework(db:Database,owner:string,input:{orderId:string;outputHash:string;reviewHash:string},env:Runtime){
 const receipt=await readOrderReview(db,owner,input.orderId);
 if(receipt.status!=='completed'||receipt.outputHash!==input.outputHash||receipt.review?.verdict!=='needs_work'||receipt.review.stale||receipt.reviewHash!==input.reviewHash)
  throw new AgentError('결과 또는 보완 기준이 변경됐습니다. 최신 검토를 확인해 주세요.','CONFLICT',409);
 const row=await db.prepare('SELECT state_json FROM orbit_agent_orders WHERE owner_id=? AND id=?').bind(owner,input.orderId).first<{state_json:string}>();
 if(!row)throw new AgentError('원래 업무를 찾지 못했습니다.','NOT_FOUND',404);
 const parent=JSON.parse(row.state_json),review=receipt.review;
 const key=await outputHash(JSON.stringify([owner,input.orderId,input.outputHash,input.reviewHash]));
 const id=`${key.slice(0,8)}-${key.slice(8,12)}-5${key.slice(13,16)}-a${key.slice(17,20)}-${key.slice(20,32)}`;
 // Deterministic identity reuses the same correction after retries or lost acknowledgements.
 const data=(await readWorkspace(db,owner)).data;
 const projectId=data.projects.some(p=>p.id===parent.projectId)?parent.projectId:null;
 const taskIds=(parent.taskIds??[]).filter((id:string)=>data.tasks.some(t=>t.id===id&&(!projectId||t.projectId===projectId)));
 const eventIds=(parent.eventIds??[]).filter((id:string)=>data.events.some(e=>e.id===id));
 const instruction=`기존 결과를 아래 검토 기준에 맞게 보완하세요. 원래 업무 범위와 기존 실행 근거는 참고자료의 rework에 있습니다. 이미 수행한 외부 작업은 반복하지 말고 필요한 보완만 수행하세요. 새 발송·결제·삭제·제출이 필요하면 실행 전 승인을 받으세요.\n\n완료 기준:\n${review.criteria}\n\n부족한 점과 확인 근거:\n${review.evidence}\n\n보완 결과와 검증 근거, 아직 남은 사항을 구분해 보고하세요.`;
 const originalInstruction=(parent.scopeInstruction?parent.scopeInstruction+'\n후속 보완 지시:\n':'')+parent.instruction+(parent.steering?.length?'\n후속 사용자 수정 지시:\n'+parent.steering.map((s:{input:string})=>s.input).join('\n'):'');
 return dispatchOrder(db,owner,id,{type:'agent.dispatch',title:('보완 · '+parent.title).slice(0,160),instruction,projectId,taskIds,eventIds,mode:parent.mode??'native'},env,parent.conversationId??undefined,{parentOrderId:parent.id,originalInstruction,output:parent.output,outputHash:input.outputHash});
}
