'use client';
import {useEffect,useRef,useState} from 'react';
import {MessageSquare,LoaderCircle} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {localKakaoRequest,readKakaoCaptureFile,type KakaoLocalHealth,type KakaoScanResult} from '@/lib/orbit/kakao-client';
import type {KakaoCapture,KakaoReview,KakaoStatus} from '@/lib/orbit/kakao/types';
import {agentRequest} from '../agent/connections';
import {KakaoResults} from './results';
import {KakaoModelSettings} from './model-settings';

export function KakaoReviewEntry({demo=false}:{demo?:boolean}){
 const [open,setOpen]=useState(false);
 return <><div className="kakao-entry"><div><strong>카카오톡에서 놓친 약속과 할 일</strong><p>최근 7일의 읽은 대화를 검토하고, 해결할 일을 정리합니다.</p></div><button type="button" className="secondary-button" data-testid="kakao-review-open" disabled={demo} onClick={()=>setOpen(true)}><MessageSquare size={16}/>카카오톡 비서실장</button></div>
  {open&&<Dialog open onOpenChange={value=>{if(!value)setOpen(false);}}><DialogContent className="kakao-dialog" data-testid="kakao-review-dialog"><DialogHeader><DialogTitle>카카오톡 비서실장</DialogTitle><DialogDescription>최근 7일 대화부터 검토합니다. 미읽음 메시지가 있는 방은 제외하고, 카카오톡 입력·전송은 하지 않습니다.</DialogDescription></DialogHeader><KakaoPanel onClose={()=>setOpen(false)}/></DialogContent></Dialog>}
 </>;
}

function KakaoPanel({onClose}:{onClose:()=>void}){
 const [status,setStatus]=useState<KakaoStatus|null>(null),[token,setToken]=useState(''),[health,setHealth]=useState<KakaoLocalHealth|null>(null),[busy,setBusy]=useState('loading'),[error,setError]=useState(''),[review,setReview]=useState<KakaoReview|null>(null),[capture,setCapture]=useState<KakaoCapture|null>(null),[notice,setNotice]=useState('');
 const alive=useRef(true),lock=useRef(false),scan=useRef<{id:string;token:string;controller:AbortController}|null>(null);
 const refresh=async()=>{const next=await agentRequest('/api/integrations/kakao') as KakaoStatus;if(alive.current){setStatus(next);setReview(next.runs[0]??null);}};
 useEffect(()=>{alive.current=true;void refresh().catch(failure=>{if(alive.current)setError(failure.message);}).finally(()=>{if(alive.current)setBusy('');});return()=>{alive.current=false;const active=scan.current;if(active){active.controller.abort();void localKakaoRequest(active.token,'/stop',{id:active.id}).catch(()=>{});}};},[]);
 const run=async(stage:string,action:()=>Promise<void>)=>{
  if(lock.current)return;
  lock.current=true;setBusy(stage);setError('');setNotice('');
  try{await action()}catch(failure){if(alive.current)setError(failure instanceof Error?failure.message:'검토를 완료하지 못했습니다.')}
  finally{lock.current=false;if(alive.current)setBusy('');}
 };
 const analyze=async(value:KakaoCapture)=>{
  if(!alive.current)return;
  setCapture(value);setBusy('analyze');
  const result=await agentRequest('/api/integrations/kakao','POST',value) as KakaoReview;
  if(!alive.current)return;
  setReview(result);setCapture(null);window.dispatchEvent(new CustomEvent('orbit:agent-refresh'));
  await refresh();
 };
 const connect=()=>run('connect',async()=>{
  setHealth(null);const next=await localKakaoRequest<KakaoLocalHealth>(token,'/health');
  if(next.protocol!==1||!['manual_only','verified_navigation','read_rooms'].includes(next.mode))throw new Error('지원하지 않는 Mac 연결 프로그램입니다.');
  if(alive.current)setHealth(next);
 });
 const collect=(scope:'current_read_room'|'recent_read_rooms')=>run('scan',async()=>{
  if(!health?.connected||!status?.modelReady)throw new Error('Mac과 분석 연결을 확인해 주세요.');
  if(scope==='recent_read_rooms'&&health.mode!=='read_rooms')throw new Error('자동 방 이동을 지원하는 최신 Mac 연결 프로그램으로 다시 연결해 주세요.');
  const active={id:crypto.randomUUID(),token,controller:new AbortController()};scan.current=active;
  try{const result=await localKakaoRequest<KakaoScanResult>(token,'/scan',{id:active.id,scope},active.controller.signal);
   if(active.controller.signal.aborted||!alive.current)return;
   if(!result.capture?.rooms?.length)throw new Error('조건을 충족하는 읽은 대화가 없습니다.');
   const excluded=result.skipped?.length?`${result.skipped.length}개 항목을 수집 조건에 따라 제외했습니다. `:'';
   setNotice(result.complete===false?`${excluded}부분 검토: 이번에 ${result.capture.rooms.length}개 방을 확인했습니다. 다시 실행하면 남은 방부터 이어서 검토합니다.`:excluded);
   await analyze(result.capture);
  }finally{if(scan.current===active)scan.current=null;}
 });
 const stop=async()=>{const active=scan.current;if(!active)return;active.controller.abort();setNotice('중지를 요청했습니다. Mac 연결 프로그램의 중지 상태를 확인합니다.');try{await localKakaoRequest(active.token,'/stop',{id:active.id});if(alive.current)setNotice('수집 중지 요청을 전달했습니다. 이미 접수된 분석 결과는 새로고침해서 확인할 수 있습니다.');}catch(failure){if(alive.current)setError(failure instanceof Error?failure.message:'중지 상태를 확인하지 못했습니다.');}};
 const inbox=()=>{window.dispatchEvent(new CustomEvent('orbit:agent-refresh'));onClose();window.location.hash='inbox';};
 return <div className="kakao-panel">
  <p className="kakao-boundary">읽지 않은 방의 본문·미리보기를 제외합니다. 방 열기·검토용 스크롤 외에 메시지 작성, 전송, 반응, 다운로드는 제공하지 않습니다.</p>
  {status&&!status.modelReady&&<p role="status" className="kakao-warning">분석 연결이 필요합니다. 아래에서 전용 분석 연결을 설정해 주세요.</p>}
  <form className="dialog-form" onSubmit={event=>{event.preventDefault();void connect();}}>
   <label>Mac 연결 키<input className="form-field" data-testid="kakao-token" type="password" value={token} onChange={event=>{setToken(event.target.value);setHealth(null);}} autoComplete="off" spellCheck={false} maxLength={128} disabled={!!busy} placeholder="Mac 연결 프로그램이 표시한 키"/></label>
   <p className="form-hint">키는 이 창이 열린 동안만 유지합니다. 브라우저가 로컬 네트워크 접근을 물으면 연결할 Mac에서 허용해 주세요.</p>
   <a className="text-button" href="/downloads/orbit-kakao-mac.zip" download>Mac 연결 프로그램 다운로드</a>
   <button className="secondary-button" data-testid="kakao-connect" disabled={!!busy||token.length<32}>Mac 연결 확인</button>
  </form>
  {health&&<div className="kakao-connection" role="status"><strong>{health.connected?'Mac 연결 확인됨':'Mac 준비 필요'}</strong><p>{health.message}</p>{health.mode==='manual_only'?<p>현재 연결 프로그램은 수동 검토만 지원합니다. 자동 이동을 사용하려면 최신 Mac 연결 프로그램을 내려받아 다시 연결하세요.</p>:<p>최근 7일에 대화한 방 중 미읽음이 없는 방만 자동으로 이동합니다. 새 메시지가 감지되거나 사용자가 조작하면 검토를 멈춥니다.</p>}<p className="form-hint">진입 직전에 미읽음을 다시 확인합니다. 확인과 진입 사이 새 메시지가 도착하면 카카오톡 자체 읽음 처리가 발생할 수 있습니다.</p></div>}
  <div className="chief-actions"><button type="button" className="primary-button" data-testid="kakao-scan-recent" disabled={!!busy||!status?.modelReady||!health?.connected||health.mode!=='read_rooms'} onClick={()=>void collect('recent_read_rooms')}>{busy==='scan'?<LoaderCircle size={15} className="animate-spin"/>:<MessageSquare size={15}/>}최근 7일 읽은 방 자동 검토</button><button type="button" className="secondary-button" data-testid="kakao-scan" disabled={!!busy||!status?.modelReady||!health?.connected} onClick={()=>void collect('current_read_room')}>현재 읽은 방 검토</button>{scan.current&&<button type="button" className="secondary-button" onClick={()=>void stop()}>수집 중지</button>}<button type="button" className="text-button" data-testid="kakao-refresh" disabled={!!busy} onClick={()=>void run('refresh',refresh)}>결과 새로고침</button></div>
  <details><summary>검토용 수집 파일로 분석</summary><p className="form-hint">읽음 상태와 날짜가 포함된 전용 JSON 수집 파일만 사용할 수 있습니다. 카카오톡 전체 대화 내보내기는 받지 않습니다.</p><label>대화 캡처 파일<input data-testid="kakao-capture-file" type="file" accept="application/json,.json" disabled={!!busy||!status?.modelReady} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void run('analyze',async()=>analyze(await readKakaoCaptureFile(file)));}}/></label></details>
  {capture&&!busy&&<button type="button" className="secondary-button" onClick={()=>void run('analyze',()=>analyze(capture))}>같은 수집 결과로 분석 다시 확인</button>}
  {error&&<p className="agent-error" role="alert" data-testid="kakao-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <KakaoModelSettings disabled={!!busy} onChanged={refresh}/>
  {review&&<KakaoResults key={review.id} review={review} onInbox={inbox} onDeleted={async()=>{setReview(null);setCapture(null);window.dispatchEvent(new CustomEvent('orbit:agent-refresh'));await refresh();}}/>}
 </div>;
}
