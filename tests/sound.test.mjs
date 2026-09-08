import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createDatabase} from './sqlite-d1.mjs';
import {readSound,writeSound} from '../lib/orbit/sound/storage.ts';
import {emptySound,soundAction} from '../lib/orbit/sound/state.ts';

const config={mix:{rain:65,ocean:0,wind:0,noise:18,pad:0},beatEnabled:false,beatHz:14,fade:12,engineVersion:'2.0',purposeRating:null};
const start=id=>({action:'start',id,sceneId:'rain-desk',goal:'영업자료 초안 완성',duration:1500,config});
test('sound records persist independently, checkpoint never regresses, finish retries do not duplicate',async()=>{
  const db=createDatabase(),id=randomUUID();
  try{
    await writeSound(db,'owner',start(id));
    await writeSound(db,'owner',{action:'checkpoint',id,elapsed:120,config});
    await writeSound(db,'owner',{action:'checkpoint',id,elapsed:90,config});
    assert.equal((await readSound(db,'owner')).state.active.elapsed,120);
    assert.equal((await readSound(db,'other')).state.active,null);
    const finish={action:'finish',id,elapsed:100,config,result:'partial',helpful:null,discomfort:false};
    await writeSound(db,'owner',finish);await writeSound(db,'owner',finish);
    const state=(await readSound(db,'owner')).state;
    assert.equal(state.sessions.length,1);assert.equal(state.sessions[0].elapsed,120);
    assert.equal(state.sessions[0].helpful,null);assert.equal(state.active,null);
    assert.equal(await db.prepare('SELECT owner_id FROM orbit_workspaces WHERE owner_id=?').bind('owner').first(),null);
  }finally{db.close()}
});
test('parallel favorite changes merge by retrying revisions; competing session start cannot overwrite',async()=>{
  const db=createDatabase();
  try{
    await Promise.all(['rain-desk','deep-flow','soft-pink'].map(sceneId=>writeSound(db,'owner',{action:'favorite',sceneId,enabled:true})));
    assert.deepEqual(new Set((await readSound(db,'owner')).state.favorites),new Set(['rain-desk','deep-flow','soft-pink']));
    const first=randomUUID();await writeSound(db,'owner',start(first));
    await assert.rejects(writeSound(db,'owner',start(randomUUID())),e=>e.code==='CONFLICT');
    assert.equal((await readSound(db,'owner')).state.active.id,first);
  }finally{db.close()}
});
test('backup import validates source, merges IDs, preserves other records and refuses during active playback',async()=>{
  const db=createDatabase(),id=randomUUID();
  try{
    const state={...emptySound(),favorites:['warm-brown'],routines:[{id,name:'자료 집중',scene_id:'rain-desk',duration:1500,mix_json:JSON.stringify(config)}]};
    const action=soundAction.parse({action:'import',state});
    await writeSound(db,'owner',{action:'favorite',sceneId:'deep-flow',enabled:true});
    await writeSound(db,'owner',action);await writeSound(db,'owner',action);
    assert.equal((await readSound(db,'owner')).state.routines.length,1);
    assert.deepEqual((await readSound(db,'owner')).state.favorites,['deep-flow','warm-brown']);
    await writeSound(db,'owner',start(randomUUID()));
    await assert.rejects(writeSound(db,'owner',action),e=>e.code==='CONFLICT');
    assert.equal(soundAction.safeParse({action:'import',state:{...state,favorites:['unknown']}}).success,false);
    assert.equal(soundAction.safeParse({...start(randomUUID()),duration:Infinity}).success,false);
  }finally{db.close()}
});
test('sandbox bridge rejects foreign messages, awaits real storage, keeps export cache and handles failures',async()=>{
  const sent=[],listeners={},parent={postMessage:(message,origin)=>sent.push({message,origin})};
  const context=vm.createContext({parent,location:{href:'https://orbit.test/sound-station/index.html'},URL,Map,Promise,setTimeout,clearTimeout,Error,Number,Array,JSON,structuredClone,
    window:{addEventListener:(name,fn)=>listeners[name]=fn},sc:emptySound(),ic:()=>{},TL:()=>{},Kg:()=>{},vo:()=>{},OL:()=>{},AL:emptySound,
    Hg:{parse:value=>value,safeParse:value=>({success:!!value,data:value})}});
  vm.runInContext(readFileSync(new URL('../components/orbit/sound/bridge.js',import.meta.url),'utf8'),context);
  const pending=context.Kg();const request=sent[0].message;
  assert.equal(sent[0].origin,'https://orbit.test');assert.equal(request.method,'read');
  const response={protocol:'orbit.sound.v1',type:'response',id:request.id,state:{...emptySound(),favorites:['deep-flow']}};
  listeners.message({source:parent,origin:'https://evil.test',data:response});
  listeners.message({source:{},origin:'https://orbit.test',data:response});
  assert.deepEqual(context.sc.favorites,[]);
  listeners.message({source:parent,origin:'https://orbit.test',data:response});
  assert.deepEqual((await pending).favorites,['deep-flow']);
  const write=context.vo({action:'favorite',sceneId:'rain-desk',enabled:true}),r=sent.at(-1).message;
  listeners.message({source:parent,origin:'https://orbit.test',data:{protocol:'orbit.sound.v1',type:'response',id:r.id,error:'저장 실패'}});
  await assert.rejects(write,/저장 실패/);assert.deepEqual(context.sc.favorites,['deep-flow']);
});
test('playback bridge drives original controls and never starts audio on mount or prefill',()=>{
  const calls=[],messages=[];
  const context=vm.createContext({Z:{useEffect:fn=>fn()},Q:false,C:false,A:false,D:null,r:{title:'빗소리',mode:'focus'},Me:false,l:25,b:0,f:35,Zt:false,Fe:{current:null},
    orbitSend:value=>messages.push(value),window:{},eu:()=>calls.push('toggle'),$i:()=>calls.push('pause'),p:v=>calls.push(['volume',v]),
    u:v=>calls.push(['goal',v]),o:()=>{},n:()=>{},c:()=>{},s:v=>calls.push(['minutes',v]),sa:()=>{},t:()=>{},go:[{mix:{rain:65}}],Math,Number});
  vm.runInContext(readFileSync(new URL('../components/orbit/sound/hook.js',import.meta.url),'utf8'),context);
  assert.equal(calls.length,0);assert.equal(messages[0].state.active,false);
  const bridge=context.window.__orbitSoundBridge;
  bridge.prefill({goal:'영업자료',minutes:500});assert.deepEqual(calls,[['goal','영업자료'],['minutes',180]]);
  bridge.volume(900);bridge.toggle();bridge.pause();
  assert.deepEqual(calls.slice(-3),[['volume',100],'toggle','pause']);
});
