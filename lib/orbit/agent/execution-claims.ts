import type {WorkOrder} from './orders-schema.ts';

type RunReceipt=Pick<WorkOrder,'runId'|'status'>;
const escapeRegExp=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function citesRun(text:string,runId:string|null){
 return !!runId&&new RegExp('(^|[^A-Za-z0-9_-])'+escapeRegExp(runId)+'(?=$|[^A-Za-z0-9_-])').test(text);
}

// WorkOrder receipts describe the parent Hermes run only. They do not contain a
// verified recipient or child lifecycle, so they cannot substantiate delegation.
// Keep these claims closed until real child receipts are collected and checked.
export function unsupportedHandoff(text:string,orders:RunReceipt[]){
 const plain=text.replace(/[*`]/g,'');
 const action='(?:전달했습니다|요청했습니다|위임했습니다|소환했습니다|호출했습니다|착수했습니다|시작했습니다|작업\\s*중입니다|진행\\s*중입니다|실행\\s*중입니다|완료했습니다|종료했습니다)';
 const child='(?:@[A-Za-z0-9가-힣_-]+|[A-Za-z0-9가-힣_-]+\\s*팀|dev[-_\\s]?lead|개발\\s*에이전트|(?:하위|서브|보조)\\s*에이전트|sub[-\\s]?agent)';
 if(new RegExp(child+'[^.!?\\n]{0,80}'+action,'i').test(plain)
  ||/@[A-Za-z0-9가-힣_-]+[^.!?\n]{0,80}(?:요청|전달|위임|소환)/i.test(plain)
  ||/(?:에이전트|agent)[^.!?\n]{0,60}(?:전달했습니다|요청했습니다|위임했습니다|소환했습니다|호출했습니다)/i.test(plain))return true;

 // An honest parent status still requires its exact run ID and matching state.
 // A completed run or approval wait must never justify "working now".
 const parent='(?:에이전트|Hermes|헤르메스)[^.!?\\n]{0,60}';
 const claims:{pattern:RegExp;status:WorkOrder['status']}[]=[
  {pattern:new RegExp(parent+'(?:착수했습니다|시작했습니다|작업\\s*중입니다|진행\\s*중입니다|실행\\s*중입니다)','i'),status:'running'},
  {pattern:new RegExp(parent+'승인\\s*대기\\s*중입니다','i'),status:'waiting_for_approval'},
  {pattern:new RegExp(parent+'실행(?:이|은)?\\s*(?:종료되었습니다|끝났습니다)','i'),status:'completed'},
 ];
 return claims.some(({pattern,status})=>pattern.test(plain)&&!orders.some(o=>o.status===status&&citesRun(plain,o.runId)));
}

export function handoffCorrection(hasDispatch:boolean){
 return hasDispatch?'실행할 업무를 제안했습니다. 아래 실행 카드를 승인하면 실제 에이전트 작업이 시작됩니다. 아직 개발팀에 전달되거나 착수된 상태는 아닙니다.':'실제 에이전트 위임이나 작업 착수를 확인하지 못했습니다. 개발팀을 언급한 문구만으로 실행된 것으로 표시하지 않습니다. 실행 연결과 접수 기록을 확인해야 합니다.';
}
