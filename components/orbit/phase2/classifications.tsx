'use client';
import {useMemo,useState} from 'react';
import {automaticProject} from '@/lib/orbit/classify';
import type {WorkspaceData,Note} from '@/lib/orbit/model';
import type {WorkspaceAction} from '@/lib/orbit/validation';
export function Classifications({data,busy,demo,perform}:{data:WorkspaceData;busy:boolean;demo:boolean;perform:(a:WorkspaceAction,message?:string)=>Promise<boolean>}){
 const [working,setWorking]=useState(''),[error,setError]=useState('');
 const candidates=useMemo(()=>data.notes.slice(-100).flatMap(n=>{const best=automaticProject(`${n.title} ${n.summary} ${n.tags.join(' ')}`,data.projects,data.tasks,data.notes.filter(x=>x.id!==n.id));return best&&best.projectId!==n.projectId?[{note:n,best}]:[]}).slice(0,12),[data]);
 async function apply(meta:Note,projectId:string){setWorking(meta.id);setError('');try{const note=demo?meta:await(await fetch('/api/notes?id='+encodeURIComponent(meta.id),{cache:'no-store'})).json();if(!note.id||note.error)throw Error(note.error||'원문을 불러오지 못했습니다.');if((note.revision??1)!==(meta.revision??1))throw Error('원문이 변경됐습니다. 목록을 새로고침해 주세요.');const {revision,bodyStored,wikiMentionIds,searchExcerpt,...fields}=note;await perform({type:'note.upsert',note:{...fields,projectId},expectedNoteRevision:revision??1},'원문을 유지하고 프로젝트 분류를 변경했습니다.');}catch(e){setError((e as Error).message)}finally{setWorking('')}}
 return <details className="phase2-record"><summary>분류 점검 · 프로젝트 연결 제안 {candidates.length}건</summary><p className="form-hint">최근 목록 100건의 제목·요약·태그와 프로젝트 키워드를 비교했습니다. 제안은 검토 후 적용하며 원문과 변경 이력을 보존합니다.</p>{candidates.map(({note,best})=><div className="phase2-record" key={note.id}><strong>{note.title}</strong><p>{data.projects.find(p=>p.id===note.projectId)?.name} → {data.projects.find(p=>p.id===best.projectId)?.name}</p><p>일치한 표현: {best.matched.join(' · ')}</p><button className="secondary-button" disabled={busy||!!working} onClick={()=>void apply(note,best.projectId)}>{working===note.id?'저장 중…':'이 프로젝트로 분류'}</button></div>)}{!candidates.length&&<p>다른 프로젝트로 옮길 만큼 명확한 일치가 없습니다.</p>}{error&&<p role="alert">{error}</p>}</details>;
}
