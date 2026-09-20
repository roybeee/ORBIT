'use client';
import {useRef,type ReactNode} from 'react';
import {dateSwipeDirection} from '@/lib/orbit/date-swipe';
export function CalendarDateStrip({children,onStep}:{children:ReactNode;onStep:(days:number)=>void}){
 const gesture=useRef<{id:number;x:number;y:number;cancelled:boolean}|null>(null),suppress=useRef(0);
 return <div className="calendar-date-strip" aria-label="좌우로 밀어 날짜 이동" onPointerDown={e=>{if(!e.isPrimary||e.button!==0){gesture.current=null;return;}gesture.current={id:e.pointerId,x:e.clientX,y:e.clientY,cancelled:false}}} onPointerMove={e=>{const g=gesture.current;if(!g||g.id!==e.pointerId)return;const dx=e.clientX-g.x,dy=e.clientY-g.y;if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx))g.cancelled=true;if(!g.cancelled&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.4)e.currentTarget.setPointerCapture(e.pointerId)}} onPointerUp={e=>{const g=gesture.current;gesture.current=null;if(!g||g.id!==e.pointerId||g.cancelled)return;const step=dateSwipeDirection(e.clientX-g.x,e.clientY-g.y);if(step){suppress.current=Date.now()+700;onStep(step)}}} onPointerCancel={()=>{gesture.current=null}} onClickCapture={e=>{if(Date.now()<suppress.current){e.preventDefault();e.stopPropagation()}}}>
 {children}</div>
}
