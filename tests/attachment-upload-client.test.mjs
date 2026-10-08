import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {completeAttachmentUpload} from '../lib/orbit/attachments/upload-client.ts';

const pending={id:'file',prepared:false,state:'pending'};
const ready={...pending,state:'ready'};
const finished={...ready,prepared:true};
const content={preview:new Blob(['preview']),text:'meeting',label:'image'};
function gate(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function steps(overrides={}){const calls=[];return {calls,operations:{
 original:async()=>{calls.push('original');return ready},
 prepare:async()=>{calls.push('prepare');return content},
 preview:async()=>{calls.push('preview');return ready},
 finalize:async()=>{calls.push('finalize');return finished},
 processing:()=>calls.push('processing'),...overrides,
 }}}

test('original upload and preparation start together; preview and context wait for both',async()=>{
 const original=gate(),preparation=gate(),starts=[];
 const s=steps({original:()=>{starts.push('original');return original.promise},prepare:()=>{starts.push('prepare');return preparation.promise}});
 const work=completeAttachmentUpload(pending,s.operations);
 try{
  await nextTurn();
  assert.deepEqual(starts,['original','prepare']);
  preparation.resolve(content);
  await nextTurn();
  assert.deepEqual(s.calls,[],'no preview/context before original is ready');
  original.resolve(ready);
  assert.deepEqual(await work,finished);
  assert.deepEqual(s.calls,['processing','preview','finalize']);
 }finally{original.resolve(ready);preparation.resolve(content);await work.catch(()=>{})}
});

test('ready retry skips original upload, but finalizes only after preview succeeds',async()=>{
 const preview=gate(),s=steps({preview:()=>{s.calls.push('preview');return preview.promise}});
 const work=completeAttachmentUpload(ready,s.operations);
 await nextTurn();
 assert.ok(!s.calls.includes('original'));
 assert.ok(!s.calls.includes('finalize'));
 preview.resolve(ready);
 assert.deepEqual(await work,finished);
 assert.ok(s.calls.includes('processing'));
 assert.ok(s.calls.indexOf('preview')<s.calls.indexOf('finalize'));
});

test('already prepared retry does no preparation or network writes',async()=>{
 const s=steps();
 assert.deepEqual(await completeAttachmentUpload(finished,s.operations),finished);
 assert.deepEqual(s.calls,[]);
});

test('upload and preparation failures are both observed before permitting retry',async()=>{
 const original=gate(),preparation=gate(),s=steps({original:()=>original.promise,prepare:()=>preparation.promise});
 let settled=false;
 const work=completeAttachmentUpload(pending,s.operations).finally(()=>{settled=true});
 const outcome=assert.rejects(work,/upload failed/);
 original.reject(new Error('upload failed'));
 await nextTurn();
 assert.equal(settled,false,'retry must not race preparation from the previous attempt');
 preparation.reject(new Error('prepare failed'));
 await outcome;
 assert.deepEqual(s.calls,[]);
});

test('preparation failure waits for original completion and does not finalize',async()=>{
 const original=gate(),s=steps({original:()=>original.promise,prepare:async()=>{throw new Error('prepare failed')}});
 let settled=false;
 const work=completeAttachmentUpload(pending,s.operations).finally(()=>{settled=true});
 const outcome=assert.rejects(work,/prepare failed/);
 await nextTurn();
 assert.equal(settled,false);
 original.resolve(ready);
 await outcome;
 assert.ok(!s.calls.includes('preview'));
 assert.ok(!s.calls.includes('finalize'));
});

test('a non-ready original response cannot upload preview or finalize context',async()=>{
 const s=steps({original:async()=>pending});
 await assert.rejects(completeAttachmentUpload(pending,s.operations),/원본/);
 assert.ok(!s.calls.includes('preview'));
 assert.ok(!s.calls.includes('finalize'));
});

test('preview failure prevents finalization and a later retry can finish',async()=>{
 const failed=steps({preview:async()=>{throw new Error('preview failed')}});
 await assert.rejects(completeAttachmentUpload(ready,failed.operations),/preview failed/);
 assert.ok(!failed.calls.includes('finalize'));
 const retry=steps();
 assert.deepEqual(await completeAttachmentUpload(ready,retry.operations),finished);
 assert.ok(!retry.calls.includes('original'));
});

test('synchronous preparation errors are observed alongside the upload',async()=>{
 const original=gate(),s=steps({original:()=>original.promise,prepare:()=>{throw new Error('prepare threw')}});
 const outcome=assert.rejects(completeAttachmentUpload(pending,s.operations),/prepare threw/);
 await nextTurn();original.resolve(ready);await outcome;
 assert.ok(!s.calls.includes('finalize'));
});

test('a context response without completed preparation cannot mark the attachment ready',async()=>{
 const s=steps({finalize:async()=>ready});
 await assert.rejects(completeAttachmentUpload(ready,s.operations),/파일 준비/);
});
