import type {WorkspaceData,CalendarEvent} from './model.ts';
import {withDefaults} from './model.ts';
export function activeAllocation(data:WorkspaceData,date:string){return (data.weeklyAllocations??[]).find(p=>p.active&&p.from<=date&&p.through>=date)}
export function allocationAllowsWork(data:WorkspaceData,projectId:string,date:string){return activeAllocation(data,date)?.allocations.find(a=>a.projectId===projectId)?.stance!=='pause'}
export function protectedEvents(data:WorkspaceData,date:string):CalendarEvent[]{return (activeAllocation(data,date)?.protectedBlocks??[]).filter(b=>b.date===date).map(b=>({...b,id:'protected:'+b.id,kind:'break' as const}))}
export function planningEvents(events:CalendarEvent[],date:string,preferences:WorkspaceData['preferences']):CalendarEvent[]{
  const p=withDefaults(preferences),extra:CalendarEvent[]=[];
  if(p.rhythm.lunchEnd>p.rhythm.lunchStart)extra.push({id:'lunch',title:'점심',date,start:p.rhythm.lunchStart,end:p.rhythm.lunchEnd,kind:'break'});
  for(const e of events.filter(e=>e.date===date&&e.kind==='meeting'))if(p.travelMinutes>0)extra.push(
    {id:'travel-before:'+e.id,title:'이동',date,start:Math.max(0,e.start-p.travelMinutes),end:e.start,kind:'break'},
    {id:'travel-after:'+e.id,title:'이동',date,start:e.end,end:Math.min(1440,e.end+p.travelMinutes),kind:'break'});
  return [...events,...extra];
}
