'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import type {CalendarEvent} from '@/lib/orbit/model';
import {HOLD_MS,MOVE_SLOP,moveRestriction,shiftedEvent} from '@/lib/orbit/calendar-move';
import {dateSwipeDirection} from '@/lib/orbit/date-swipe';
import {HOUR_PX} from '@/lib/orbit/calendar-month';

type Props={onStep?:(days:number)=>void;events:CalendarEvent[];disabled:boolean;onMove:(before:CalendarEvent,after:CalendarEvent)=>Promise<boolean>;onInteractionChange:(active:boolean)=>void};
type Session={event:CalendarEvent;x:number;y:number;currentY:number;laneTop:number;input:'touch'|'pointer';id:number;active:boolean;timer?:ReturnType<typeof setTimeout>;frame?:number};

export function useDayGridMove(props:Props){
 const root=useRef<HTMLDivElement>(null),latest=useRef(props),session=useRef<Session|null>(null);
 const saving=useRef(false),suppressUntil=useRef(0);
 const [preview,setPreview]=useState<{event:CalendarEvent;saving?:boolean}|null>(null);
 useLayoutEffect(()=>{latest.current=props;});
 useEffect(()=>{
  const element=root.current!;let alive=true;
  let swipe:{id:number;x:number;y:number;horizontal:boolean}|null=null;
  const laneTop=()=>element.querySelector('.day-grid-lane')!.getBoundingClientRect().top;
  // The lane's viewport position accounts for both window and nested-container scrolling.
  const shifted=(s:Session)=>shiftedEvent(s.event,s.currentY-s.y+s.laneTop-laneTop(),HOUR_PX/4);
  const changed=()=>{const s=session.current;if(s?.active)setPreview({event:shifted(s)});};
  const clear=()=>{const s=session.current;if(s?.timer)clearTimeout(s.timer);if(s?.frame)cancelAnimationFrame(s.frame);session.current=null;latest.current.onInteractionChange(false);};
  const cancel=()=>{swipe=null;if(session.current)suppressUntil.current=Date.now()+700;clear();if(!saving.current)setPreview(null);};
  const scrollParent=()=>{
   for(let node=element.parentElement;node;node=node.parentElement){
    if(/auto|scroll/.test(getComputedStyle(node).overflowY)&&node.scrollHeight>node.clientHeight)return node;
   }
   return document.scrollingElement as HTMLElement;
  };
  const autoScroll=()=>{
   const s=session.current;if(!s?.active)return;
   const parent=scrollParent(),rect=parent===document.scrollingElement?{top:0,bottom:window.innerHeight}:parent.getBoundingClientRect();
   const top=Math.max(0,rect.top)+80,bottom=Math.min(window.innerHeight,rect.bottom)-80;
   const speed=s.currentY<top?-Math.min(10,(top-s.currentY)/5):s.currentY>bottom?Math.min(10,(s.currentY-bottom)/5):0;
   if(speed){parent.scrollTop+=speed;changed();}
   s.frame=requestAnimationFrame(autoScroll);
  };
  const begin=(target:EventTarget|null,x:number,y:number,input:Session['input'],id:number)=>{
   if(session.current||saving.current||latest.current.disabled)return;
   const button=target instanceof Element?target.closest<HTMLElement>('[data-grid-move]'):null;
   const event=latest.current.events.find(e=>e.id===button?.dataset.gridMove);
   if(!event||event.allDay||moveRestriction(event))return;
   const s:Session={event:{...event},x,y,currentY:y,laneTop:laneTop(),input,id,active:false};session.current=s;
   latest.current.onInteractionChange(true);
   s.timer=setTimeout(()=>{
    if(session.current!==s||latest.current.disabled){cancel();return;}
    swipe=null;s.active=true;suppressUntil.current=Date.now()+700;
    navigator.vibrate?.(18);changed();
   },HOLD_MS);
  };
  const move=(x:number,y:number,e:Event)=>{
   const s=session.current;if(!s)return;
   if(!s.active){if(Math.hypot(x-s.x,y-s.y)>MOVE_SLOP){suppressUntil.current=Date.now()+700;clear();}return;}
   if(latest.current.disabled||(s.input==='touch'&&!e.cancelable)){cancel();return;}
   e.preventDefault();s.currentY=y;changed();
   if(!s.frame&&Math.abs(y-s.y)>MOVE_SLOP)s.frame=requestAnimationFrame(autoScroll);
  };
  const finish=async(y:number)=>{
   const s=session.current;if(!s)return;
   if(!s.active){clear();return;}
   s.currentY=y;const after=shifted(s);suppressUntil.current=Date.now()+700;clear();
   if(latest.current.disabled||after.start===s.event.start){setPreview(null);return;}
   saving.current=true;latest.current.onInteractionChange(true);setPreview({event:after,saving:true});
   try{await latest.current.onMove(s.event,after);}
   catch{toast.error('시간 변경을 저장하지 못했습니다. 다시 시도해 주세요.');}
   finally{saving.current=false;if(alive){setPreview(null);latest.current.onInteractionChange(false);}}
  };
  const touchStart=(e:TouchEvent)=>{
   if(e.touches.length!==1){cancel();return;}
   const t=e.touches[0];
   swipe=!saving.current&&!latest.current.disabled&&latest.current.onStep?{id:t.identifier,x:t.clientX,y:t.clientY,horizontal:false}:null;
   begin(e.target,t.clientX,t.clientY,'touch',t.identifier);
  };
  const touchMove=(e:TouchEvent)=>{
   if(e.touches.length!==1){cancel();return;}
   const s=session.current,t=e.touches[0];
   if(s?.input==='touch'&&s.id===t.identifier)move(t.clientX,t.clientY,e);
   const g=swipe;if(!g||g.id!==t.identifier)return;
   if(latest.current.disabled||saving.current||!e.cancelable){swipe=null;return;}
   const dx=t.clientX-g.x,dy=t.clientY-g.y;
   if(!g.horizontal&&Math.hypot(dx,dy)>MOVE_SLOP){
    if(Math.abs(dx)<=Math.abs(dy)*1.4){swipe=null;return;}
    swipe={...g,horizontal:true};
   }
   if(swipe?.horizontal)e.preventDefault();
  };
  const touchEnd=(e:TouchEvent)=>{
   const g=swipe;swipe=null;
   if(g){
    const t=Array.from(e.changedTouches).find(t=>t.identifier===g.id);
    const step=t&&g.horizontal?dateSwipeDirection(t.clientX-g.x,t.clientY-g.y):0;
    if(step&&!latest.current.disabled&&!saving.current&&e.cancelable){
     e.preventDefault();suppressUntil.current=Date.now()+700;clear();latest.current.onStep?.(step);return;
    }
   }
   const s=session.current;if(s?.input!=='touch')return;
   const t=Array.from(e.changedTouches).find(t=>t.identifier===s.id);if(!t)return;
   if(s.active&&e.cancelable)e.preventDefault();void finish(t.clientY);
  };
  const multi=(e:TouchEvent)=>{if(e.touches.length>1)cancel();};
  const down=(e:PointerEvent)=>{if(e.pointerType!=='touch'&&e.button===0)begin(e.target,e.clientX,e.clientY,'pointer',e.pointerId);};
  const matches=(e:PointerEvent)=>session.current?.input==='pointer'&&session.current.id===e.pointerId;
  const pointerMove=(e:PointerEvent)=>{if(matches(e))move(e.clientX,e.clientY,e);};
  const up=(e:PointerEvent)=>{if(matches(e))void finish(e.clientY);};
  const pointerCancel=(e:PointerEvent)=>{if(matches(e))cancel();};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&(session.current||swipe)){e.preventDefault();cancel();}};
  const menu=(e:Event)=>{if(session.current||Date.now()<suppressUntil.current)e.preventDefault();};
  const visibility=()=>{if(document.hidden)cancel();};
  const scroll=()=>{swipe=null;if(session.current?.active)changed();else if(session.current)cancel();};
  element.addEventListener('touchstart',touchStart,{passive:true});
  document.addEventListener('touchstart',multi,{passive:true});
  document.addEventListener('touchmove',touchMove,{passive:false});
  document.addEventListener('touchend',touchEnd,{passive:false});
  document.addEventListener('touchcancel',cancel);
  element.addEventListener('pointerdown',down);
  document.addEventListener('pointermove',pointerMove);
  document.addEventListener('pointerup',up);
  document.addEventListener('pointercancel',pointerCancel);
  document.addEventListener('keydown',key);
  element.addEventListener('contextmenu',menu);
  document.addEventListener('visibilitychange',visibility);
  document.addEventListener('scroll',scroll,true);
  window.addEventListener('blur',cancel);
  return()=>{
   alive=false;clear();
   element.removeEventListener('touchstart',touchStart);document.removeEventListener('touchstart',multi);
   document.removeEventListener('touchmove',touchMove);document.removeEventListener('touchend',touchEnd);document.removeEventListener('touchcancel',cancel);
   element.removeEventListener('pointerdown',down);document.removeEventListener('pointermove',pointerMove);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',pointerCancel);
   document.removeEventListener('keydown',key);element.removeEventListener('contextmenu',menu);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('scroll',scroll,true);window.removeEventListener('blur',cancel);
  };
 },[]);
 return {root,preview,suppressClick:()=>saving.current||Date.now()<suppressUntil.current};
}
