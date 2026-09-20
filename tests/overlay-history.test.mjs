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
