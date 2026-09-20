import test from 'node:test';
import assert from 'node:assert/strict';
import {createOverlayStack} from '../lib/orbit/overlay-stack.ts';
function fixture(){
 const events=new EventTarget(),entries=[{url:'https://orbit.test/#today',state:{route:'today'}},{url:'https://orbit.test/#calendar',state:{route:'calendar',scroll:420}}],jobs=[],traversals=[];
 let index=1,routeChanges=0;
 const browser={location:{get href(){return entries[index].url}},history:{get state(){return entries[index].state},pushState(state,_,url){entries.splice(index+1);entries.push({state,url:new URL(url,entries[index].url).href});index++},replaceState(state,_,url){entries[index]={state,url:new URL(url,entries[index].url).href}},back(){traversals.push(-1)}},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)};
 const stack=createOverlayStack(browser,fn=>fn(),fn=>jobs.push(fn));
 browser.addEventListener('popstate',()=>routeChanges++);
 browser.addEventListener('hashchange',()=>routeChanges++);
 const runJobs=()=>{while(jobs.length)jobs.shift()()};
 const traverse=()=>{assert.ok(traversals.length);index=Math.max(0,index+traversals.shift());events.dispatchEvent(new Event('popstate'))};
 return {browser,entries,jobs,traversals,stack,runJobs,traverse,get routeChanges(){return routeChanges},skipBack(){const oldURL=browser.location.href;index=Math.max(0,index-2);const newURL=browser.location.href;events.dispatchEvent(new Event('popstate'));const event=new Event('hashchange');Object.assign(event,{oldURL,newURL});events.dispatchEvent(event);this.flush()},flush(){let guard=0;while(jobs.length||traversals.length){assert.ok(++guard<30);runJobs();if(traversals.length)traverse()}},back(){browser.history.back();this.flush()}};
}
test('event detail Back closes its Sheet and keeps the same calendar, then normal Back navigates',()=>{
 const b=fixture();let open=true;const off=b.stack.register(()=>{open=false;off()});
 b.back();assert.equal(open,false);assert.equal(b.routeChanges,0);assert.equal(b.browser.location.href,'https://orbit.test/#calendar');
 assert.deepEqual(b.browser.history.state,{route:'calendar',scroll:420});b.back();assert.equal(b.routeChanges,1);assert.equal(b.browser.location.href,'https://orbit.test/#today');
});
test('nested detail, editor and select close from the top one at a time',()=>{
 const b=fixture(),closed=[];
 const detail=b.stack.register(()=>{closed.push('detail');detail()});
 const editor=b.stack.register(()=>{closed.push('editor');editor()});
 const select=b.stack.register(()=>{closed.push('select');select()});
 assert.equal(b.entries.length,3);b.back();assert.deepEqual(closed,['select']);b.back();assert.deepEqual(closed,['select','editor']);b.back();assert.deepEqual(closed,['select','editor','detail']);assert.equal(b.routeChanges,0);
});
test('unsaved confirmation cancellation keeps the form; confirmed discard removes both layers',()=>{
 const b=fixture();let alert=null,discarded=false;
 const form=b.stack.register(()=>{if(!alert)alert=b.stack.register(()=>{alert();alert=null})});
 b.back();assert.ok(alert);b.back();assert.equal(alert,null);b.back();assert.ok(alert);
 discarded=true;alert();form();b.flush();assert.equal(discarded,true);assert.equal(b.routeChanges,0);assert.equal(b.browser.location.href,'https://orbit.test/#calendar');
});
test('a saving popup that refuses close keeps a boundary on repeated Back',()=>{
 const b=fixture();let saving=true,requests=0;const off=b.stack.register(()=>{requests++;if(!saving)off()});
 b.back();b.back();assert.equal(requests,2);assert.equal(b.routeChanges,0);assert.equal(b.entries.length,3);saving=false;b.back();assert.equal(b.routeChanges,0);
});
test('same-turn popup replacements do not traverse; delayed cleanup never closes the replacement',()=>{
 const b=fixture();let newClosed=0;const old=b.stack.register(()=>{});old();const next=b.stack.register(()=>{newClosed++;next()});b.flush();assert.equal(newClosed,0);assert.equal(b.routeChanges,0);
 next();b.runJobs();assert.equal(b.traversals.length,1);
 const late=b.stack.register(()=>{newClosed++;late()});b.flush();assert.equal(newClosed,0);assert.equal(b.routeChanges,0);b.back();assert.equal(newClosed,1);
});
test('navigation after closing waits for history cleanup before pushing the next route',()=>{
 const b=fixture();const off=b.stack.register(()=>{});off();b.stack.afterClose(()=>b.browser.history.pushState({route:'projects'},'','#projects'));
 b.flush();assert.equal(b.browser.location.href,'https://orbit.test/#projects');assert.equal(b.routeChanges,0);b.back();assert.equal(b.browser.location.href,'https://orbit.test/#calendar');
});
test('URL metadata replacements preserve the sentinel and survive popup dismissal',()=>{
 const b=fixture();const off=b.stack.register(()=>off());b.stack.replace({route:'calendar'},'/?conversation=test#calendar');b.back();assert.equal(b.browser.location.href,'https://orbit.test/?conversation=test#calendar');assert.equal(b.routeChanges,0);assert.deepEqual(b.browser.history.state,{route:'calendar'});
});
test('a nested popup mounted with its parent closes before the parent layout effect',()=>{
 const b=fixture(),parentId=Symbol(),childId=Symbol(),closed=[];
 const child=b.stack.register(()=>{closed.push('child');child()},{id:childId,parent:parentId});
 const parent=b.stack.register(()=>{closed.push('parent');parent()},{id:parentId});
 b.back();assert.deepEqual(closed,['child']);b.back();assert.deepEqual(closed,['child','parent']);
});
test('new-project save can replace its editor with details on a new route without leaving a stale boundary',()=>{
 const b=fixture(),off=b.stack.register(()=>{});off();let detailClosed=false;
 const detail=b.stack.register(()=>{detailClosed=true;detail()});
 b.stack.afterClose(()=>b.stack.push({route:'projects'},'#projects'));b.flush();
 assert.equal(b.browser.location.href,'https://orbit.test/#projects');b.back();assert.equal(detailClosed,true);assert.equal(b.routeChanges,0);assert.equal(b.browser.location.href,'https://orbit.test/#projects');
 b.back();assert.equal(b.browser.location.href,'https://orbit.test/#calendar');
});
test('an async iframe popup stays below an already-open host dialog',()=>{
 const b=fixture(),closed=[];
 const settings=b.stack.register(()=>{closed.push('settings');settings()});
 const sound=b.stack.register(()=>{closed.push('sound');sound()},{id:Symbol(),priority:-1});
 b.back();assert.deepEqual(closed,['settings']);b.back();assert.deepEqual(closed,['settings','sound']);
});

test('event editor replaces details; discard returns to calendar without reopening detail or leaving the route',()=>{
 const b=fixture();const detail=b.stack.register(()=>{});detail();let confirm;
 const editor=b.stack.register(()=>{confirm=b.stack.register(()=>{confirm();confirm=undefined})});
 b.flush();b.back();assert.ok(confirm);assert.equal(b.routeChanges,0);
 confirm();editor();b.flush();assert.equal(b.browser.location.href,'https://orbit.test/#calendar');assert.equal(b.routeChanges,0);assert.deepEqual(b.browser.history.state,{route:'calendar',scroll:420});
});


test('Android Back skipping the sentinel keeps task editing on its route and opens discard confirmation',()=>{
 const b=fixture();let confirm=null,closed=false;
 const detail=b.stack.register(()=>{});detail();
 const form=b.stack.register(()=>{if(!confirm)confirm=b.stack.register(()=>{confirm();confirm=null})});b.flush();
 b.skipBack();assert.ok(confirm);assert.equal(b.routeChanges,0);assert.equal(b.browser.location.href,'https://orbit.test/#calendar');
 // A second system Back dismisses the confirmation; the edited values stay in the form.
 b.skipBack();assert.equal(confirm,null);assert.equal(b.routeChanges,0);
 b.skipBack();assert.ok(confirm);confirm();form();closed=true;b.flush();
 assert.ok(closed);assert.equal(b.routeChanges,0);assert.equal(b.browser.location.href,'https://orbit.test/#calendar');
 assert.deepEqual(b.browser.history.state,{route:'calendar',scroll:420});
 b.back();assert.equal(b.browser.location.href,'https://orbit.test/#today');assert.equal(b.routeChanges,1);
});

test('a skipped route traversal closes a read-only popup without navigating its background',()=>{
 const b=fixture();let closed=false;const off=b.stack.register(()=>{closed=true;off()});
 b.skipBack();assert.ok(closed);assert.equal(b.routeChanges,0);assert.equal(b.browser.location.href,'https://orbit.test/#calendar');
});
