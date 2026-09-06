'use client';
import {useState} from 'react';
import {Check,ExternalLink,Link2,LoaderCircle,Unplug,CalendarDays,Mic,Orbit} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {Connection,Provider} from '@/lib/orbit/agent/types';
export async function agentRequest(path:string,method='GET',body?:unknown){
 const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',...(body!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 let data;try{data=await response.json()}catch{throw new Error('연결이 중단됐습니다. 다시 불러오면 저장된 결과를 확인할 수 있습니다.')}
 if(!response.ok)throw new Error(data.error??'요청을 완료하지 못했습니다.');return data;
}
export function Connections({connections,onClose,onChange}:{connections:Connection[];onClose:()=>void;onChange:()=>Promise<void>}){
 const [apiKey,setApiKey]=useState(''),[model,setModel]=useState(connections.find(c=>c.provider==='openai')?.model??'gpt-5.6-terra');
 const [clientId,setClientId]=useState(''),[clientSecret,setClientSecret]=useState(''),[busy,setBusy]=useState<Provider|null>(null),[error,setError]=useState(''),[feedback,setFeedback]=useState('');
 const state=(provider:Provider)=>connections.find(c=>c.provider===provider);
 const callback=typeof window==='undefined'?'':window.location.origin+'/api/integrations/callback';
 async function run(provider:Provider,task:()=>Promise<void>){setBusy(provider);setError('');setFeedback('');try{await task();await onChange()}catch(error){setError(error instanceof Error?error.message:'연결을 확인해 주세요.')}finally{setBusy(null)}}
 async function connect(provider:'plaud'|'google_calendar'){const data=await agentRequest('/api/integrations/connect','POST',{provider});const url=new URL(data.url);if(!['https://mcp.plaud.ai','https://accounts.google.com'].includes(url.origin))throw new Error('연결 주소를 확인할 수 없습니다.');window.location.assign(url.href)}
 return <Dialog open onOpenChange={open=>{if(!open)onClose()}}><DialogContent className="agent-connection-dialog"><DialogHeader><DialogTitle>Orbit 연결</DialogTitle><DialogDescription>대화에 필요한 AI와 내 기록을 연결하세요. 비밀키는 서버에 암호화해 보관합니다.</DialogDescription></DialogHeader><div className="dialog-form connection-list">
  {error&&<p role="alert" className="agent-error">{error}</p>}{feedback&&<p role="status" className="agent-feedback">{feedback}</p>}
  <section className="connection-card"><header><span className="connection-icon"><Orbit size={22}/></span><div><h3>AI 에이전트</h3><p>내 업무와 기록을 이해하는 대화</p></div><span className={'connection-status '+(state('openai')?.connected?'connected':'')}>{state('openai')?.connected?'연결됨':'설정 필요'}</span></header>
   <form onSubmit={event=>{event.preventDefault();void run('openai',async()=>{await agentRequest('/api/integrations','POST',{provider:'openai',key:apiKey,model});setApiKey('');setFeedback('AI 키와 모델 접근 권한을 확인했습니다.')})}}>
    <label>OpenAI API 키<input className="form-field" type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} autoComplete="new-password" spellCheck={false} placeholder={state('openai')?.connected?'새 키를 입력하면 교체됩니다':'sk-…'} required minLength={20} maxLength={500}/></label>
    <details><summary>모델 설정</summary><label>사용할 모델<input className="form-field" value={model} onChange={e=>setModel(e.target.value)} required maxLength={100}/></label></details>
    <p className="connection-help">ChatGPT 구독과 별도로 API 사용 요금이 발생합니다. <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">API 키 만들기 <ExternalLink size={12}/></a></p>
    <button className="primary-button" disabled={!!busy||!apiKey.trim()}>{busy==='openai'?<LoaderCircle className="animate-spin" size={16}/>:<Check size={16}/>}확인하고 저장</button>
   </form>
  </section>
  <section className="connection-card"><header><span className="connection-icon"><Mic size={22}/></span><div><h3>Plaud</h3><p>회의 기록 → 위키와 실행 제안</p></div><span className={'connection-status '+(state('plaud')?.connected?'connected':'')}>{state('plaud')?.connected?'연결됨':'연결 필요'}</span></header><p className="connection-help">Plaud 계정에서 Orbit의 기록 조회를 허용하세요. 대화 중 필요한 회의록을 찾아 후속 업무를 제안합니다.</p><button className="secondary-button" disabled={!!busy} onClick={()=>void run('plaud',()=>connect('plaud'))}>{busy==='plaud'?<LoaderCircle className="animate-spin" size={16}/>:<Link2 size={16}/>}Plaud {state('plaud')?.connected?'다시 연결':'연결'}</button></section>
  <section className="connection-card"><header><span className="connection-icon"><CalendarDays size={22}/></span><div><h3>Google Calendar</h3><p>일정 조회와 승인한 일정 등록</p></div><span className={'connection-status '+(state('google_calendar')?.connected?'connected':'')}>{state('google_calendar')?.connected?'연결됨':'연결 필요'}</span></header>
   <p className="connection-help">기본 캘린더를 가져와 시간 충돌을 확인합니다. Google 일정 생성 카드를 승인하면 내 캘린더에 등록합니다.</p>
   <details open={!state('google_calendar')?.configured}><summary>최초 연결 설정</summary><ol className="connection-steps"><li><a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer">Google Cloud에서 Calendar API 사용 설정</a></li><li>OAuth 동의 화면을 설정하고 내 Google 계정을 테스트 사용자로 추가합니다.</li><li>웹 애플리케이션 OAuth 클라이언트를 만들고 아래 주소를 승인된 리디렉션 URI로 등록합니다.</li></ol><label>리디렉션 URI<input className="form-field callback-uri" readOnly value={callback} onFocus={e=>e.target.select()}/></label><form onSubmit={event=>{event.preventDefault();void run('google_calendar',async()=>{await agentRequest('/api/integrations','POST',{provider:'google_calendar',clientId,clientSecret});setClientId('');setClientSecret('');setFeedback('Google 설정을 저장했습니다. Google 연결을 눌러 계정을 승인하세요.')})}}><label>클라이언트 ID<input className="form-field" value={clientId} onChange={e=>setClientId(e.target.value)} placeholder="….apps.googleusercontent.com" required autoComplete="off" spellCheck={false}/></label><label>클라이언트 보안 비밀번호<input className="form-field" type="password" value={clientSecret} onChange={e=>setClientSecret(e.target.value)} required autoComplete="new-password"/></label><button className="secondary-button" disabled={!!busy||!clientId||!clientSecret}>Google 설정 저장</button></form></details>
   <button className="secondary-button" disabled={!!busy||!state('google_calendar')?.configured} onClick={()=>void run('google_calendar',()=>connect('google_calendar'))}>{busy==='google_calendar'?<LoaderCircle className="animate-spin" size={16}/>:<Link2 size={16}/>}Google {state('google_calendar')?.connected?'다시 연결':'연결'}</button>
  </section>
  <p className="connection-help">ChatGPT에 연결한 계정과 별도로, Orbit 앱에서 사용할 권한을 승인합니다. Google 연결을 테스트 모드로 두면 재승인이 필요할 수 있습니다.</p>
  <details className="connection-disconnect"><summary>연결 해제</summary><p className="connection-help">Orbit에 보관한 연결 정보를 지웁니다. 서비스의 승인 자체를 취소하려면 해당 계정 설정에서도 해제하세요.</p>{connections.filter(c=>c.configured&&c.provider!=='plaud'||c.connected).map(c=><button key={c.provider} className="text-button danger-text" disabled={!!busy} onClick={()=>void run(c.provider,async()=>{await agentRequest('/api/integrations','DELETE',{provider:c.provider});setFeedback(c.label+' 연결 정보를 삭제했습니다.')})}><Unplug size={14}/>{c.label} 해제</button>)}</details>
 </div></DialogContent></Dialog>;
}
