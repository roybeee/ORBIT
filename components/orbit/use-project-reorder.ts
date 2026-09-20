'use client';
import {useEffect,useRef,useState} from 'react';
import {PROJECT_HOLD_MS,PROJECT_PRESS_SLOP} from '@/lib/orbit/project-press';
import {moveProjectInOrder} from '@/lib/orbit/project-order';

type Options={ids:string[];coreId?:string;scope:string;disabled:boolean;onManage:(id:string)=>void;onSave:(ids:string[])=>Promise<boolean>};
type Drag={id:string;x:number;y:number};
type Session={id:string;x:number;y:number;input:'touch'|'pointer';pointer:number;active:boolean;timer?:ReturnType<typeof setTimeout>;before:string[]|null};
export function useProjectReorder(options:Options){
 const root=useRef<HTMLDivElement>(null),latest=useRef(options);latest.current=options;
 const [order,setOrder]=useState<string[]|null>(null),orderRef=useRef<string[]|null>(null);
 const [drag,setDrag]=useState<Drag|null>(null),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
 const savingRef=useRef(false);
 const session=useRef<Session|null>(null),suppress=useRef(0),cancelGesture=useRef<()=>void>(()=>{});
 const update=(ids:string[]|null)=>{orderRef.current=ids;setOrder(ids)};
 function startEditing(){if(options.disabled||savingRef.current)return;update(options.ids.filter(id=>id!==options.coreId));setMessage('순서 편집 중 · 카드를 끌어 놓은 뒤 저장하세요.')}
 function cancel(){if(savingRef.current)return;cancelGesture.current();update(null);setMessage('순서 변경을 취소했습니다.')}
 async function save(){
  if(!orderRef.current||savingRef.current||options.disabled)return;
  const ids=[...orderRef.current];cancelGesture.current();update(ids);
  if(ids.length<2){update(null);return}
  savingRef.current=true;setSaving(true);setMessage('순서를 저장하고 있어요.');
  try{const ok=await latest.current.onSave(ids);if(ok){update(null);setMessage('프로젝트 순서를 저장했습니다.')}else{update(null);setMessage('저장 결과를 확인하지 못했어요. 마지막으로 확인한 순서를 표시합니다.')}}
  catch{update(null);setMessage('저장 결과를 확인하지 못했어요. 마지막으로 확인한 순서를 표시합니다.')}
  finally{savingRef.current=false;setSaving(false)}
 }
 function step(id:string,delta:number){if(savingRef.current||latest.current.disabled)return;const ids=orderRef.current;if(!ids)return;const i=ids.indexOf(id),target=ids[i+delta];if(target)update(moveProjectInOrder(ids,id,target))}
 // A change of bucket/filter/core or external membership invalidates the draft.
 const membership=options.ids.slice().sort().join('|');
 useEffect(()=>{cancelGesture.current();update(null);setMessage('')},[options.scope,options.coreId,membership]);
 useEffect(()=>{if(options.disabled)cancelGesture.current()},[options.disabled]);
 useEffect(()=>{
  const element=root.current;if(!element)return;let frame=0,lastTouch=0;
  function clear(){const s=session.current;if(s?.timer)clearTimeout(s.timer);if(frame)cancelAnimationFrame(frame);frame=0;session.current=null;setDrag(null)}
  function abort(){const s=session.current;if(s?.active){suppress.current=Date.now()+800;update(s.before)}clear()}
  cancelGesture.current=abort;
  function begin(target:EventTarget|null,x:number,y:number,input:Session['input'],pointer:number){
   if(latest.current.disabled||savingRef.current||session.current)return;
   const el=target instanceof Element?target:null,card=el?.closest<HTMLElement>('[data-project-card]');if(!card)return;
   const control=el?.closest('button,a,input,select,textarea,[role=button]');if(control&&!control.hasAttribute('data-project-title'))return;
   const id=card.dataset.projectCard!;if(id===latest.current.coreId&&orderRef.current)return;const s:Session={id,x,y,input,pointer,active:false,before:orderRef.current?[...orderRef.current]:null};session.current=s;
   const activate=()=>{
    if(session.current!==s||latest.current.disabled){abort();return}
    if(id===latest.current.coreId){suppress.current=Date.now()+800;clear();latest.current.onManage(id);return}
    s.active=true;suppress.current=Date.now()+800;
    if(!orderRef.current)update(latest.current.ids.filter(key=>key!==latest.current.coreId));
    setDrag({id,x:s.x,y:s.y});setMessage('순서 편집 중 · 카드를 끌어 놓은 뒤 저장하세요.');
    if(typeof navigator.vibrate==='function')navigator.vibrate(20);
    frame=requestAnimationFrame(autoScroll);
   };
   if(orderRef.current&&id!==latest.current.coreId)activate();else s.timer=setTimeout(activate,PROJECT_HOLD_MS);
  }
  function place(){
   const s=session.current,ids=orderRef.current;if(!s?.active||!ids)return;
   const card=document.elementFromPoint(s.x,s.y)?.closest<HTMLElement>('[data-project-card]');
   const target=card?.dataset.projectCard;
   if(card&&element!.contains(card)&&target&&target!==s.id&&target!==latest.current.coreId&&ids.includes(target))update(moveProjectInOrder(ids,s.id,target));
  }
  function autoScroll(){
   const s=session.current;if(!s?.active)return;
   const bounds=element!.getBoundingClientRect(),edge=Math.min(64,bounds.width/4);
   const speed=s.x<bounds.left+edge?-Math.min(15,(bounds.left+edge-s.x)/4):s.x>bounds.right-edge?Math.min(15,(s.x-bounds.right+edge)/4):0;
   if(speed)element!.scrollBy({left:speed,behavior:'instant'});
   const bottom=window.innerHeight-110;
   const dy=s.y<80?-Math.min(12,(80-s.y)/4):s.y>bottom?Math.min(12,(s.y-bottom)/4):0;
   if(dy)window.scrollBy({top:dy,behavior:'instant'});
   if(speed||dy)place();frame=requestAnimationFrame(autoScroll);
  }
  function move(x:number,y:number,e:Event){
   const s=session.current;if(!s)return;
   if(!s.active){if(Math.hypot(x-s.x,y-s.y)>PROJECT_PRESS_SLOP)abort();return}
   if(latest.current.disabled||s.input==='touch'&&!e.cancelable){abort();return}
   if(e.cancelable)e.preventDefault();s.x=x;s.y=y;setDrag({id:s.id,x,y});place();
  }
  function end(e:Event){const s=session.current;if(!s)return;if(s.active){if(e.cancelable)e.preventDefault();suppress.current=Date.now()+800;setMessage('순서를 바꿨어요. 저장을 누르면 적용됩니다.')}clear()}
  const touchStart=(e:TouchEvent)=>{lastTouch=Date.now();if(e.touches.length!==1){abort();return}const t=e.touches[0];begin(e.target,t.clientX,t.clientY,'touch',t.identifier)};
  const touchMove=(e:TouchEvent)=>{if(session.current?.input!=='touch')return;if(e.touches.length!==1){abort();return}const t=e.touches[0];if(t.identifier===session.current.pointer)move(t.clientX,t.clientY,e)};
  const touchEnd=(e:TouchEvent)=>{if(session.current?.input==='touch'&&Array.from(e.changedTouches).some(t=>t.identifier===session.current?.pointer))end(e)};
  const multi=(e:TouchEvent)=>{if(e.touches.length>1)abort()};
  const down=(e:PointerEvent)=>{if(e.pointerType==='touch'||!e.isPrimary||e.button!==0)return;begin(e.target,e.clientX,e.clientY,'pointer',e.pointerId)};
  const pointerMove=(e:PointerEvent)=>{if(session.current?.input==='pointer'&&session.current.pointer===e.pointerId)move(e.clientX,e.clientY,e)};
  const up=(e:PointerEvent)=>{if(session.current?.input==='pointer'&&session.current.pointer===e.pointerId)end(e)};
  const pointerCancel=(e:PointerEvent)=>{if(session.current?.input==='pointer'&&session.current.pointer===e.pointerId)abort()};
  const click=(e:MouseEvent)=>{const card=e.target instanceof Element&&e.target.closest('[data-project-card]');if(card&&!(e.target as Element).closest('[data-reorder-control]')&&(Date.now()<suppress.current||orderRef.current)){e.preventDefault();e.stopImmediatePropagation()}};
  const context=(e:MouseEvent)=>{const card=e.target instanceof Element?e.target.closest<HTMLElement>('[data-project-card]'):null;if(!card)return;e.preventDefault();if(!session.current&&Date.now()-lastTouch>1200&&!latest.current.disabled&&!orderRef.current)latest.current.onManage(card.dataset.projectCard!)};
  const scroll=()=>{if(session.current&&!session.current.active)abort()};
  const hidden=()=>{if(document.hidden)abort()};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&orderRef.current){e.preventDefault();if(savingRef.current||latest.current.disabled)return;abort();update(null);setMessage('순서 변경을 취소했습니다.')}};
  element.addEventListener('touchstart',touchStart,{passive:true});document.addEventListener('touchmove',touchMove,{passive:false});document.addEventListener('touchend',touchEnd,{passive:false});document.addEventListener('touchcancel',abort);document.addEventListener('touchstart',multi,{passive:true});
  element.addEventListener('pointerdown',down);document.addEventListener('pointermove',pointerMove);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',pointerCancel);element.addEventListener('contextmenu',context);document.addEventListener('click',click,true);document.addEventListener('keydown',key);window.addEventListener('scroll',scroll,{capture:true,passive:true});window.addEventListener('blur',abort);document.addEventListener('visibilitychange',hidden);
  return()=>{clear();element.removeEventListener('touchstart',touchStart);document.removeEventListener('touchmove',touchMove);document.removeEventListener('touchend',touchEnd);document.removeEventListener('touchcancel',abort);document.removeEventListener('touchstart',multi);element.removeEventListener('pointerdown',down);document.removeEventListener('pointermove',pointerMove);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',pointerCancel);element.removeEventListener('contextmenu',context);document.removeEventListener('click',click,true);document.removeEventListener('keydown',key);window.removeEventListener('scroll',scroll,true);window.removeEventListener('blur',abort);document.removeEventListener('visibilitychange',hidden)};
 },[]);
 return {root,order,drag,saving,message,editing:order!==null,startEditing,cancel,save,step};
}
