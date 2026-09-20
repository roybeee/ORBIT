import test from 'node:test';
import assert from 'node:assert/strict';
import {createOverlayHistory} from '../lib/orbit/overlay-history.ts';

// Model asynchronous browser traversal: a close must finish before its next UI
// action, and repeated taps must never queue multiple history.back() calls.
function browserAtCalendar() {
  const events = new EventTarget();
  const entries = [
    {url:'https://orbit.test/#today',state:{route:'today'}},
    {url:'https://orbit.test/#calendar',state:{route:'calendar',scroll:640}},
  ];
  let index=1;
  const pending=[];
  const browser={
    location:{get href(){return entries[index].url}},
    history:{
      get state(){return entries[index].state},
      pushState(state,_,url){entries.splice(index+1);entries.push({state,url});index++},
      replaceState(state,_,url){entries[index]={state,url}},
      back(){pending.push(-1)},
    },
    addEventListener:events.addEventListener.bind(events),
    removeEventListener:events.removeEventListener.bind(events),
  };
  return {browser,entries,pending,
    flush(){while(pending.length){index=Math.max(0,index+pending.shift());events.dispatchEvent(new Event('popstate'))}},
  };
}

test('Android Back closes time assignment on the same calendar without invoking page navigation',()=>{
  const b=browserAtCalendar();let open=true,routeChanges=0;
  const h=createOverlayHistory(b.browser);
  b.browser.addEventListener('popstate',()=>routeChanges++);
  assert.equal(h.open(()=>open=false),true);
  b.browser.history.back();b.flush();
  assert.equal(open,false);assert.equal(routeChanges,0);
  assert.equal(b.browser.location.href,'https://orbit.test/#calendar');
  assert.deepEqual(b.browser.history.state,{route:'calendar',scroll:640});
  b.browser.history.back();b.flush();
  assert.equal(b.browser.location.href,'https://orbit.test/#today');
  assert.equal(routeChanges,1);
});

test('close, backdrop and Escape cleanup consume only one entry even on repeated taps',()=>{
  const b=browserAtCalendar();let closed=0;
  const h=createOverlayHistory(b.browser);
  h.open(()=>closed++);h.close();h.close();
  assert.equal(b.pending.length,1);b.flush();assert.equal(closed,1);
  h.open(()=>closed++);h.close();b.flush();
  assert.equal(closed,2);assert.equal(b.entries.length,3);
  b.browser.history.back();b.flush();
  assert.equal(b.browser.location.href,'https://orbit.test/#today');
});

test('task details and post-save navigation run after popstate so the new screen stays open',()=>{
  for(const nextView of ['details','saved']){
    const b=browserAtCalendar();const calls=[];
    const h=createOverlayHistory(b.browser);
    b.browser.addEventListener('popstate',()=>calls.push('route reset'));
    h.open(()=>calls.push('dismiss'));
    h.close(()=>calls.push(nextView));
    assert.deepEqual(calls,[]);b.flush();
    assert.deepEqual(calls,['dismiss',nextView]);
    assert.equal(b.browser.location.href,'https://orbit.test/#calendar');
  }
});

test('a real navigation is not swallowed, and closing cannot back out of a different route',()=>{
  const b=browserAtCalendar();let dismissed=0,continued=0;
  const h=createOverlayHistory(b.browser);
  h.open(()=>dismissed++);
  b.browser.history.pushState({route:'projects'},'','https://orbit.test/#projects');
  h.close(()=>continued++);
  assert.equal(dismissed,1);assert.equal(continued,1);assert.equal(b.pending.length,0);
  assert.equal(b.browser.location.href,'https://orbit.test/#projects');
});

test('disposing an open boundary preserves pre-existing router state and removes its listener',()=>{
  const b=browserAtCalendar();let dismissed=0;
  const h=createOverlayHistory(b.browser);h.open(()=>dismissed++);h.dispose();
  assert.deepEqual(b.browser.history.state,{route:'calendar',scroll:640});
  b.browser.history.back();b.flush();assert.equal(dismissed,0);
});

const {createConfirmableOverlayHistory}=await import('../lib/orbit/confirmable-overlay-history.ts');
function unsavedForm(b){
 const state={open:true,confirm:false,discarded:0,closed:0,blocked:false,title:'작성 중인 할 일'};
 const h=createConfirmableOverlayHistory(b.browser,{
  blocked:()=>state.blocked,onConfirmChange:value=>state.confirm=value,
  onClose:()=>{state.open=false;state.closed++},
  onDiscard:()=>{state.discarded++;state.title=''},
 });
 h.open();return {h,state};
}
test('new-task Back asks first; leaving discards only the form and retains the underlying calendar',()=>{
 const b=browserAtCalendar(),{h,state}=unsavedForm(b);let routeChanges=0;
 b.browser.addEventListener('popstate',()=>routeChanges++);
 b.browser.history.back();b.flush();
 assert.equal(state.open,true);assert.equal(state.confirm,true);assert.equal(state.discarded,0);
 h.discard();h.discard();assert.equal(b.pending.length,1);b.flush();
 assert.equal(state.open,false);assert.equal(state.confirm,false);assert.equal(state.discarded,1);assert.equal(state.closed,1);
 assert.equal(b.browser.location.href,'https://orbit.test/#calendar');assert.equal(routeChanges,0);
 b.browser.history.back();b.flush();assert.equal(b.browser.location.href,'https://orbit.test/#today');
});
test('continue writing and Back on the confirmation preserve inputs without growing history',()=>{
 const b=browserAtCalendar(),{h,state}=unsavedForm(b);
 for(let i=0;i<4;i++){
  b.browser.history.back();b.flush();assert.equal(state.confirm,true);
  if(i%2)h.cancel();else{b.browser.history.back();b.flush();}
  assert.equal(state.confirm,false);assert.equal(state.open,true);assert.equal(state.title,'작성 중인 할 일');
  assert.equal(state.discarded,0);assert.equal(b.entries.length,3);
 }
 h.requestClose();assert.equal(state.confirm,true);h.discard();b.flush();assert.equal(state.closed,1);
});
test('successful new-task save consumes its boundary without asking or discarding',()=>{
 const b=browserAtCalendar(),{h,state}=unsavedForm(b);let savedNext=false;
 state.blocked=true;h.finish(()=>savedNext=true);b.flush();
 assert.equal(state.open,false);assert.equal(state.confirm,false);assert.equal(state.discarded,0);assert.equal(savedNext,true);
 assert.deepEqual(b.browser.history.state,{route:'calendar',scroll:640});
 h.open();state.open=true;b.browser.history.back();state.blocked=false;b.flush();assert.equal(state.confirm,true);
});
test('pending saves prevent discarding or leaving even with repeated Back or close requests',()=>{
 const b=browserAtCalendar(),{h,state}=unsavedForm(b);
 state.blocked=true;h.requestClose();b.browser.history.back();b.flush();
 assert.equal(state.open,true);assert.equal(state.confirm,false);assert.equal(b.browser.location.href,'https://orbit.test/#calendar');
 state.blocked=false;h.requestClose();state.blocked=true;h.discard();assert.equal(b.pending.length,0);
 assert.equal(state.discarded,0);state.blocked=false;h.discard();b.flush();assert.equal(state.discarded,1);
});
