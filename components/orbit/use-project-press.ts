'use client';
import {useEffect,useRef,useState} from 'react';
import {createProjectPressController} from '@/lib/orbit/project-press';

export function useProjectPress({disabled,onManage}:{disabled:boolean;onManage:(id:string)=>void}){
  const root=useRef<HTMLDivElement>(null),latest=useRef({disabled,onManage});latest.current={disabled,onManage};
  const [holding,setHolding]=useState<string|null>(null);
  useEffect(()=>{
    const element=root.current;if(!element)return;
    let lastTouch=0;
    const controller=createProjectPressController({disabled:()=>latest.current.disabled,onOpen:id=>latest.current.onManage(id),onArm:id=>{setHolding(id);if(id&&typeof navigator.vibrate==='function')navigator.vibrate(18)}});
    const cancel=controller.cancel;
    const down=(e:PointerEvent)=>{
      if(e.pointerType==='touch')lastTouch=Date.now();
      if(!e.isPrimary||e.button!==0){cancel();return;}
      if(latest.current.disabled)return;
      const target=e.target instanceof Element?e.target:null,card=target?.closest<HTMLElement>('[data-project-card]');
      if(!card)return;
      const control=target?.closest('button,a,input,select,textarea,[role=button]');
      if(control&&!control.hasAttribute('data-project-title'))return;
      cancel();
      const id=card.dataset.projectCard!;
      controller.begin(id,e.clientX,e.clientY,e.pointerId);
    };
    const move=(e:PointerEvent)=>controller.move(e.clientX,e.clientY,e.pointerId);
    const up=(e:PointerEvent)=>{if(controller.end(e.pointerId)&&e.cancelable)e.preventDefault()};
    const click=(e:MouseEvent)=>{if(e.detail!==0&&controller.suppressClick()&&e.target instanceof Element&&e.target.closest('[data-project-card]')){e.preventDefault();e.stopImmediatePropagation()}};
    const context=(e:MouseEvent)=>{
      const target=e.target instanceof Element?e.target:null,card=target?.closest<HTMLElement>('[data-project-card]');
      if(!card)return;
      e.preventDefault();
      if(controller.active||Date.now()-lastTouch<1200)return;
      if(!latest.current.disabled)latest.current.onManage(card.dataset.projectCard!);
    };
    const hidden=()=>{if(document.visibilityState!=='visible')cancel()};
    element.addEventListener('pointerdown',down);element.addEventListener('contextmenu',context);
    window.addEventListener('pointermove',move,{passive:true});window.addEventListener('pointerup',up);
    window.addEventListener('pointercancel',cancel);window.addEventListener('pointerdown',eSecond);
    function eSecond(e:PointerEvent){if(controller.active&&!e.isPrimary)cancel()}
    window.addEventListener('scroll',cancel,{passive:true,capture:true});window.addEventListener('blur',cancel);
    document.addEventListener('visibilitychange',hidden);document.addEventListener('click',click,true);
    return()=>{cancel();element.removeEventListener('pointerdown',down);element.removeEventListener('contextmenu',context);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('pointerdown',eSecond);window.removeEventListener('scroll',cancel,true);window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',hidden);document.removeEventListener('click',click,true)};
  },[disabled]);
  return {root,holding};
}
