'use client';
import {ChevronRight,Crosshair,Target} from 'lucide-react';
import {goalLadder} from '@/lib/orbit/goal-ladder';
import type {Goal,WorkspaceData} from '@/lib/orbit/model';

const rung=(label:string,goal:Goal|undefined,hint:string)=><li className={goal?'':'is-empty'}><span className="goal-rung-label">{label}</span><strong>{goal?.sentence??hint}</strong>{goal?.deadline&&<small>{goal.deadline.slice(0,7).replace('-','.')}까지</small>}</li>;

// 꿈 → 중장기 → 단기 at the top of 프로젝트, so each project reads as a step toward a goal.
export function GoalLadderStrip({data,today,onGoals,onManage,onProject}:{data:WorkspaceData;today:string;onGoals:()=>void;onManage:()=>void;onProject:(id:string)=>void}){
 const ladder=goalLadder(data,today);
 if(ladder.empty)return <section className="goal-ladder is-empty" aria-label="목표 사다리"><Target size={18} aria-hidden="true"/><p><strong>목표 사다리가 비어 있어요.</strong> 꿈 → 중장기 → 단기 목표를 정하면 프로젝트가 어느 목표로 가는 걸음인지 보입니다.</p><button className="secondary-button" onClick={onManage}>목표 사다리 만들기</button></section>;
 return <section className="goal-ladder" aria-label="목표 사다리">
  <ol>{rung('꿈',ladder.life,'꿈을 정해 보세요')}{rung('중장기',ladder.mid,'중장기 목표 없음')}{rung('단기',ladder.short,'단기 목표 없음')}</ol>
  <div className="goal-ladder-foot">
   {ladder.domino?<button className="goal-domino" onClick={()=>onProject(ladder.domino!.id)}><Crosshair size={15} aria-hidden="true"/>도미노 · {ladder.domino.name}</button>:<span className="goal-ladder-note">도미노 프로젝트를 정하지 않았어요</span>}
   <span className="goal-ladder-note">{ladder.linkedProjects?`이 목표로 가는 진행 중 프로젝트 ${ladder.linkedProjects}개`:'목표와 연결된 진행 중 프로젝트가 없어요 · 프로젝트 개요에서 연결하세요'}</span>
   <button className="text-button" onClick={onGoals}>목표 보기<ChevronRight size={15}/></button>
  </div>
 </section>;
}
