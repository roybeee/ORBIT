import type {WorkspaceData,Project} from '../model.ts';
import type {AgentAction} from '../agent/types.ts';
import {addDays,todayInZone} from '../dates.ts';
import {zonedInstant} from '../agent/calendar.ts';
import {AgentError} from '../agent/errors.ts';
import type {KakaoCapture} from './types.ts';
import {validateCitations} from './evidence.ts';
import type {KakaoModelResult,KakaoProposal} from './model.ts';

const normalize=(text:string)=>text.trim().replace(/\s+/g,' ').toLocaleLowerCase();
async function stableUuid(value:string){
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 digest[6]=(digest[6]&15)|80;digest[8]=(digest[8]&63)|128;
 const hex=[...digest.slice(0,16)].map(v=>v.toString(16).padStart(2,'0')).join('');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
function existingProposal(data:WorkspaceData,pending:AgentAction[],proposal:KakaoProposal){
 const records=proposal.kind==='event'?[...data.events,...pending.flatMap(a=>a.action.type==='event.upsert'?[a.action.event]:[])]:[...data.tasks,...pending.flatMap(a=>a.action.type==='task.upsert'?[a.action.task]:[])];
 return records.some(record=>normalize(record.title)===normalize(proposal.title)&&(proposal.kind==='event'&&'date' in record?record.date===proposal.date&&record.start===proposal.start&&record.end===proposal.end:proposal.kind==='task'&&'due' in record&&record.due===proposal.due));
}
function projectFor(data:WorkspaceData,proposal:KakaoProposal,today:string){
 if(proposal.projectId&&!data.projects.some(p=>p.id===proposal.projectId))throw new AgentError('카카오톡 제안의 프로젝트를 현재 워크스페이스에서 확인하지 못했습니다.','KAKAO_EVIDENCE',422);
 if(proposal.kind==='event'||proposal.projectId)return {id:proposal.projectId,project:undefined};
 const existing=data.projects.find(p=>p.id==='kakao-inbox');
 const project:Project|undefined=existing?undefined:{id:'kakao-inbox',name:'카카오톡 검토함',color:'#6c7e9a',symbol:'톡',goal:'읽은 카카오톡 대화에서 확인한 업무',due:addDays(today,90),priority:3,status:'active'};
 return {id:'kakao-inbox',project};
}
async function stage(capture:KakaoCapture,proposal:KakaoProposal,data:WorkspaceData,revision:number,conversationId:string):Promise<AgentAction>{
 const cited=validateCitations(capture,proposal.citations),today=todayInZone('Asia/Seoul');
 const key=JSON.stringify([capture.rooms.map(r=>r.id).sort(),proposal.kind,normalize(proposal.title),proposal.kind==='event'?[proposal.date,proposal.start,proposal.end]:proposal.due]);
 const recordId='kakao-'+await stableUuid(key),id=crypto.randomUUID(),project=projectFor(data,proposal,today);
 const reason=cited.map(m=>`${m.room} · ${m.sender} · ${m.sentAt??m.sentOn}${m.timePrecision==='day'?' (날짜까지만 확인)':''}\n“${m.quote}”`).join('\n').slice(0,2000);
 const description='카카오톡에서 확인한 반영 후보 · 승인된 개인 사본\nORBIT에서 근거 확인: /?conversation='+encodeURIComponent(conversationId);
 const action:AgentAction['action']=proposal.kind==='event'
  ?{type:'event.upsert',event:{id:recordId,title:proposal.title,date:proposal.date,start:proposal.start,end:proposal.end,kind:'meeting',scope:'personal',description,...(project.id?{projectId:project.id}:{})}}
  :{type:'task.upsert',task:{id:recordId,title:proposal.title,due:proposal.due,projectId:project.id!,status:proposal.status,duration:proposal.minutes,impact:3,focus:false,definition:proposal.definition,description:description+`\n예상 소요 ${proposal.minutes}분(추정)`,scope:'personal'},...(project.project?{project:project.project}:{})};
 return {id,turnId:capture.id,conversationId,title:proposal.title,reason,action,expectedRevision:revision,state:'pending',note:'',revisitDate:null,createdAt:new Date().toISOString()};
}
export async function buildKakaoActions(capture:KakaoCapture,result:KakaoModelResult,data:WorkspaceData,revision:number,conversationId:string,pending:AgentAction[]){
 const questions=[...result.questions],actions:AgentAction[]=[];
 for(const proposal of result.proposals){
  if(!proposal.confirmed){questions.push(`‘${proposal.title}’의 확정 여부와 날짜·시간을 확인해 주세요.`);continue;}
  if(proposal.kind==='event'&&data.preferences.timeZone!=='Asia/Seoul'){questions.push(`‘${proposal.title}’은 한국 시간 기준 대화입니다. ORBIT 시간대(${data.preferences.timeZone})와 달라 일정으로 만들지 않았습니다. 시간대를 확인해 주세요.`);continue;}
  if(proposal.kind==='event'&&Date.parse(zonedInstant(proposal.date,proposal.start,'Asia/Seoul'))<Date.now()){questions.push(`‘${proposal.title}’은 이미 지난 약속이어서 새 일정으로 등록하지 않았습니다.`);continue;}
  if(existingProposal(data,[...pending,...actions],proposal))continue;
  const action=await stage(capture,proposal,data,revision,conversationId);
  const recordId=action.action.type==='event.upsert'?action.action.event.id:action.action.type==='task.upsert'?action.action.task.id:'';
  if(data.events.some(e=>e.id===recordId)||data.tasks.some(t=>t.id===recordId))continue;
  actions.push(action);
 }
 return {actions,questions:[...new Set(questions)].slice(0,40)};
}
