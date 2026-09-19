'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {X} from 'lucide-react';

export function SoundMini({children,onDismiss}:{children:ReactNode;onDismiss:()=>void}){
  const [drag,setDrag]=useState<{x:number;y:number;over:boolean}|null>(null);
  const target=useRef<HTMLButtonElement>(null);
  const gesture=useRef<{id:number;x:number;y:number;active:boolean;timer:ReturnType<typeof setTimeout>}|null>(null);
  const suppress=useRef(false);
  const cancel=()=>{if(gesture.current)clearTimeout(gesture.current.timer);gesture.current=null;setDrag(null)};
  useEffect(()=>{const abort=()=>cancel();window.addEventListener('blur',abort);return()=>{cancel();window.removeEventListener('blur',abort)}},[]);
  const over=(x:number,y:number)=>{const r=target.current?.getBoundingClientRect();return !!r&&x>=r.left-16&&x<=r.right+16&&y>=r.top-16&&y<=r.bottom+16};
  return <>
    <aside className={`sound-mini ${drag?'sound-mini-dragging':''}`} aria-label="사운드 재생 제어" style={drag?{transform:`translate(${drag.x}px,${drag.y}px)`}:undefined}
      onContextMenu={e=>e.preventDefault()}
      onClickCapture={e=>{if(suppress.current){e.preventDefault();e.stopPropagation();suppress.current=false}}}
      onKeyDown={e=>{if(e.key==='Escape')cancel()}}
      onPointerDown={e=>{
        if(!e.isPrimary||e.button!==0||!(e.target as HTMLElement).closest('.sound-mini-open'))return;
        cancel();suppress.current=false;const el=e.currentTarget;
        const g={id:e.pointerId,x:e.clientX,y:e.clientY,active:false,timer:setTimeout(()=>{
          el.setPointerCapture(g.id);g.active=true;suppress.current=true;setDrag({x:0,y:0,over:false});
        },450)};gesture.current=g;
      }}
      onPointerMove={e=>{const g=gesture.current;if(!g||g.id!==e.pointerId)return;
        const x=e.clientX-g.x,y=e.clientY-g.y;
        if(!g.active){if(Math.hypot(x,y)>10)cancel();return}
        setDrag({x,y,over:over(e.clientX,e.clientY)});
      }}
      onPointerUp={e=>{const g=gesture.current;if(!g||g.id!==e.pointerId)return;
        const dismiss=g.active&&over(e.clientX,e.clientY);cancel();
        if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
        if(dismiss)onDismiss();
      }} onPointerLeave={()=>{if(gesture.current&&!gesture.current.active)cancel()}} onPointerCancel={cancel} onLostPointerCapture={cancel}>
      {children}
      <button className="sound-mini-accessible-close" aria-label="사운드 종료하고 재생바 닫기" onClick={onDismiss}><X size={18}/></button>
    </aside>
    {drag&&<button ref={target} className={`sound-dismiss-target ${drag.over?'sound-dismiss-over':''}`} aria-label="여기에 놓아 재생 종료" onClick={onDismiss}><X size={30}/><span>{drag.over?'놓으면 재생 종료':'여기로 끌어 재생 종료'}</span></button>}
  </>;
}
