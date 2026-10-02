'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {readDraft,saveDraft,clearDraft} from './device-drafts';
import {requestOwnerHeaders} from './request-owner';
import { toast } from 'sonner';
import { emptyWorkspace, type WorkspaceSnapshot } from './model';
import {commandSchema} from './validation';
import type { WorkspaceAction } from './validation';
import { applyAction } from './reducer';
import {WorkspaceWrites,restoreWrites} from './workspace-write-client';
import {
  initialProjects,
  initialTasks,
  initialNotes,
  initialEvents,
  initialGoals,
  initialDominoProjectId,
  initialHabits,
  initialRisks,
  initialImprovements,
  initialReviews,
} from './seed';
import { generateProposal, calibrationFactor } from './planner';
const initial = (demo: boolean): WorkspaceSnapshot => {
  const empty = emptyWorkspace();
  return {
    revision: 0,
    updatedAt: null,
    data: demo
      ? {
          ...empty,
          projects: initialProjects,
          tasks: initialTasks.map((t) => ({ ...t, focusDate: t.focus ? '2026-09-06' : undefined })),
          notes: initialNotes,
          events: initialEvents,
          goals: initialGoals,
          dominoProjectId: initialDominoProjectId,
          habits: initialHabits,
          risks: initialRisks,
          improvements: initialImprovements,
          reviews: initialReviews,
          proposals: [
            generateProposal(
              initialTasks,
              initialEvents,
              '2026-09-07',
              'normal',
              undefined,
              empty.preferences,
              {
                dominoProjectId: initialDominoProjectId,
                calibration: (t) => calibrationFactor(initialTasks, t, '2026-09-07'),
              },
            ),
          ],
        }
      : empty,
  };
};
interface Failure {message:string;code:string}
export function useWorkspace(demo:boolean, ownerId='') {
  const [snapshot,setSnapshot]=useState(()=>initial(demo));
  const [loaded,setLoaded]=useState(demo),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false);
  const [savedInputs,setSavedInputs]=useState<{title:string;text:string}[]>([]);
  const [failure,setFailure]=useState<Failure|null>(null),[online,setOnline]=useState(true),[hasPending,setHasPending]=useState(false);
  const engine=useRef<WorkspaceWrites|null>(null),pauseRef=useRef(false),reading=useRef(false);
  const draftTarget=useRef('');
  const read=useCallback(async()=>{
    const r=await fetch('/api/workspace',{headers:{...requestOwnerHeaders(),...(ownerId?{'x-orbit-owner':ownerId}:{})},cache:'no-store',signal:AbortSignal.timeout(20000)});
    const body=await r.json();if(!r.ok)throw {message:body.error,code:body.code};return body as WorkspaceSnapshot;
  },[ownerId]);
  const load=useCallback(async(automatic=false)=>{
    const client=engine.current;
    if(demo||!client||reading.current||client.running||(automatic&&pauseRef.current))return;
    reading.current=true;
    try{const value=await read();if(engine.current!==client||automatic&&pauseRef.current)return;client.accept(value);setLoaded(true);if(!client.queue.length){client.failure=null;setFailure(null);}}
    catch(error){if(engine.current===client)setFailure({message:(error as Error).message||'연결 상태를 확인해 주세요.',code:'NETWORK'});}
    finally{reading.current=false;}
  },[demo,read]);
  useEffect(()=>{
    let active=true;setLoaded(demo);setSnapshot(initial(demo));setFailure(null);setSavedInputs([]);
    // Per-tab queues cannot overwrite another tab's unsent commands. sessionStorage
    // retains this key on reload; drafts remain scoped to the authenticated owner.
    try{draftTarget.current=sessionStorage.getItem('orbit-write-tab')||crypto.randomUUID();sessionStorage.setItem('orbit-write-tab',draftTarget.current);}catch{draftTarget.current='default';}
    const target=draftTarget.current;
    const client:WorkspaceWrites=new WorkspaceWrites(initial(demo),{
      read,
      post:async(command):Promise<WorkspaceSnapshot>=>{
        if(demo)return {data:applyAction(client.snapshot.data,command.action,new Date('2026-09-06T09:00:00Z')),revision:client.snapshot.revision+1,updatedAt:new Date().toISOString()};
        const r=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',...requestOwnerHeaders(),...(ownerId?{'x-orbit-owner':ownerId}:{})},body:JSON.stringify(command),signal:AbortSignal.timeout(20000)});
        const body=await r.json();if(!r.ok)throw {message:body.error,code:body.code};return body;
      },
      persist:queue=>{if(!demo){if(queue.length)saveDraft(ownerId,'write-queue',target,queue);else clearDraft(ownerId,'write-queue',target);}},
      online:()=>demo||navigator.onLine,
      change:()=>{if(!active)return;setSnapshot(client.view);setFailure(client.failure);setSaving(client.queue.some(x=>!x.blocked));setBusy(client.running&&client.blocking);setHasPending(client.blocking);setSavedInputs(client.queue.filter(x=>x.blocked).map(x=>{
        const a=x.command.action;const record=a.type==='project.upsert'?a.project:a.type==='task.upsert'?a.task:a.type==='event.upsert'?a.event:a.type==='note.upsert'?a.note:null;
        if(!record)return {title:'보관된 변경 요청',text:'내용을 다시 확인한 후 다시 시도해 주세요.'};
        const labels:Record<string,string>={name:'이름',title:'제목',goal:'목표',description:'설명',memo:'메모',due:'마감일',date:'날짜',start:'시작(분)',end:'종료(분)',definition:'완료 기준',body:'내용'};
        return {title:'title' in record?record.title:'name' in record?record.name:'보관된 입력',text:Object.entries(record).filter(([k])=>labels[k]).map(([k,v])=>labels[k]+': '+String(v??'')).join('\n')};
      }));},
    });
    engine.current=client;
    if(!demo){
      client.queue=restoreWrites(readDraft(ownerId,'write-queue',target));
      // Recover the old single pending slot with the original operation id first.
      const old=commandSchema.safeParse(readDraft(ownerId,'command'));
      if(old.success&&!client.queue.some(x=>x.command.operationId===old.data.operationId)){
        client.queue.unshift({command:old.data,basis:{revision:old.data.expectedRevision,entity:null},attempted:true});
        try{saveDraft(ownerId,'write-queue',target,client.queue);clearDraft(ownerId,'command');}catch{/* old copy remains */}
      }
    }
    const start=async()=>{await load();if(active)await client.flush();};void start();
    const resume=()=>{if(document.visibilityState==='visible'&&navigator.onLine){void client.flush();if(!client.queue.length&&!pauseRef.current)void load(true);}};
    const connection=()=>{setOnline(navigator.onLine);if(navigator.onLine)resume();};
    const timer=setInterval(resume,15000);
    window.addEventListener('focus',resume);window.addEventListener('online',connection);window.addEventListener('offline',connection);document.addEventListener('visibilitychange',resume);
    setOnline(navigator.onLine);
    return()=>{active=false;client.stopped=true;clearInterval(timer);window.removeEventListener('focus',resume);window.removeEventListener('online',connection);window.removeEventListener('offline',connection);document.removeEventListener('visibilitychange',resume);};
  },[demo,ownerId,load,read]);
  const mutate=useCallback(async(action:WorkspaceAction)=>{
    if(!loaded||!engine.current){toast.error('먼저 저장된 내용을 불러와 주세요.');return false;}
    return engine.current.enqueue(action);
  },[loaded]);
  const retry=useCallback(async()=>{if(engine.current?.queue.length)return engine.current.retry();await load();return false;},[load]);
  const discardRequestAndRefresh=useCallback(async()=>{
    const client=engine.current;if(!client||client.running)return;
    try{if(client.queue.length)saveDraft(ownerId,'recovered-command',crypto.randomUUID(),client.queue);}catch{toast.error('입력 보관에 실패했습니다. 다시 시도해 주세요.');return;}
    client.queue=[];client.failure=null;clearDraft(ownerId,'write-queue',draftTarget.current);await load();
  },[ownerId,load]);
  const pauseRefresh=useCallback((value:boolean)=>{pauseRef.current=value;},[]);
  const acceptSnapshot=useCallback((value:WorkspaceSnapshot)=>{engine.current?.accept(value);},[]);
  return {snapshot,loaded,busy,saving,savedInputs,failure,online,mutate,retry,pauseRefresh,acceptSnapshot,refresh:load,discardRequestAndRefresh,hasPending};
}
