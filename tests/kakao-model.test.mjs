import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {configureKakaoModel,kakaoModelSettings,disconnectKakaoModel,resolveKakaoModel} from '../lib/orbit/kakao/settings.ts';
import {kakaoModelReply} from '../lib/orbit/kakao/transport.ts';
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const config={provider:'anthropic',apiKey:'not-a-real-api-key-for-test',model:'claude-sonnet-5-5'};
async function fixture(fn){const db=createDatabase(),original=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=original;db.close()}}
test('dedicated model credentials are encrypted and public status never exposes the key',()=>fixture(async db=>{
 const saved=await configureKakaoModel(db,'owner',config,env);assert.equal(saved.configured,true);assert.equal(JSON.stringify(saved).includes(config.apiKey),false);
 const row=await db.prepare('SELECT secret_json,public_json FROM orbit_integrations WHERE owner_id=?').bind('owner').first();assert.equal(JSON.stringify(row).includes(config.apiKey),false);assert.equal((await resolveKakaoModel(db,'owner',env)).apiKey,config.apiKey);
}));
test('model credentials are owner isolated and revocable',()=>fixture(async db=>{
 await configureKakaoModel(db,'owner',config,env);assert.equal((await kakaoModelSettings(db,'other')).configured,false);assert.equal(await resolveKakaoModel(db,'other',env),null);await disconnectKakaoModel(db,'owner');assert.equal(await resolveKakaoModel(db,'owner',env),null);
}));
test('arbitrary endpoints or incompatible model identifiers cannot be saved',()=>fixture(async db=>{
 await assert.rejects(()=>configureKakaoModel(db,'owner',{...config,endpoint:'https://evil.example'},env),e=>e.code==='KAKAO_MODEL_INPUT');await assert.rejects(()=>configureKakaoModel(db,'owner',{...config,model:'gpt-bad-for-anthropic'},env),e=>e.code==='KAKAO_MODEL_INPUT');
}));
test('Anthropic requests have no tools and consume text-only completed messages',async()=>{
 const original=globalThis.fetch;try{globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');const body=JSON.parse(options.body);assert.equal(body.tools,undefined);assert.equal(body.mcp_servers,undefined);assert.equal(body.messages.length,1);assert.equal(options.redirect,'error');return Response.json({type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:'{"summary":"완료"}'}]})};assert.equal(await kakaoModelReply(config,'instructions','input'),'{"summary":"완료"}');}finally{globalThis.fetch=original}
});
test('Anthropic tool-use and truncated responses are rejected',async()=>{
 const original=globalThis.fetch;try{globalThis.fetch=async()=>Response.json({type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'tool_use',name:'send_message'}]});await assert.rejects(()=>kakaoModelReply(config,'instructions','input'),e=>e.code==='KAKAO_MODEL_FORMAT');globalThis.fetch=async()=>Response.json({type:'message',role:'assistant',stop_reason:'max_tokens',content:[{type:'text',text:'secret raw'}]});await assert.rejects(()=>kakaoModelReply(config,'instructions','input'),e=>e.code==='KAKAO_MODEL_FORMAT');}finally{globalThis.fetch=original}
});
test('provider error content does not leak into errors',async()=>{
 const original=globalThis.fetch;try{globalThis.fetch=async()=>new Response('private-provider-debug',{status:401});await assert.rejects(()=>kakaoModelReply(config,'instructions','input'),e=>e.code==='KAKAO_MODEL_UPSTREAM'&&!e.message.includes('private-provider-debug'));}finally{globalThis.fetch=original}
});
