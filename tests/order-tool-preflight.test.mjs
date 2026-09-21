import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {dispatchOrder,listOrders,orderCapabilities} from '../lib/orbit/agent/orders.ts';
import {configuredOrderTools,requiresNativeDelegation,assertOrderToolCapabilities} from '../lib/orbit/agent/order-tool-preflight.ts';
const catalog=tools=>({object:'list',platform:'api_server',data:[{enabled:true,configured:true,tools}]});
test('tool discovery distinguishes confirmed empty tools from incomplete discovery',()=>{
 assert.deepEqual(configuredOrderTools({object:'list',data:[]}),[]);
 assert.deepEqual(configuredOrderTools({object:'list',data:[{enabled:true,configured:true,tools:['terminal','delegate_task','terminal']},{enabled:false,configured:true,tools:['disabled']},{enabled:true,configured:false,tools:['unconfigured']}]}),['delegate_task','terminal']);
 for(const value of [{data:[]},{object:'list',data:[{tools:['terminal']}]},{object:'list',data:[{enabled:true,configured:true,tools:[null]}]},{object:'list',platform:'slack',data:[]}])assert.throws(()=>configuredOrderTools(value));
});
test('only explicit positive delegation commands require delegate_task',()=>{
 for(const input of ['개발팀 에이전트를 소환해서 수정해','dev-lead에게 위임해','하위 에이전트로 병렬 작업해','코드를 확인하고 개발팀에 독립 작업을 맡겨 테스트 결과를 보고해 줘.'])assert.equal(requiresNativeDelegation(input),true,input);
 for(const input of ['개발팀 회의록을 분석해 줘','에이전트 실행 오류를 수정해','dev-lead 설정 문서를 조사해','개발팀에 위임하지 말고 직접 수정해','하위 에이전트 없이 병렬 작업해','개발팀 에이전트를 소환하지 마','개발팀이 위임했는지 확인해','하위 에이전트로 병렬 작업하지 마'])assert.equal(requiresNativeDelegation(input),false,input);
});
test('confirmed missing capabilities block native work; research, ASIDE and unknown discovery remain usable',()=>{
 const empty={tools:[],discoveryError:''};
 assert.throws(()=>assertOrderToolCapabilities('native','코드를 수정해',empty),e=>e.code==='HERMES_TOOLS_MISSING');
 for(const mode of ['native','workflow']){
  assert.throws(()=>assertOrderToolCapabilities(mode,'dev-lead에게 위임해',{tools:['terminal'],discoveryError:''}),e=>e.code==='HERMES_DELEGATION_MISSING');
  assert.doesNotThrow(()=>assertOrderToolCapabilities(mode,'개발팀 에이전트를 소환해서 수정해',{tools:['delegate_task'],discoveryError:''}));
 }
 assert.doesNotThrow(()=>assertOrderToolCapabilities('research','Plaud 회의록을 분석해',empty));
 assert.doesNotThrow(()=>assertOrderToolCapabilities('workflow','ASIDE 브라우저에서 공개 메뉴를 조회해',empty));
 assert.doesNotThrow(()=>assertOrderToolCapabilities('native','개발팀에 위임하지 말고 직접 수정해',{tools:['terminal'],discoveryError:''}));
 assert.doesNotThrow(()=>assertOrderToolCapabilities('native','dev-lead에게 위임해',{tools:[],discoveryError:'조회 실패'}));
});
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const caps={object:'hermes.api_server.capabilities',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{supported:true,durable:true,retention_seconds:86400}}};
const order={type:'agent.dispatch',title:'실제 수정',instruction:'코드를 확인하고 수정해',mode:'native',projectId:null,taskIds:[]};
async function fixture(fn){const db=createDatabase(),fetch=globalThis.fetch;try{await saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'preflight-test-token',connectionId:'test'},{connected:true},env.ORBIT_ENCRYPTION_KEY);await fn(db)}finally{globalThis.fetch=fetch;db.close()}}
function upstream(toolsets){let posts=0;globalThis.fetch=async(url,init={})=>{if(url.endsWith('/v1/capabilities'))return Response.json(caps);if(url.endsWith('/v1/toolsets'))return Response.json(toolsets);if(init.method==='POST'){posts++;return Response.json({run_id:'run_preflight'},{status:202})}return Response.json({object:'hermes.run',run_id:'run_preflight',status:'running'})};return()=>posts;}
test('preflight rejection creates no execution receipt and sends no run request',()=>fixture(async db=>{
 for(const [tools,instruction,code] of [[[],order.instruction,'HERMES_TOOLS_MISSING'],[['terminal'],'개발팀 에이전트를 소환해서 수정해','HERMES_DELEGATION_MISSING'],[['terminal'],'dev-lead에게 위임해','HERMES_DELEGATION_MISSING'],[['terminal'],'하위 에이전트로 병렬 작업해','HERMES_DELEGATION_MISSING']]){
  const posts=upstream(catalog(tools));await assert.rejects(()=>dispatchOrder(db,'owner',randomUUID(),{...order,instruction},env),e=>e.code===code);assert.equal(posts(),0);assert.deepEqual(await listOrders(db,'owner'),[]);
 }
}));
test('malformed discovery reports uncertainty rather than a false missing-tools rejection',()=>fixture(async db=>{
 const posts=upstream({object:'list',data:[{tools:['terminal']}]});const discovered=await orderCapabilities(db,'owner',env);assert.ok(discovered.discoveryError);assert.deepEqual(discovered.tools,[]);const result=await dispatchOrder(db,'owner',randomUUID(),order,env);assert.equal(result.status,'running');assert.equal(posts(),1);
}));
