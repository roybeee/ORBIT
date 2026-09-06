'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import {emptyWorkspace,type WorkspaceSnapshot} from './model';
import type {WorkspaceAction} from './validation';
import {applyAction,DomainError} from './reducer';
import {initialProjects,initialTasks,initialNotes,initialEvents} from './seed';
import {generateProposal} from './planner';
const initial=(demo:boolean):WorkspaceSnapshot=>({revision:0,updatedAt:null,data:demo?{...emptyWorkspace(),projects:initialProjects,tasks:initialTasks.map(t=>({...t,focusDate:t.focus?'2026-09-06':undefined})),notes:initialNotes,events:initialEvents,proposals:[generateProposal(initialTasks,initialEvents,'2026-09-07')]}:emptyWorkspace()});
interface Failure {message:string;code:string}
export function useWorkspace(demo:boolean){
 const [snapshot,setSnapshot]=useState(()=>initial(demo));const snapshotRef=useRef(snapshot);
 const [loaded,setLoaded]=useState(demo),[busy,setBusy]=useState(false),[failure,setFailure]=useState<Failure|null>(null);
 const [online,setOnline]=useState(true);
 const busyRef=useRef(false);const pauseRef=useRef(false);const mounted=useRef(true);const pending=useRef<{operationId:string;expectedRevision:number;action:WorkspaceAction}|null>(null);
 const publish=useCallback((value:WorkspaceSnapshot)=>{snapshotRef.current=value;if(mounted.current)setSnapshot(value)},[]);
 const load=useCallback(async(automatic=false)=>{if(demo||busyRef.current||(automatic&&pauseRef.current))return;if(!navigator.onLine){setOnline(false);return}busyRef.current=true;setBusy(true);const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);try{const r=await fetch('/api/workspace',{cache:'no-store',signal:controller.signal});const body=await r.json();if(!r.ok)throw {message:body.error,code:body.code};if(automatic&&pauseRef.current)return;publish(body);setLoaded(true);setFailure(null)}catch(e){const err=e as Failure;setFailure({message:err.message||'연결 상태를 확인하고 다시 시도해 주세요.',code:err.code||'NETWORK'})}finally{clearTimeout(timeout);busyRef.current=false;if(mounted.current)setBusy(false)}},[demo,publish]);
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false}},[load]);
 const send=useCallback(async(command:NonNullable<typeof pending.current>):Promise<boolean>=>{
  if(!demo&&!navigator.onLine){setOnline(false);toast.error('인터넷 연결 후 다시 저장해 주세요. 입력 내용은 이 화면에 남아 있습니다.');return false}
  if(busyRef.current){toast('저장 중입니다. 잠시 기다려 주세요.');return false}busyRef.current=true;setBusy(true);pending.current=command;
  const before=snapshotRef.current;let optimistic=false;
  if(!demo&&['task.status','task.focus'].includes(command.action.type)){try{publish({...before,data:applyAction(before.data,command.action)});optimistic=true}catch{}}
  try{
   if(demo){const data=applyAction(snapshotRef.current.data,command.action,new Date('2026-09-06T09:00:00Z'));publish({data,revision:snapshotRef.current.revision+1,updatedAt:new Date().toISOString()})}
   else{const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);try{const r=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command),signal:controller.signal});const body=await r.json();if(!r.ok)throw {message:body.error,code:body.code};publish(body)}finally{clearTimeout(timeout)}}
   pending.current=null;setFailure(null);return true;
  }catch(e){if(optimistic)publish(before);const err=e as Failure;const failure={message:err.message||'저장을 확인하지 못했습니다. 다시 저장해 주세요.',code:err.code||(e instanceof DomainError?'INPUT':'NETWORK')};if(failure.code==='INPUT')pending.current=null;setFailure(failure);toast.error(failure.message);return false}
  finally{busyRef.current=false;if(mounted.current)setBusy(false)}
 },[demo,publish]);
 const mutate=useCallback(async(action:WorkspaceAction)=>{if(!loaded){toast.error('먼저 저장된 내용을 불러와 주세요.');return false}if(pending.current&&!busyRef.current){toast.error('이전 저장 결과를 먼저 확인해 주세요.');return false}return send({operationId:crypto.randomUUID(),expectedRevision:snapshotRef.current.revision,action})},[loaded,send]);
 const retry=useCallback(async()=>{if(pending.current)return send(pending.current);await load();return false},[send,load]);
 const discardRequestAndRefresh=useCallback(async()=>{pending.current=null;await load()},[load]);
 useEffect(()=>{if(demo)return;setOnline(navigator.onLine);const resume=()=>{if(document.visibilityState==='visible'&&navigator.onLine&&!pending.current&&!busyRef.current&&!pauseRef.current)void load(true)};const connection=()=>{setOnline(navigator.onLine);if(navigator.onLine)resume()};const timer=setInterval(resume,60000);window.addEventListener('focus',resume);window.addEventListener('online',connection);window.addEventListener('offline',connection);document.addEventListener('visibilitychange',resume);return()=>{clearInterval(timer);window.removeEventListener('focus',resume);window.removeEventListener('online',connection);window.removeEventListener('offline',connection);document.removeEventListener('visibilitychange',resume)}},[demo,load]);
 const pauseRefresh=useCallback((value:boolean)=>{pauseRef.current=value},[]);
 return {snapshot,loaded,busy,failure,online,mutate,retry,pauseRefresh,refresh:discardRequestAndRefresh,hasPending:!!pending.current};
}
