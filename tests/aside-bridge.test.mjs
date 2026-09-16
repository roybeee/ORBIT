import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createBridge,parseEvents,readEvents,ORIGIN} from '../scripts/aside/bridge.mjs';
const cli={command:process.execPath,prefix:[fileURLToPath(new URL('./fixtures/aside-cli.mjs',import.meta.url))]};
async function setup(){const directory=mkdtempSync(join(tmpdir(),'orbit-aside-'));const bridge=await createBridge({directory,cli,account:'paid-account',port:0});return {directory,bridge}}
async function req(bridge,path,input,headers={}){return fetch(`http://127.0.0.1:${bridge.port}`+path,{method:input?'POST':'GET',headers:{Origin:ORIGIN,Authorization:`Bearer ${bridge.token}`,...(input?{'Content-Type':'application/json'}:{}),...headers},body:input?JSON.stringify(input):undefined})}
async function until(fn){for(let i=0;i<100;i++){const result=await fn();if(result)return result;await new Promise(ok=>setTimeout(ok,20))}throw Error('Timed out')}
test('loopback authentication, origin checks and CLI feature probe',async()=>{
 const {bridge,directory}=await setup();try{
  assert.equal((await req(bridge,'/health',undefined,{Origin:'https://evil.example'})).status,403);
  assert.equal((await req(bridge,'/health',undefined,{Authorization:'Bearer wrong'})).status,401);
  assert.equal((await (await req(bridge,'/health')).json()).ready,true);
 }finally{await bridge.close();rmSync(directory,{recursive:true,force:true})}
});
test('duplicate delivery spawns once and only returns final text after CLI exits',async()=>{
 const {bridge,directory}=await setup();try{
  const runId=randomUUID(),input={runId,account:'paid-account',prompt:'Read a source and report the answer.'};
  const responses=await Promise.all([req(bridge,'/runs',input),req(bridge,'/runs',input)]);assert.deepEqual(responses.map(r=>r.status),[200,200]);
  const early=await responses[0].json();assert.equal(early.status,'running');assert.equal(early.result,'');
  assert.equal((await req(bridge,'/runs',{...input,prompt:'A different prompt entirely'})).status,409);
  const final=await until(async()=>{const r=await(await req(bridge,'/runs/'+runId)).json();return r.status==='needs_review'?r:false});
  assert.match(final.result,/Final answer/);assert.ok(!JSON.stringify(final).includes('should-not-upload'));
  assert.equal(readFileSync(join(directory,runId+'.jsonl.spawns'),'utf8'),'spawn\n');
  await req(bridge,'/runs',input);assert.equal(readFileSync(join(directory,runId+'.jsonl.spawns'),'utf8'),'spawn\n');
 }finally{await bridge.close();rmSync(directory,{recursive:true,force:true})}
});
test('cancel-before-dispatch leaves a tombstone and blocks further work until acknowledged',async()=>{
 const {bridge,directory}=await setup();try{
  const runId=randomUUID();await req(bridge,'/cancel',{runId});
  const run=await(await req(bridge,'/runs',{runId,account:'paid-account',prompt:'Do not start this cancelled job.'})).json();assert.equal(run.status,'needs_attention');
  assert.equal((await req(bridge,'/runs',{runId:randomUUID(),account:'paid-account',prompt:'Another queued job'})).status,409);
  assert.equal((await req(bridge,'/acknowledge',{runId,confirmed:true})).status,200);
  assert.equal((await(await req(bridge,'/health')).json()).blocked,false);
 }finally{await bridge.close();rmSync(directory,{recursive:true,force:true})}
});
test('restart marks ambiguous dispatch for review and recovers its log without spawning',async()=>{
 const {bridge,directory}=await setup();let next;try{
  const id=bridge.bridgeId;await bridge.close();
  const runId=randomUUID();writeFileSync(join(directory,runId+'.json'),JSON.stringify({runId,fingerprint:'old',status:'running',seq:1,progress:'starting',result:''}));
  writeFileSync(join(directory,runId+'.jsonl'),JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'Recover this partial result'}]}})+'\n');
  next=await createBridge({directory,cli,account:'paid-account',port:0});assert.equal(next.bridgeId,id);
  const run=await(await req(next,'/runs/'+runId)).json();assert.equal(run.status,'needs_attention');assert.equal(run.seq,2);assert.equal(run.result,'Recover this partial result');
  assert.equal((await(await req(next,'/health')).json()).blocked,true);
 }finally{if(next)await next.close();rmSync(directory,{recursive:true,force:true})}
});
test('completed results survive reconnection; active stop requires native-state review',async()=>{
 const {bridge,directory}=await setup();let next;try{
  const completedId=randomUUID();await req(bridge,'/runs',{runId:completedId,account:'paid-account',prompt:'Read a source and report.'});
  await until(async()=>{const run=await(await req(bridge,'/runs/'+completedId)).json();return run.status==='needs_review'});
  await bridge.close();next=await createBridge({directory,cli,account:'paid-account',port:0});
  const recovered=await(await req(next,'/runs/'+completedId)).json();assert.match(recovered.result,/Final answer/);assert.equal(recovered.status,'needs_review');
  const runId=randomUUID();await req(next,'/runs',{runId,account:'paid-account',prompt:'Please wait forever on this test.'});
  await req(next,'/cancel',{runId});
  await until(async()=>{const run=await(await req(next,'/runs/'+runId)).json();return run.status==='needs_attention'});
  assert.equal((await(await req(next,'/health')).json()).blocked,true);
 }finally{if(next)await next.close();rmSync(directory,{recursive:true,force:true})}
});
test('large image-rich log tails are bounded and preserve the final text',()=>{
 const directory=mkdtempSync(join(tmpdir(),'orbit-aside-tail-'));try{
  const file=join(directory,'large.jsonl');writeFileSync(file,'x'.repeat(17*1024*1024)+'\n'+JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'Final tail result'}]}})+'\n');
  assert.equal(readEvents(file).result,'Final tail result');
 }finally{rmSync(directory,{recursive:true,force:true})}
});
test('event parser ignores tool output and malformed/incomplete JSON',()=>{
 const input=JSON.stringify({type:'message_end',message:{role:'toolResult',content:[{type:'text',text:'secret'}]}})+'\n{"type":';
 assert.equal(parseEvents(input).result,'');
});
