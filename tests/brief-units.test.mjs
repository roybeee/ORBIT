import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {todayInZone,addDays} from '../lib/orbit/dates.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {collectPlanningContext} from '../lib/orbit/brief/context.ts';
import {splitCatalog,frameFor,enc,baseKey,prefixOf,depthFor,planLevel,diffKey,manifestOf,diffManifest,orderUnits,keyRecency,textChunks,joinChunks,FRAME_CHARS,MERGE_CHARS} from '../lib/orbit/brief/units.ts';
import {analysisVersion,cacheKey} from '../lib/orbit/brief/cache.ts';
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const today=todayInZone('Asia/Seoul'),date=addDays(today,1),planning={date,energy:'normal'};
const project={id:'p',name:'출시',goal:'검증 가능한 출시 결정',due:addDays(date,5),priority:5,color:'#5558e8',symbol:'P'};
const task={id:'t',title:'의사결정안',projectId:'p',status:'todo',due:date,impact:3,focus:false,duration:45,definition:'결정안 한 장'};
async function fixture(fn){const db=createDatabase(),fetch=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=fetch;db.close()}}
async function seed(db){let n=0;const send=async(action)=>{const out=await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:n,action});n=out.revision};await send({type:'project.upsert',project});await send({type:'preferences.update',preferences:{...emptyWorkspace().preferences,workDays:[0,1,2,3,4,5,6]}});await send({type:'task.upsert',task});await send({type:'task.upsert',task:{...task,id:'done',title:'출시 자료',status:'done',result:'비교자료 확정',completedOn:today}});await send({type:'note.upsert',note:{id:'n',title:'출시 회의',kind:'meeting',projectId:'p',summary:'출시 검토',body:'최종 결정: 가격 조건이 확인될 때까지 출시 확정은 보류한다. 미결: 가격 조건.',tags:[],updated:today}});await send({type:'review.save',review:{date:today,win:'비교자료 확정',block:'가격 조건 미확인',energy:'normal'}});return readWorkspace(db,'owner')}
function refs(v){if(!v||typeof v!=='object')return [];return [...new Set([...(typeof v.evidence==='string'?[v.evidence]:Array.isArray(v.evidence)?v.evidence.filter(x=>typeof x==='string'):[]),...Object.values(v).flatMap(refs)])]}
const month=today.slice(0,7);
const catalogOf=async(db,snapshot)=>(await collectPlanningContext(db,'owner',snapshot,planning,[],env)).catalog;
const insertTurn=(db,input,created)=>db.prepare("INSERT INTO orbit_agent_turns(owner_id,id,conversation_id,input,attachment_ids,status,response_json,created_at,updated_at) VALUES(?,?,'legacy',?,'[]','completed',?,?,?)").bind('owner',randomUUID(),input,JSON.stringify({text:'답변',sources:[]}),created,created).run();

test('splitCatalog is deterministic and order-independent',()=>fixture(async db=>{
 const snapshot=await seed(db);
 for(let i=0;i<4;i++)await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:(await readWorkspace(db,'owner')).revision,action:{type:'note.upsert',note:{id:'m'+i,title:'메모 '+i,kind:'meeting',projectId:'p',summary:'요약 '+i,body:'본문 '+i,tags:[],updated:addDays(today,-i)}}});
 const first=await readWorkspace(db,'owner');
 const shuffled={...first,data:{...first.data,tasks:[...first.data.tasks].reverse(),notes:[...first.data.notes].sort(()=>0.5-Math.random())}};
 const a=splitCatalog(await catalogOf(db,first)),b=splitCatalog(await catalogOf(db,shuffled));
 assert.equal(JSON.stringify(a.units),JSON.stringify(b.units));
 assert.ok(a.units.length>0);
 assert.ok(a.frame.availableWindows);assert.ok(a.frame.preferences);assert.ok(Array.isArray(a.frame.brainy.goals));
 assert.ok(a.units.every(u=>!u.key.startsWith('frame')));
 for(const unit of a.units)assert.ok(refs(unit.value).length>0,'unit '+unit.key+' carries evidence');
 assert.deepEqual(a.units.map(u=>u.key),orderUnits(a.units).map(u=>u.key),'units carry the analysis order, newest first');
 assert.equal(JSON.stringify(a.units),JSON.stringify(splitCatalog(await catalogOf(db,first)).units));
}));

test('unit keys and buckets',()=>fixture(async db=>{
 let snapshot=await seed(db);
 snapshot=await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'note.upsert',note:{id:'big',title:'원문',kind:'meeting',projectId:'p',summary:'회의 원문',body:'가나다라마바사'.repeat(6000),tags:[],updated:today}}});
 const created=today+'T09:00:00.000Z';
 await insertTurn(db,'원페이지 실행 제안 · 2026-01-01 · normal',created);
 await insertTurn(db,'가격 조건은 어떻게 되나요?',created);
 const {units}=splitCatalog(await catalogOf(db,await readWorkspace(db,'owner')));
 const byKey=Object.fromEntries(units.map(u=>[u.key,u.value]));
 assert.ok(byKey['notes/'+month].some(n=>n.id==='n'));
 assert.equal(byKey['notes/'+month].some(n=>n.id==='big'),false);
 assert.equal(byKey[`note/${month}/${today}.big`].id,'big');
 assert.equal(byKey['project/p'].tasks.length,1);assert.equal(byKey['project/p'].tasks[0].id,'t');assert.equal(byKey['project/p'].project.id,'p');
 assert.ok(byKey['done/'+month].some(t=>t.id==='done'));
 const conversations=units.filter(u=>u.key.startsWith('conversation/')).flatMap(u=>u.value);
 assert.equal(conversations.length,1);assert.equal(conversations[0].user,'가격 조건은 어떻게 되나요?');
 // Day buckets need the conversation `date` field (context.ts); assert the key shape on an explicit catalog.
 const dated=splitCatalog({conversations:[{user:'질문',answer:'답',date:today,evidence:'conversation:x'},{user:'원페이지 실행 제안 · 2026-01-01 · normal',answer:'계획',date:today,evidence:'conversation:y'}]});
 assert.deepEqual(dated.units.map(u=>u.key),[`conversation/${month}/${today}`]);assert.equal(dated.units[0].value.length,1);
 assert.ok(units.every(u=>!u.key.startsWith('records/chief')));
 const escaped=enc('a/b#c~d.e');
 assert.ok(!/[/#~.]/.test(escaped),escaped);
 assert.equal(decodeURIComponent(escaped),'a/b#c~d.e');
}));

test('planLevel groups by prefix, chunks by size, passthrough single children',()=>{
 const item=(key,chars=200)=>({key,analysis:{kind:'analysis',summary:'요약 '.repeat(Math.ceil(chars/3)).slice(0,chars),evidence:['note:'+key]}});
 const items=[
  item('note/2026-09/2026-09-01.a#0'),item('note/2026-09/2026-09-01.a#1'),item('note/2026-08/2026-08-02.b'),item('project/p'),
  ...Array.from({length:40},(_,i)=>item(`conversation/2026-09/2026-09-${String(i+1).padStart(2,'0')}`,1000)),
 ];
 const deep=planLevel([...items].reverse(),3);
 assert.deepEqual(deep.find(g=>g.key==='note/2026-09/2026-09-01.a').children.map(c=>c.key),['note/2026-09/2026-09-01.a#0','note/2026-09/2026-09-01.a#1']);
 assert.ok(deep.filter(g=>g.key!=='note/2026-09/2026-09-01.a').every(g=>g.children.length===1));
 assert.equal(deep.length,items.length-1);
 const mid=planLevel(items,2);
 for(const g of mid)assert.ok(g.children.every(c=>prefixOf(c.key,2)===baseKey(g.key)),g.key);
 assert.ok(mid.some(g=>g.key==='note/2026-09'&&g.children.length===2));
 assert.ok(mid.some(g=>g.key==='note/2026-08'));assert.ok(mid.some(g=>g.key==='project/p'));
 assert.ok(mid.filter(g=>g.key.startsWith('conversation/2026-09~g')).length>=2,'40 KB of conversations exceed MERGE_CHARS');
 const small=planLevel(items,2,12000),chunks=small.filter(g=>g.key.startsWith('conversation/2026-09~g'));
 assert.ok(chunks.length>=4);
 assert.deepEqual(chunks.map(g=>g.key),chunks.map((_,i)=>'conversation/2026-09~g'+i));
 const order=chunks.flatMap(g=>g.children.map(c=>c.key));
 assert.deepEqual(order,[...order].sort());
 for(const g of small)assert.ok(JSON.stringify({key:g.key,data:g.children.map(c=>({key:c.key,...c.analysis}))}).length<=12000+200,g.key);
 for(const g of planLevel(items,2))assert.ok(JSON.stringify({key:g.key,data:g.children.map(c=>({key:c.key,...c.analysis}))}).length<=MERGE_CHARS+200,g.key);
 const root=planLevel(items,0);
 assert.ok(root.every(g=>g.key===''||/^~g\d+$/.test(g.key)));
 assert.equal(root.reduce((n,g)=>n+g.children.length,0),items.length);
 assert.equal(prefixOf('note/2026-09/x~g1',2),'note/2026-09');
 assert.equal(prefixOf('note/2026-09/x#3',9),'note/2026-09/x');
 assert.equal(prefixOf('note/2026-09/x',0),'');
 assert.equal(depthFor(2),3);assert.equal(depthFor(4),2);assert.equal(depthFor(6),1);assert.equal(depthFor(8),0);assert.equal(depthFor(12),0);
});

test('analysisVersion and cacheKey change with instructions, stage and content',async()=>{
 const a=await analysisVersion('instructions'),b=await analysisVersion('instructions x');
 assert.equal(a.length,16);assert.match(a,/^[0-9a-f]{16}$/);assert.notEqual(a,b);
 assert.equal(await analysisVersion('instructions'),a);
 const source=await cacheKey(a,'source','{"key":"notes/2026-09","data":[]}');
 assert.match(source,/^[0-9a-f]{64}$/);
 assert.notEqual(source,await cacheKey(a,'merge','{"key":"notes/2026-09","data":[]}'));
 assert.notEqual(source,await cacheKey(b,'source','{"key":"notes/2026-09","data":[]}'));
 assert.notEqual(source,await cacheKey(a,'source','{"key":"notes/2026-09","data":[1]}'));
 assert.equal(source,await cacheKey(a,'source','{"key":"notes/2026-09","data":[]}'));
});

test('frameFor respects the budget ladder',()=>fixture(async db=>{
 const catalog=await catalogOf(db,await seed(db)),cutoff=catalog.cutoff;
 const goals=Array.from({length:80},(_,i)=>({id:'g'+i,kind:'short',sentence:'목표 '+i,parentId:null,deadline:date,progress:{note:'진행 '.repeat(60),updatedOn:today},evidence:'goal:g'+i}));
 const memories=Array.from({length:60},(_,i)=>({id:'m'+i,statement:'기억 '.repeat(20)+i,updatedOn:today,evidence:'memory:m'+i}));
 const plans=[addDays(cutoff,-2),addDays(cutoff,-1),cutoff,date,addDays(date,1)].map(d=>({id:'plan-'+d,date:d,energy:'normal',budget:300,unscheduled:[],replan:{basis:'x'},items:[{id:'i',taskId:'t',start:540,end:600,reason:'r',state:'pending',role:'must',draftTask:{...task,title:'초안'}}]}));
 const operating=[{metricId:'m1',name:'매출',state:'attention',delta:1,percent:2,question:'q',hypothesis:'가설',evidence:'metric:m1'},{metricId:'m2',name:'비용',state:'normal',delta:0,percent:0,question:'q',hypothesis:'가설',evidence:'metric:m2'}];
 const plaudTools=[{name:'plaud_read',description:'d',inputSchema:{type:'object'}}];
 const large={...catalog,brainy:{...catalog.brainy,goals},personal:{...catalog.personal,confirmed:memories},previousPlans:plans,operating,plaudTools};
 const frame=frameFor(large);
 assert.ok(JSON.stringify(large).length>FRAME_CHARS);
 assert.ok(JSON.stringify(frame).length<=FRAME_CHARS,String(JSON.stringify(frame).length));
 assert.equal(frame.trimmed[0],'personal.confirmed');
 assert.deepEqual(frame.personal.confirmed.slice(0,2),['memory:m0','memory:m1']);
 assert.ok(frame.preferences);assert.ok(frame.availableWindows);assert.equal(frame.budget,'표준');
 assert.deepEqual(frame.plaudTools,[{name:'plaud_read',note:'schema omitted; call plaud_tools for the full input schema'}]);
 assert.deepEqual(frame.recentPlans.map(p=>p.date),[addDays(cutoff,-1),cutoff,date]);
 assert.equal(frame.recentPlans[0].replan,undefined);
 assert.equal(frame.operating[0].hypothesis,undefined);assert.equal(frame.operating[0].metricId,'m1');assert.equal(frame.operating.length,1);assert.ok(frame.trimmed.includes('operating'));
 const smallCatalog={...catalog,previousPlans:plans,operating,plaudTools},small=frameFor(smallCatalog);
 assert.equal(small.trimmed.length,0);
 assert.deepEqual(small.recentPlans[0].items[0].draftTask,{title:'초안',projectId:'p',duration:45});
 assert.deepEqual(small.plaudTools.map(t=>Object.keys(t)),[['name','note']]);
 assert.equal(small.operating.length,2);assert.ok(small.operating.every(s=>s.hypothesis===undefined&&s.evidence));
 assert.equal(small.chief.responses,undefined);assert.equal(small.chief.careRoutines,undefined);
 assert.equal(JSON.stringify(splitCatalog(smallCatalog).frame),JSON.stringify(small));
}));

test('textChunks round-trips surrogate pairs',()=>{
 const pizza='🍕';
 let text='';while(text.length<50000){const gap=15999-(text.length%16000);text+='가'.repeat(gap>0?gap:16000)+pizza}
 text=text.slice(0,50000);if(/[\uD800-\uDBFF]$/.test(text))text+=pizza.slice(1);
 const chunks=textChunks(text);
 assert.ok(chunks.length>=4);
 for(const c of chunks){assert.ok(c.length<=16000);assert.ok(!/[\uD800-\uDBFF]$/.test(c),'no chunk ends with a lone high surrogate');assert.ok(!/^[\uDC00-\uDFFF]/.test(c))}
 assert.ok(chunks.some(c=>c.length===15999));
 assert.equal(joinChunks(chunks.map(c=>({content:c}))),text);
 assert.deepEqual(textChunks(''),[]);
 assert.deepEqual(textChunks('abc',2),['ab','c']);
});

test('diffKey/manifestOf/diffManifest',()=>{
 assert.equal(diffKey('note/2026-09/2026-09-22.abc#3'),'note/abc');
 assert.equal(diffKey('note/2026-09/2026-09-22.abc'),'note/abc');
 assert.equal(diffKey('notes/2026-09~g1'),'notes/2026-09');
 assert.equal(diffKey('notes/2026-09#2'),'notes/2026-09');
 assert.equal(diffKey('project/p'),'project/p');
 const first=manifestOf([{key:'note/2026-09/2026-09-22.abc#0',hash:'a'.repeat(64)},{key:'note/2026-09/2026-09-22.abc#1',hash:'b'.repeat(64)},{key:'notes/2026-09',hash:'c'.repeat(64)},{key:'project/p',hash:'d'.repeat(64)}]);
 assert.deepEqual(first,{'note/abc':'a'.repeat(16)+'b'.repeat(16),'notes/2026-09':'c'.repeat(16),'project/p':'d'.repeat(16)});
 const second=manifestOf([{key:'note/2026-10/2026-10-01.abc#0',hash:'a'.repeat(64)},{key:'note/2026-10/2026-10-01.abc#1',hash:'e'.repeat(64)},{key:'notes/2026-09',hash:'c'.repeat(64)},{key:'project/p',hash:'d'.repeat(64)}]);
 assert.deepEqual(diffManifest(first,second),{added:0,modified:1,deleted:0,keys:['note/abc']});
 assert.deepEqual(diffManifest(first,first),{added:0,modified:0,deleted:0,keys:[]});
 const {'project/p':_gone,...removed}=second;
 assert.deepEqual(diffManifest(first,{...removed,'event/2026-09':'f'.repeat(16)}),{added:1,modified:1,deleted:1,keys:['project/p','note/abc','event/2026-09']});
 const many=Object.fromEntries(Array.from({length:70},(_,i)=>['done/'+String(i).padStart(3,'0'),'x']));
 const capped=diffManifest(many,{});
 assert.equal(capped.deleted,70);assert.equal(capped.keys.length,60);assert.equal(capped.keys[0],'done/000');
});

test('units are ordered newest first, with the undated current state ahead of history',()=>{
 const u=k=>({key:k,value:[]});
 const ordered=orderUnits([
  u('conversation/2026-04/2026-04-09'),u('note/2026-09/2026-09-22.abc'),u('project/ofd'),
  u('done/2026-09'),u('conversation/2026-09/2026-09-06'),u('records/decisions'),
  u('review/2026'),u('event/2026-10'),u('notes/2026-04'),u('project/-'),
 ]).map(x=>x.key);
 // Undated first (stable by key), then by the date in the key, newest to oldest.
 assert.deepEqual(ordered,[
  'project/-','project/ofd','records/decisions',
  'event/2026-10','note/2026-09/2026-09-22.abc','conversation/2026-09/2026-09-06','done/2026-09',
  'conversation/2026-04/2026-04-09','notes/2026-04','review/2026',
 ]);
 assert.equal(keyRecency('conversation/2026-09/2026-09-06'),'2026-09-06');
 assert.equal(keyRecency('done/2026-09'),'2026-09-00');
 assert.equal(keyRecency('review/2026'),'2026-00-00');
 assert.equal(keyRecency('project/ofd'),'');
 // Total and deterministic: the same input in any arrival order gives the same sequence.
 const shuffled=orderUnits([...[...ordered].reverse()].map(u)).map(x=>x.key);
 assert.deepEqual(shuffled,ordered);
});

test('the manifest identifies content, not the order units were processed in',()=>{
 const leaves=[{key:'notes/2026-09',hash:'a'.repeat(64)},{key:'note/2026-09/2026-09-22.x#0',hash:'b'.repeat(64)},{key:'note/2026-09/2026-09-22.x#1',hash:'c'.repeat(64)}];
 assert.deepEqual(manifestOf(leaves),manifestOf([...leaves].reverse()));
 assert.deepEqual(diffManifest(manifestOf(leaves),manifestOf([...leaves].reverse())),{added:0,modified:0,deleted:0,keys:[]});
});
