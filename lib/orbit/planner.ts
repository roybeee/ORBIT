import type {Task,CalendarEvent,ProposalItem,Proposal,Preferences} from './model';
export function overlaps(a:{start:number;end:number},b:{start:number;end:number}){return a.start<b.end&&a.end>b.start;}
export function availableWindows(events:CalendarEvent[],date:string,workStart=540,workEnd=1080){
  const busy=events.filter(e=>e.date===date&&e.end>workStart&&e.start<workEnd).map(e=>({start:Math.max(workStart,e.start),end:Math.min(workEnd,e.end)})).sort((a,b)=>a.start-b.start);
  let cursor=workStart;const windows:{start:number;end:number}[]=[];
  for(const event of busy){if(event.start>cursor)windows.push({start:cursor,end:event.start});cursor=Math.max(cursor,event.end);}
  if(cursor<workEnd)windows.push({start:cursor,end:workEnd});return windows;
}
export function generateProposal(tasks:Task[],events:CalendarEvent[],date:string,energy:Proposal['energy']='normal',previous?:Proposal,preferences?:Preferences,orderedTaskIds?:string[]):Proposal{
  const retained=previous?.date===date?previous.items.filter(i=>i.state!=='pending'):[];
  const reserved=retained.filter(i=>i.state==='approved').map(i=>({id:i.id,title:'승인한 집중 시간',date,start:i.start,end:i.end,kind:'focus' as const,taskId:i.taskId}));
  const reservations=events.filter(e=>!reserved.some(r=>r.taskId===e.taskId&&e.date===date)).concat(reserved);
  const workday=new Date(date+'T12:00:00Z').getUTCDay();
  const windows=preferences&&!preferences.workDays.includes(workday)?[]:availableWindows(reservations,date,preferences?.workStart??540,preferences?.workEnd??1080);
  const free=windows.reduce((sum,w)=>sum+w.end-w.start,0);
  const budget=Math.floor(free*({low:Math.min(.5,1-(preferences?.bufferFraction??.2)),normal:1-(preferences?.bufferFraction??.2),high:1-(preferences?.bufferFraction??.2)}[energy]));
  let remaining=budget;
  const isReady=(t:Task)=>t.status!=='waiting'&&t.status!=='done'&&(!t.planHoldUntil||t.planHoldUntil<=date)&&!(t.dependsOn??[]).some(id=>tasks.find(t=>t.id===id)?.status!=='done');
  const candidates=tasks.filter(t=>(!orderedTaskIds||orderedTaskIds.includes(t.id))&&isReady(t)&&!retained.some(i=>i.taskId===t.id)&&!events.some(e=>e.date===date&&e.taskId===t.id));
  const score=(t:Task)=>t.impact*10+(t.due<=date?30:0)+(t.focus?15:0)+(t.status==='doing'?5:0)+(energy==='high'&&t.duration>=60?8:energy==='low'&&t.duration<=30?8:0);
  candidates.sort((a,b)=>(orderedTaskIds?orderedTaskIds.indexOf(a.id)-orderedTaskIds.indexOf(b.id):0)||score(b)-score(a)||a.due.localeCompare(b.due)||a.id.localeCompare(b.id));
  const items=[...retained];const unscheduled:string[]=[];
  for(const task of candidates){
    const slot=windows.find(w=>w.end-w.start>=task.duration);
    if(!Number.isFinite(task.duration)||task.duration<1||task.duration>remaining||!slot||items.filter(i=>i.state!=='deferred').length>=(preferences?.focusLimit??3)){unscheduled.push(task.id);continue;}
    const start=slot.start,end=start+task.duration;
    items.push({id:`${date}:${task.id}`,taskId:task.id,start,end,state:'pending',reason:`${task.due<=date?'마감이 도래한 업무입니다. ':'다가오는 마감을 준비합니다. '}${task.status==='doing'?'진행하던 일을 마무리하면 작업 전환을 줄일 수 있습니다. ':'프로젝트의 다음 결과물을 만드는 일입니다. '}${energy==='low'?'낮은 에너지를 반영해 여유 시간을 늘렸습니다. ':''}고정 일정과 겹치지 않는 ${task.duration}분을 확보했습니다.`});
    slot.start=end+(preferences?.breakMinutes??10);remaining-=task.duration;
  }
  return {...(previous?.brief?{brief:previous.brief,draftTasks:previous.draftTasks}:{}),id:`plan:${date}`,date,items:items.sort((a,b)=>a.start-b.start),unscheduled,budget,energy};
}
export function approveProposalItem(proposal:Proposal,itemId:string,tasks:Task[],events:CalendarEvent[]):{proposal:Proposal;events:CalendarEvent[];error?:string}{
  const item=proposal.items.find(i=>i.id===itemId);const task=tasks.find(t=>t.id===item?.taskId);
  if(!item||!task)return {proposal,events,error:'항목을 찾을 수 없습니다.'};
  if(item.state==='approved')return {proposal,events};
  if(item.state!=='pending')return {proposal,events,error:'보류한 항목을 먼저 다시 검토해 주세요.'};
  if(task.status==='done'||task.status==='waiting'||(task.planHoldUntil&&task.planHoldUntil>proposal.date)||(task.dependsOn??[]).some(id=>tasks.find(t=>t.id===id)?.status!=='done'))return {proposal,events,error:'업무 상태가 바뀌었습니다. 제안을 다시 생성해 주세요.'};
  if(task.duration!==item.end-item.start)return {proposal,events,error:'업무의 예상 시간이 변경됐습니다. 최신 진척으로 다시 분석해 주세요.'};
  if(events.some(e=>e.date===proposal.date&&overlaps(e,item)))return {proposal,events,error:'다른 일정과 겹칩니다. 제안을 다시 생성해 주세요.'};
  const event:CalendarEvent={id:`approved:${item.id}`,title:task.title,date:proposal.date,start:item.start,end:item.end,kind:'focus',projectId:task.projectId,taskId:task.id};
  return {proposal:{...proposal,items:proposal.items.map(i=>i.id===itemId?{...i,state:'approved'}:i)},events:[...events,event]};
}
