import test from 'node:test';
import assert from 'node:assert/strict';
import {illustrationScreens} from '../lib/orbit/city-themes.ts';
import {areas,tabAreas,areaOf,viewLabels,searchEntries,searchScreens,inboxCounts,badgeText,orderNeedsDecision} from '../lib/orbit/navigation.ts';

const allViews=[...illustrationScreens];

test('every screen belongs to exactly one area and keeps its View id',()=>{
 const placed=areas.flatMap(a=>a.views);
 assert.equal(new Set(placed).size,placed.length,'no screen may appear in two areas');
 assert.deepEqual([...placed].sort(),[...allViews].sort(),'every View id must be placed');
 for(const view of allViews)assert.ok(viewLabels[view],`${view} needs a visible label`);
});

test('the bottom bar has four question tabs around the Orbit button',()=>{
 assert.deepEqual(tabAreas.map(a=>a.label),['오늘','결재함','프로젝트','기록']);
 assert.equal(areaOf('today').id,'today');
 assert.equal(areaOf('calendar').id,'today');
 assert.equal(areaOf('followup').id,'inbox');
 assert.equal(areaOf('agent').kind,'dock');
 assert.equal(areaOf('backup').kind,'menu');
 assert.equal(tabAreas[0].views[0],'today','the first tab opens on 오늘');
});

test('search finds screens by their current and former names',()=>{
 const find=q=>searchScreens(q).map(e=>e.view);
 assert.ok(find('결정').includes('followup'));
 assert.ok(find('전체 현황').includes('dashboard'));
 assert.ok(find('알림').includes('inbox'),'notifications moved into the inbox');
 assert.ok(find('검토함').includes('inbox'),'the chat review box moved into the inbox');
 assert.ok(find('대화').includes('agent'));
 assert.ok(find('ASIDE').includes('aside'),'latin names are case-insensitive');
 assert.ok(find('aside').includes('aside'));
 assert.ok(find('  시간   배분 ').includes('portfolio'),'whitespace is ignored');
 assert.equal(searchScreens('').length,searchEntries().length,'an empty query lists every screen');
 assert.deepEqual(searchScreens('존재하지않는화면'),[]);
});

test('inbox count adds only decisions the owner must make',()=>{
 const counts=inboxCounts({
  today:'2026-09-26',
  proposals:[
   {date:'2026-09-25',items:[{state:'pending'}]},
   {date:'2026-09-26',items:[{state:'pending'},{state:'approved'}]},
   {date:'2026-09-27',items:[{state:'pending'},{state:'deferred'}]},
  ],
  aiPending:2,
  orders:[{status:'waiting_for_approval'},{status:'completed'},{status:'completed',review:'accepted'},{status:'running'}],
  decisions:[{status:'active',reviewDate:'2026-09-26'},{status:'closed',reviewDate:'2026-09-01'},{status:'active',reviewDate:'2026-09-30'}],
  delegations:[{status:'working',checkDate:'2026-09-20'},{status:'verified',checkDate:'2026-09-20'},{status:'cancelled',checkDate:'2026-09-20'}],
 });
 // A finished order waits for no decision: its result arrives as a 소식 notice and is reviewed in 업무 진행.
 assert.deepEqual(counts,{plans:2,ai:2,orders:1,followups:2,total:7});
});

test('only an order waiting for execution approval is a decision',()=>{
 assert.equal(orderNeedsDecision({status:'waiting_for_approval'}),true);
 for(const status of ['completed','running','failed','cancelled'])assert.equal(orderNeedsDecision({status}),false,status);
});

test('inbox count tolerates missing collections and unknown AI state',()=>{
 assert.deepEqual(inboxCounts({today:'2026-09-26',proposals:[],aiPending:null,orders:[]}),{plans:0,ai:0,orders:0,followups:0,total:0});
});

test('badge text is empty at zero and capped at 99+',()=>{
 assert.equal(badgeText(0),'');
 assert.equal(badgeText(7),'7');
 assert.equal(badgeText(120),'99+');
});
