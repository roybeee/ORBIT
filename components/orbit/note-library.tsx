'use client';
import {useEffect,useState} from 'react';
import {BookOpen,ChevronLeft,ChevronRight,FileText,Inbox,Lightbulb,RotateCcw} from 'lucide-react';
import type {Note} from '@/lib/orbit/model';
export function NoteLibrary({notes,kind,query,revision,demo,onSelect,onRefresh}:{notes:Note[];kind:'wiki'|'knowledge';query:string;revision:number;demo:boolean;onSelect:(id:string)=>void;onRefresh:()=>Promise<void>}){
 const [page,setPage]=useState(0),[items,setItems]=useState<Note[]>([]),[more,setMore]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{setPage(0)},[query,kind,revision]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');setConflict(false);
  if(demo){const matches=notes.filter(n=>(kind==='knowledge'?n.kind==='knowledge':n.kind!=='knowledge')&&[n.title,n.summary,n.body,...n.tags].some(text=>text.toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>b.updated.localeCompare(a.updated)||a.id.localeCompare(b.id));setItems(matches.slice(page*24,(page+1)*24));setMore(matches.length>(page+1)*24);setLoading(false);return}
  const timer=setTimeout(async()=>{try{const params=new URLSearchParams({q:query,kind,offset:String(page*24),workspaceRevision:String(revision)});const response=await fetch('/api/notes?'+params,{cache:'no-store',signal:controller.signal});const result=await response.json();if(!response.ok){if(response.status===409)setConflict(true);throw new Error(result.error||'검색을 완료하지 못했습니다.')}if(!controller.signal.aborted){setItems(result.items);setMore(result.hasMore)}}catch(error){if(!controller.signal.aborted)setError((error as Error).message)}finally{if(!controller.signal.aborted)setLoading(false)}},200);
  return()=>{clearTimeout(timer);controller.abort()};
 },[demo,notes,kind,query,revision,page,attempt]);
 if(error)return <div className="empty-state" role="alert"><Inbox size={30}/><p>{error}</p><button className="secondary-button" onClick={()=>conflict?void onRefresh():setAttempt(v=>v+1)}><RotateCcw size={16}/>{conflict?'최신 내용 불러오기':'다시 시도'}</button></div>;
 if(loading)return <div className="note-loading" role="status">기록을 찾는 중…</div>;
 return <>{items.length===0?<div className="empty-state"><Inbox size={30}/><h3>일치하는 기록이 없습니다</h3><p>다른 검색어를 입력하거나 새로운 기록을 추가해 보세요.</p></div>:<div className="document-grid">{items.map(note=><button className="document-card" key={note.id} onClick={()=>onSelect(note.id)}>{note.kind==='knowledge'?<Lightbulb size={24}/>:note.kind==='meeting'?<FileText size={24}/>:<BookOpen size={24}/>}<h2>{note.title}</h2><p>{note.summary}</p><div className="doc-foot"><span>{note.tags.slice(0,2).join(' · ')}</span><span>{note.updated.slice(5).replace('-','.')}</span></div></button>)}</div>}{(page>0||more)&&<nav className="note-pagination" aria-label="기록 목록 페이지"><button className="secondary-button" disabled={page===0} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={16}/>이전</button><span>{page+1}페이지</span><button className="secondary-button" disabled={!more} onClick={()=>setPage(p=>p+1)}>다음<ChevronRight size={16}/></button></nav>}</>;
}
