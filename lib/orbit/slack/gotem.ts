// GoTEM Slack messages (morning plan / afternoon check / night review) composed from stored ORBIT
// state only. No AI call: the Hermes cron prints `text` as-is, and an empty result stays silent.
// Order of every message: today's one thing → first action → current state → one ORBIT link.
import {addDays,koreanDate,minuteInZone,todayInZone} from '../dates.ts';
import {formatTime,type WorkspaceData} from '../model.ts';
import {reviewCandidates} from '../review-evidence.ts';
import {todayFocus,type TodayFocus} from '../today-focus.ts';
import {localStamp,type PlanStatus} from '../brief/status-model.ts';

export const GOTEM_SLOTS=['morning','afternoon','night'] as const;
export type GotemSlot=typeof GOTEM_SLOTS[number];
export interface PlanSignal {state:PlanStatus['plan']['state'];analysis:PlanStatus['analysis']['state'];basisAt:string|null;changes:number}
export interface GotemMessage {
 slot:GotemSlot;
 date:string;
 send:boolean;
 reason:string;
 text:string;
 dataAt:string;
 planState?:PlanSignal['state'];
 taskId?:string;
 carryReviewDate?:string;
}
interface Input {slot:GotemSlot;data:WorkspaceData;now:Date;plan:PlanSignal|null;origin:string}

// Record changes only; collector backlogs do not make a plan stale (same rule as the status API).
export function planSignal(status:Pick<PlanStatus,'plan'|'analysis'>):PlanSignal{
 const u=status.plan.unconfirmed;
 return {state:status.plan.state,analysis:status.analysis.state,basisAt:status.plan.basisAt,changes:u.workspaceRevisions+u.noteRevisions+u.conversations};
}

// 'M/D HH:mm' in the owner's zone.
function stamp(iso:string,zone:string){
 const local=localStamp(iso,zone);
 return local?`${Number(local.slice(5,7))}/${Number(local.slice(8,10))} ${local.slice(11)}`:'';
}
const shortDate=(date:string)=>`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`;
const taskLink=(origin:string,taskId:string)=>`${origin}/?task=${encodeURIComponent(taskId)}#today`;

function stateLine(plan:PlanSignal,zone:string){
 const basis=plan.basisAt?` · ${stamp(plan.basisAt,zone)} 기준`:'';
 if(plan.state==='ready')return `상태: 계획 준비 완료${basis}`;
 if(plan.state==='stale')return `상태: 계획 준비됨${basis} · 이후 기록 ${plan.changes}건 변경, 계획 화면에서 확인해 주세요`;
 if(plan.analysis==='failed')return '상태: 분석 실패 · 보존된 기본 계획으로 시작할 수 있어요';
 if(plan.analysis==='running')return '상태: 분석 진행 중 · 기본 계획으로 먼저 시작할 수 있어요';
 return '상태: 기본 계획 · 분석 결과 없이 저장된 할 일로 만든 계획이에요';
}

function focusLines(focus:TodayFocus){
 return [
  focus.title,
  `첫 10분: ${focus.firstStep??'타이머 10분을 켜고 바로 시작'}`,
  ...(focus.slot?[`추천 시간 ${formatTime(focus.slot.start)}–${formatTime(focus.slot.end)}`]:[]),
  ...(focus.carry?[`어제 회고(${shortDate(focus.carry.reviewDate)}) 반영: ${focus.carry.rule}`]:[]),
 ];
}

function morning(base:GotemMessage,{data,plan,origin}:Input,focus:TodayFocus|null):GotemMessage{
 const zone=data.preferences.timeZone,header=`*오늘의 한 가지* · ${koreanDate(base.date)}`;
 const planState=plan?.state??'none';
 if(planState==='none')return {...base,send:true,reason:'no_plan',planState,
  text:[header,'오늘 계획이 아직 없어요.','ORBIT에서 계획을 만들면 첫 행동과 시간대를 바로 정해 드려요.',`계획 만들기: ${origin}/#proposal`].join('\n')};
 if(!focus)return {...base,send:true,reason:'empty_plan',planState,
  text:[header,'오늘 계획에 배치된 업무가 없어요.',stateLine(plan!,zone),`계획 보기: ${origin}/#proposal`].join('\n')};
 const link=focus.taskId?`ORBIT에서 시작: ${taskLink(origin,focus.taskId)}`:`계획 보기: ${origin}/#proposal`;
 return {...base,send:true,reason:'plan',planState,...(focus.taskId?{taskId:focus.taskId}:{}),...(focus.carry?{carryReviewDate:focus.carry.reviewDate}:{}),
  text:[header,...focusLines(focus),stateLine(plan!,zone),link].join('\n')};
}

function afternoon(base:GotemMessage,{data,now,plan,origin}:Input,focus:TodayFocus|null):GotemMessage{
 const skip=(reason:string)=>({...base,send:false,reason,...(plan?{planState:plan.state}:{})});
 if(!focus?.taskId||!plan||plan.state==='none')return skip('no_plan');
 const task=data.tasks.find(t=>t.id===focus.taskId);
 if(!task)return skip('no_plan');
 if(task.status==='done')return skip('focus_done');
 if(task.startedAt||task.status==='doing')return skip('focus_started');
 if(focus.slot&&minuteInZone(data.preferences.timeZone,now)<focus.slot.end)return skip('before_slot');
 const planned=focus.slot?` (추천 시간 ${formatTime(focus.slot.start)}–${formatTime(focus.slot.end)} 지남)`:'';
 return {...base,send:true,reason:'not_started',planState:plan.state,taskId:task.id,
  text:[`*오후 점검* · ${task.title}`,`아직 시작 기록이 없어요${planned}.`,'둘 중 하나만 남겨 주세요: ① 막힌 이유 ② 계획 조정(미루기·쪼개기)',`ORBIT에서 이어가기: ${taskLink(origin,task.id)}`].join('\n')};
}

function night(base:GotemMessage,{data,now,origin}:Input):GotemMessage{
 if(data.reviews.some(r=>r.date===base.date))return {...base,send:false,reason:'review_saved'};
 const candidates=reviewCandidates(data,base.date,base.date,now);
 const count=(state:string)=>candidates.filter(c=>c.state===state).length;
 const summary=candidates.length
  ?`기록에서 결과 후보 ${candidates.length}개를 미리 채워 뒀어요 (확정 ${count('confirmed')} · 추정 ${count('suggested')} · 미확인 ${count('open')}).`
  :'기록에서 찾은 결과 후보가 없어요. 오늘 한 일을 한 줄만 남겨 주세요.';
 const tomorrow=todayFocus(data,addDays(base.date,1));
 return {...base,send:true,reason:'review_due',
  text:[`*하루 마무리* · ${koreanDate(base.date)}`,summary,'맞음 · 수정 · 아직 모름만 고르면 되고, 확인 전에는 저장되지 않아요.','내일 계획에 반영할 개선점 1개도 함께 골라 주세요.',
   ...(tomorrow?[`내일 첫 후보: ${tomorrow.title}`]:[]),`회고 확인: ${origin}/#review`].join('\n')};
}

export function composeGotem(input:Input):GotemMessage{
 const zone=input.data.preferences.timeZone,date=todayInZone(zone,input.now);
 const base:GotemMessage={slot:input.slot,date,send:false,reason:'',text:'',dataAt:input.now.toISOString()};
 if(input.slot==='night')return night(base,input);
 const focus=todayFocus(input.data,date);
 return input.slot==='morning'?morning(base,input,focus):afternoon(base,input,focus);
}
