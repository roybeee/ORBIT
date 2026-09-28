import test from 'node:test';
import assert from 'node:assert/strict';
import {runRuntimeTick} from '../scripts/runtime-tick.mjs';
const env={ORBIT_RUNTIME_TICK_URL:'https://example.chatgpt.site/api/runtime/tick',ORBIT_RUNTIME_TICK_TOKEN:'secret-runtime',ORBIT_SITES_BEARER:'secret-sites'};
function harness(statuses){
 let time=0,calls=0;const logs=[],delays=[];
 return {options:{env,now:()=>time,sleep:async ms=>{delays.push(ms);time+=ms;},log:{warn:s=>logs.push(s),info:s=>logs.push(s)},fetchImpl:async(url,init)=>{
  calls++;assert.equal(url,env.ORBIT_RUNTIME_TICK_URL);assert.equal(init.redirect,'error');assert.equal(init.method,'POST');
  assert.equal(init.headers['x-orbit-runtime-key'],env.ORBIT_RUNTIME_TICK_TOKEN);
  assert.equal(init.headers['OAI-Sites-Authorization'],'Bearer '+env.ORBIT_SITES_BEARER);
  const status=statuses.shift()??200;
  return status===200?Response.json({active:false}):new Response('private diagnostic',{status});
 }},logs,delays,calls:()=>calls,advance:ms=>{time+=ms;}};
}
for(const status of [502,503,504])test(`HTTP ${status} recovers on the next successful tick`,async()=>{
 const h=harness([status,200]);await runRuntimeTick(h.options);assert.equal(h.calls(),2);assert.deepEqual(h.delays,[1000]);assert.match(h.logs.at(-1),/complete/);assert.ok(!h.logs.join().includes('secret'));assert.ok(!h.logs.join().includes('private'));
});
test('persistent gateway errors still fail after two retries',async()=>{
 const h=harness([503,502,503,200]);await assert.rejects(runRuntimeTick(h.options),/HTTP 503/);assert.equal(h.calls(),3);assert.deepEqual(h.delays,[1000,2000]);assert.ok(!h.logs.some(s=>s.includes('complete')));
});
for(const status of [400,401,403,429,500])test(`HTTP ${status} fails without hiding it through retries`,async()=>{
 const h=harness([status,200]);await assert.rejects(runRuntimeTick(h.options),new RegExp('HTTP '+status));assert.equal(h.calls(),1);assert.deepEqual(h.delays,[]);
});
test('recovery has a hard elapsed budget',async()=>{
 const h=harness([]);h.options.fetchImpl=async()=>{h.advance(179500);return new Response('',{status:503});};
 await assert.rejects(runRuntimeTick(h.options),/HTTP 503/);assert.deepEqual(h.delays,[]);
});
test('transport errors and invalid JSON remain visible failures',async()=>{
 const h=harness([]);h.options.fetchImpl=async()=>{throw Error('secret network diagnostics');};await assert.rejects(runRuntimeTick(h.options),/^Error: Orbit runtime transport failed$/);
 h.options.fetchImpl=async()=>new Response('invalid json');await assert.rejects(runRuntimeTick(h.options),SyntaxError);
});
test('busy tick stops without another call',async()=>{
 const h=harness([]);let calls=0;h.options.fetchImpl=async()=>{calls++;return Response.json({active:true,busy:true});};await runRuntimeTick(h.options);assert.equal(calls,1);
});
test('active work retains twelve-step bound',async()=>{
 const h=harness([]);let calls=0;h.options.fetchImpl=async()=>{calls++;return Response.json({active:true});};await runRuntimeTick(h.options);assert.equal(calls,12);
});
test('invalid target or missing credentials never sends a request',async()=>{
 for(const patch of [{ORBIT_RUNTIME_TICK_URL:'https://example.com/api/runtime/tick'},{ORBIT_RUNTIME_TICK_TOKEN:''}]){
 const h=harness([]);await assert.rejects(runRuntimeTick({...h.options,env:{...env,...patch}}));assert.equal(h.calls(),0);
 }
});
