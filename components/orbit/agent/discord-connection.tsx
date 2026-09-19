'use client';
import {useEffect,useState} from 'react';
import {MessageCircle,LoaderCircle,ExternalLink,Check} from 'lucide-react';
import {agentRequest} from './connections';
import {discordHelp} from '@/lib/orbit/discord/protocol';
type State={config:null|{enabled:boolean;guildId:string;channelId:string;userId:string;botName:string;channelName:string};lastPoll:string|null;lastReceived:string|null;lastSent:string|null;lastError:string;queue:{status:string;count:number}[];runtime?:{config:{enabled:boolean;lastSchedulerTick?:string}}};
const time=(value:string|null|undefined)=>value?new Date(value).toLocaleString('ko-KR'):'아직 없음';
export function DiscordConnection({onChange}:{onChange:()=>Promise<void>}){
 const [state,setState]=useState<State|null>(null),[token,setToken]=useState(''),[guildId,setGuildId]=useState(''),[channelId,setChannelId]=useState(''),[userId,setUserId]=useState(''),[enabled,setEnabled]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState('');
 const load=async()=>{const data=await agentRequest('/api/discord');setState(data);if(data.config){setGuildId(data.config.guildId);setChannelId(data.config.channelId);setUserId(data.config.userId);setEnabled(data.config.enabled);}};
 useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
 async function run(action:'save'|'sync'|'test'){setBusy(true);setError('');setFeedback('');try{await agentRequest('/api/discord','POST',{action,...(action==='save'?{settings:{...(token?{token}:{}),guildId,channelId,userId,enabled}}:{})});if(action==='save')setToken('');await load();await onChange();setFeedback(action==='save'?'봇과 채널 권한을 확인해 저장했습니다.':action==='test'?'테스트 알림을 요청했습니다. 채널에서 수신 여부를 확인하세요.':'동기화 상태를 갱신했습니다.');}catch(e){setError(e instanceof Error?e.message:'연결을 확인하세요.');}finally{setBusy(false);}}
 const scheduler=state?.runtime?.config.lastSchedulerTick;
 const healthy=Boolean(state?.runtime?.config.enabled&&scheduler&&Date.now()-Date.parse(scheduler)<180000);
 return <section className="connection-card discord-connection"><header><span className="connection-icon"><MessageCircle size={22}/></span><div><h3>Discord 업무 채널</h3><p>업무 지시 · 결과 보고 · 승인과 보류</p></div><span className={'connection-status '+(state?.config?.enabled?'connected':'')}>{state?.config?(state.config.enabled?'사용 중':'일시 정지'):'연결 필요'}</span></header>
 <p className="connection-help">본인 전용 텍스트 채널을 연결하세요. 아래 사용자 ID의 명령만 실행하며, ORBIT의 새 응답·업무 결과·검토 제안을 이 채널로 보냅니다. 다른 채널과 과거 메시지는 자동 수집하지 않습니다.</p>
 <details open={!state?.config}><summary>디스코드 연결 설정</summary>
 <ol className="connection-steps"><li><a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">Discord에서 봇 만들기 <ExternalLink size={13}/></a> → Bot에서 Message Content Intent를 켭니다.</li><li>봇을 서버에 초대하고, 전용 채널의 보기·메시지 보내기·메시지 기록 읽기 권한을 부여합니다.</li><li>Discord 설정 → 고급 → 개발자 모드를 켜고 서버·채널·본인의 ID를 복사합니다.</li></ol>
 <form onSubmit={e=>{e.preventDefault();void run('save');}}>
 <label>봇 토큰<input className="form-field" type="password" autoComplete="new-password" spellCheck={false} value={token} onChange={e=>setToken(e.target.value)} required={!state?.config} placeholder={state?.config?'비워 두면 기존 토큰 유지':'Discord Bot Token'} maxLength={300}/></label>
 <label>서버 ID<input className="form-field" inputMode="numeric" pattern="[0-9]{17,20}" value={guildId} onChange={e=>setGuildId(e.target.value)} required/></label>
 <label>전용 텍스트 채널 ID<input className="form-field" inputMode="numeric" pattern="[0-9]{17,20}" value={channelId} onChange={e=>setChannelId(e.target.value)} required/></label>
 <label>명령할 본인의 사용자 ID<input className="form-field" inputMode="numeric" pattern="[0-9]{17,20}" value={userId} onChange={e=>setUserId(e.target.value)} required/></label>
 <label className="chief-inline"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>이 채널에서 업무 지시와 보고 사용</label>
 <button className="primary-button" disabled={busy}>{busy?<LoaderCircle size={16} className="animate-spin"/>:<Check size={16}/>}봇 확인 및 저장</button>
 </form></details>
 {state?.config&&<><p className="connection-help">{state.config.botName} · #{state.config.channelName}</p><div className="chief-job-status"><small>명령 확인: {time(state.lastPoll)}</small><small>최근 명령 접수: {time(state.lastReceived)}</small><small>최근 알림 전달: {time(state.lastSent)}</small><small>자동 실행: {healthy?'최근 실행 확인됨':'예약 실행 확인 필요 · ORBIT 자동 실행 설정에서 점검'}</small>{state.queue.map(q=><small key={q.status}>{({pending:'전달 대기',sending:'전달 확인 중',uncertain:'전달 여부 불명',failed:'전달 실패'} as Record<string,string>)[q.status]} {q.count}건</small>)}</div><div className="discord-actions"><button className="secondary-button" disabled={busy||!state.config.enabled} onClick={()=>void run('test')}>테스트 알림 보내기</button><button className="secondary-button" disabled={busy||!state.config.enabled} onClick={()=>void run('sync')}>지금 동기화</button></div></>}
 <p className="connection-help">명령은 자동 실행 주기에 맞춰 처리합니다. 앱을 닫아도 처리하려면 서버 자동 실행이 켜져 있어야 합니다. HERMES의 직접 대화·첨부·기존 예약 알림은 아래 전환 도구로 별도 연결합니다.</p>
 <details><summary>사용할 명령어</summary><pre className="discord-help">{discordHelp}</pre></details>
 <details><summary>기존 HERMES·Slack 전환</summary><p className="connection-help">HERMES 서버에서 프로필별로 전환 도구를 실행합니다. 기존 설정을 백업하고, Discord 연결 확인 뒤 Slack 사용을 끌 수 있습니다. 기존 대화 기록은 유지됩니다.</p><a className="text-button" href="/downloads/hermes-discord-migrate.py" download>HERMES 전환 도구 받기</a><a className="text-button" href="/downloads/Discord_Migration.ko.md" download>전환 안내 받기</a></details>
 <div aria-live="polite">{error&&<p role="alert" className="agent-error">{error}</p>}{state?.lastError&&<p role="alert" className="agent-error">{state.lastError}</p>}{feedback&&<p role="status" className="agent-feedback">{feedback}</p>}</div>
 </section>;
}
