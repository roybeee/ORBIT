import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {createDatabase} from './sqlite-d1.mjs';
import {digest} from '../lib/orbit/slack/directives.ts';
import {writeCommand,readNote,readWorkspace} from '../db/repository.ts';
import {todayInZone} from '../lib/orbit/dates.ts';
// note.upsert stamps the server's today and the readback compares it with the wire date,
// so a fixture pinned to a past date reports target_changed from the next midnight onwards.
const today=todayInZone('Asia/Seoul');
register('./cloudflare-loader.mjs',import.meta.url);
const db=createDatabase();
globalThis.__orbitCloudflareEnv={DB:db};
globalThis.fetch=async()=>{throw Error('Provider writes are blocked')};
const {default:worker}=await import('../dist/server/index.js');
test('built HTTP route demo: scoped binding, atomic knowledge note, operation reconciliation',async()=>{try{
 const token='test-built-route-only-123456789012345';
 await db.prepare('INSERT INTO orbit_slack_credentials VALUES(?,?,?,?,?,?,?)').bind(await digest(token),'demo-owner','TDEMO','UDEMO','directives:write',4102444800000,0).run();
 await writeCommand(db,'demo-owner',{operationId:'seed',expectedRevision:0,action:{type:'project.upsert',project:{id:'ofd',name:'OFD',goal:'Progress',due:'2099-01-01',color:'#4455cc',symbol:'O',priority:3,status:'active'}}});
 const send=(query='',body)=>worker.fetch(new Request('https://orbit.test/api/integrations/slack/directives'+query,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})}},{waitUntil(){},passThroughOnException(){}});
 const resolution=await send('?resolveProjectId=ofd&workspaceId=TDEMO&requesterId=UDEMO');assert.equal(resolution.status,200);const binding=await resolution.json();
 const wire={operationKey:'built-demo',source:{platform:'slack',workspaceId:'TDEMO',requesterId:'UDEMO',channelId:'CDEMO',messageTs:'1790043198.626399',eventId:'EvDEMO'},providerStatus:'succeeded',providerError:'',project:{id:'ofd'},binding,change:{kind:'note',title:'Progress',text:'1) 원문\n2) ordered text',date:today}};
 const response=await send('',wire);assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.status,'completed');assert.equal((await readNote(db,'demo-owner',saved.target.id)).body,wire.change.text);
 const recovered=await send('?operationKey=built-demo');assert.equal((await recovered.json()).id,saved.id);assert.equal((await (await send('',wire)).json()).id,saved.id);
 const ambiguous={...wire,operationKey:'ambiguous'};delete ambiguous.project;delete ambiguous.binding;const pending=await (await send('',ambiguous)).json();assert.equal(pending.status,'needs_confirmation');assert.deepEqual(pending.candidates,['ofd']);assert.equal(pending.target,null);
 // Change only canonical kind, keeping every previously verified field intact.
 const before=await readNote(db,'demo-owner',saved.target.id);assert.equal(before.kind,'knowledge');
 await writeCommand(db,'demo-owner',{operationId:'kind-only',expectedRevision:(await readWorkspace(db,'demo-owner')).revision,action:{type:'note.upsert',note:{...before,kind:'wiki'}}});
 const changed=await (await send('?id='+saved.id)).json();
 assert.deepEqual(changed.target.note,{...saved.target.note,kind:'wiki',revision:saved.target.note.revision+1});
 assert.equal(changed.status,'target_changed');
 assert.equal((await (await send('?operationKey=built-demo')).json()).status,'target_changed');
 assert.equal((await (await send('',wire)).json()).status,'target_changed');
}finally{db.close()}});
