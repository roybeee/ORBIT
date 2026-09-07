import assert from 'node:assert/strict';
import test from 'node:test';
import {availableUpdate} from '../lib/orbit/app-version.ts';

test('an open old app detects a newer server build without using cached credentials or responses',async()=>{
  let received;
  const latest=await availableUpdate('old',async(path,options)=>{received={path,options};return Response.json({build:'new'})});
  assert.equal(latest,'new');assert.equal(received.path,'/api/version');
  assert.equal(received.options.credentials,'same-origin');assert.equal(received.options.cache,'no-store');
  assert.equal(await availableUpdate('new',async()=>Response.json({build:'new'})),null);
});
test('offline, login, failed and invalid responses never announce an update',async()=>{
  for(const fetcher of [async()=>{throw new Error('offline')},async()=>new Response('login',{status:401}),async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),async()=>Response.json({}),async()=>Response.json({build:{}}),async()=>Response.json({build:'<invalid>'})]){
    assert.equal(await availableUpdate('old',fetcher),null);
  }
});
