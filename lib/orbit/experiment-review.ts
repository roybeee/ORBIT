import {executionSamples} from './execution-history.ts';
import {addDays} from './dates.ts';
import {reasonLabel,type WorkspaceData,type OutcomeReason} from './model.ts';
import type {Experiment} from './phase4-schema.ts';
// The closing step of a small experiment: when to review it, what the result suggests, and which
// recurring problems deserve one. Everything here is rule-based advice; the owner decides.
export type Verdict=NonNullable<Experiment['decision']>['verdict'];
export type ExperimentStage='measure'|'running'|'review'|'decide'|'decided'|'stopped';
export const verdictLabel:Record<Verdict,string>={adopt:'계속 적용',retry:'수정해서 재시도',drop:'중단'};
export function experimentStage(e:Experiment,today:string):ExperimentStage{
 if(e.status==='stopped')return 'stopped';
 if(e.status==='completed')return e.decision?'decided':'decide';
 if(e.baseline===null)return 'measure';
 return today>=e.through?'review':'running';
}
export const experimentsToReview=(data:Pick<WorkspaceData,'experiments'>,today:string)=>(data.experiments??[]).filter(e=>{const stage=experimentStage(e,today);return stage==='decide'||(e.status==='active'&&today>=e.through)});
export function suggestVerdict(e:Experiment):{verdict:Verdict;reasons:string[]}|null{
 if(!e.result)return null;
 const {value}=e.result,unit=e.unit,period=`${e.from}–${e.through} 관찰`;
 if(e.baseline===null)return {verdict:'retry',reasons:[`시작 기준값이 없어 개선 여부를 비교할 수 없습니다(측정 ${value}${unit}). 기준값을 먼저 측정해 다시 시도하세요.`,period]};
 const gain=e.direction==='up'?value-e.baseline:e.baseline-value;
 const compare=`기준 ${e.baseline}${unit} → 측정 ${value}${unit}, 목표 ${e.target}${unit}`;
 if(e.result.met)return {verdict:'adopt',reasons:[`${compare}: 목표를 달성했습니다.`,period]};
 if(gain>0)return {verdict:'retry',reasons:[`${compare}: 나아졌지만 목표에 못 미쳤습니다. 행동이나 기간을 고쳐 다시 시험할 수 있습니다.`,period]};
 return {verdict:'drop',reasons:[`${compare}: 기준보다 나아지지 않았습니다.`,period]};
}
// Incomplete work that failed for the same recorded reason at least `min` times in the last `days` days.
export function repeatedIssues(data:Pick<WorkspaceData,'tasks'|'executionHistory'>,today:string,days=14,min=3){
 const from=addDays(today,-(days-1)),rows=executionSamples(data,from,today).rows.filter(r=>r.outcome!=='done'&&r.reason in reasonLabel);
 const groups=new Map<OutcomeReason,typeof rows>();
 for(const r of rows)groups.set(r.reason as OutcomeReason,[...groups.get(r.reason as OutcomeReason)??[],r]);
 return [...groups].filter(([,list])=>list.length>=min).sort((a,b)=>b[1].length-a[1].length).map(([reason,list])=>({reason,label:reasonLabel[reason],count:list.length,from,through:today,examples:[...list].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(r=>({date:r.date,title:r.title,taskId:r.taskId}))}));
}
