'use client';
import {AgentRequestError} from '@/lib/orbit/agent/approval-feedback';
import {useState} from 'react';
import {Check,ExternalLink,Link2,LoaderCircle,Unplug,CalendarDays,Mic,Orbit} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {Connection,Provider} from '@/lib/orbit/agent/types';
export async function agentRequest(path:string,method='GET',body?:unknown){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
 try{
  const response=await fetch(path,{method,signal:controller.signal,credentials:'same-origin',cache:'no-store',...(body!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  let data;try{data=await response.json()}catch{throw new Error('연결이 중단됐습니다. 다시 불러오면 저장된 결과를 확인할 수 있습니다.')}
  if(!response.ok)throw new AgentRequestError(data.error??'요청을 완료하지 못했습니다.',data.code,data.details);return data;
 }catch(error){if(controller.signal.aborted)throw new Error('연결 시간이 초과됐습니다. 다시 눌러 진행 상태를 확인해 주세요.');throw error}finally{clearTimeout(timer)}
}
export function Connections({connections,onClose,onChange}:{connections:Connection[];onClose:()=>void;onChange:()=>Promise<void>}){
 const [endpoint,setEndpoint]=useState(connections.find(c=>c.provider==='hermes')?.endpoint??''),[token,setToken]=useState('');
 const [clientId,setClientId]=useState(''),[clientSecret,setClientSecret]=useState(''),[busy,setBusy]=useState<Provider|null>(null),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[active,setActive]=useState<Provider|null>(null),[authLink,setAuthLink]=useState('');
 const state=(provider:Provider)=>connections.find(c=>c.provider===provider);
 const callback=typeof window==='undefined'?'':window.location.origin+'/api/integrations/callback';
 async function run(provider:Provider,task:()=>Promise<void>){setBusy(provider);setActive(provider);setError('');setFeedback('');setAuthLink('');try{await task();await onChange()}catch(error){setError(error instanceof Error?error.message:'연결을 확인해 주세요.')}finally{setBusy(null)}}
 async function connect(provider:'plaud'|'google_calendar'|'google_mail'){const data=await agentRequest('/api/integrations/connect','POST',{provider});const url=new URL(data.url);if(!['https://mcp.plaud.ai','https://accounts.google.com'].includes(url.origin))throw new Error('연결 주소를 확인할 수 없습니다.');setAuthLink(url.href);setFeedback('인증 화면으로 이동합니다. 화면이 바뀌지 않으면 아래 링크를 누르세요.');window.location.assign(url.href)}
 const notice=(provider:Provider)=>active===provider?<div aria-live="polite">{error&&<p role="alert" className="agent-error">{error}</p>}{feedback&&<p role="status" className="agent-feedback">{feedback}</p>}{authLink&&<a className="text-button" href={authLink} rel="noreferrer">인증 화면 직접 열기 <ExternalLink size={14}/></a>}</div>:null;
 return <Dialog open onOpenChange={open=>{if(!open)onClose()}}><DialogContent className="agent-connection-dialog"><DialogHeader><DialogTitle>Orbit 연결</DialogTitle><DialogDescription>내 헤르메스와 기록을 연결하세요. 연결 암호와 계정 권한은 서버에 암호화해 보관합니다.</DialogDescription></DialogHeader><div className="dialog-form connection-list">
  <section className="connection-card"><header><span className="connection-icon"><Orbit size={22}/></span><div><h3>헤르메스 에이전트</h3><p>내 Hermes와 대화하고 실행을 설계</p></div><span className={'connection-status '+(state('hermes')?.connected?'connected':'')}>{state('hermes')?.connected?'연결됨':'설정 필요'}</span></header>
   <form onSubmit={event=>{event.preventDefault();void run('hermes',async()=>{await agentRequest('/api/integrations','POST',{provider:'hermes',endpoint,token});setToken('');setFeedback('헤르메스 실행 기능과 연결 암호를 확인했습니다. 대화를 시작하세요.')})}}>
    <label>헤르메스 연결 주소<input className="form-field" type="url" value={endpoint} onChange={e=>setEndpoint(e.target.value)} autoComplete="url" spellCheck={false} placeholder="https://나의-헤르메스-주소" required maxLength={500}/></label>
    <label>헤르메스 연결 암호<input className="form-field" type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="new-password" spellCheck={false} placeholder={state('hermes')?.connected?'새 암호를 입력하면 교체됩니다':'Hermes에 설정한 연결 암호'} required minLength={20} maxLength={500}/></label>
    <p className="connection-help">Mac에서 실행하는 헤르메스의 모델과 설정을 사용합니다. Mac이 켜져 있고 외부에서 접속할 수 있는 HTTPS 주소가 필요합니다.</p>
    <a className="text-button" href="https://github.com/roybeee/ORBIT/blob/main/docs/Hermes_Setup.ko.md" target="_blank" rel="noreferrer">Mac에서 헤르메스 연결 준비 <ExternalLink size={14}/></a>
    <button className="primary-button" disabled={!!busy||!endpoint.trim()||!token.trim()}>{busy==='hermes'?<LoaderCircle className="animate-spin" size={16}/>:<Check size={16}/>} {busy==='hermes'?'헤르메스 확인 중…':'헤르메스 연결 확인'}</button>
    {notice('hermes')}
   </form>
  </section>
  <section className="connection-card"><header><span className="connection-icon"><Mic size={22}/></span><div><h3>Plaud</h3><p>회의 기록 → 위키와 실행 제안</p></div><span className={'connection-status '+(state('plaud')?.connected?'connected':'')}>{state('plaud')?.connected?'연결됨':'연결 필요'}</span></header><p className="connection-help">Plaud 계정에서 Orbit의 기록 조회를 허용하세요. 대화 중 필요한 회의록을 찾아 후속 업무를 제안합니다.</p><button className="secondary-button" disabled={!!busy} onClick={()=>void run('plaud',()=>connect('plaud'))}>{busy==='plaud'?<LoaderCircle className="animate-spin" size={16}/>:<Link2 size={16}/>}{busy==='plaud'?'Plaud 인증 준비 중…':state('plaud')?.connected?'Plaud 다시 연결':'Plaud 연결'}</button>{notice('plaud')}</section>
  <section className="connection-card"><header><span className="connection-icon"><CalendarDays size={22}/></span><div><h3>Google Calendar</h3><p>일정 조회와 승인한 일정 등록</p></div><span className={'connection-status '+(state('google_calendar')?.connected?'connected':'')}>{state('google_calendar')?.connected?'연결됨':'연결 필요'}</span></header>
   <p className="connection-help">기본 캘린더를 가져와 시간 충돌을 확인합니다. Google 일정 생성 카드를 승인하면 내 캘린더에 등록합니다.</p>
   <details open={!state('google_calendar')?.configured}><summary>최초 연결 설정</summary><ol className="connection-steps"><li><a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer">Google Cloud에서 Calendar API 사용 설정</a></li><li>OAuth 동의 화면을 설정하고 내 Google 계정을 테스트 사용자로 추가합니다.</li><li>웹 애플리케이션 OAuth 클라이언트를 만들고 아래 주소를 승인된 리디렉션 URI로 등록합니다.</li></ol><label>리디렉션 URI<input className="form-field callback-uri" readOnly value={callback} onFocus={e=>e.target.select()}/></label><form onSubmit={event=>{event.preventDefault();void run('google_calendar',async()=>{await agentRequest('/api/integrations','POST',{provider:'google_calendar',clientId,clientSecret});setClientId('');setClientSecret('');setFeedback('Google 설정을 저장했습니다. Google 연결을 눌러 계정을 승인하세요.')})}}><label>클라이언트 ID<input className="form-field" value={clientId} onChange={e=>setClientId(e.target.value)} placeholder="….apps.googleusercontent.com" required autoComplete="off" spellCheck={false}/></label><label>클라이언트 보안 비밀번호<input className="form-field" type="password" value={clientSecret} onChange={e=>setClientSecret(e.target.value)} required autoComplete="new-password"/></label><button className="secondary-button" disabled={!!busy||!clientId||!clientSecret}>Google 설정 저장</button></form></details>
   <button className="secondary-button" disabled={!!busy||!state('google_calendar')?.configured} onClick={()=>void run('google_calendar',()=>connect('google_calendar'))}>{busy==='google_calendar'?<LoaderCircle className="animate-spin" size={16}/>:<Link2 size={16}/>}{busy==='google_calendar'?'Google 연결 준비 중…':state('google_calendar')?.connected?'Google 다시 연결':'Google 연결'}</button>{notice('google_calendar')}
  </section>
  <section className="connection-card"><header><span className="connection-icon"><Mic size={22}/></span><div><h3>Gmail → 개인 위키</h3><p>받은 메일을 관련 위키의 출처로 연결</p></div><span className="connection-status">{state('google_mail')?.connected?'연결됨':'연결 필요'}</span></header>
   <p className="connection-help">위 Google 설정을 공유하며 Gmail 읽기 권한은 별도로 승인합니다. <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer">Gmail API 사용 설정</a> 후 연결하세요. 위키를 열어 둔 동안 최근 30일 메일을 순차 수집합니다. 첨부파일과 메일 발송은 포함하지 않습니다.</p>
   <button className="secondary-button" disabled={!!busy||!state('google_mail')?.configured} onClick={()=>void run('google_mail',()=>connect('google_mail'))}><Link2 size={16}/>{state('google_mail')?.connected?'Gmail 다시 연결':'Gmail 읽기 연결'}</button>{notice('google_mail')}
  </section>
  <p className="connection-help">ChatGPT에 연결한 계정과 별도로, Orbit 앱에서 사용할 권한을 승인합니다. Google 연결을 테스트 모드로 두면 재승인이 필요할 수 있습니다.</p>
  <details className="connection-disconnect"><summary>연결 해제</summary><p className="connection-help">Orbit에 보관한 연결 정보를 지웁니다. 서비스의 승인 자체를 취소하려면 해당 계정 설정에서도 해제하세요.</p>{connections.filter(c=>(c.configured&&c.provider!=='plaud')||c.connected).map(c=><button key={c.provider} className="text-button danger-text" disabled={!!busy} onClick={()=>void run(c.provider,async()=>{await agentRequest('/api/integrations','DELETE',{provider:c.provider});setFeedback(c.label+' 연결 정보를 삭제했습니다.')})}><Unplug size={14}/>{c.label} 해제</button>)}</details>
 </div></DialogContent></Dialog>;
}
