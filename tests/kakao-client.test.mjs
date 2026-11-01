import test from 'node:test';
import assert from 'node:assert/strict';
import {localKakaoRequest,readKakaoCaptureFile} from '../lib/orbit/kakao-client.ts';

const token='a'.repeat(64);
test('local transport fixes destination and never sends cookies or follows redirects',async()=>{
 const original=globalThis.fetch;
 try{globalThis.fetch=async(url,init)=>{assert.equal(url,'http://127.0.0.1:43128/health');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer '+token);return Response.json({protocol:1});};
 assert.deepEqual(await localKakaoRequest(token,'/health'),{protocol:1});}finally{globalThis.fetch=original}
});
test('invalid key and unsupported operation never contact a local service',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async()=>{calls++;throw new Error('unexpected')};
 await assert.rejects(()=>localKakaoRequest('short','/health'),/연결 키/);
 await assert.rejects(()=>localKakaoRequest(token,'/send'),/허용/);
 assert.equal(calls,0);}finally{globalThis.fetch=original}
});
test('local errors are bounded and an aborted scan never becomes success',async()=>{
 const original=globalThis.fetch;
 try{globalThis.fetch=async()=>Response.json({error:'미읽음 상태를 확인할 수 없습니다.'},{status:409});
 await assert.rejects(()=>localKakaoRequest(token,'/scan',{id:'x',scope:'current_read_room'}),/미읽음/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>localKakaoRequest(token,'/health',undefined,controller.signal),/중지/);
 }finally{globalThis.fetch=original}
});
test('capture file reader rejects malformed oversized or unrelated data before analysis',async()=>{
 await assert.rejects(()=>readKakaoCaptureFile({size:2000001,text:async()=>'{}'}),/크기/);
 await assert.rejects(()=>readKakaoCaptureFile({size:1,text:async()=>'{'}),/JSON/);
 await assert.rejects(()=>readKakaoCaptureFile({size:2,text:async()=>'{}'}),/수집 파일/);
 const capture={id:'test',source:'kakao-read-review',rooms:[]};
 assert.deepEqual(await readKakaoCaptureFile({size:100,text:async()=>JSON.stringify({capture})}),capture);
});
