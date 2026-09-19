import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarLiveSync} from '../lib/orbit/calendar-live.ts';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
function fixture(request){
 const context={enabled:true,paused:false,visible:true,online:true,date:'2026-09-19'};
 let time=10000,next=0;const timers=new Map(),success=[],errors=[];
 const sync=createCalendarLiveSync({context:()=>context,request,onStart(){},onSettled(){},onSuccess:value=>{success.push(value)},onError:error=>errors.push(error),now:()=>time,setTimer:(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id},clearTimer:id=>timers.delete(id)});
 return {sync,context,timers,success,errors,advance:ms=>{time+=ms}};
}
test('date changes wait for the active sync and discard its stale UI result',async()=>{
 const first=deferred(),second=deferred(),dates=[];
 const f=fixture(date=>{dates.push(date);return dates.length===1?first.promise:second.promise});
 const a=f.sync.wake();await f.sync.wake();
 f.context.date='2026-09-26';await f.sync.wake();
 assert.deepEqual(dates,['2026-09-19']);
 first.resolve({connected:true,count:4});await a;
 assert.deepEqual(f.success,[]);assert.equal([...f.timers.values()][0].delay,0);
 const b=f.sync.wake();assert.deepEqual(dates,['2026-09-19','2026-09-26']);
 second.resolve({connected:true,count:7});await b;
 assert.deepEqual(f.success,[{connected:true,count:7}]);assert.equal([...f.timers.values()][0].delay,30000);
 f.sync.stop();assert.equal(f.timers.size,0);
});
test('hidden, offline and editing states pause sync; disposal ignores an in-flight response',async()=>{
 const pending=deferred();let calls=0;
 const f=fixture(()=>{calls++;return pending.promise});
 for(const [key,value] of [['enabled',false],['visible',false],['online',false],['paused',true]]){
  const original=f.context[key];f.context[key]=value;await f.sync.wake();assert.equal(calls,0);f.context[key]=original;
 }
 const request=f.sync.wake();assert.equal(calls,1);f.sync.stop();pending.resolve({connected:true,count:2});await request;
 assert.deepEqual(f.success,[]);assert.equal(f.timers.size,0);
});
test('failed sync backs off and paired focus events do not duplicate requests',async()=>{
 let calls=0;const f=fixture(async()=>{if(++calls===1)throw new Error('network');return {connected:true,count:3}});
 await f.sync.wake();assert.equal(f.errors.length,1);assert.deepEqual(f.success,[]);assert.equal([...f.timers.values()][0].delay,60000);
 f.advance(60000);await f.sync.wake();await f.sync.wake();assert.equal(calls,2);assert.equal(f.success.length,1);
 f.advance(30000);await f.sync.wake();assert.equal(calls,3);assert.equal([...f.timers.values()][0].delay,30000);f.sync.stop();
});
