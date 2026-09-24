import type {WorkspaceData,CalendarEvent,Improvement} from './model.ts';
import {withDefaults} from './model.ts';
export function activeAllocation(data:WorkspaceData,date:string){return (data.weeklyAllocations??[]).find(p=>p.active&&p.from<=date&&p.through>=date)}
export function allocationAllowsWork(data:WorkspaceData,projectId:string,date:string){return activeAllocation(data,date)?.allocations.find(a=>a.projectId===projectId)?.stance!=='pause'}
export function protectedEvents(data:WorkspaceData,date:string):CalendarEvent[]{return (activeAllocation(data,date)?.protectedBlocks??[]).filter(b=>b.date===date).map(b=>({...b,id:'protected:'+b.id,kind:'break' as const}))}
// The one engine-applied meeting buffer: the longest active rule wins, so two adopted rules never stack.
export const meetingBufferRule=(rules:Improvement[]=[])=>rules.filter((r):r is Improvement&{effect:NonNullable<Improvement['effect']>}=>r.active&&r.effect?.type==='meetingBuffer').sort((a,b)=>b.effect.minutes-a.effect.minutes||a.id.localeCompare(b.id))[0];
export function planningEvents(events:CalendarEvent[],date:string,preferences:WorkspaceData['preferences'],rules?:Improvement[]):CalendarEvent[]{
  const p=withDefaults(preferences),extra:CalendarEvent[]=[],buffer=meetingBufferRule(rules);
  if(p.rhythm.lunchEnd>p.rhythm.lunchStart)extra.push({id:'lunch',title:'점심',date,start:p.rhythm.lunchStart,end:p.rhythm.lunchEnd,kind:'break'});
  for(const e of events.filter(e=>e.date===date&&e.kind==='meeting')){
    if(p.travelMinutes>0)extra.push(
    {id:'travel-before:'+e.id,title:'이동',date,start:Math.max(0,e.start-p.travelMinutes),end:e.start,kind:'break'},
    {id:'travel-after:'+e.id,title:'이동',date,start:e.end,end:Math.min(1440,e.end+p.travelMinutes),kind:'break'});
    if(buffer)extra.push({id:'rule-buffer:'+buffer.id+':'+e.id,title:'회의 뒤 여유',date,start:Math.min(1440,e.end+p.travelMinutes),end:Math.min(1440,e.end+p.travelMinutes+buffer.effect.minutes),kind:'break'});
  }
  return [...events,...extra];
}
