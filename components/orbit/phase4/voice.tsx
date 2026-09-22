'use client';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Mic,Square} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {WorkspaceData} from '@/lib/orbit/model';
import {morningScript} from '@/lib/orbit/phase4';
// Minimal Web Speech API surface used here; lib.dom does not declare the (webkit-prefixed) constructor.
interface RecognitionResultEvent{results:ArrayLike<ArrayLike<{transcript:string}>>}
interface RecognitionErrorEvent{error:string}
interface Recognition{lang:string;interimResults:boolean;continuous:boolean;onresult:((e:RecognitionResultEvent)=>void)|null;onerror:((e:RecognitionErrorEvent)=>void)|null;onend:(()=>void)|null;start():void;stop():void;abort():void}
type SpeechWindow=Window&{SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
const recognitionEngine=()=>(window as SpeechWindow).SpeechRecognition||(window as SpeechWindow).webkitSpeechRecognition;
// Client-only capability checks: the server snapshot stays false so hydration matches, then the client re-renders.
const noSubscribe=()=>()=>{};
const recognitionSupported=()=>!!recognitionEngine();
const synthesisSupported=()=>'speechSynthesis'in window;
const unsupported=()=>false;
export function VoiceInput({onText,disabled=false,compact=false,menuOnly=false,requestStart=0}:{menuOnly?:boolean;requestStart?:number;onText:(s:string)=>void;disabled?:boolean;compact?:boolean}){
 const supported=useSyncExternalStore(noSubscribe,recognitionSupported,unsupported);const [recording,setRecording]=useState(false),[notice,setNotice]=useState(''),[consentOpen,setConsentOpen]=useState(false),[informed,setInformed]=useState(false);const recognition=useRef<Recognition|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);const callback=useRef(onText);
 useEffect(()=>{callback.current=onText});
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);if(recognition.current){recognition.current.onresult=null;recognition.current.onerror=null;recognition.current.onend=null;recognition.current.abort();}},[]);
 useEffect(()=>{if(disabled&&recognition.current){recognition.current.onresult=null;recognition.current.abort();}},[disabled]);
 // eslint-disable-next-line react-hooks/set-state-in-effect -- requestStart is an event counter from the parent; each increment must open the consent dialog (or show the fallback notice) exactly once
 useEffect(()=>{if(!requestStart||disabled||recognition.current)return;if(recognitionEngine())setConsentOpen(true);else setNotice('이 기기에서는 키보드의 음성 입력을 이용해 주세요.')},[requestStart]);
 const stop=()=>recognition.current?.stop();
 function start(){if(disabled||recognition.current)return;try{const Engine=recognitionEngine()!;const r=new Engine();recognition.current=r;r.lang='ko-KR';r.interimResults=false;r.continuous=false;r.onresult=e=>{const text=Array.from(e.results).map(x=>x[0].transcript).join(' ').slice(0,8000);callback.current(text);setNotice('내용을 확인한 뒤 보내세요.');};r.onerror=e=>setNotice(e.error==='not-allowed'?'마이크 권한을 허용하거나 키보드로 입력하세요.':'음성을 인식하지 못했습니다. 다시 시도하거나 키보드로 입력하세요.');r.onend=()=>{setRecording(false);if(timer.current)clearTimeout(timer.current);recognition.current=null};r.start();setRecording(true);setNotice('듣고 있어요…');timer.current=setTimeout(()=>r.stop(),60000);}catch{recognition.current=null;setRecording(false);if(timer.current)clearTimeout(timer.current);setNotice('이 브라우저에서는 음성을 시작할 수 없습니다. 키보드로 입력하세요.')}}
 if(compact&&!supported)return null;
 return <><div hidden={menuOnly&&!recording&&!notice} className={'orbit-voice-input'+(compact?' orbit-voice-compact':'')}><button type="button" className={compact?'icon-button':'secondary-button'} disabled={disabled||!supported} onClick={()=>recording?stop():informed?start():setConsentOpen(true)} aria-label={recording?'음성 입력 마치기':'음성으로 입력'} title={recording?'음성 입력 마치기':'음성으로 입력'} aria-pressed={recording}>{compact?(recording?<Square size={17} fill="currentColor"/>:<Mic size={20}/>):recording?'음성 입력 마치기':'음성으로 입력'}</button>{notice&&<small role="status">{notice}</small>}{!compact&&!supported&&<small>키보드의 음성 입력을 이용해 주세요.</small>}</div><Dialog open={consentOpen} onOpenChange={setConsentOpen}><DialogContent><DialogHeader><DialogTitle>음성으로 입력</DialogTitle><DialogDescription>음성이 브라우저 제공자의 서버에서 처리될 수 있습니다. 인식된 내용은 입력창에 들어가며, 직접 보내기를 누르면 전송됩니다.</DialogDescription></DialogHeader><div className="agent-action-buttons"><button type="button" className="secondary-button" onClick={()=>setConsentOpen(false)}>취소</button><button type="button" className="primary-button" disabled={disabled} onClick={()=>{setInformed(true);setConsentOpen(false);start()}}>음성 입력 시작</button></div></DialogContent></Dialog></>;

}
export function VoicePanel({data,today,onAsk}:{data:WorkspaceData;today:string;onAsk:(s:string)=>void}){
 const [text,setText]=useState(''),[speaking,setSpeaking]=useState(false),[notice,setNotice]=useState('');const supported=useSyncExternalStore(noSubscribe,synthesisSupported,unsupported);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);const script=morningScript(data,today);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);window.speechSynthesis?.cancel();},[]);
 function speak(){window.speechSynthesis.cancel();if(timer.current)clearTimeout(timer.current);const u=new SpeechSynthesisUtterance(script);u.lang='ko-KR';u.rate=1.1;u.onend=()=>{setSpeaking(false);if(timer.current)clearTimeout(timer.current)};u.onerror=()=>{setSpeaking(false);setNotice('읽기를 완료하지 못했습니다. 아래 원문을 확인하세요.')};window.speechSynthesis.speak(u);setSpeaking(true);timer.current=setTimeout(()=>{window.speechSynthesis.cancel();setSpeaking(false);setNotice('60초 읽기를 마쳤습니다. 남은 내용은 원문에서 확인하세요.');},60000);}
 return <section className="phase2-panel"><article className="phase2-record"><h2>아침 60초 브리핑</h2><p>{script}</p><button className="primary-button" disabled={!supported} onClick={()=>speaking?(window.speechSynthesis.cancel(),timer.current&&clearTimeout(timer.current),setSpeaking(false)):speak()}>{speaking?'읽기 중지':'브리핑 듣기'}</button><p role="status">{notice}</p></article><article className="phase2-record"><h2>짧게 말하고 검토하기</h2><VoiceInput onText={s=>setText(t=>(t+' '+s).trim().slice(0,8000))}/><label className="form-label">업무·결정·마감<textarea className="form-field" maxLength={8000} value={text} onChange={e=>setText(e.target.value)}/></label><button className="primary-button" disabled={!text.trim()} onClick={()=>onAsk(text)}>검토한 내용을 에이전트에 가져가기</button></article></section>;
}
