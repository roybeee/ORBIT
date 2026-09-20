'use client';
import {useLayoutEffect,useRef,useState,useContext,createContext,createElement,type ReactNode} from 'react';
import {flushSync} from 'react-dom';
import {createOverlayStack} from '@/lib/orbit/overlay-stack';
const PopupParent=createContext<symbol|undefined>(undefined);
let stack:ReturnType<typeof createOverlayStack>|undefined;
function popupStack(){return stack??=createOverlayStack(window,fn=>flushSync(fn));}
export function afterPopupClose(fn:()=>void){popupStack().afterClose(fn);}
export function pushPopupRoute(state:unknown,url:string){popupStack().push(state,url);}
export function replacePopupRoute(state:unknown,url:string){popupStack().replace(state,url);}

export function usePopupHistory({open,defaultOpen,onOpenChange,children,historyPriority=0}:{open?:boolean;defaultOpen?:boolean;onOpenChange?:(open:boolean)=>void;children?:ReactNode;historyPriority?:number}){
 const id=useRef(Symbol()),parent=useContext(PopupParent);
 const [internal,setInternal]=useState(defaultOpen??false);
 const shown=open??internal;
 const change=(value:boolean)=>{if(open===undefined)setInternal(value);onOpenChange?.(value);};
 const latest=useRef(change);latest.current=change;
 useLayoutEffect(()=>{if(shown)return popupStack().register(()=>latest.current(false),{id:id.current,parent,priority:historyPriority});},[shown,parent,historyPriority]);
 return {open:shown,onOpenChange:change,children:createElement(PopupParent.Provider,{value:id.current},children)};
}
