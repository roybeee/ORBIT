import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {register} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createDatabase} from './sqlite-d1.mjs';
register('./cloudflare-loader.mjs',import.meta.url);
const db=createDatabase();
globalThis.__orbitCloudflareEnv={DB:db};
const {default:worker}=await import('../dist/server/index.js');
after(()=>db.close());
const identity=(id='owner-a')=>({'oai-authenticated-user-id':id,'oai-authenticated-user-email':id+'@example.test','oai-authenticated-user-full-name':'Test%20Owner','oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'});
const request=(path,init={})=>worker.fetch(new Request('https://orbit.test'+path,init),{DB:db,ASSETS:{fetch:async()=>new Response('Not found',{status:404})}},{waitUntil(){},passThroughOnException(){}});
test('chief schedule routes require the signed-in owner and same-origin mutations',async()=>{
 assert.equal((await request('/api/agent/chief')).status,401);
 const cross=await request('/api/agent/chief',{method:'POST',headers:{...identity(),'content-type':'application/json',origin:'https://other.test'},body:JSON.stringify({action:'sync'})});assert.equal(cross.status,403);
 const sync=await request('/api/agent/chief',{method:'POST',headers:{...identity(),'content-type':'application/json'},body:JSON.stringify({action:'sync'})});assert.equal(sync.status,200);assert.equal((await sync.json()).inactive,true);
});
test('the deployed app shell cannot be HTTP-cached and exposes an authenticated live build identifier',async()=>{
 const response=await request('/',{headers:identity()});assert.match(response.headers.get('cache-control'),/no-store/);
 assert.equal((await request('/api/version')).status,401);
 const version=await request('/api/version',{headers:identity()});assert.equal(version.status,200);assert.match(version.headers.get('cache-control'),/no-store/);
 const {build}=await version.json();assert.match(build,/^\d{4}-\d{2}-\d{2}T/);
 const html=await response.text();assert.match(html,/workspace-[A-Za-z0-9_-]+\.js/);
 const assets=await readdir(new URL('../dist/client/assets/',import.meta.url));
 const bundles=await Promise.all(assets.filter(name=>/^(pwa-provider|app-version|workspace)-.*\.js$/.test(name)).map(name=>readFile(new URL('../dist/client/assets/'+name,import.meta.url),'utf8')));
 assert.ok(bundles.some(source=>source.includes(build)),'client and API must share the exact build identifier');
 assert.ok(bundles.some(source=>source.includes('목표·도미노')&&source.includes('프로젝트 보기')&&source.includes('그래프')),'deployable workspace must contain graph controls');
});
test('anonymous browser access redirects to the platform sign-in flow',async()=>{const r=await request('/');assert.ok([302,303,307,308].includes(r.status));assert.match(r.headers.get('location')??'',/signin-with-chatgpt/)});
test('authenticated shell uses Korean, personal workspace and install manifest metadata',async()=>{const r=await request('/',{headers:identity()});assert.equal(r.status,200);const html=await r.text();assert.match(html,/Orbit 에이전트/);assert.match(html,/lang="ko"/);assert.match(html,/<link[^>]*rel="manifest"[^>]*crossorigin="use-credentials"/i);assert.match(html,/apple-touch-icon/);assert.match(html,/viewport-fit=cover/);assert.equal((html.match(/name="viewport"/g)??[]).length,1);assert.doesNotMatch(html,/새로고침하면 초기화/);assert.doesNotMatch(html,/화덕피자 파일럿 운영안 확정/)});
test('demo is clearly separated and does not create stored user records',async()=>{const before=await db.prepare('SELECT COUNT(*) as n FROM orbit_workspaces').first();const r=await request('/demo',{headers:identity()});assert.equal(r.status,200);const html=await r.text();assert.match(html,/예시 체험/);assert.match(html,/변경은 저장되지 않습니다/);assert.match(html,/화덕피자 파일럿 운영안 확정/);assert.deepEqual(await db.prepare('SELECT COUNT(*) as n FROM orbit_workspaces').first(),before)});
test('workspace API rejects anonymous reads and writes',async()=>{assert.equal((await request('/api/workspace')).status,401);assert.equal((await request('/api/workspace',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401)});
test('unlinked email-only sessions show account recovery instead of redirecting to a missing sign-in page',async()=>{
 const headers={'oai-authenticated-user-email':'unlinked@example.test'};
 const r=await request('/install',{headers});assert.equal(r.status,307);assert.equal(new URL(r.headers.get('location'),'https://orbit.test').href,'https://orbit.test/account/recover?return_to=%2Finstall');
 const recovery=await request('/account/recover?return_to=%2Finstall',{headers});assert.equal(recovery.status,200);const html=await recovery.text();assert.match(html,/기존 계정에 다시 연결/);assert.match(html,/href="\/install"/);
 assert.equal((await request('/api/workspace',{headers})).status,401);
 assert.equal((await request('/api/workspace',{headers:{'oai-authenticated-user-id':'owner-a'}})).status,401);
});
test('standalone email-only sessions reuse the verified stable owner and existing records across page and API requests',async()=>{
 const stable='standalone-owner',headers=identity(stable);
 const action={type:'project.upsert',project:{id:'stable-project',name:'기존 컴퓨터와 폰의 프로젝트',color:'#5558e8',symbol:'S',goal:'Keep owner',due:'2026-09-30',priority:3}};
 const saved=await request('/api/workspace',{method:'POST',headers:{...headers,'content-type':'application/json',origin:'https://orbit.test'},body:JSON.stringify({expectedRevision:0,operationId:randomUUID(),action})});assert.equal(saved.status,200);
 const legacy={'oai-authenticated-user-email':headers['oai-authenticated-user-email']};
 const same=await request('/api/workspace',{headers:legacy});assert.equal(same.status,200);assert.equal((await same.json()).data.projects[0].id,'stable-project');
 for(const path of ['/','/install'])assert.equal((await request(path,{headers:legacy})).status,200);
 const recovered=await request('/account/recover?return_to=%2Finstall',{headers:legacy});assert.equal(recovered.status,307);assert.equal(new URL(recovered.headers.get('location'),'https://orbit.test').href,'https://orbit.test/install');
 const external=await request('/account/recover?return_to=https%3A%2F%2Fevil.test',{headers:legacy});assert.equal(new URL(external.headers.get('location'),'https://orbit.test').href,'https://orbit.test/');
 const different=await request('/api/workspace',{headers:identity('different-owner')});assert.equal((await different.json()).data.projects.length,0);
 const keys=await db.prepare('SELECT owner_id FROM orbit_workspaces WHERE owner_id=?').bind(stable).first();assert.equal(keys.owner_id,stable);
});
test('a conflicting stable identity disables email-only recovery instead of merging accounts',async()=>{
 const email='reassigned@example.test';
 const results=await Promise.all(['first-id','second-id'].map(id=>request('/api/workspace',{headers:{...identity(id),'oai-authenticated-user-email':email}})));
 for(const r of results)assert.equal(r.status,200);
 const legacy={'oai-authenticated-user-email':email};assert.equal((await request('/api/workspace',{headers:legacy})).status,401);
 await request('/api/workspace',{headers:{...identity('first-id'),'oai-authenticated-user-email':email}});
 assert.equal((await request('/api/workspace',{headers:legacy})).status,401);
});
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
 for(const path of ['/api/agent','/api/agent/conversations','/api/integrations'])assert.equal((await request(path)).status,401);
 for(const path of ['/api/agent','/api/agent/conversations','/api/agent/run','/api/integrations','/api/integrations/connect','/api/integrations/sync']){
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


test('conversation HTTP routes persist metadata and reject cross-owner reads and foreign-origin edits',async()=>{
 const owner='conversation-http',id=randomUUID(),headers={...identity(owner),'content-type':'application/json',origin:'https://orbit.test'};
 const created=await request('/api/agent/conversations',{method:'POST',headers,body:JSON.stringify({id,title:'별도 대화',projectId:null})});assert.equal(created.status,200);assert.equal((await created.json()).id,id);
 const list=await request('/api/agent/conversations',{headers});assert.match(list.headers.get('cache-control'),/no-store/);assert.equal((await list.json()).items[0].id,id);
 const state=await request('/api/agent?conversationId='+id,{headers});assert.equal(state.status,200);assert.equal((await state.json()).conversation.title,'별도 대화');
 assert.equal((await request('/api/agent?conversationId='+id,{headers:identity('foreign-owner')})).status,404);
 assert.equal((await request('/api/agent?conversationId='+id+'&before=bad',{headers})).status,400);
 const body=JSON.stringify({id,title:'정리한 대화',projectId:null,expectedRevision:0});
 assert.equal((await request('/api/agent/conversations',{method:'PATCH',headers:{...headers,origin:'https://foreign.test'},body})).status,403);
 const renamed=await request('/api/agent/conversations',{method:'PATCH',headers,body});assert.equal(renamed.status,200);assert.equal((await renamed.json()).title,'정리한 대화');
});

test('file endpoints require owner identity and same-origin writes, and stream the saved original',async()=>{
 const values=new Map();globalThis.__orbitCloudflareEnv.BUCKET={async put(key,body){const bytes=new Uint8Array(await new Response(body).arrayBuffer());values.set(key,bytes);return {size:bytes.length}},async get(key,options){const bytes=values.get(key);if(!bytes)return null;const data=options?.range?bytes.slice(options.range.offset,options.range.offset+options.range.length):bytes;return {size:bytes.length,body:new Blob([data]).stream(),arrayBuffer:async()=>data.slice().buffer}},async delete(key){values.delete(key)}};
 const owner='file-http',headers={...identity(owner),origin:'https://orbit.test','content-type':'application/json'},id=randomUUID();
 for(const path of ['/api/attachments','/api/attachments/content?id='+id,'/api/attachments/preview?id='+id])assert.equal((await request(path)).status,401);
 assert.equal((await request('/api/attachments',{method:'POST',headers:{...headers,origin:'https://foreign.test'},body:'{}'})).status,403);
 let r=await request('/api/attachments',{method:'POST',headers,body:JSON.stringify({id,name:'자료.txt',size:5})});assert.equal(r.status,200);
 r=await request('/api/attachments/content?id='+id,{method:'PUT',headers:{...headers,'content-type':'text/plain','content-length':'5'},body:'hello'});assert.equal(r.status,200);
 r=await request('/api/attachments/context',{method:'POST',headers,body:JSON.stringify({id,text:'hello',label:'텍스트'})});assert.equal(r.status,200);
 r=await request('/api/attachments/content?id='+id,{headers:identity(owner)});assert.equal(r.status,200);assert.equal(await r.text(),'hello');assert.match(r.headers.get('cache-control'),/no-store/);assert.match(r.headers.get('content-disposition'),/attachment/);
 assert.equal((await request('/api/attachments/content?id='+id,{headers:identity('file-other')})).status,404);assert.equal((await(await request('/api/attachments',{headers:identity(owner)})).json()).items[0].id,id);
});
test('share intake preserves its draft through login and unhandled POST reports failure',async()=>{
 const id=randomUUID();const r=await request('/share?draft='+id);assert.equal(r.status,307);assert.ok(decodeURIComponent(r.headers.get('location')).includes('/share?draft='+id));const page=await request('/share?draft='+id,{headers:identity()});assert.equal(page.status,200);const html=await page.text();assert.match(html,/Orbit 에이전트/);assert.ok(html.includes(id));const fallback=await request('/share-target',{method:'POST',body:'not processed'});assert.equal(fallback.status,503);assert.match(await fallback.text(),/공유/);
});

test('daily brief routes require ownership, validate the date and fall back to the local planner without Hermes',async()=>{
 assert.equal((await request('/api/brief?date=2026-10-01')).status,401);
 const headers={...identity('brief-http'),'content-type':'application/json',origin:'https://orbit.test'};
 assert.equal((await request('/api/brief?date=bad',{headers})).status,400);
 const empty=await request('/api/brief?date=2026-10-01',{headers});assert.equal(empty.status,200);assert.match(empty.headers.get('cache-control'),/no-store/);assert.equal((await empty.json()).run,null);
 const body=JSON.stringify({id:randomUUID(),date:'2026-10-01',energy:'normal'});
 assert.equal((await request('/api/brief',{method:'POST',headers:{...headers,origin:'https://foreign.test'},body})).status,403);
 // Without a connected Hermes the deterministic BRAINY planner still answers, and says so.
 const missing=await request('/api/brief',{method:'POST',headers,body});assert.equal(missing.status,200);const started=await missing.json();assert.equal(started.local,true);
 const workspace=await (await request('/api/workspace',{headers})).json();assert.equal(workspace.data.proposals.find(p=>p.date==='2026-10-01').laser.status,'none');
});

test('the packaged workspace atomically creates a keyword project and moves its task with a replay-safe response',async()=>{
 const headers={...identity('classified-owner'),'content-type':'application/json',origin:'https://orbit.test'};
 const post=async(expectedRevision,action,operationId=randomUUID())=>request('/api/workspace',{method:'POST',headers,body:JSON.stringify({expectedRevision,operationId,action})});
 const project={id:'bucket',name:'오늘 실행',color:'#5558e8',symbol:'O',goal:'',due:'2026-09-30',priority:3};
 assert.equal((await post(0,{type:'project.upsert',project})).status,200);
 const task={id:'task',title:'올드페리도넛 영업자료 완성',projectId:'bucket',status:'todo',duration:75,due:'2026-09-10',impact:3,focus:false,definition:'자료 전달'};
 assert.equal((await post(1,{type:'task.upsert',task})).status,200);
 const action={type:'task.assign',projects:[{...project,id:'ofd',name:'올드페리도넛',keywords:['올드페리도넛']}],assignments:[{id:'task',projectId:'ofd'}]},operationId=randomUUID();
 assert.equal((await post(2,action,operationId)).status,200);
 assert.equal((await post(2,action,operationId)).status,200);
 const data=(await (await request('/api/workspace',{headers})).json()).data;
 assert.equal(data.projects.length,2);assert.equal(data.tasks[0].projectId,'ofd');assert.equal(data.tasks[0].duration,75);
 const assets=await readdir(new URL('../dist/client/assets/',import.meta.url));
 const bundles=await Promise.all(assets.filter(name=>/^workspace-.*\.js$/.test(name)).map(name=>readFile(new URL('../dist/client/assets/'+name,import.meta.url),'utf8')));
 assert.ok(bundles.some(source=>source.includes('그래프 프로젝트 선택')&&source.includes('그래프에 연결된 할 일')&&source.includes('새 프로젝트')));
});

test('past and current proposal dates are accepted by the built HTTP API and available through workspace reload',async()=>{
 const headers={...identity('dated-brief-owner'),'content-type':'application/json',origin:'https://orbit.test'};
 for(const date of ['2026-01-02',new Date().toISOString().slice(0,10)]){
  const generated=await request('/api/brief',{method:'POST',headers,body:JSON.stringify({id:randomUUID(),date,energy:'normal'})});assert.equal(generated.status,200);
  const read=await request('/api/brief?date='+date,{headers});assert.equal(read.status,200);
  const workspace=await (await request('/api/workspace',{headers})).json();assert.ok(workspace.data.proposals.some(p=>p.date===date));
 }
 const invalid=await request('/api/brief',{method:'POST',headers,body:JSON.stringify({id:randomUUID(),date:'2026-02-30',energy:'normal'})});assert.equal(invalid.status,400);
});


test('wiki intake requires owner authentication and same origin, and never exposes the seed in browser bundles',async()=>{
 const path='/api/wiki',body=JSON.stringify({action:'bootstrap'}),headers={...identity('wiki-http'),'content-type':'application/json',origin:'https://orbit.test'};
 assert.equal((await request(path,{method:'POST',headers:{'content-type':'application/json'},body})).status,401);
 assert.equal((await request(path,{method:'POST',headers:{...headers,origin:'https://foreign.test'},body})).status,403);
 const unavailable=await request(path,{method:'POST',headers,body});assert.equal(unavailable.status,200);assert.deepEqual(await unavailable.json(),{available:false,imported:0});
 const seed=JSON.parse(await readFile(new URL('../lib/orbit/wiki/seed.json',import.meta.url),'utf8'));
 const assets=await readdir(new URL('../dist/client/assets/',import.meta.url));let wikiUI=false;
 for(const file of assets.filter(n=>n.endsWith('.js'))){const source=await readFile(new URL('../dist/client/assets/'+file,import.meta.url),'utf8');assert.ok(!source.includes(seed.id));assert.ok(!source.includes('ORBIT_WIKI_SEED_KEY'));if(source.includes('개인 위키 문서 연결 그래프')&&source.includes('새 정보 확인'))wikiUI=true}
 assert.ok(wikiUI);
});


test('built API accepts independent conversations while one is already running and exposes scoped busy state',async()=>{
 const owner='parallel-http',headers={...identity(owner),'content-type':'application/json',origin:'https://orbit.test'};
 const {saveConnection}=await import('../lib/orbit/agent/secrets.ts');
 globalThis.__orbitCloudflareEnv.ORBIT_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 await saveConnection(db,owner,'hermes',{endpoint:'https://hermes.example.com',token:'test',connectionId:'parallel'},{connected:true},globalThis.__orbitCloudflareEnv.ORBIT_ENCRYPTION_KEY);
 const ids=[randomUUID(),randomUUID()];
 for(const conversationId of ids){assert.equal((await request('/api/agent/conversations',{method:'POST',headers,body:JSON.stringify({id:conversationId,title:'병렬 대화',projectId:null})})).status,200);assert.equal((await request('/api/agent',{method:'POST',headers,body:JSON.stringify({id:randomUUID(),conversationId,message:'별도 업무 준비'})})).status,200)}
 const state=await (await request('/api/agent?conversationId='+ids[1],{headers})).json();assert.equal(state.activeRuns.length,2);assert.equal(state.activeRun.conversationId,ids[1]);
 assert.equal((await request('/api/agent',{method:'POST',headers,body:JSON.stringify({id:randomUUID(),conversationId:ids[1],message:'같은 대화 중복'})})).status,409);
 const fresh=await (await request('/api/agent?conversationId=new',{headers})).json();assert.equal(fresh.activeRun,null);assert.equal(fresh.activeRuns.length,2);
 const files=await readdir(new URL('../dist/client/assets/',import.meta.url));const source=(await Promise.all(files.filter(n=>/^workspace-.*\.js$/.test(n)).map(n=>readFile(new URL('../dist/client/assets/'+n,import.meta.url),'utf8')))).join('');assert.ok(source.includes('여기서도 바로 요청할 수 있어요'));assert.ok(!source.includes('완료되면 여기서 보낼 수 있어요'));
});

test('personal context HTTP endpoints are private, bounded and owner-scoped',async()=>{assert.equal((await request('/api/personal')).status,401);const response=await request('/api/personal',{headers:identity('personal-http-owner')});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal((await response.json()).turns,0);assert.equal((await request('/api/personal?q='+('a'.repeat(201)),{headers:identity()})).status,400);const search=await request('/api/personal?q=sample',{headers:identity('personal-http-owner')});assert.equal(search.status,200);assert.deepEqual((await search.json()).items,[]);});
