// DB-free plan readiness model shared by the status API (server) and the home strip (client bundle).
export const MORNING_HOUR=7;
export interface RunSummary {version:string;inline:boolean;leaves:number;reused:number;analyzed:number;merges:number;mergeReused:number;posts:number;changes:{added:number;modified:number;deleted:number;keys:string[]}}
export interface PlanStatus {
 now:string;
 target:{date:string;timeZone:string;eveningHour:number;afterEvening:boolean};
 collection:{state:'ok'|'partial'|'error'|'unknown';lastProgressAt:string|null;
  sources:{provider:string;label:string;state:'ok'|'partial'|'error';detail:string;attemptedAt:string;succeededAt?:string}[];
  pending:{plaudQueue:number;plaudFailed:number;plaudImports:number;activityPending:number;activityQuarantined:number;meetingReviews:number;mail:number;total:number}};
 analysis:{state:'idle'|'running'|'completed'|'failed';turnId:string|null;startedAt:string|null;lastProgressAt:string|null;progress:string;error:string;basisAt:string|null;sourceRevision:number|null;metrics:RunSummary|null};
 plan:{state:'none'|'local'|'ready'|'stale';date:string;readyAt:string|null;basisAt:string|null;cutoff:string|null;sourceRevision:number|null;currentRevision:number;durationMs:number|null;metrics:RunSummary|null;
  unconfirmed:{workspaceRevisions:number;noteRevisions:number;conversations:number;collection:number;total:number}};
 history:{date:string;turnId:string;status:'running'|'completed'|'failed';startedAt:string;basisAt:string;readyAt:string|null;durationMs:number|null;readyBeforeMorning:boolean|null;metrics:RunSummary|null}[];
}
export type StepState='idle'|'active'|'done'|'stale'|'error';
export interface PlanStep {id:'collect'|'analyze'|'plan';title:string;state:StepState;summary:string;detail:string}

const TITLES={collect:'자료 수집',analyze:'계획 분석',plan:'계획 준비 완료'} as const;
const DEMO_SUMMARY={collect:'체험 화면에서는 서버 상태를 표시하지 않습니다',analyze:'내 워크스페이스에서 확인할 수 있습니다',plan:'—'} as const;
const STEP_IDS=['collect','analyze','plan'] as const;

// 'YYYY-MM-DDTHH:mm' in the owner's zone via Intl (no date arithmetic); '' for an unparsable input.
export function localStamp(iso:string,timeZone:string):string{
 const time=Date.parse(iso);
 if(Number.isNaN(time))return '';
 const parts=new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time));
 const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find(p=>p.type===type)?.value??'';
 return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function formatAt(iso:string|null|undefined,timeZone:string):string{
 if(!iso)return '—';
 const time=Date.parse(iso);
 if(Number.isNaN(time))return '—';
 return new Date(time).toLocaleString('ko-KR',{timeZone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
}

function placeholderSteps(summaries:Record<PlanStep['id'],string>):PlanStep[]{
 return STEP_IDS.map(id=>({id,title:TITLES[id],state:'idle' as const,summary:summaries[id],detail:'—'}));
}

function collectStep(status:PlanStatus,timeZone:string):PlanStep{
 const {state,lastProgressAt,pending}=status.collection;
 const summary=state==='unknown'?{state:'idle' as const,summary:'수집 기록 없음'}
  :state==='error'?{state:'error' as const,summary:'확인 필요'}
  :state==='partial'?{state:'active' as const,summary:`수집 중 · 미확인 자료 ${pending.total}건`}
  :{state:'done' as const,summary:'수집 완료'};
 const counts:[string,number][]=[['회의록',pending.plaudQueue+pending.plaudFailed+pending.plaudImports],['대화',pending.activityPending+pending.activityQuarantined],['검토 대기',pending.meetingReviews],['메일',pending.mail]];
 const extra=counts.filter(([,n])=>n>0).map(([label,n])=>` · ${label} ${n}`).join('');
 return {id:'collect',title:TITLES.collect,...summary,detail:`마지막 진행 ${formatAt(lastProgressAt,timeZone)}${extra}`};
}

function metricsDetail(metrics:PlanStatus['analysis']['metrics']):string{
 if(!metrics)return '—';
 if(metrics.inline)return `직접 분석 · Hermes ${metrics.posts}회`;
 return `재사용 ${metrics.reused+metrics.mergeReused}/${metrics.leaves+metrics.merges} · Hermes ${metrics.posts}회`;
}

function analyzeStep(status:PlanStatus,timeZone:string):PlanStep{
 const a=status.analysis,base={id:'analyze' as const,title:TITLES.analyze};
 if(a.state==='running')return {...base,state:'active',summary:'분석 중',detail:`${a.progress.slice(0,110)} · 마지막 진행 ${formatAt(a.lastProgressAt,timeZone)}`};
 if(a.state==='completed')return {...base,state:'done',summary:`분석 완료 ${formatAt(a.lastProgressAt,timeZone)}`,detail:metricsDetail(a.metrics)};
 if(a.state==='failed')return {...base,state:'error',summary:'실패 · 다시 요청 필요',detail:a.error.slice(0,110)};
 return {...base,state:'idle',summary:'대기 중',detail:`${status.target.eveningHour}시 자동 준비`};
}

function planStep(status:PlanStatus,timeZone:string):PlanStep{
 const p=status.plan,today=localStamp(status.now,timeZone).slice(0,10),dayLabel=status.target.date===today?'오늘':'내일';
 const changed=p.unconfirmed.workspaceRevisions+p.unconfirmed.noteRevisions+p.unconfirmed.conversations;
 const summary=p.state==='none'?{state:'idle' as const,summary:`${dayLabel} 계획 준비 전`}
  :p.state==='local'?{state:'done' as const,summary:'기본 계획 준비됨'}
  :p.state==='ready'?{state:'done' as const,summary:`${dayLabel} 계획 준비됨 · ${formatAt(p.readyAt,timeZone)}`}
  :{state:'stale' as const,summary:`${dayLabel} 계획 준비됨 · 이후 변경 ${changed}건`};
 return {id:'plan',title:TITLES.plan,...summary,detail:`반영 기준 시각 ${formatAt(p.basisAt,timeZone)}${p.cutoff?` · ${p.cutoff}까지 기록`:''}`};
}

export function planSteps(status:PlanStatus|null,demo:boolean,timeZone:string):PlanStep[]{
 if(demo)return placeholderSteps(DEMO_SUMMARY);
 if(!status)return placeholderSteps({collect:'상태 확인 중',analyze:'상태 확인 중',plan:'상태 확인 중'});
 return [collectStep(status,timeZone),analyzeStep(status,timeZone),planStep(status,timeZone)];
}
