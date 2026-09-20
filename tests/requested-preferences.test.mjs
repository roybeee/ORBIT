import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {workspaceWithRequestedPreferences} from '../db/requested-preferences.ts';
import {chiefOfStaff} from '../lib/orbit/chief.ts';
const owner='sKibsOUhWF6NEYA1xneShn25agzo4eAVZZ0yvy5bVoEAZMlpCn53ky';
test('requested 19:00 cutoff persists once, preserves other settings and respects later edits',async()=>{
 const db=createDatabase();try{
  const initial=await readWorkspace(db,owner);
  await writeCommand(db,owner,{operationId:randomUUID(),expectedRevision:0,action:{type:'preferences.update',preferences:{...initial.data.preferences,bufferFraction:.25,workEnd:1080}}});
  const changed=await workspaceWithRequestedPreferences(db,owner);
  assert.equal(changed.data.preferences.workEnd,1140);assert.equal(changed.data.preferences.bufferFraction,.25);
  assert.equal(chiefOfStaff(changed.data,new Date('2026-09-21T03:00:00Z')).timeBudget.end,1140);
  assert.equal((await workspaceWithRequestedPreferences(db,owner)).revision,changed.revision);
  await writeCommand(db,owner,{operationId:randomUUID(),expectedRevision:changed.revision,action:{type:'preferences.update',preferences:{...changed.data.preferences,workEnd:1200}}});
  assert.equal((await workspaceWithRequestedPreferences(db,owner)).data.preferences.workEnd,1200);
  const other=await workspaceWithRequestedPreferences(db,'another-owner');
  assert.equal(other.revision,0);assert.equal(other.data.preferences.workEnd,1080);
 }finally{db.close()}
});
test('concurrent loads apply the requested preference only once',async()=>{
 const db=createDatabase();try{
  const results=await Promise.all([workspaceWithRequestedPreferences(db,owner),workspaceWithRequestedPreferences(db,owner)]);
  assert.ok(results.every(s=>s.data.preferences.workEnd===1140));
  assert.equal((await readWorkspace(db,owner)).revision,1);
 }finally{db.close()}
});
