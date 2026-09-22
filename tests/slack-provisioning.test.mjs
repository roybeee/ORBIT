import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from './sqlite-d1.mjs';
import {digest,handleDirective} from '../lib/orbit/slack/directives.ts';
const moduleUrl='../lib/orbit/slack/provisioning.ts';
const admin='a'.repeat(64), app='b'.repeat(64), rotated='c'.repeat(64);
async function setup(){const service=await import(moduleUrl);const db=createDatabase();await db.prepare('INSERT INTO orbit_identity_links(email_hash,owner_id,conflicted) VALUES(?,?,0)').bind('e'.repeat(64),'owner').run();const manifest={action:'create',tokenHash:await digest(app),ownerId:'owner',emailHash:'e'.repeat(64),workspaceId:'TTEST',requesterId:'UTEST',expiresAt:Date.now()+60*60*1000};const env={ORBIT_SLACK_PROVISION_AUTH_HASH:await digest(admin),ORBIT_SLACK_PROVISION_MANIFEST:JSON.stringify(manifest)};return {db,service,manifest,env}}
async function call(s,{body='{}',method='POST',token=admin,manifest=s.manifest,env=s.env,headers={}}={}){return s.service.provisionSlackCredential(s.db,new Request('https://orbit.test/api/integrations/slack/credentials',{method,headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},...(method==='POST'?{body}:{})}),{...env,ORBIT_SLACK_PROVISION_MANIFEST:JSON.stringify(manifest)})}
test('operator provisioning exists and persists only digest; idempotent readback and expiry/revocation/rotation',async()=>{assert.ok(await import(moduleUrl).catch(()=>null),'supported operator provisioning missing');const s=await setup();try{
 assert.equal((await call(s)).status,200);assert.equal((await call(s)).status,200);
 const status=await (await call(s,{method:'GET'})).json();assert.equal(status.state,'active');assert.equal(JSON.stringify(status).includes(app),false);
 let rows=await s.db.prepare('SELECT * FROM orbit_slack_credentials').all();assert.equal(rows.results.length,1);assert.equal(rows.results[0].token_hash,await digest(app));
 const rotate={...s.manifest,action:'rotate',tokenHash:await digest(rotated),previousTokenHash:await digest(app)};
 assert.equal((await call(s,{manifest:rotate})).status,200);assert.equal((await call(s,{manifest:rotate})).status,200);
 assert.equal((await s.db.prepare('SELECT revoked FROM orbit_slack_credentials WHERE token_hash=?').bind(await digest(app)).first()).revoked,1);
 assert.equal((await call(s,{manifest:{...rotate,action:'revoke',previousTokenHash:undefined}})).status,200);
 assert.equal((await call(s,{manifest:rotate})).status,409,'never resurrect revoked credential');
 assert.equal((await handleDirective(s.db,new Request('https://orbit.test/?prepareNote=1&workspaceId=TTEST&requesterId=UTEST',{headers:{authorization:'Bearer '+rotated}}))).status,401);
 }finally{s.db.close()}});
test('no gate/app/forged identity enrollment; disabled, malformed, oversized, foreign-origin and mismatched principal fail closed',async()=>{const s=await setup();try{
 for(const token of ['',app,'test-only-sites-gate'])assert.equal((await call(s,{token,headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'forged'}})).status,401);
 assert.equal((await call(s,{env:{}})).status,401);
 assert.equal((await call(s,{body:JSON.stringify({ownerId:'victim'})})).status,422);
 assert.equal((await call(s,{body:' '.repeat(1025)})).status,413);
 assert.equal((await call(s,{headers:{origin:'https://foreign.test'}})).status,403);
 for(const patch of [{ownerId:'victim'},{emailHash:'f'.repeat(64)},{expiresAt:1},{expiresAt:Date.now()+32*86400000},{workspaceId:'wrong'},{requesterId:'wrong'},{scope:'*'},{token:app}])assert.notEqual((await call(s,{manifest:{...s.manifest,...patch}})).status,200);
 await s.db.prepare('UPDATE orbit_identity_links SET conflicted=1').run();assert.equal((await call(s)).status,403);
 assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM orbit_slack_credentials').first()).n,0);
 }finally{s.db.close()}});
test('immutable token principal and rotation require matching old principal; revocation never deletes receipts',async()=>{const s=await setup();try{
 await call(s);assert.equal((await call(s,{manifest:{...s.manifest,requesterId:'UOTHER'}})).status,409);
 assert.equal((await call(s,{manifest:{...s.manifest,action:'rotate',tokenHash:await digest(rotated),previousTokenHash:await digest(app),requesterId:'UOTHER'}})).status,409);
 assert.equal((await call(s,{manifest:{...s.manifest,expiresAt:s.manifest.expiresAt+1}})).status,409);
 assert.equal((await call(s,{manifest:{...s.manifest,action:'revoke'}})).status,200);assert.equal((await call(s,{manifest:{...s.manifest,action:'revoke'}})).status,200);assert.equal((await call(s)).status,409);
 assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM orbit_slack_credentials').first()).n,1);
 }finally{s.db.close()}});


test('rotation rechecks revoked predecessor and identity at commit',async()=>{for(const mode of ['revoke','identity']){const s=await setup();try{await call(s);const batch=s.db.batch.bind(s.db);s.db.batch=async statements=>{if(mode==='revoke')await s.db.prepare('UPDATE orbit_slack_credentials SET revoked=1').run();else await s.db.prepare('UPDATE orbit_identity_links SET conflicted=1').run();return batch(statements)};const r=await call(s,{manifest:{...s.manifest,action:'rotate',previousTokenHash:await digest(app),tokenHash:await digest(rotated)}});assert.equal(r.status,409);assert.equal(await s.db.prepare('SELECT token_hash FROM orbit_slack_credentials WHERE token_hash=?').bind(await digest(rotated)).first(),null)}finally{s.db.close()}}});
