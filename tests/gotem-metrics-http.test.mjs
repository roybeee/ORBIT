import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {createDatabase} from './sqlite-d1.mjs';
register('./cloudflare-loader.mjs',import.meta.url);
const db=createDatabase();
globalThis.__orbitCloudflareEnv={DB:db};
globalThis.fetch=async()=>{throw Error('No outbound calls on the metrics path')};
const {default:worker}=await import('../dist/server/index.js');
const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})}};
const call=(headers={})=>worker.fetch(new Request('https://orbit.test/api/gotem/metrics',{headers}),env,{waitUntil(){},passThroughOnException(){}});
const signedIn={'oai-authenticated-user-id':'metrics-owner','oai-authenticated-user-email':'metrics-owner@example.test'};

test('GoTEM metrics route: signed-in owner only, empty history reads as no data yet',async()=>{try{
 assert.equal((await call()).status,401);
 const response=await call(signedIn);
 assert.equal(response.status,200);
 const m=await response.json();
 assert.equal(m.morning.sent,0);
 assert.equal(m.morning.rate,null);
 assert.equal(m.morning.medianMinutes,null);
 assert.equal(m.carry.eligible,0);
 assert.equal(m.carry.rate,null);
}finally{db.close()}});
