'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Bell,CheckCheck,CheckCircle2,AlertCircle,Clock3,X} from 'lucide-react';
import {toast} from 'sonner';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {OrbitNotification} from '@/lib/orbit/notifications/store';
import {clientRequest} from '@/lib/orbit/agent/client-request';
type Inbox={items:OrbitNotification[];unread:number;publicKey:string;serverTime:string;hasMore:boolean;subscriptions:{id:string;error:string}[]};
const bytes=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
export function NotificationCenter({ownerId,demo}:{ownerId:string;demo:boolean}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Inbox|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[push,setPush]=useState(false),[supported,setSupported]=useState(false),[filter,setFilter]=useState('all');
 const [swipe,setSwipe]=useState<{id:string;dx:number}|null>(null),[opened,setOpened]=useState<string[]>([]);
 const seen=useRef<Set<string>|null>(null),scope=useRef(ownerId),drag=useRef<{id:string;x:number}|null>(null);
 useLayoutEffect(()=>{scope.current=ownerId},[ownerId]);
 const request=useCallback((method='GET',body?:unknown,suffix='')=>clientRequest('/api/notifications'+suffix,method,body),[ownerId]);
 const refresh=useCallback(async()=>{const current=ownerId;try{const next=await request() as Inbox;if(scope.current!==current)return;setData(next);setError('');if('serviceWorker'in navigator&&'PushManager'in window){const reg=await navigator.serviceWorker.getRegistration('/'),sub=await reg?.pushManager.getSubscription();if(sub){const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sub.endpoint))),id=btoa(String.fromCharCode(...hash)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');setPush(next.subscriptions.some(s=>s.id===id));}else setPush(false);}const fresh=next.items.filter(n=>!n.readAt&&!seen.current?.has(n.id));if(seen.current&&fresh.length){const n=fresh[0];toast(n.title,{description:fresh.length>1?`새 알림 ${fresh.length}건` : n.body.slice(0,100),action:{label:'확인',onClick:()=>setOpen(true)}});}seen.current=new Set([...(seen.current??[]),...next.items.map(n=>n.id)]);const nav=navigator as Navigator&{setAppBadge?:(n:number)=>Promise<void>;clearAppBadge?:()=>Promise<void>};if(next.unread)void nav.setAppBadge?.(next.unread).catch(()=>{});else void nav.clearAppBadge?.().catch(()=>{});}catch(e){if(scope.current===current)setError((e as Error).message)}},[ownerId,request]);
 // eslint-disable-next-line react-hooks/set-state-in-effect -- the inbox resets for the new owner, and push support and the ?notifications flag come from browser APIs that only exist after mount
 useEffect(()=>{if(demo)return;seen.current=null;setData(null);void refresh();const poll=setInterval(()=>{if(document.visibilityState==='visible')void refresh()},12000);const onFocus=()=>void refresh();window.addEventListener('focus',onFocus);const support='serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;setSupported(support);if(support){navigator.serviceWorker.addEventListener('message',onFocus);}setOpen(new URLSearchParams(location.search).has('notifications'));return()=>{clearInterval(poll);window.removeEventListener('focus',onFocus);if(support)navigator.serviceWorker.removeEventListener('message',onFocus)}},[demo,refresh]);
 async function enable(){setBusy(true);setError('');try{const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('기기 설정에서 ORBIT 알림을 허용해 주세요. 앱 안의 알림함은 계속 사용할 수 있습니다.');const reg=await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();if(sub){const expected=bytes(data!.publicKey),actual=new Uint8Array(sub.options.applicationServerKey??new ArrayBuffer(0));if(expected.length!==actual.length||expected.some((v,i)=>v!==actual[i])){await sub.unsubscribe();sub=null;}}if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(data!.publicKey)});const value=sub.toJSON();await request('POST',{action:'subscribe',subscription:{endpoint:sub.endpoint,keys:value.keys}});setPush(true);await request('POST',{action:'test'});await refresh();}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function disable(){setBusy(true);try{const reg=await navigator.serviceWorker.getRegistration('/'),sub=await reg?.pushManager.getSubscription();if(sub){await request('POST',{action:'unsubscribe',endpoint:sub.endpoint});await sub.unsubscribe();}setPush(false)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function visit(n:OrbitNotification){try{await request('POST',{action:'read',ids:[n.id]});location.assign(n.href)}catch(e){setError((e as Error).message)}}
 // Dismissal is optimistic: the row disappears at once and the server marks it so the
 // next collection pass cannot bring it back. A failure puts the list back as it was.
 async function dismiss(id:string){
  const before=data;
  if(data)setData({...data,items:data.items.filter(i=>i.id!==id),unread:Math.max(0,data.unread-(data.items.find(i=>i.id===id)?.readAt?0:1))});
  setSwipe(null);
  try{await request('POST',{action:'dismiss',ids:[id]})}catch(e){setError((e as Error).message);if(before)setData(before)}
 }
 function swipeStart(id:string,x:number){drag.current={id,x};setSwipe({id,dx:0})}
 function swipeMove(x:number){const d=drag.current;if(!d)return;setSwipe({id:d.id,dx:Math.max(0,x-d.x)})}
 function swipeEnd(){const d=drag.current,current=swipe;drag.current=null;if(d&&current&&current.id===d.id&&current.dx>=96)void dismiss(d.id);else setSwipe(null)}
 // A failing dependency repeats one title for every retried record, so consecutive
 // notifications sharing a kind and title collapse into their newest row with a count.
 function grouped(items:OrbitNotification[]){
  return items.reduce<{key:string;head:OrbitNotification;rest:OrbitNotification[]}[]>((acc,item)=>{
   const last=acc.at(-1),key=item.kind+'\u0000'+item.title;
   return last&&last.key===key?[...acc.slice(0,-1),{...last,rest:[...last.rest,item]}]:[...acc,{key,head:item,rest:[]}];
  },[]);
 }
 async function dismissGroup(group:{head:OrbitNotification;rest:OrbitNotification[]}){
  const ids=[group.head.id,...group.rest.map(i=>i.id)],before=data;
  if(data)setData({...data,items:data.items.filter(i=>!ids.includes(i.id)),unread:Math.max(0,data.unread-ids.filter(id=>![...data.items].find(i=>i.id===id)?.readAt).length)});
  setSwipe(null);
  try{for(let i=0;i<ids.length;i+=100)await request('POST',{action:'dismiss',ids:ids.slice(i,i+100)})}catch(e){setError((e as Error).message);if(before)setData(before)}
 }
 async function readAll(){if(!data)return;try{await request('POST',{action:'read',ids:[],through:data.serverTime});await refresh()}catch(e){setError((e as Error).message)}}
 if(demo)return null;
 return <><button className="icon-button notification-bell" aria-label={`알림함${data?.unread?' · 읽지 않은 알림 '+data.unread+'건':''}`} onClick={()=>{setOpen(true);void refresh()}}><Bell size={20}/>{!!data?.unread&&<span>{data.unread>99?'99+':data.unread}</span>}</button>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="notification-dialog"><DialogHeader><DialogTitle>알림함 {data?.unread?`· ${data.unread}`:''}</DialogTitle><DialogDescription>회의 요약, 승인 요청, 업무 완료와 실패를 확인하세요.</DialogDescription></DialogHeader>
 <div className="notification-controls"><button className="text-button" onClick={()=>void readAll()} disabled={!data?.unread}><CheckCheck size={16}/>모두 읽음</button>{supported?<button className="secondary-button" disabled={busy||!data} onClick={()=>void(push?disable():enable())}>{push?'이 기기 알림 끄기':'기기 알림 켜기'}</button>:<p className="form-hint">기기 알림은 지원되는 브라우저에서 설정할 수 있습니다.</p>}{push&&<button className="text-button" disabled={busy} onClick={()=>void request('POST',{action:'test'}).then(refresh).catch(e=>setError(e.message))}>테스트 알림</button>}</div>
 {error&&<p role="alert" className="note-error">{error}</p>}{data?.subscriptions.some(s=>s.error)&&<p role="status" className="note-error">일부 기기에 알림을 보내지 못해 재시도 중입니다. 기기 알림 설정과 테스트 알림을 확인해 주세요.</p>}
 <div className="notification-filters" aria-label="알림 필터">{[['all','전체'],['approval','승인 요청'],['failed','실패'],['unread','읽지 않음']].map(([key,label])=><button key={key} aria-pressed={filter===key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}</button>)}</div>
 <div className="notification-list" aria-live="polite">{data&&grouped(data.items.filter(n=>filter==='all'||filter==='unread'&&!n.readAt||n.kind===filter)).map(group=>{const n=group.head,count=group.rest.length+1,expanded=opened.includes(group.key);return <div key={group.key} className="notification-group"><div key={n.id} className="notification-row" onTouchStart={e=>swipeStart(n.id,e.touches[0].clientX)} onTouchMove={e=>swipeMove(e.touches[0].clientX)} onTouchEnd={swipeEnd} onTouchCancel={swipeEnd} style={swipe?.id===n.id?{transform:`translateX(${Math.min(swipe.dx,160)}px)`,transition:drag.current?'none':'transform .18s ease'}:undefined}><button className={'notification-item '+(n.readAt?'read':'unread')} onClick={()=>void visit(n)}>{n.kind==='failed'?<AlertCircle size={20}/>:n.kind==='approval'?<Clock3 size={20}/>:n.kind==='completed'?<CheckCircle2 size={20}/>:<Bell size={20}/>}<span><strong>{n.title}</strong><p>{n.body}</p><small>{new Date(n.createdAt).toLocaleString('ko-KR')}</small></span>{!n.readAt&&<i aria-label="읽지 않음"/>}</button><button className="notification-dismiss" aria-label={`알림 삭제 · ${n.title}`} onClick={()=>void dismiss(n.id)}><X size={16}/></button></div>{count>1&&<div className="notification-group-more"><button className="text-button" onClick={()=>setOpened(v=>expanded?v.filter(k=>k!==group.key):[...v,group.key])}>{expanded?'같은 알림 접기':`같은 알림 ${count-1}건 더 보기`}</button><button className="text-button" onClick={()=>void dismissGroup(group)}>{count}건 모두 삭제</button></div>}{count>1&&expanded&&group.rest.map(r=><div key={r.id} className="notification-row is-grouped"><button className={'notification-item '+(r.readAt?'read':'unread')} onClick={()=>void visit(r)}><span><strong>{r.title}</strong><p>{r.body}</p><small>{new Date(r.createdAt).toLocaleString('ko-KR')}</small></span>{!r.readAt&&<i aria-label="읽지 않음"/>}</button><button className="notification-dismiss" aria-label={`알림 삭제 · ${r.title}`} onClick={()=>void dismiss(r.id)}><X size={16}/></button></div>)}</div>})}{!data?<p>알림을 불러오는 중입니다.</p>:!data.items.length?<p className="empty-state">새 알림이 없습니다. 회의록이 등록되거나 업무 상태가 바뀌면 여기서 알려드립니다.</p>:null}</div>
 {data?.hasMore&&<button className="text-button" onClick={()=>void request('GET',undefined,'?before='+encodeURIComponent(data.items.at(-1)!.createdAt)).then((v:Inbox)=>setData({...data,items:[...data.items,...v.items],hasMore:v.hasMore})).catch(e=>setError(e.message))}>이전 알림 더 보기</button>}
 </DialogContent></Dialog></>;
}
