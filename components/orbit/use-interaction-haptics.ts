'use client';
import {useEffect} from 'react';
import {haptic} from '@/lib/orbit/haptics';

const controls='button,a[href],summary,[role="button"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"],input[type="button"],input[type="submit"],input[type="checkbox"],input[type="radio"]';
export function useInteractionHaptics(){
 useEffect(()=>{
  let active=true;
  const click=(event:MouseEvent)=>{
   if(!event.isTrusted||event.button!==0)return;
   const target=event.composedPath().find((node):node is Element=>node instanceof Element&&node.matches(controls));
   if(!target||target.matches(':disabled')||target.closest('[aria-disabled="true"],[inert]'))return;
   if(target.matches('a[aria-current="page"]'))return;
   const allowPrevented=target.getAttribute('data-haptic')==='tap';
   // Capture also sees portal/stopPropagation clicks. Wait until swipe and
   // long-press handlers have had the chance to cancel a follow-up click.
   setTimeout(()=>{if(active&&(!event.defaultPrevented||allowPrevented))haptic('tap');},0);
  };
  document.addEventListener('click',click,true);
  return()=>{active=false;document.removeEventListener('click',click,true);};
 },[]);
}
