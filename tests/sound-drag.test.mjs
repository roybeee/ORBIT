import {test} from 'node:test';
import assert from 'node:assert/strict';
import {soundDrag} from '../components/orbit/sound/drag.ts';
const point=(x,y,id=1)=>({pointerId:id,clientX:x,clientY:y});
function setup(t){
  t.mock.timers.enable({apis:['setTimeout']});
  let state=null,dismissed=0;
  const drag=soundDrag({change:s=>state=s,hit:(x,y)=>x>=100&&x<=200&&y>=100&&y<=200,dismiss:()=>dismissed++});
  return {drag,get state(){return state},get dismissed(){return dismissed}};
}
test('Android long press survives capture loss and tracks finger outside bar through drop',t=>{
 const a=setup(t);a.drag.start(point(40,400));t.mock.timers.tick(450);
 assert.deepEqual(a.state,{x:0,y:0,over:false});
 // Android's implicit capture may emit lostpointercapture on child elements.
 // The window gesture stream deliberately has no handler for this notification.
 a.drag.move(point(80,300));assert.equal(a.state.y,-100);
 a.drag.move(point(150,150));assert.equal(a.state.over,true);
 a.drag.end(point(150,150));assert.equal(a.dismissed,1);assert.equal(a.state,null);
 assert.equal(a.drag.consumeClick(),true);assert.equal(a.drag.consumeClick(),false);
});
test('release outside target returns bar without stopping; short tap stays clickable',t=>{
 const a=setup(t);a.drag.start(point(40,400));t.mock.timers.tick(450);
 a.drag.move(point(300,250));a.drag.end(point(300,250));assert.equal(a.dismissed,0);assert.equal(a.state,null);
 a.drag.start(point(40,400));a.drag.end(point(40,400));assert.equal(a.drag.consumeClick(),false);
 t.mock.timers.tick(500);assert.equal(a.state,null);
});
test('pointer cancellation and pre-hold movement never stop audio; secondary finger cannot finish',t=>{
 const a=setup(t);a.drag.start(point(40,400));a.drag.move(point(40,350));t.mock.timers.tick(500);assert.equal(a.state,null);
 a.drag.start(point(40,400));t.mock.timers.tick(450);a.drag.end(point(150,150,2));assert.notEqual(a.state,null);
 a.drag.cancel();a.drag.end(point(150,150));assert.equal(a.dismissed,0);assert.equal(a.state,null);
});
