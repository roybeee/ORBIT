'use client';
import {Maximize2,Plus,X} from 'lucide-react';
import {useEffect,useLayoutEffect,useRef,type ReactNode} from 'react';
import {usePopupHistory} from '@/components/ui/use-popup-history';
import {OrbitMark} from '../brand';

export type DockMode='page'|'dock'|'hidden';

// Holds the single Orbit chat instance. The same element is the full 대화 page, the dock
// over any screen (bottom sheet on phones, right panel on wide screens) or hidden, so the
// conversation, its stream and its send lock are never mounted twice.
export function OrbitDock({mode,context,onAttachContext,onClose,onExpand,children}:{mode:DockMode;context:string;onAttachContext:()=>void;onClose:()=>void;onExpand:()=>void;children:ReactNode}){
 const docked=mode==='dock';
 // Back closes the dock like any other popup; nested dialogs inside the chat stack above it.
 const history=usePopupHistory({open:docked,onOpenChange:open=>{if(!open)onClose()},children});
 const opener=useRef<Element|null>(null),element=useRef<HTMLDivElement>(null),latestMode=useRef(mode);
 useLayoutEffect(()=>{latestMode.current=mode});
 useEffect(()=>{
  if(!docked)return;
  opener.current=document.activeElement;
  const composer=()=>document.getElementById('orbit-message');
  const frame=requestAnimationFrame(()=>composer()?.focus({preventScroll:true}));
  // On a phone the sheet covers the page (the tab bar stays usable): keep focus out of the covered page.
  const phone=window.matchMedia('(max-width:767px)');
  const guard=(event:FocusEvent)=>{
   const target=event.target as Element|null;
   if(!phone.matches||!target||element.current?.contains(target)||target.closest('.mobile-nav,[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]'))return;
   composer()?.focus({preventScroll:true});
  };
  document.addEventListener('focusin',guard);
  return()=>{
   cancelAnimationFrame(frame);document.removeEventListener('focusin',guard);
   // Expanding to the 대화 page keeps the composer focused; closing returns to the opener.
   if(latestMode.current==='page')composer()?.focus({preventScroll:true});
   else if(opener.current instanceof HTMLElement&&opener.current.isConnected)opener.current.focus({preventScroll:true});
  };
 },[docked]);
 return <>
  {docked&&<button className="orbit-dock-scrim" aria-label="Orbit 닫기" tabIndex={-1} onClick={onClose}/>}
  <div ref={element} className={`orbit-dock is-${mode}`} hidden={mode==='hidden'} role={docked?'complementary':undefined} aria-label={docked?'Orbit 대화':undefined}
   onKeyDown={event=>{
    // React bubbles keys from portaled dialogs/menus inside the chat; those close themselves.
    if(docked&&event.key==='Escape'&&!event.defaultPrevented&&event.currentTarget.contains(event.target as Node)){event.stopPropagation();onClose();}
   }}>
   {docked&&<header className="orbit-dock-head">
    <span className="orbit-dock-title"><OrbitMark size={22}/><strong>Orbit</strong></span>
    <button className="orbit-dock-context" onClick={onAttachContext} title="보고 있던 화면 이름을 메시지에 덧붙입니다"><Plus size={14}/><span>맥락: {context}</span></button>
    <button className="icon-button" onClick={onExpand} aria-label="대화 전체 화면으로 열기"><Maximize2 size={17}/></button>
    <button className="icon-button" onClick={onClose} aria-label="Orbit 닫기"><X size={18}/></button>
   </header>}
   <div className="orbit-dock-body">{history.children}</div>
  </div>
 </>;
}
