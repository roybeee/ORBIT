import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {createDatabase} from './sqlite-d1.mjs';
import {digest} from '../lib/orbit/slack/directives.ts';
register('./cloudflare-loader.mjs',import.meta.url);
const db=createDatabase();
const env={DB:db};
globalThis.__orbitCloudflareEnv=env;
globalThis.fetch=async()=>{throw Error('External requests forbidden')};
const {default:worker}=await import('../dist/server/index.js');
const admin='a'.repeat(64),app='b'.repeat(64),next='c'.repeat(64);
const manifest={action:'create',tokenHash:await digest(app),ownerId:'fixture-owner',emailHash:'e'.repeat(64),workspaceId:'TTEST',requesterId:'UTEST',expiresAt:Date.now()+3600000};
const stage=m=>{env.ORBIT_SLACK_PROVISION_AUTH_HASH=undefined;env.ORBIT_SLACK_PROVISION_MANIFEST=JSON.stringify(m)};
async function enable(m=manifest){stage(m);env.ORBIT_SLACK_PROVISION_AUTH_HASH=await digest(admin)}
const send=(method='POST',{token=admin,body='{}',headers={},path='/api/integrations/slack/credentials'}={})=>worker.fetch(new Request('https://orbit.test'+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},...(method==='POST'?{body}:{})}),{...env,ASSETS:{fetch:async()=>new Response('',{status:404})}},{waitUntil(){},passThroughOnException(){}});
const count=async()=> (await db.prepare('SELECT COUNT(*) n FROM orbit_slack_credentials').first()).n;
test('built Worker HTTP credential provisioning: pinned operator auth, principal, lost ACK, rotation and revocation',async()=>{try{
 stage(manifest);assert.equal((await send()).status,401,'disabled by default');
 await enable();
 for(const token of ['',app,'sites-gate'])assert.equal((await send('POST',{token,headers:{'OAI-Sites-Authorization':'Bearer sites-gate','oai-authenticated-user-id':'fixture-owner'}})).status,401);
 assert.equal((await send()).status,403,'no identity auto-enrollment');
 await db.prepare('INSERT INTO orbit_identity_links VALUES(?,?,0)').bind(manifest.emailHash,manifest.ownerId).run();
 for(const patch of [{ownerId:'foreign'},{emailHash:'f'.repeat(64)},{expiresAt:1},{workspaceId:'invalid'},{requesterId:'invalid'},{scope:'*'}]){
  await enable({...manifest,...patch});assert.notEqual((await send()).status,200);
 }
 await enable();
 assert.equal((await send('POST',{body:JSON.stringify({...manifest,ownerId:'foreign'})})).status,422);
 assert.equal((await send('POST',{headers:{origin:'https://foreign.test'}})).status,403);
 assert.equal((await send('POST',{body:' '.repeat(1025)})).status,413);
 env.ORBIT_SLACK_PROVISION_MANIFEST='{}';assert.equal((await send()).status,422);
 await enable();await db.prepare('UPDATE orbit_identity_links SET conflicted=1').run();assert.equal((await send()).status,403);
 await db.prepare('UPDATE orbit_identity_links SET conflicted=0').run();assert.equal(await count(),0);
 assert.deepEqual(await (await send('GET')).json(),{state:'absent',matches:false});
 // Discard the successful POST body to model a lost ACK, reconcile through GET.
 assert.equal((await send()).status,200);
 const get=await send('GET');assert.equal(get.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(await get.json(),{state:'active',matches:true});
 assert.equal((await send()).status,200);assert.equal(await count(),1);
 const rows=await db.prepare('SELECT * FROM orbit_slack_credentials').all();assert.equal(rows.results[0].token_hash,await digest(app));assert.ok(!JSON.stringify(rows).includes(app));
 const prepare='/api/integrations/slack/directives?prepareNote=1&workspaceId=TTEST&requesterId=UTEST';
 assert.equal((await send('GET',{token:app,path:prepare})).status,200);
 assert.equal((await send('GET',{token:admin,path:prepare})).status,401,'operator secret is not app authority');
 await enable({...manifest,requesterId:'UOTHER'});assert.equal((await send()).status,409);
 const rotated={...manifest,action:'rotate',tokenHash:await digest(next),previousTokenHash:manifest.tokenHash};
 await enable(rotated);assert.equal((await send()).status,200);
 assert.deepEqual(await (await send('GET')).json(),{state:'active',matches:true});assert.equal((await send()).status,200);assert.equal(await count(),2);
 assert.equal((await send('GET',{token:app,path:prepare})).status,401);assert.equal((await send('GET',{token:next,path:prepare})).status,200);
 await enable({...rotated,action:'revoke',previousTokenHash:undefined});assert.equal((await send()).status,200);assert.equal((await send()).status,200);
 assert.deepEqual(await (await send('GET')).json(),{state:'revoked',matches:true});
 assert.equal((await send('GET',{token:next,path:prepare})).status,401);
 await enable(rotated);assert.equal((await send()).status,409,'cannot resurrect');
 stage(manifest);assert.equal((await send('GET')).status,401,'disable operator after maintenance');
 }finally{db.close()}});
