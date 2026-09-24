'use client';
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {Command,CommandEmpty,CommandGroup,CommandInput,CommandItem,CommandList} from '@/components/ui/command';
import {afterPopupClose} from '@/components/ui/use-popup-history';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import type {View} from '@/lib/orbit/model';
import {searchScreens} from '@/lib/orbit/navigation';
import {viewIcons} from './view-icons';

export interface SearchAction {id:string;label:string;hint:string;icon:ReactNode;keywords:readonly string[];disabled?:boolean;run:()=>void}

const typing=(target:EventTarget|null)=>target instanceof HTMLElement&&(target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target.tagName));

// ⌘K / Ctrl+K anywhere, and "/" when not typing, open 찾기.
export function useSearchShortcut(setOpen:(open:boolean)=>void){
 useEffect(()=>{
  const mac=/Mac|iPhone|iPad/.test(navigator.platform);
  const onKey=(e:KeyboardEvent)=>{
   // Never open over another popup: it would navigate underneath it or reset its draft.
   if(e.target instanceof Element&&e.target.closest('[role="dialog"],[role="alertdialog"],[role="menu"]'))return;
   // ⌘K on Mac (Ctrl+K there deletes to the end of the line), Ctrl+K elsewhere. KeyK also works with a Korean input source.
   if((mac?e.metaKey:e.ctrlKey)&&!e.altKey&&(e.code==='KeyK'||e.key?.toLowerCase()==='k')){e.preventDefault();setOpen(true);return;}
   if(e.key==='/'&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!typing(e.target)){e.preventDefault();setOpen(true);}
  };
  window.addEventListener('keydown',onKey);
  return()=>window.removeEventListener('keydown',onKey);
 },[setOpen]);
}

const matches=(action:SearchAction,query:string)=>{const q=query.toLowerCase().replace(/\s+/g,'');return !q||[action.label,action.hint,...action.keywords].some(w=>w.toLowerCase().replace(/\s+/g,'').includes(q));};

// Replaces the former "전체 메뉴". Former menu names still find their new place.
export function OrbitSearch({open,onOpenChange,view,navigate,actions}:{open:boolean;onOpenChange:(open:boolean)=>void;view:View;navigate:(v:View)=>void;actions:readonly SearchAction[]}){
 const [query,setQuery]=useState('');
 const screens=useMemo(()=>searchScreens(query),[query]);
 const shownActions=useMemo(()=>actions.filter(a=>matches(a,query)),[actions,query]);
 // Navigation already waits for the popup to close; actions that open another popup must too.
 const close=(then:()=>void)=>{onOpenChange(false);setQuery('');afterPopupClose(then);};
 const groups=[...new Set(screens.map(s=>s.area))];
 return <Dialog open={open} onOpenChange={next=>{onOpenChange(next);if(!next)setQuery('');}}>
  <DialogContent className="orbit-search overflow-hidden p-0" showCloseButton={false}>
   <DialogHeader className="sr-only"><DialogTitle>찾기</DialogTitle><DialogDescription>화면 이름이나 예전 메뉴 이름, 하고 싶은 일을 입력하세요.</DialogDescription></DialogHeader>
   <Command shouldFilter={false} loop>
    <CommandInput value={query} onValueChange={setQuery} placeholder="화면·예전 메뉴 이름·할 일 찾기" aria-label="찾기"/>
    <CommandList>
     <CommandEmpty>‘{query}’와 맞는 화면이 없습니다. 다른 이름으로 찾아 보세요.</CommandEmpty>
     {shownActions.length>0&&<CommandGroup heading="바로 하기">{shownActions.map(a=><CommandItem key={a.id} value={'action:'+a.id} disabled={a.disabled} onSelect={()=>close(a.run)}>{a.icon}<span className="search-item-label">{a.label}</span><span className="search-item-hint">{a.hint}</span></CommandItem>)}</CommandGroup>}
     {groups.map(area=><CommandGroup key={area} heading={area}>{screens.filter(s=>s.area===area).map(s=>{const Icon=viewIcons[s.view];return <CommandItem key={s.view} value={'view:'+s.view} onSelect={()=>close(()=>navigate(s.view))}><Icon/><span className="search-item-label">{s.label}</span>{s.view===view?<span className="search-item-hint">지금 화면</span>:s.keywords.length>0&&<span className="search-item-hint">{s.keywords.slice(0,2).join(' · ')}</span>}</CommandItem>;})}</CommandGroup>)}
    </CommandList>
   </Command>
   <p className="orbit-search-foot"><kbd>↑</kbd><kbd>↓</kbd> 이동 · <kbd>Enter</kbd> 열기 · <kbd>Esc</kbd> 닫기</p>
  </DialogContent>
 </Dialog>;
}
