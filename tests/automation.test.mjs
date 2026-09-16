import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {connectOda,readOda,automationState,changeAutomation,automationInput,odaRequest,ODA_ORIGIN} from '../lib/orbit/automation/connection.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const token='oda_int_'+randomUUID()+'.'+randomBytes(32).toString('base64url');
const caps={version:1,stores:[{id:'store1',name:'Test store'}],kinds:['revenue','expense'],routines:true,currency:'KRW'};
async function fixture(fn){const db=createDatabase(),fetch=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=fetch;db.close()}}
test('ODA connection secrets are encrypted, owner isolated and only sent to the fixed backend',()=>fixture(async db=>{
 globalThis.fetch=async(url,init)=>{assert.equal(url,ODA_ORIGIN+'/api/v2/oda/integration/capabilities');assert.equal(init.headers.Authorization,'Bearer '+token);assert.equal(init.redirect,'error');return Response.json(caps)};
 await connectOda(db,'owner',env,token);
 const row=await db.prepare('SELECT secret_json FROM orbit_automation_connections WHERE owner_id=?').bind('owner').first();assert.ok(!row.secret_json.includes(token));
 assert.equal(await readOda(db,'other',env),null);assert.equal((await readOda(db,'owner',env)).token,token);
 assert.equal((await automationState(db,'other',env)).connected,false);
 await assert.rejects(odaRequest({token},'https://other.example/'),{status:400});
}));
test('scheduled registration reuses Hermes only server-to-server; invocation retries retain caller identity',()=>fixture(async db=>{
 const calls=[];globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json(url.endsWith('/capabilities')?caps:{routine:{id:'saved'}})};
 await connectOda(db,'owner',env,token);
 await saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'private-hermes',connectionId:'connection'},{connected:true},env.ORBIT_ENCRYPTION_KEY);
 const input={action:'routine.save',id:randomUUID(),title:'Daily check',prompt:'Read the current public report',storeId:'store1',timeZone:'Asia/Seoul',time:'09:00',weekdays:[1,2,3,4,5],enabled:true,mode:'report'};
 const result=await changeAutomation(db,'owner',env,input);assert.ok(!JSON.stringify(result).includes('private-hermes'));
 const payload=JSON.parse(calls.at(-1).init.body);assert.deepEqual(payload.runner,{endpoint:'https://hermes.example.com',token:'private-hermes'});assert.ok(!('action' in payload));
 const command={action:'routine.run',id:input.id,invocationId:randomUUID()};await changeAutomation(db,'owner',env,command);await changeAutomation(db,'owner',env,command);
 assert.equal(calls.at(-1).init.body,calls.at(-2).init.body);assert.deepEqual(JSON.parse(calls.at(-1).init.body),{id:command.invocationId});
 await assert.rejects(changeAutomation(db,'other',env,input),{status:409});
}));
test('structured posting accepts refunds, rejects fractional KRW and sends no browser or owner credentials',()=>fixture(async db=>{
 const input={action:'batch.preview',batchId:randomUUID(),storeId:'store1',month:'2026-09',source:{system:'Test POS',accountRef:'store1',url:'https://example.com/reports',capturedAt:'2026-09-16T00:00:00.000Z'},lines:[{externalRef:'refund-1',date:'2026-09-15',kind:'revenue',channel:'baemin',category:'sales',description:'Refund',amountKrw:-11000,vatKrw:-1000}]};
 assert.equal(automationInput.safeParse(input).success,true);
 assert.equal(automationInput.safeParse({...input,lines:[{...input.lines[0],amountKrw:1.5}]}).success,false);
 assert.equal(automationInput.safeParse({...input,source:{...input.source,url:'https://example.com/report?token=secret'}}).success,false);
 assert.equal(automationInput.safeParse({...input,ownerId:'other'}).success,false);
 globalThis.fetch=async(url,init)=>Response.json(url.endsWith('/capabilities')?caps:{id:input.batchId,status:'awaiting_approval'});
 await connectOda(db,'owner',env,token);const result=await changeAutomation(db,'owner',env,input);assert.equal(result.status,'awaiting_approval');
}));
