import type { Database } from '../../db/repository.ts';
import { advanceAgent } from './agent/runner.ts';
import { advanceOrder, listOrders } from './agent/orders.ts';
import { orderActive } from './agent/orders-schema.ts';
import {flushCalendarOutbox,hasCalendarDeliveryWork} from './agent/calendar-outbox.ts';
import type { Runtime } from './agent/integrations.ts';

// One durable, leased transition. The scheduler and foreground reconciliation use
// the same executor, so reconnects never create replacement remote runs.
export async function advanceRuntimeWork(db: Database, owner: string, env: Runtime, cursor = 0) {
  const jobs = await db.prepare("SELECT j.turn_id FROM orbit_hermes_jobs j JOIN orbit_agent_turns t ON t.owner_id=j.owner_id AND t.id=j.turn_id WHERE j.owner_id=? AND t.status='running' ORDER BY j.turn_id").bind(owner).all<{turn_id:string}>();
  const stops = await db.prepare('SELECT id FROM orbit_agent_orders WHERE owner_id=? AND stop_requested=1').bind(owner).all<{id:string}>();
  const orders = (await listOrders(db, owner)).filter(o => orderActive(o.status) && (o.status !== 'waiting_for_approval' || !o.approval || Date.now()-Date.parse(o.updatedAt)>=60000 || stops.results.some(s=>s.id===o.id)));
  const work: {id:string;run:()=>Promise<unknown>}[] = [
    ...jobs.results.map(j => ({id:'chat:'+j.turn_id, run:()=>advanceAgent(db,owner,j.turn_id,env)})),
    ...orders.map(o => ({id:'order:'+o.id, run:()=>advanceOrder(db,owner,o.id,env,{action:'poll',id:o.id})})),
  ].sort((a,b)=>a.id.localeCompare(b.id));
  if(await hasCalendarDeliveryWork(db,owner))work.push({id:'calendar',run:async()=>{
    const deadline=Date.now()+6000;
    for(let i=0;i<3&&Date.now()<deadline;i++){await flushCalendarOutbox(db,owner,env,undefined,true);if(!await hasCalendarDeliveryWork(db,owner))break;}

  }});
  if (!work.length) return {active:false,cursor,error:''};
  const index = cursor % work.length;
  let error = '';
  try { await work[index].run(); }
  catch { error = '일부 실행 단계 재확인 필요 · 실행 결과에서 오류를 확인하세요.'; }
  return {active:true,cursor:index+1,error};
}
