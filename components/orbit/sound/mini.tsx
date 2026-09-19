'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {X} from 'lucide-react';
import {soundDrag,type DragPosition} from './drag';

export function SoundMini({children,onDismiss}:{children:ReactNode;onDismiss:()=>void}){
  const [drag,setDrag]=useState<DragPosition|null>(null);
  const target=useRef<HTMLButtonElement>(null);
  const grabOffset=useRef({x:0,y:0});
  const dismiss=useRef(onDismiss);dismiss.current=onDismiss;
  const controller=useRef<ReturnType<typeof soundDrag>|null>(null);
  if(!controller.current)controller.current=soundDrag({
    change:setDrag,dismiss:()=>dismiss.current(),
    hit:(x,y)=>{
      const r=target.current?.getBoundingClientRect();
      if(!r)return false;
      const inside=(px:number,py:number)=>px>=r.left-24&&px<=r.right+24&&py>=r.top-24&&py<=r.bottom+24;
      return inside(x,y)||inside(x+grabOffset.current.x,y+grabOffset.current.y);
    },
  });
  useEffect(()=>{
    const controls=controller.current!;
    const cancel=()=>controls.cancel();
    // Keep following the finger outside the original button, without switching
    // capture targets or cancelling on a bubbling child lostpointercapture.
    window.addEventListener('pointermove',controls.move,true);
    window.addEventListener('pointerup',controls.end,true);
    window.addEventListener('pointercancel',cancel,true);
    window.addEventListener('blur',cancel);
    return()=>{
      window.removeEventListener('pointermove',controls.move,true);
      window.removeEventListener('pointerup',controls.end,true);
      window.removeEventListener('pointercancel',cancel,true);
      window.removeEventListener('blur',cancel);controls.cancel();
    };
  },[]);
  return <>
    <aside className={`sound-mini ${drag?'sound-mini-dragging':''}`} aria-label="사운드 재생 제어" style={drag?{transform:`translate3d(${drag.x}px,${drag.y}px,0)`}:undefined}
      onContextMenu={e=>e.preventDefault()}
      onClickCapture={e=>{if(controller.current!.consumeClick()){e.preventDefault();e.stopPropagation()}}}
      onKeyDown={e=>{if(e.key==='Escape')controller.current!.cancel()}}
      onPointerDown={e=>{
        if(!e.isPrimary||e.button!==0||(e.target as Element).closest('.sound-mini-volume,.sound-mini-toggle,.sound-mini-accessible-close'))return;
        const rect=e.currentTarget.getBoundingClientRect();
        grabOffset.current={x:rect.left+rect.width/2-e.clientX,y:rect.top+rect.height/2-e.clientY};
        controller.current!.start(e);
      }}>
      {children}
      <button className="sound-mini-accessible-close" aria-label="사운드 종료하고 재생바 닫기" onClick={onDismiss}><X size={18}/></button>
    </aside>
    {drag&&<button ref={target} className={`sound-dismiss-target ${drag.over?'sound-dismiss-over':''}`} aria-label="여기에 놓아 재생 종료" onClick={onDismiss}><X size={30}/><span>{drag.over?'놓으면 재생 종료':'여기로 끌어 재생 종료'}</span></button>}
  </>;
}
