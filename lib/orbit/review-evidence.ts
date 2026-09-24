import type {WorkspaceData,Task,Note,Outcome,OutcomeReason,ReviewDetail,ReviewConfirmation} from './model.ts';
import {addDays,koreanDate} from './dates.ts';
import {executionSamples} from './execution-history.ts';
import {calibrationEvidence,calibrate} from './planner.ts';
import type {ExecutionRecord} from './phase4-schema.ts';

// Evidence-backed review candidates. Everything here is a rule over stored records: no model is called.
// A candidate is `confirmed` only when an outcome for that date is already on record; `suggested` outcomes
// come from explicit record wording (notes, Slack-filed notes, delegations) or the focus timer and are never
// saved until the user accepts them. Calendar blocks are shown as planned time, never as actual time.

export type CandidateState='confirmed'|'suggested'|'open';
export interface ReviewEvidence {kind:'record'|'timer'|'note'|'delegation'|'status';label:string;quote:string;ref?:{type:'note'|'delegation'|'task';id:string;line?:number};signal?:Outcome;reason?:OutcomeReason}
export interface ReviewCandidate {
  taskId:string;title:string;source:string;estimate:number;state:CandidateState;
  outcome?:Outcome;reason?:OutcomeReason;actual?:number;basis:string;evidence:ReviewEvidence[];
  timer?:{total:number;since:number;running:boolean};calendarMinutes?:number;
}

export function plannedItems(data: WorkspaceData, date: string): { task: Task; source: string }[] {
  const approved = new Set(
    data.events
      .filter((e) => e.date === date && e.taskId && e.id.startsWith('approved:'))
      .map((e) => e.taskId!),
  );
  const rows: { task: Task; source: string; order: number }[] = [];
  for (const t of data.tasks) {
    if (t.laserDate === date) rows.push({ task: t, source: 'Goal Laser', order: 0 });
    else if ((t.focus && t.focusDate === date) || approved.has(t.id))
      rows.push({ task: t, source: '핵심 결과물', order: 1 });
    else if (t.completedOn === date) rows.push({ task: t, source: '오늘 완료', order: 2 });
    else if (t.unplanned && t.due === date) rows.push({ task: t, source: '계획에 없던 일 +', order: 3 });
    else if (t.due === date && t.status !== 'done') rows.push({ task: t, source: '오늘 마감', order: 4 });
  }
  return rows.sort((a, b) => a.order - b.order);
}

const norm=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,'');
const GENERIC=new Set(['하기','진행','작업','업무','정리','확인','준비','관련','검토','회의','미팅','건']);
function tokensOf(title:string){return title.normalize('NFKC').toLowerCase().split(/[\s·,./()[\]:~\-_'"“”‘’]+/).filter(t=>t.length>=2&&!GENERIC.has(t)).slice(0,4)}
// A line mentions a task when it contains the whole title, or every distinctive word of a title with at least two.
export function mentionsTask(line:string,title:string){return mentionsNormalized(norm(line),title)}
const titleKeys=new Map<string,{whole:string;tokens:string[]}>();
function keysOf(title:string){let k=titleKeys.get(title);if(!k){if(titleKeys.size>2000)titleKeys.clear();k={whole:norm(title),tokens:tokensOf(title).map(norm)};titleKeys.set(title,k);}return k}
function mentionsNormalized(text:string,title:string){
  const {whole,tokens}=keysOf(title);
  if(whole.length>=4&&text.includes(whole))return true;
  return tokens.length>=2&&tokens.every(t=>text.includes(t));
}
const NOT_DONE=/(못\s?했|못\s?함|못\s?끝|미뤘|미룸|연기|보류|취소|안\s?됐|막혔|막힘|회신\s?대기|답변\s?대기|대기\s?중|postpone|delayed|blocked|waiting)/i;
const PARTIAL=/(진행\s?중|진행중|일부|절반|초안|작업\s?중|이어서|in progress|wip|draft)/i;
const DONE=/(완료|끝냈|끝났|끝남|마쳤|마무리했|전달했|발송했|보냈|제출했|공유했|올렸|등록했|처리했|해결했|받았|done|completed|finished|shipped|sent)/i;
// Negation first: "완료 못했다" must not read as done. The task's own words are removed first, so a title
// such as "제안서 초안 발송" does not read as progress wording.
export function outcomeSignal(raw:string,title=''):{outcome:Outcome;reason?:OutcomeReason}|undefined{
  let line=raw.normalize('NFKC');
  for(const w of [title.normalize('NFKC'),...title.normalize('NFKC').split(/\s+/)].filter(w=>w.length>=2).sort((a,b)=>b.length-a.length))line=line.split(w).join(' ');
  if(NOT_DONE.test(line))return {outcome:/(대기|막혔|막힘|회신|답변|blocked|waiting)/i.test(line)?'partial':'skipped',reason:/(대기|막혔|막힘|회신|답변|blocked|waiting)/i.test(line)?'waiting':/(연기|미뤘|미룸|보류|취소|postpone)/i.test(line)?'priority':'other'};
  if(PARTIAL.test(line))return {outcome:'partial',reason:'time'};
  if(DONE.test(line))return {outcome:'done'};
  return undefined;
}
const clip=(s:string,n=160)=>{const t=s.trim().replace(/\s+/g,' ');return t.length>n?t.slice(0,n-1)+'…':t};
function noteLabel(n:Note){
  if(n.source?.provider==='gmail')return '메일';
  if(n.source?.provider==='plaud')return '회의록(Plaud)';
  if(n.kind==='meeting')return '회의록';
  return '업무 기록';
}
const noteDate=(n:Note)=>n.source?.date?.slice(0,10)??n.updated?.slice(0,10);
// Notes that were written or filed on the review date and whose text we can read. Bodies may be stored
// outside the workspace aggregate; the server passes them in, the client falls back to the summary.
type ReadableNote={note:Note;lines:{index:number;raw:string;text:string}[]};
export function evidenceNotes(notes:Note[],date:string):ReadableNote[]{
  return notes.filter(n=>n.kind!=='wiki'&&noteDate(n)===date).slice(-24).map(note=>({note,lines:[note.title,...(note.summary?note.summary.split(/\r?\n/):[]),...(note.body?note.body.split(/\r?\n/):[])]
    .slice(0,2000).map((raw,index)=>({index,raw,text:norm(raw)})).filter(l=>l.text&&l.raw.length<=2000)}));
}
function noteEvidence(task:Task,notes:ReadableNote[]):ReviewEvidence[]{
  const found:ReviewEvidence[]=[];
  for(const {note,lines} of notes)for(const l of lines){
    if(!mentionsNormalized(l.text,task.title))continue;
    const signal=outcomeSignal(l.raw,task.title);
    found.push({kind:'note',label:`${noteLabel(note)} · ${clip(note.title,40)}`,quote:clip(l.raw),ref:{type:'note',id:note.id,line:l.index},...(signal?{signal:signal.outcome,...(signal.reason?{reason:signal.reason}:{})}:{})});
    if(found.length>=3)return found;
  }
  return found;
}
function delegationEvidence(data:WorkspaceData,task:Task,date:string):ReviewEvidence[]{
  const out:ReviewEvidence[]=[];
  for(const d of data.delegations??[]){
    if(d.taskId!==task.id)continue;
    const today=d.history.filter(h=>h.at.slice(0,10)===date);
    const last=today.at(-1)??(d.updatedAt.slice(0,10)===date?{status:d.status,update:d.update,evidence:d.evidence,assignee:d.assignee}:undefined);
    if(!last)continue;
    const signal:Outcome|undefined=last.status==='delivered'||last.status==='verified'?'done':last.status==='blocked'?'partial':undefined;
    out.push({kind:'delegation',label:`위임 · ${clip(last.assignee||d.assignee,20)} · ${last.status}`,quote:clip(last.update||last.evidence||d.deliverable),ref:{type:'delegation',id:d.id},...(signal?{signal}:{}),...(last.status==='blocked'?{reason:'waiting' as const}:{})});
  }
  return out;
}
// A few minutes on the timer is not evidence of progress; below this it is shown but not used as a guess.
const TIMER_GUESS=5;
const elapsed=(startedAt:string,now:Date)=>Math.max(0,Math.round((now.getTime()-Date.parse(startedAt))/60000));
// Focus timer minutes are cumulative on the task. `since` is what accrued after the last outcome record,
// which is the only part attributable to today. Past dates have no attributable timer.
function timerOf(data:WorkspaceData,task:Task,date:string,today:string,now:Date){
  if(date!==today)return undefined;
  const running=!!task.startedAt,total=(task.actualMinutes??0)+(task.startedAt?elapsed(task.startedAt,now):0);
  const last=[...data.executionHistory??[]].reverse().find(r=>r.taskId===task.id);
  const since=Math.max(0,total-(last?.actual??0));
  return total>0||running?{total,since,running}:undefined;
}
export function reviewCandidates(data:WorkspaceData,date:string,today:string,now:Date,notes:Note[]=data.notes):ReviewCandidate[]{
  const readable=evidenceNotes(notes,date);
  const recorded=new Map(executionSamples(data,date,date).rows.map(r=>[r.taskId,r]));
  const planned=plannedItems(data,date);
  const extra=data.tasks.filter(t=>!planned.some(p=>p.task.id===t.id)&&(t.status!=='done'||t.completedOn===date||t.outcomeOn===date));
  const rows=[...planned.map(p=>({task:p.task,source:p.source,planned:true})),...extra.map(task=>({task,source:'기록에서 발견',planned:false}))];
  const out:ReviewCandidate[]=[];let extras=0;
  for(const {task,source,planned:isPlanned} of rows){
    const record=recorded.get(task.id);
    const notesFound=noteEvidence(task,readable),delegated=delegationEvidence(data,task,date);
    const timer=timerOf(data,task,date,today,now);
    const calendarMinutes=data.events.filter(e=>e.date===date&&e.taskId===task.id&&!e.allDay).reduce((s,e)=>s+Math.max(0,e.end-e.start),0)||undefined;
    const confirmedOutcome=task.outcomeOn===date&&task.outcome?task.outcome:record?.outcome;
    if(!isPlanned&&!confirmedOutcome&&!notesFound.some(e=>e.signal)&&!delegated.length&&!(timer&&timer.since>=TIMER_GUESS))continue;
    if(!isPlanned&&++extras>10)continue;
    const evidence:ReviewEvidence[]=[];
    const estimate=task.outcomeEstimateMinutes??task.duration;
    if(confirmedOutcome){
      const actual=task.outcomeOn===date?task.actualMinutes:record?.actual??undefined;
      evidence.push({kind:'record',label:'확정 · 실행 기록',quote:`${date} 결과를 이미 기록했습니다.`,ref:{type:'task',id:task.id}});
      out.push({taskId:task.id,title:task.title,source,estimate:record?.estimate??estimate,state:'confirmed',outcome:confirmedOutcome,
        ...(confirmedOutcome!=='done'?{reason:(task.outcomeOn===date?task.outcomeReason:(record?.reason||undefined) as OutcomeReason|undefined)??'other'}:{}),
        ...(actual!==undefined&&actual!==null?{actual}:{}),basis:'이미 기록된 결과입니다. 다르면 수정하세요.',evidence:[...evidence,...notesFound,...delegated].slice(0,4),...(timer?{timer}:{}),...(calendarMinutes?{calendarMinutes}:{})});
      continue;
    }
    if(timer&&timer.since>0)evidence.push({kind:'timer',label:timer.running?'집중 타이머 · 진행 중':'집중 타이머',quote:`마지막 결과 기록 이후 ${timer.since}분 집중 (누적 ${timer.total}분)`,ref:{type:'task',id:task.id},signal:task.status==='done'?'done':'partial'});
    if(task.status==='waiting'||task.blocker?.trim())evidence.push({kind:'status',label:'대기 중',quote:clip(task.blocker?.trim()||'필요한 답변이나 조건을 기다립니다.'),ref:{type:'task',id:task.id},reason:'waiting'});
    if(task.status==='done'&&task.completedOn===date)evidence.push({kind:'status',label:'할 일 상태',quote:'이 날짜에 완료로 표시했습니다.',ref:{type:'task',id:task.id},signal:'done'});
    evidence.push(...delegated,...notesFound);
    const explicit=evidence.filter(e=>e.signal&&e.kind!=='timer');
    const signals=[...new Set(explicit.map(e=>e.signal!))];
    let outcome:Outcome|undefined,basis:string;
    if(signals.length===1){outcome=signals[0];const top=explicit[0];basis=`${top.label}: “${clip(top.quote,60)}”`;}
    else if(signals.length>1){basis='기록마다 결과가 달라 추정하지 않았습니다. 근거를 보고 골라 주세요.';}
    else if(timer&&timer.since>=TIMER_GUESS){outcome='partial';basis=`집중 타이머 ${timer.since}분 기록은 있지만 완료 표시는 없습니다.`;}
    else basis=evidence.length?'관련 기록은 있지만 결과를 말하지 않습니다.':'연결된 기록이 없습니다. 직접 확인해 주세요.';
    const reason=outcome&&outcome!=='done'?evidence.find(e=>e.reason)?.reason??(outcome==='partial'?'time':'other'):undefined;
    out.push({taskId:task.id,title:task.title,source,estimate,state:outcome?'suggested':'open',...(outcome?{outcome}:{}),...(reason?{reason}:{}),basis,evidence:evidence.slice(0,4),...(timer?{timer}:{}),...(calendarMinutes?{calendarMinutes}:{})});
  }
  return out.slice(0,40);
}

// What the saved review changes for tomorrow. Mirrors the reducer and planner rules; describes, never decides.
export interface ReflectionLine {kind:'done'|'carry'|'followup'|'estimate'|'calibration'|'unknown'|'history';text:string}
export interface ReviewReflection {date:string;next:string;lines:ReflectionLine[]}
export function reviewReflection(data:WorkspaceData,detail:ReviewDetail,today:string,now:Date,unknown:string[]=[]):ReviewReflection{
  const date=detail.date,next=addDays(date,1),lines:ReflectionLine[]=[];
  const q=(t:string)=>`‘${clip(t,40)}’`;
  const tasks=new Map(data.tasks.map(t=>[t.id,t]));
  const past=date<today;
  if(past)lines.push({kind:'history',text:'지난 날짜 회고라 할 일 상태는 그대로 두고 그날의 실행 기록만 고칩니다.'});
  const done=detail.items.filter(i=>i.outcome==='done');
  if(!past&&done.length)lines.push({kind:'done',text:`완료 ${done.length}개(${done.slice(0,3).map(i=>q(i.title)).join(', ')}${done.length>3?' 외':''})는 내일 후보에서 빠집니다.`});
  for(const i of detail.items.filter(i=>i.outcome!=='done')){
    const t=tasks.get(i.taskId);if(!t||past)continue;
    if(i.outcome==='partial')lines.push({kind:'carry',text:`${q(i.title)} 부분 진행 → 진행 중으로 두어 내일 후보에서 이어하기 우선순위를 받습니다.`});
    else lines.push({kind:'carry',text:`${q(i.title)} 못함 → 예정 상태로 남아 내일 후보에 다시 들어갑니다.`});
    if(i.reason==='waiting'&&!t.checkDate)lines.push({kind:'followup',text:`${q(i.title)} 외부 대기 → ${koreanDate(next,false)} ‘확인 필요’ 목록에 올려 회신 여부를 먼저 확인하게 합니다.`});
  }
  // Calibration after this save: append what the reducer would record, then ask the planner's own function.
  const records:ExecutionRecord[]=detail.items.map(i=>({id:'preview:'+i.taskId,taskId:i.taskId,title:i.title,projectId:tasks.get(i.taskId)?.projectId??'',date,at:now.toISOString(),due:tasks.get(i.taskId)?.due??date,outcome:i.outcome,reason:i.reason??'',estimate:i.estimateMinutes,actual:i.actualMinutes??(past?null:tasks.get(i.taskId)?.actualMinutes??null),impact:tasks.get(i.taskId)?.impact??3,buffer:null}));
  const history=[...data.executionHistory??[],...records];
  for(const i of done.filter(i=>i.actualMinutes!==undefined&&i.estimateMinutes>0)){
    const diff=Math.round((i.actualMinutes!/i.estimateMinutes-1)*100);
    lines.push({kind:'estimate',text:`${q(i.title)} 예상 ${i.estimateMinutes}분 / 실제 ${i.actualMinutes}분${diff?` (${diff>0?'+':''}${diff}%)`:''} → 예상시간 보정 표본에 들어갑니다.`});
  }
  const valid=executionSamples({tasks:data.tasks,executionHistory:history},addDays(next,-30),next).rows.filter(r=>r.outcome==='done'&&r.actual!==null&&r.actual>0&&r.estimate>0).length;
  let calibrated=false;
  for(const t of data.tasks.filter(t=>!past&&detail.items.some(i=>i.taskId===t.id&&i.outcome!=='done'))){
    const e=calibrationEvidence(data.tasks,t,next,history);
    if(e.sufficient&&e.factor!==1){calibrated=true;lines.push({kind:'calibration',text:`${q(t.title)} 예상 ${t.duration}분 → 내일은 ${calibrate(t.duration,e.factor)}분으로 배치합니다 (${e.tier} ${e.samples.length}개 중앙값 ×${e.factor}).`});}
  }
  if(!calibrated)lines.push({kind:'calibration',text:valid>=5?`최근 30일 완료·실제시간 표본 ${valid}개로 예상시간 보정이 켜져 있습니다. 이어갈 업무의 예상이 실제와 비슷해 조정할 값이 없습니다.`:`최근 30일 완료·실제시간 표본 ${valid}/5개 — ${5-valid}개 더 쌓이면 예상시간을 자동으로 보정합니다.`});
  const unmeasured=done.filter(i=>i.actualMinutes===undefined&&(past||!(tasks.get(i.taskId)?.actualMinutes??0))).length;
  if(unmeasured)lines.push({kind:'unknown',text:`실제 시간이 없는 완료 ${unmeasured}개는 예상시간 보정 표본에 넣지 않습니다.`});
  if(unknown.length)lines.push({kind:'unknown',text:`아직 모름 ${unknown.length}개(${unknown.slice(0,3).map(q).join(', ')}${unknown.length>3?' 외':''})는 완료·실패로 기록하지 않고 상태를 그대로 둡니다.`});
  return {date,next,lines};
}

// Effect check for the evidence-first review: first 7 measured days against the following 7.
export interface ConfirmationWindow {from:string;to:string;days:number;shown:number;confirmed:number;rate:number|null;medianSeconds:number|null}
const median=(v:number[])=>{if(!v.length)return null;const s=[...v].sort((a,b)=>a-b);return s.length%2?s[(s.length-1)/2]:Math.round((s[s.length/2-1]+s[s.length/2])/2)};
function windowOf(rows:{date:string;c:ReviewConfirmation}[],from:string,to:string):ConfirmationWindow{
  const r=rows.filter(x=>x.date>=from&&x.date<=to),shown=r.reduce((s,x)=>s+x.c.shown,0),confirmed=r.reduce((s,x)=>s+x.c.confirmed,0);
  return {from,to,days:r.length,shown,confirmed,rate:shown?Math.round(confirmed/shown*100):null,medianSeconds:median(r.map(x=>x.c.seconds))};
}
export function confirmationTrend(details:ReviewDetail[]){
  const rows=details.filter(d=>d.confirmation).map(d=>({date:d.date,c:d.confirmation!})).sort((a,b)=>a.date.localeCompare(b.date));
  if(!rows.length)return null;
  const start=rows[0].date;
  return {baseline:windowOf(rows,start,addDays(start,6)),next:windowOf(rows,addDays(start,7),addDays(start,13))};
}
