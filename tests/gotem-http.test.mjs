import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {createDatabase} from './sqlite-d1.mjs';
import {digest} from '../lib/orbit/slack/directives.ts';
import {writeCommand} from '../db/repository.ts';
import {handleGotem} from '../lib/orbit/slack/gotem-http.ts';
import {todayInZone} from '../lib/orbit/dates.ts';
register('./cloudflare-loader.mjs',import.meta.url);
const db=createDatabase();
globalThis.__orbitCloudflareEnv={DB:db};
globalThis.fetch=async()=>{throw Error('No outbound calls on the GoTEM path')};
const {default:worker}=await import('../dist/server/index.js');
const token='test-gotem-route-only-1234567890123456';
const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})}};
const call=(method,{query='',body,auth=token}={})=>worker.fetch(new Request('https://orbit.test/api/integrations/slack/gotem'+query,{method,headers:{...(auth?{authorization:'Bearer '+auth}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){},passThroughOnException(){}});
const sends=()=>db.prepare("SELECT date,slot,status,reason,payload_json FROM orbit_gotem_sends WHERE owner_id='demo-owner' ORDER BY slot").all().then(r=>r.results);

test('GoTEM route: scoped credential, preview without a claim, one send per day and slot',async()=>{try{
 await db.prepare('INSERT INTO orbit_slack_credentials VALUES(?,?,?,?,?,?,?)').bind(await digest(token),'demo-owner','TDEMO','UDEMO','directives:write',4102444800000,0).run();
 await db.prepare('INSERT INTO orbit_slack_credentials VALUES(?,?,?,?,?,?,?)').bind(await digest('revoked-gotem-token-12345678901234567'),'demo-owner','TDEMO','UDEMO','directives:write',4102444800000,1).run();
 const today=todayInZone('Asia/Seoul');
 await writeCommand(db,'demo-owner',{operationId:'seed-project',expectedRevision:0,action:{type:'project.upsert',project:{id:'p',name:'투자',goal:'g',due:'2099-01-01',color:'#445566',symbol:'P',priority:3,status:'active'}}});
 await writeCommand(db,'demo-owner',{operationId:'seed-task',expectedRevision:1,action:{type:'task.upsert',task:{id:'t1',title:'투자 제안서 초안',projectId:'p',status:'todo',due:today,impact:3,focus:false,duration:60,definition:'목차 한 장'}}});

 assert.equal((await call('POST',{body:{slot:'morning'},auth:''})).status,401);
 assert.equal((await call('POST',{body:{slot:'morning'},auth:'revoked-gotem-token-12345678901234567'})).status,401);
 assert.equal((await call('POST',{body:{slot:'lunch'}})).status,422);
 assert.equal((await call('GET',{query:'?slot=dawn'})).status,422);

 const preview=await call('GET',{query:'?slot=night'});
 assert.equal(preview.status,200);
 assert.equal(preview.headers.get('cache-control'),'private, no-store');
 const shown=await preview.json();
 assert.equal(shown.slot,'night');
 assert.equal(shown.send,true);
 assert.ok(shown.text.endsWith('https://orbit.test/#review'));
 assert.equal((await sends()).length,0,'a preview never claims the slot');

 const first=await (await call('POST',{body:{slot:'night'}})).json();
 assert.equal(first.send,true);
 assert.equal(first.text,shown.text);
 const again=await (await call('POST',{body:{slot:'night'}})).json();
 assert.equal(again.send,false);
 assert.equal(again.reason,'duplicate');
 assert.equal(again.text,'');

 const morning=await (await call('POST',{body:{slot:'morning'}})).json();
 assert.equal(morning.send,true);
 assert.match(morning.text,/오늘의 한 가지/);
 const afternoon=await (await call('POST',{body:{slot:'afternoon'}})).json();
 assert.equal(afternoon.send,false,'no plan yet, so nothing to check in the afternoon');

 // After the evening hour the status API targets tomorrow; the morning/afternoon message must still
 // describe today's plan (found in a local run at 23:23 KST: a saved plan was reported as missing).
 await writeCommand(db,'demo-owner',{operationId:'seed-plan',expectedRevision:2,action:{type:'proposal.generate',date:today,energy:'normal'}});
 const late=await (await handleGotem(db,new Request('https://orbit.test/api/integrations/slack/gotem?slot=morning',{headers:{authorization:'Bearer '+token}}),new Date(today+'T23:00:00+09:00'))).json();
 assert.equal(late.date,today);
 assert.equal(late.planState,'local');
 assert.doesNotMatch(late.text,/오늘 계획이 아직 없어요/);

 const rows=await sends();
 assert.deepEqual(rows.map(r=>[r.date,r.slot,r.status]),[[today,'afternoon','skipped'],[today,'morning','sent'],[today,'night','sent']]);
 assert.equal(JSON.parse(rows.find(r=>r.slot==='afternoon').payload_json).reason,'no_plan');
}finally{db.close()}});
