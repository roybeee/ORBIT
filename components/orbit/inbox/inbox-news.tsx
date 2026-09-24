'use client';
import {AlertCircle,Bell,CheckCircle2,Clock3} from 'lucide-react';
import type {NewsSummary} from '../notifications';

const icon={failed:AlertCircle,approval:Clock3,completed:CheckCircle2,info:Bell} as const;

// 소식: things to know, not to decide. Read-only; no red count.
export function InboxNews({news,onNews}:{news:NewsSummary|null;onNews:()=>void}){
 if(!news||!news.items.length)return null;
 const latest=[...news.items].sort((a,b)=>Number(!!a.readAt)-Number(!!b.readAt)).slice(0,3);
 return <section className="inbox-news" aria-label="소식">
  <header><h2>소식</h2>{news.unread>0&&<span className="inbox-news-unread">읽지 않음 {news.unread}</span>}<button className="text-button" onClick={onNews}>모두 보기</button></header>
  <ul>{latest.map(n=>{const Icon=icon[n.kind]??Bell;return <li key={n.id} className={n.readAt?'is-read':''}><button onClick={onNews}><Icon size={17} aria-hidden="true"/><span><strong>{n.title}</strong><small>{n.body}</small></span>{!n.readAt&&<i aria-label="읽지 않음"/>}</button></li>;})}</ul>
 </section>;
}
