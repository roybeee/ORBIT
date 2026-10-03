'use client';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Mic,Square} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {WorkspaceData} from '@/lib/orbit/model';
import {morningScript} from '@/lib/orbit/phase4';
import {mergeFinals} from '@/lib/orbit/dictation';
// Minimal Web Speech API surface used here; lib.dom does not declare the (webkit-prefixed) constructor.
interface RecognitionResultEvent{resultIndex?:number;results:ArrayLike<ArrayLike<{transcript:string}>&{isFinal?:boolean}>}
interface RecognitionErrorEvent{error:string}
interface Recognition{lang:string;interimResults:boolean;continuous:boolean;onresult:((e:RecognitionResultEvent)=>void)|null;onerror:((e:RecognitionErrorEvent)=>void)|null;onend:(()=>void)|null;start():void;stop():void;abort():void}
type SpeechWindow=Window&{SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
const recognitionEngine=()=>(window as SpeechWindow).SpeechRecognition||(window as SpeechWindow).webkitSpeechRecognition;
// Client-only capability checks: the server snapshot stays false so hydration matches, then the client re-renders.
const noSubscribe=()=>()=>{};
const recognitionSupported=()=>!!recognitionEngine();
const synthesisSupported=()=>'speechSynthesis'in window;
const unsupported=()=>false;
const CONSENT_KEY='orbit:voice-informed';
const rememberedConsent=()=>{try{return localStorage.getItem(CONSENT_KEY)==='1'}catch{return false}};
const DICTATION_LIMIT=10*60*1000;
export type DictationState={interim:string;listening:boolean;done:boolean};
// dictation: keeps listening across the engine's own pauses until the owner presses 종료 (or 10 minutes),
// reporting the whole text so far and the words still being recognized.
export function VoiceInput({onText,onDictation,dictation=false,stopRequest=0,disabled=false,compact=false,menuOnly=false,requestStart=0}:{menuOnly?:boolean;requestStart?:number;onText:(s:string)=>void;onDictation?:(text:string,state:DictationState)=>void;dictation?:boolean;stopRequest?:number;disabled?:boolean;compact?:boolean}){
 const supported=useSyncExternalStore(noSubscribe,recognitionSupported,unsupported);const [recording,setRecording]=useState(false),[notice,setNotice]=useState(''),[consentOpen,setConsentOpen]=useState(false),[informed,setInformed]=useState(false);const recognition=useRef<Recognition|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);const callback=useRef(onText),dictated=useRef(onDictation);
 const session=useRef<{stopped:boolean;committed:string;finals:string[];interim:string;errors:number;startedAt:number}|null>(null);
 useEffect(()=>{callback.current=onText;dictated.current=onDictation});
 // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the remembered consent (localStorage) once on the client
 useEffect(()=>{if(rememberedConsent())setInformed(true)},[]);
 useEffect(()=>{if(stopRequest)stopDictation()},[stopRequest]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>()=>{if(session.current)session.current.stopped=true;session.current=null;if(timer.current)clearTimeout(timer.current);if(recognition.current){recognition.current.onresult=null;recognition.current.onerror=null;recognition.current.onend=null;recognition.current.abort();}},[]);
 useEffect(()=>{if(disabled&&session.current)session.current.stopped=true;if(disabled&&recognition.current){recognition.current.onresult=null;recognition.current.abort();}},[disabled]);
 // eslint-disable-next-line react-hooks/set-state-in-effect -- requestStart is an event counter from the parent; each increment must open the consent dialog (or show the fallback notice) exactly once
 useEffect(()=>{if(!requestStart||disabled||recognition.current)return;if(recognitionEngine()){if(rememberedConsent()){setInformed(true);start()}else setConsentOpen(true)}else setNotice('이 기기에서는 키보드의 음성 입력을 이용해 주세요.')},[requestStart]);
 const stop=()=>dictation?stopDictation():recognition.current?.stop();
 const report=(done:boolean)=>{const s=session.current;if(!s)return;const text=[s.committed,mergeFinals(s.finals.filter(Boolean))].filter(Boolean).join(' ').slice(0,8000);dictated.current?.(text,{interim:done?'':s.interim,listening:!done,done})};
 function finishDictation(message?:string){const s=session.current;if(!s)return;if(timer.current)clearTimeout(timer.current);s.committed=[s.committed,mergeFinals(s.finals.filter(Boolean))].filter(Boolean).join(' ');s.finals=[];s.interim='';report(true);session.current=null;recognition.current=null;setRecording(false);setNotice(message??(s.committed?'받아 적은 내용을 확인한 뒤 저장하세요.':'들린 말이 없어요. 다시 시도하거나 키보드로 입력하세요.'))}
 function stopDictation(){const s=session.current;if(!s)return;s.stopped=true;if(recognition.current)recognition.current.stop();else finishDictation()}
 function listen(){const s=session.current;if(!s)return;try{const Engine=recognitionEngine()!;const r=new Engine();recognition.current=r;r.lang='ko-KR';r.interimResults=true;r.continuous=true;
  r.onresult=e=>{let interim='';for(let i=e.resultIndex??0;i<e.results.length;i++){const result=e.results[i],said=result[0]?.transcript??'';if(result.isFinal)s.finals[i]=said;else interim+=said}s.interim=interim.trim();s.errors=0;report(false)};
  r.onerror=e=>{if(e.error==='not-allowed'||e.error==='service-not-allowed'||e.error==='audio-capture'){s.stopped=true;setNotice(e.error==='audio-capture'?'마이크를 찾지 못했습니다. 키보드로 입력하세요.':'마이크 권한을 허용하거나 키보드로 입력하세요.')}else if(e.error==='network'&&++s.errors>3){s.stopped=true;setNotice('음성 인식 연결이 끊겼습니다. 받아 적은 내용은 남아 있어요.')}};
  // The engine ends on its own after a pause; keep what it heard and listen again until 종료.
  r.onend=()=>{s.committed=[s.committed,mergeFinals(s.finals.filter(Boolean))].filter(Boolean).join(' ');s.finals=[];s.interim='';recognition.current=null;if(s.stopped||Date.now()-s.startedAt>DICTATION_LIMIT){finishDictation(s.stopped?undefined:'10분이 지나 받아쓰기를 마쳤습니다. 내용을 확인한 뒤 저장하세요.');return}report(false);setTimeout(()=>{if(session.current===s&&!s.stopped)listen();else if(session.current===s)finishDictation()},150)};
  r.start();}catch{recognition.current=null;finishDictation('이 브라우저에서는 음성을 시작할 수 없습니다. 키보드로 입력하세요.')}}
 function startDictation(){if(disabled||session.current)return;session.current={stopped:false,committed:'',finals:[],interim:'',errors:0,startedAt:Date.now()};setRecording(true);setNotice('');report(false);listen()}// the sheet shows what is being heard and the 종료 button
 function start(){if(dictation)return startDictation();if(disabled||recognition.current)return;try{const Engine=recognitionEngine()!;const r=new Engine();recognition.current=r;r.lang='ko-KR';r.interimResults=false;r.continuous=false;r.onresult=e=>{const text=Array.from(e.results).map(x=>x[0].transcript).join(' ').slice(0,8000);callback.current(text);setNotice('내용을 확인한 뒤 보내세요.');};r.onerror=e=>setNotice(e.error==='not-allowed'?'마이크 권한을 허용하거나 키보드로 입력하세요.':'음성을 인식하지 못했습니다. 다시 시도하거나 키보드로 입력하세요.');r.onend=()=>{setRecording(false);if(timer.current)clearTimeout(timer.current);recognition.current=null};r.start();setRecording(true);setNotice('듣고 있어요…');timer.current=setTimeout(()=>r.stop(),60000);}catch{recognition.current=null;setRecording(false);if(timer.current)clearTimeout(timer.current);setNotice('이 브라우저에서는 음성을 시작할 수 없습니다. 키보드로 입력하세요.')}}
 if(compact&&!supported)return null;
 return <><div hidden={menuOnly&&!recording&&!notice} className={'orbit-voice-input'+(compact?' orbit-voice-compact':'')}><button type="button" className={compact?'icon-button':'secondary-button'} disabled={disabled||!supported} onClick={()=>recording?stop():informed?start():setConsentOpen(true)} aria-label={recording?(dictation?'받아쓰기 종료':'음성 입력 마치기'):'음성으로 입력'} title={recording?(dictation?'받아쓰기 종료':'음성 입력 마치기'):'음성으로 입력'} aria-pressed={recording}>{compact?(recording?<Square size={17} fill="currentColor"/>:<Mic size={20}/>):recording?'음성 입력 마치기':'음성으로 입력'}</button>{notice&&<small role="status">{notice}</small>}{!compact&&!supported&&<small>키보드의 음성 입력을 이용해 주세요.</small>}</div><Dialog open={consentOpen} onOpenChange={setConsentOpen}><DialogContent><DialogHeader><DialogTitle>음성으로 입력</DialogTitle><DialogDescription>음성이 브라우저 제공자의 서버에서 처리될 수 있습니다. 인식된 내용은 입력창에 들어가며, 직접 보내기를 누르면 전송됩니다.{dictation?' 종료를 누를 때까지 계속 듣고, 종료 후 받아 적은 글은 Orbit AI가 항목과 제목으로 정리합니다(저장 전 확인).':''}</DialogDescription></DialogHeader><div className="agent-action-buttons"><button type="button" className="secondary-button" onClick={()=>setConsentOpen(false)}>취소</button><button type="button" className="primary-button" disabled={disabled} onClick={()=>{setInformed(true);try{localStorage.setItem(CONSENT_KEY,'1')}catch{/* asked again next time */}setConsentOpen(false);start()}}>음성 입력 시작</button></div></DialogContent></Dialog></>;

}
export function VoicePanel({data,today,onAsk}:{data:WorkspaceData;today:string;onAsk:(s:string)=>void}){
 const [text,setText]=useState(''),[speaking,setSpeaking]=useState(false),[notice,setNotice]=useState('');const supported=useSyncExternalStore(noSubscribe,synthesisSupported,unsupported);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);const script=morningScript(data,today);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);window.speechSynthesis?.cancel();},[]);
 function speak(){window.speechSynthesis.cancel();if(timer.current)clearTimeout(timer.current);const u=new SpeechSynthesisUtterance(script);u.lang='ko-KR';u.rate=1.1;u.onend=()=>{setSpeaking(false);if(timer.current)clearTimeout(timer.current)};u.onerror=()=>{setSpeaking(false);setNotice('읽기를 완료하지 못했습니다. 아래 원문을 확인하세요.')};window.speechSynthesis.speak(u);setSpeaking(true);timer.current=setTimeout(()=>{window.speechSynthesis.cancel();setSpeaking(false);setNotice('60초 읽기를 마쳤습니다. 남은 내용은 원문에서 확인하세요.');},60000);}
 return <section className="phase2-panel"><article className="phase2-record"><h2>아침 60초 브리핑</h2><p>{script}</p><button className="primary-button" disabled={!supported} onClick={()=>speaking?(window.speechSynthesis.cancel(),timer.current&&clearTimeout(timer.current),setSpeaking(false)):speak()}>{speaking?'읽기 중지':'브리핑 듣기'}</button><p role="status">{notice}</p></article><article className="phase2-record"><h2>짧게 말하고 검토하기</h2><VoiceInput onText={s=>setText(t=>(t+' '+s).trim().slice(0,8000))}/><label className="form-label">업무·결정·마감<textarea className="form-field" maxLength={8000} value={text} onChange={e=>setText(e.target.value)}/></label><button className="primary-button" disabled={!text.trim()} onClick={()=>onAsk(text)}>검토한 내용을 에이전트에 가져가기</button></article></section>;
}
