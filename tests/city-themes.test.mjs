import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction,DomainError} from '../lib/orbit/reducer.ts';
import {actionSchema,preferencesSchema} from '../lib/orbit/validation.ts';
import {screenIllustration,projectIllustration,cityThemes,illustrationThemes} from '../lib/orbit/city-themes.ts';
import {projectWorld} from '../lib/orbit/project-world.ts';
import {readWorkspace,writeCommand,RevisionConflict} from '../db/repository.ts';
import {createDatabase} from './sqlite-d1.mjs';
import {settingsFromBackup,planSettings} from '../lib/orbit/backup-settings.ts';
const now=new Date('2026-09-19T12:00:00Z');
const project={id:'project',name:'도시 프로젝트',color:'#5558e8',symbol:'O',goal:'완성하기',due:'2026-10-01',priority:3};
const initial=()=>({...emptyWorkspace(),projects:[project]});
const change=(data,action)=>applyAction(data,actionSchema.parse(action),now);

test('ten distinct city illustrations and previews are deployable assets',()=>{
 assert.equal(cityThemes.length,10);assert.equal(new Set(cityThemes.map(c=>c.id)).size,10);
 for(const theme of illustrationThemes){assert.ok(existsSync(new URL('../public'+theme.image,import.meta.url)));assert.ok(existsSync(new URL('../public'+theme.thumbnail,import.meta.url)));}
});
test('screen choices are independent and project overrides stay consistent across views',()=>{
 let data=initial();assert.equal(screenIllustration(data.preferences,'today'),'seoul');
 data=change(data,{type:'illustration.screen',screen:'today',theme:'tokyo'});
 assert.equal(screenIllustration(data.preferences,'today'),'tokyo');assert.equal(screenIllustration(data.preferences,'calendar'),'seoul');
 data=change(data,{type:'illustration.screen',screen:'projects',theme:'london'});
 assert.equal(projectIllustration(data.preferences,'project'),'london');
 data=change(data,{type:'illustration.project',id:'project',theme:'new-york'});
 assert.equal(projectWorld('project',data.preferences).image,'/orbit-cities/new-york.webp');
 data=change(data,{type:'illustration.default',theme:'paris'});
 assert.equal(screenIllustration(data.preferences,'calendar'),'paris');assert.equal(screenIllustration(data.preferences,'today'),'tokyo');assert.equal(projectIllustration(data.preferences,'project'),'new-york');
 data=change(data,{type:'illustration.project',id:'project',theme:null});assert.equal(projectIllustration(data.preferences,'project'),'london');
 data=change(data,{type:'illustration.screen',screen:'projects',theme:null});assert.equal(projectIllustration(data.preferences,'project'),'paris');
 data=change(data,{type:'illustration.project',id:'project',theme:'orbit'});assert.match(projectWorld('project',data.preferences).image,/orbit-worlds/);
});
test('invalid themes/screens and foreign projects cannot be written',()=>{
 for(const action of [{type:'illustration.screen',screen:'unknown',theme:'seoul'},{type:'illustration.default',theme:'https://example.com/image'},{type:'illustration.project',id:'project',theme:'rome'}])assert.equal(actionSchema.safeParse(action).success,false);
 assert.throws(()=>change(initial(),{type:'illustration.project',id:'missing',theme:'beijing'}),DomainError);
});
test('work settings and backup restoration preserve city preferences',()=>{
 const stale=initial().preferences;let data=change(initial(),{type:'illustration.screen',screen:'calendar',theme:'hong-kong'});
 data=change(data,{type:'preferences.update',preferences:{...stale,workEnd:1140}});
 assert.equal(screenIllustration(data.preferences,'calendar'),'hong-kong');assert.equal(data.preferences.workEnd,1140);
 assert.equal(preferencesSchema.safeParse(data.preferences).success,true);
 const backup=settingsFromBackup(data,now.toISOString());
 const plan=planSettings(initial(),backup,['preferences']);
 assert.equal(plan.next.preferences.illustrations.screens.calendar,'hong-kong');
});
test('account storage survives reload, isolates owners, and rejects stale device writes',async()=>{
 const db=createDatabase();const cmd=(revision,action)=>({expectedRevision:revision,operationId:randomUUID(),action:actionSchema.parse(action)});
 try{
  let saved=await writeCommand(db,'alice',cmd(0,{type:'illustration.screen',screen:'today',theme:'shanghai'}),now);
  saved=await writeCommand(db,'alice',cmd(saved.revision,{type:'project.upsert',project}),now);
  saved=await writeCommand(db,'alice',cmd(saved.revision,{type:'illustration.project',id:'project',theme:'singapore'}),now);
  const reload=await readWorkspace(db,'alice');assert.equal(screenIllustration(reload.data.preferences,'today'),'shanghai');assert.equal(projectIllustration(reload.data.preferences,'project'),'singapore');
  assert.equal(screenIllustration((await readWorkspace(db,'bob')).data.preferences,'today'),'seoul');
  await assert.rejects(()=>writeCommand(db,'alice',cmd(0,{type:'illustration.default',theme:'beijing'}),now),RevisionConflict);
  assert.equal((await readWorkspace(db,'alice')).revision,saved.revision);
 }finally{db.close()}
});
