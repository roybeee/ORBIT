import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {register} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
register('./cloudflare-loader.mjs',import.meta.url);
const db=createDatabase();
globalThis.__orbitCloudflareEnv={DB:db};
const {default:worker}=await import('../dist/server/index.js');
after(()=>db.close());
const identity=(id='owner-a')=>({'oai-authenticated-user-id':id,'oai-authenticated-user-email':id+'@example.test','oai-authenticated-user-full-name':'Test%20Owner','oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'});
const request=(path,init={})=>worker.fetch(new Request('https://orbit.test'+path,init),{DB:db,ASSETS:{fetch:async()=>new Response('Not found',{status:404})}},{waitUntil(){},passThroughOnException(){}});
test('anonymous browser access redirects to the platform sign-in flow',async()=>{const r=await request('/');assert.ok([302,303,307,308].includes(r.status));assert.match(r.headers.get('location')??'',/signin-with-chatgpt/)});
test('authenticated shell uses Korean, personal workspace and install manifest metadata',async()=>{const r=await request('/',{headers:identity()});assert.equal(r.status,200);const html=await r.text();assert.match(html,/Orbit 에이전트/);assert.match(html,/lang="ko"/);assert.match(html,/<link[^>]*rel="manifest"[^>]*crossorigin="use-credentials"/i);assert.match(html,/apple-touch-icon/);assert.match(html,/viewport-fit=cover/);assert.equal((html.match(/name="viewport"/g)??[]).length,1);assert.doesNotMatch(html,/새로고침하면 초기화/);assert.doesNotMatch(html,/화덕피자 파일럿 운영안 확정/)});
test('demo is clearly separated and does not create stored user records',async()=>{const before=await db.prepare('SELECT COUNT(*) as n FROM orbit_workspaces').first();const r=await request('/demo',{headers:identity()});assert.equal(r.status,200);const html=await r.text();assert.match(html,/예시 체험/);assert.match(html,/변경은 저장되지 않습니다/);assert.match(html,/화덕피자 파일럿 운영안 확정/);assert.deepEqual(await db.prepare('SELECT COUNT(*) as n FROM orbit_workspaces').first(),before)});
test('workspace API rejects anonymous reads and writes',async()=>{assert.equal((await request('/api/workspace')).status,401);assert.equal((await request('/api/workspace',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401)});
test('API rejects foreign origins and stores owner-scoped commands',async()=>{
 const action={type:'project.upsert',project:{id:'http-project',name:'HTTP persisted',color:'#5558e8',symbol:'H',goal:'Persist',due:'2026-09-30',priority:3}};
 const body=JSON.stringify({expectedRevision:0,operationId:randomUUID(),action});
 const denied=await request('/api/workspace',{method:'POST',headers:{...identity(),'content-type':'application/json',origin:'https://foreign.test'},body});assert.equal(denied.status,403);
 const saved=await request('/api/workspace',{method:'POST',headers:{...identity(),'content-type':'application/json',origin:'https://orbit.test'},body});assert.equal(saved.status,200);assert.equal((await saved.json()).revision,1);
 const owner=await request('/api/workspace',{headers:identity()});assert.match(owner.headers.get('cache-control'),/no-store/);assert.equal((await owner.json()).data.projects[0].name,'HTTP persisted');
 const other=await request('/api/workspace',{headers:identity('owner-b')});assert.equal((await other.json()).data.projects.length,0);
});

test('document and export HTTP routes enforce ownership and return complete saved bodies',async()=>{
 assert.equal((await request('/api/notes?id=n')).status,401);
 assert.equal((await request('/api/export')).status,401);
 const owner='notes-http';
 const send=async(expectedRevision,action)=>{const r=await request('/api/workspace',{method:'POST',headers:{...identity(owner),'content-type':'application/json',origin:'https://orbit.test'},body:JSON.stringify({operationId:randomUUID(),expectedRevision,action})});assert.equal(r.status,200);return r.json()};
 let state=await send(0,{type:'project.upsert',project:{id:'p',name:'Note project',color:'#5558e8',symbol:'N',goal:'Keep notes',due:'2026-09-30',priority:3}});
 state=await send(state.revision,{type:'note.upsert',note:{id:'n',title:'실제 저장 문서',kind:'meeting',projectId:'p',summary:'요약',body:'할 일: 원문 확인',tags:[],updated:'2026-09-06'}});
 assert.equal(state.data.notes[0].body,'');
 const saved=await request('/api/notes?id=n',{headers:identity(owner)});assert.equal(saved.status,200);assert.match(saved.headers.get('cache-control'),/no-store/);assert.equal((await saved.json()).body,'할 일: 원문 확인');
 assert.equal((await request('/api/notes?id=n',{headers:identity('other-owner')})).status,404);
 assert.equal((await request('/api/notes?id=n&revision=-1',{headers:identity(owner)})).status,400);
 const history=await request('/api/notes?id=n&history=1',{headers:identity(owner)});assert.equal((await history.json()).items[0].revision,1);
 const exported=await request('/api/export',{headers:identity(owner)});assert.equal(exported.status,200);assert.match(exported.headers.get('cache-control'),/no-store/);assert.equal((await exported.json()).data.notes[0].body,'할 일: 원문 확인');
});

test('desktop and phone installation guide is authenticated, launches the agent and does not alter stored records',async()=>{
 const denied=await request('/install');assert.ok([302,303,307,308].includes(denied.status));assert.match(denied.headers.get('location')??'',/signin-with-chatgpt/);
 const before=await db.prepare('SELECT COUNT(*) as n FROM orbit_workspaces').first();const page=await request('/install',{headers:identity()});assert.equal(page.status,200);const html=await page.text();
 for(const platform of ['Mac','Windows','갤럭시','iPhone'])assert.ok(html.includes(platform));
 assert.match(html,/Safari/);assert.match(html,/Dock에 추가/);assert.match(html,/href="\/\?install=mac&amp;browser=safari#agent"/);assert.match(html,/같은 ChatGPT 계정/);assert.match(html,/인터넷 연결/);
 assert.deepEqual(await db.prepare('SELECT COUNT(*) as n FROM orbit_workspaces').first(),before);
});

test('agent and integration routes require owner identity and same-origin writes',async()=>{
 for(const path of ['/api/agent','/api/integrations'])assert.equal((await request(path)).status,401);
 for(const path of ['/api/agent','/api/agent/run','/api/integrations','/api/integrations/connect','/api/integrations/sync']){
  assert.equal((await request(path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
  assert.equal((await request(path,{method:'POST',headers:{...identity(),'content-type':'application/json',origin:'https://foreign.test'},body:'{}'})).status,403);
 }
 const state=await request('/api/agent',{headers:identity('agent-http')});assert.equal(state.status,200);assert.match(state.headers.get('cache-control'),/no-store/);assert.deepEqual((await state.json()).turns,[]);
 const missing=await request('/api/agent',{method:'POST',headers:{...identity('agent-http'),'content-type':'application/json',origin:'https://orbit.test'},body:JSON.stringify({id:randomUUID(),message:'안녕하세요'})});assert.equal(missing.status,409);assert.equal((await missing.json()).code,'HERMES_SETUP');
 const callback=await request('/api/integrations/callback?state=untrusted&code=private-code',{headers:identity()});assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'/?connection_error=1#agent');assert.ok(!callback.headers.get('location').includes('private-code'));assert.match(callback.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
});

test('Plaud connect HTTP returns a usable PKCE authorization URL and secure callback cookie without registration',async()=>{
 globalThis.__orbitCloudflareEnv.ORBIT_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 globalThis.__orbitCloudflareEnv.PLAUD_OAUTH_CLIENT_ID='orbit-public-client';
 const r=await request('/api/integrations/connect',{method:'POST',headers:{...identity('plaud-http'),'content-type':'application/json',origin:'https://orbit.test'},body:JSON.stringify({provider:'plaud'})});
 assert.equal(r.status,200);const data=await r.json(),url=new URL(data.url);assert.equal(url.origin,'https://mcp.plaud.ai');assert.equal(url.searchParams.get('client_id'),'orbit-public-client');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax; Max-Age=600/);assert.match(r.headers.get('cache-control'),/no-store/);assert.ok(!JSON.stringify(data).includes('code_verifier'));assert.ok(!JSON.stringify(data).includes(globalThis.__orbitCloudflareEnv.ORBIT_ENCRYPTION_KEY));
});
