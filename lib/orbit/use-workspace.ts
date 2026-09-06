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
 const busyRef=useRef(false);const pauseRef=useRef(false);const mounted=useRef(true);const pending=useRef<{operationId:string;expectedRevision:number;action:WorkspaceAction}|null>(null);
 const publish=useCallback((value:WorkspaceSnapshot)=>{snapshotRef.current=value;if(mounted.current)setSnapshot(value)},[]);
 const load=useCallback(async(automatic=false)=>{if(demo||busyRef.current||(automatic&&pauseRef.current))return;busyRef.current=true;setBusy(true);try{const r=await fetch('/api/workspace',{cache:'no-store'});const body=await r.json();if(!r.ok)throw {message:body.error,code:body.code};if(automatic&&pauseRef.current)return;publish(body);setLoaded(true);setFailure(null)}catch(e){const err=e as Failure;setFailure({message:err.message||'연결 상태를 확인하고 다시 시도해 주세요.',code:err.code||'NETWORK'})}finally{busyRef.current=false;if(mounted.current)setBusy(false)}},[demo,publish]);
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false}},[load]);
 const send=useCallback(async(command:NonNullable<typeof pending.current>):Promise<boolean>=>{
  if(busyRef.current){toast('저장 중입니다. 잠시 기다려 주세요.');return false}busyRef.current=true;setBusy(true);pending.current=command;
  try{
   if(demo){const data=applyAction(snapshotRef.current.data,command.action,new Date('2026-09-06T09:00:00Z'));publish({data,revision:snapshotRef.current.revision+1,updatedAt:new Date().toISOString()})}
   else{const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);try{const r=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command),signal:controller.signal});const body=await r.json();if(!r.ok)throw {message:body.error,code:body.code};publish(body)}finally{clearTimeout(timeout)}}
   pending.current=null;setFailure(null);return true;
  }catch(e){const err=e as Failure;const failure={message:err.message||'저장을 확인하지 못했습니다. 다시 저장해 주세요.',code:err.code||(e instanceof DomainError?'INPUT':'NETWORK')};if(failure.code==='INPUT')pending.current=null;setFailure(failure);toast.error(failure.message);return false}
  finally{busyRef.current=false;if(mounted.current)setBusy(false)}
 },[demo,publish]);
 const mutate=useCallback(async(action:WorkspaceAction)=>{if(!loaded){toast.error('먼저 저장된 내용을 불러와 주세요.');return false}if(pending.current&&!busyRef.current){toast.error('이전 저장 결과를 먼저 확인해 주세요.');return false}return send({operationId:crypto.randomUUID(),expectedRevision:snapshotRef.current.revision,action})},[loaded,send]);
 const retry=useCallback(async()=>{if(pending.current)return send(pending.current);await load();return false},[send,load]);
 const discardRequestAndRefresh=useCallback(async()=>{pending.current=null;await load()},[load]);
 useEffect(()=>{if(demo)return;const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!pending.current&&!busyRef.current&&!pauseRef.current)void load(true)},60000);const focus=()=>{if(!pending.current&&!busyRef.current&&!pauseRef.current)void load(true)};window.addEventListener('focus',focus);return()=>{clearInterval(timer);window.removeEventListener('focus',focus)}},[demo,load]);
 const pauseRefresh=useCallback((value:boolean)=>{pauseRef.current=value},[]);
 return {snapshot,loaded,busy,failure,mutate,retry,pauseRefresh,refresh:discardRequestAndRefresh,hasPending:!!pending.current};
}
