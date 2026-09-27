'use client';
import {ExternalLink,RotateCcw,X,FileText} from 'lucide-react';
import {useCallback,useEffect,useState} from 'react';
import {toast} from 'sonner';
import type {SlackRequestItem} from '@/lib/orbit/slack/request-view';
import {agentRequest} from '../agent/connections';

const received=(iso:string,timeZone:string)=>new Intl.DateTimeFormat('ko-KR',{timeZone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));
const RETRYABLE=new Set(['waiting','failed','unconfirmed','expired','partial','needs_review']);
const CANCELABLE=new Set(['received','waiting','failed','unconfirmed','expired','partial','needs_review']);

// 대기 중인 요청: Slack instructions ORBIT kept while AI could not process them. Only a one-line
// summary and a link to the Slack message are shown, never the whole message.
export function SlackRequests({timeZone,onOpenDrafts}:{timeZone:string;onOpenDrafts:(conversationId:string)=>void}){
 const [items,setItems]=useState<SlackRequestItem[]>([]),[busy,setBusy]=useState('');
 // The list is optional: when it cannot be read the rest of the inbox still works.
 const load=useCallback(()=>agentRequest('/api/slack-requests').then(r=>setItems(r.items)).catch(()=>{}),[]);
 useEffect(()=>{let live=true;agentRequest('/api/slack-requests').then(r=>{if(live)setItems(r.items)}).catch(()=>{});return()=>{live=false}},[]);
 // While a request is being processed, look again every 20 seconds.
 const processing=items.some(i=>i.status==='processing');
 useEffect(()=>{if(!processing)return;const timer=setInterval(()=>void load(),20000);return()=>clearInterval(timer)},[processing,load]);
 async function change(item:SlackRequestItem,action:'retry'|'cancel'){
  setBusy(item.id+action);
  try{await agentRequest('/api/slack-requests','POST',{id:item.id,action});toast(action==='retry'?'다시 처리하도록 넣었습니다. 초안이 준비되면 결재함에 표시됩니다.':'요청을 취소했습니다.');await load()}
  catch(e){toast(e instanceof Error?e.message:'처리하지 못했습니다.')}
  finally{setBusy('')}
 }
 if(!items.length)return null;
 return <section className="inbox-group slack-requests" aria-label="대기 중인 요청">
  <header className="inbox-group-head"><span className="inbox-kind tone-follow">대기 중인 요청</span><strong>Slack에서 받은 지시</strong><span className="inbox-group-count">{items.length}건</span></header>
  <ul className="slack-request-list">{items.map(item=><li key={item.id} className={'slack-request is-'+item.status}>
   <div className="inbox-card-source"><span>{received(item.createdAt,timeZone)} 접수</span><span>Slack</span>{item.counts.total>0&&<span>초안 {item.counts.total}건</span>}{item.deliveries>1&&<span>중복 전송 {item.deliveries-1}회 합침</span>}</div>
   <p className="slack-request-summary">{item.summary}</p>
   <p className="slack-request-status" role="status">{item.statusLabel}</p>
   <div className="inbox-card-actions">
    {item.conversationId&&item.counts.total>0&&<button className="secondary-button" onClick={()=>onOpenDrafts(item.conversationId)}><FileText size={15}/>초안 열기</button>}
    {RETRYABLE.has(item.status)&&!item.counts.approved&&<button className="secondary-button" disabled={!!busy} onClick={()=>void change(item,'retry')}><RotateCcw size={15}/>다시 처리</button>}
    {CANCELABLE.has(item.status)&&<button className="text-button" disabled={!!busy} onClick={()=>void change(item,'cancel')}><X size={15}/>취소</button>}
    <a className="text-button" href={item.permalink} target="_blank" rel="noreferrer">원본 보기<ExternalLink size={14}/></a>
   </div>
  </li>)}</ul>
 </section>;
}
