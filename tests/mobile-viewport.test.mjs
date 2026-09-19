import test from 'node:test';
import assert from 'node:assert/strict';
import {trackMobileViewport} from '../lib/orbit/mobile-viewport.ts';

function environment(){
  const frames=new Map(), properties=new Map();let next=0;
  const win=Object.assign(new EventTarget(),{innerWidth:390,innerHeight:800,requestAnimationFrame:fn=>{frames.set(++next,fn);return next},cancelAnimationFrame:id=>frames.delete(id)});
  const viewport=Object.assign(new EventTarget(),{height:800,offsetTop:0,scale:1});win.visualViewport=viewport;
  const doc=Object.assign(new EventTarget(),{activeElement:null,documentElement:{dataset:{},style:{setProperty:(key,value)=>properties.set(key,value),removeProperty:key=>properties.delete(key)}}});
  const body={scrollTop:0,getBoundingClientRect:()=>({top:viewport.offsetTop+60,bottom:viewport.offsetTop+viewport.height})};
  const field={matches:()=>true,closest:selector=>selector.startsWith('[data-slot')?{}:body,getBoundingClientRect:()=>({top:viewport.offsetTop+600-body.scrollTop,bottom:viewport.offsetTop+700-body.scrollTop,height:100})};
  const flush=()=>{for(let i=0;frames.size&&i<10;i++){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn())}assert.equal(frames.size,0)};
  return {win,viewport,doc,body,field,properties,flush,frames};
}
test('keyboard resize and browser pan retain the visible origin and scroll only the overlay body',()=>{
  const e=environment(),stop=trackMobileViewport(e.win,e.doc);
  e.doc.activeElement=e.field;e.doc.dispatchEvent(new Event('focusin'));
  e.viewport.height=460;e.viewport.offsetTop=180;e.viewport.dispatchEvent(new Event('resize'));e.flush();
  assert.equal(e.properties.get('--phone-viewport-height'),'460px');
  assert.equal(e.properties.get('--phone-viewport-top'),'180px');
  assert.equal(e.doc.documentElement.dataset.keyboard,'open');
  assert.equal(e.body.scrollTop,256);
  const rect=e.field.getBoundingClientRect();assert.ok(rect.top>=240&&rect.bottom<=624);
  e.viewport.offsetTop=215;e.viewport.dispatchEvent(new Event('scroll'));e.flush();
  assert.equal(e.properties.get('--phone-viewport-top'),'215px');assert.equal(e.body.scrollTop,256);
  e.viewport.height=800;e.viewport.offsetTop=0;e.viewport.dispatchEvent(new Event('resize'));e.flush();
  assert.equal(e.doc.documentElement.dataset.keyboard,'closed');assert.equal(e.properties.get('--phone-viewport-height'),'800px');
  stop();assert.equal(e.properties.size,0);assert.equal(e.frames.size,0);
});
test('Android resizing both layout and visual viewports still detects the keyboard',()=>{
  const e=environment(),stop=trackMobileViewport(e.win,e.doc);
  e.doc.activeElement=e.field;e.win.innerHeight=450;e.viewport.height=450;
  e.win.dispatchEvent(new Event('resize'));e.flush();assert.equal(e.doc.documentElement.dataset.keyboard,'open');
  e.win.innerHeight=800;e.viewport.height=800;e.viewport.dispatchEvent(new Event('resize'));e.flush();assert.equal(e.doc.documentElement.dataset.keyboard,'closed');stop();
});
test('pinch zoom does not impersonate the keyboard or force a focused field to scroll',()=>{
  const e=environment(),stop=trackMobileViewport(e.win,e.doc);
  e.doc.activeElement=e.field;e.viewport.scale=2;e.viewport.height=400;e.viewport.dispatchEvent(new Event('resize'));e.flush();
  assert.equal(e.doc.documentElement.dataset.keyboard,'closed');assert.equal(e.body.scrollTop,0);stop();
});
test('ordinary page inputs and desktop screens are never force-scrolled',()=>{
  for(const desktop of [false,true]){
    const e=environment(),stop=trackMobileViewport(e.win,e.doc);e.doc.activeElement=e.field;
    if(desktop)e.win.innerWidth=1200;else e.field.closest=()=>null;
    e.viewport.height=400;e.doc.dispatchEvent(new Event('focusin'));e.flush();assert.equal(e.body.scrollTop,0);stop();
  }
});
test('unmount cancels queued focus corrections and removes listeners',()=>{
  const e=environment(),stop=trackMobileViewport(e.win,e.doc);e.doc.activeElement=e.field;e.doc.dispatchEvent(new Event('focusin'));stop();
  e.viewport.dispatchEvent(new Event('resize'));e.doc.dispatchEvent(new Event('focusin'));assert.equal(e.frames.size,0);
});
