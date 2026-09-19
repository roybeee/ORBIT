export interface CalendarSyncResult {connected:boolean;count:number;updatedAt?:string;delivery?:{pending:number;failed:number;verified:number;message?:string}}
interface Context {enabled:boolean;paused:boolean;visible:boolean;online:boolean;date:string}
interface Options {
 context:()=>Context;
 request:(date:string)=>Promise<CalendarSyncResult>;
 onStart:()=>void;
 onSuccess:(result:CalendarSyncResult)=>Promise<void>|void;
 onError:(error:unknown)=>void;
 onSettled:()=>void;
 now?:()=>number;
 setTimer?:(callback:()=>void,delay:number)=>ReturnType<typeof setTimeout>;
 clearTimer?:(timer:ReturnType<typeof setTimeout>)=>void;
}
// One request at a time, including when the selected day or visibility changes.
export function createCalendarLiveSync(options:Options){
 const now=options.now??Date.now,setTimer=options.setTimer??setTimeout,clearTimer=options.clearTimer??clearTimeout;
 let stopped=false,running=false,timer:ReturnType<typeof setTimeout>|undefined;
 let lastStarted=-Infinity,lastDate='',failures=0;
 const clear=()=>{if(timer!==undefined){clearTimer(timer);timer=undefined}};
 const schedule=(delay:number)=>{clear();if(!stopped&&options.context().enabled)timer=setTimer(()=>{void wake()},delay)};
 async function wake(){
  clear();if(stopped||running)return;
  const context={...options.context()};
  if(!context.enabled)return;
  if(context.paused||!context.visible||!context.online){schedule(30000);return;}
  // Focus and visibility events often arrive together on Android.
  if(context.date===lastDate&&now()-lastStarted<2000){schedule(2000-(now()-lastStarted));return;}
  running=true;lastStarted=now();lastDate=context.date;options.onStart();
  try{
   const result=await options.request(context.date);
   const latest=options.context();
   if(!stopped&&latest.enabled&&latest.date===context.date){failures=0;await options.onSuccess(result);}
  }catch(error){
   const latest=options.context();
   if(!stopped&&latest.enabled&&latest.date===context.date){failures++;options.onError(error);}
  }finally{
   running=false;
   if(!stopped){options.onSettled();schedule(options.context().date!==context.date?0:Math.min(120000,30000*2**failures));}
  }
 }
 return {wake,stop(){stopped=true;clear()}};
}
