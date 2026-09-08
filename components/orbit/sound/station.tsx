'use client';
import {useEffect,useRef,useState} from 'react';
import {Headphones,Pause,Play,Volume2,ArrowUpRight,LoaderCircle} from 'lucide-react';
import {Slider} from '@/components/ui/slider';
import {agentRequest} from '@/components/orbit/agent/connections';
import {emptySound,reduceSound,soundAction} from '@/lib/orbit/sound/state';

const protocol='orbit.sound.v1';
type Playback={ready:boolean;activated:boolean;busy:boolean;playing:boolean;active:boolean;title:string;mode:string;duration:number;elapsed:number;volume:number;needsFeedback:boolean};
const idle:Playback={ready:false,activated:false,busy:false,playing:false,active:false,title:'사운드스테이션',mode:'focus',duration:1500,elapsed:0,volume:35,needsFeedback:false};
const time=(seconds:number)=>`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;

export function SoundStation({visible,demo=false,onOpen}:{visible:boolean;demo?:boolean;onOpen:()=>void}){
  const [mounted,setMounted]=useState(false),[playback,setPlayback]=useState(idle),[loadError,setLoadError]=useState('');
  const frame=useRef<HTMLIFrameElement>(null),queue=useRef<Promise<void>>(Promise.resolve());
  const localDemo=useRef(emptySound()),prefill=useRef<{goal:string;minutes:number}|null>(null);
  const open=useRef(onOpen);open.current=onOpen;
  const command=(name:string,value?:unknown)=>frame.current?.contentWindow?.postMessage({protocol,type:'command',command:name,value},'*');
  useEffect(()=>{if(visible)setMounted(true)},[visible]);
  useEffect(()=>{
    const show=(event:Event)=>{
      const input=(event as CustomEvent).detail;
      if(input&&typeof input.goal==='string')prefill.current={goal:input.goal.slice(0,240),minutes:Math.max(1,Math.min(180,Number(input.minutes)||25))};
      setMounted(true);open.current();command('state');
    };
    window.addEventListener('orbit:sound-open',show);
    return()=>window.removeEventListener('orbit:sound-open',show);
  },[]);
  useEffect(()=>{
    if(!mounted)return;
    let live=true;
    const receive=(event:MessageEvent)=>{
      if(event.source!==frame.current?.contentWindow||event.origin!=='null'||event.data?.protocol!==protocol)return;
      const message=event.data;
      if(message.type==='state'){
        const s=message.state;
        if(!s||typeof s.title!=='string'||s.title.length>120||![s.duration,s.elapsed,s.volume].every(Number.isFinite))return;
        setLoadError('');
        setPlayback({ready:!!s.ready,activated:!!s.activated,busy:!!s.busy,playing:!!s.playing,active:!!s.active,title:s.title,mode:s.mode,duration:Math.max(60,Math.min(10800,s.duration)),elapsed:Math.max(0,Math.min(10800,s.elapsed)),volume:Math.max(0,Math.min(100,s.volume)),needsFeedback:!!s.needsFeedback});
        if(s.ready&&prefill.current){command('prefill',prefill.current);prefill.current=null;}
        return;
      }
      if(message.type!=='request'||typeof message.id!=='string'||message.id.length>32||!['read','mutate'].includes(message.method))return;
      // Serialize the frame's writes. The server retries CAS conflicts across devices.
      const target=frame.current?.contentWindow;
      queue.current=queue.current.catch(()=>{}).then(async()=>{
        if(!live)return;
        try{
          const action=message.method==='mutate'?soundAction.parse(message.payload):null;
          const response=demo
            ?{state:action?(localDemo.current=reduceSound(localDemo.current,action)):localDemo.current}
            :await agentRequest('/api/sound',action?'POST':'GET',action??undefined);
          if(live)target?.postMessage({protocol,type:'response',id:message.id,state:response.state},'*');
        }catch(error){
          if(live)target?.postMessage({protocol,type:'response',id:message.id,error:error instanceof Error?error.message:'사운드 기록을 저장하지 못했습니다. 다시 시도해 주세요.'},'*');
        }
      });
    };
    window.addEventListener('message',receive);
    const timeout=setTimeout(()=>setLoadError(current=>frame.current?.dataset.ready==='yes'?current:'사운드 화면 연결이 지연되고 있습니다. 아래 화면의 다시 연결을 눌러주세요.'),30000);
    return()=>{live=false;clearTimeout(timeout);window.removeEventListener('message',receive)};
  },[mounted,demo]);
  useEffect(()=>{if(playback.ready&&frame.current)frame.current.dataset.ready='yes'},[playback.ready]);
  if(!mounted)return null;
  const remaining=Math.max(0,Math.ceil(playback.duration-playback.elapsed));
  return <>
    <section className={`sound-station ${visible?'':'sound-station-background'}`} aria-hidden={!visible} inert={!visible}>
      <div className="sound-workspace-intro"><div><Headphones size={19}/><strong>사운드스테이션</strong><span>다른 업무 화면에서도 이어집니다</span></div><a href="/sound-station/OPEN-SOURCE-NOTICES.txt" target="_blank" rel="noreferrer">오픈소스 안내 <ArrowUpRight size={12}/></a></div>
      {loadError&&<p className="sound-load-error" role="status">{loadError}</p>}
      <iframe ref={frame} title="Orbit 사운드스테이션 — 집중, 휴식, 수면 준비" src="/sound-station/index.html"
        sandbox="allow-scripts allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox"
        allow="autoplay; fullscreen" allowFullScreen onLoad={()=>command('state')} onError={()=>setLoadError('사운드 화면을 열지 못했습니다. 인터넷 연결을 확인한 뒤 Orbit을 새로고침해 주세요.')}/>
    </section>
    {!visible&&playback.active&&<aside className="sound-mini" aria-label="사운드 재생 제어">
      <button className="sound-mini-open" onClick={onOpen}><span className={`sound-mini-icon ${playback.playing?'playing':''}`}><Headphones size={19}/></span><span><strong>{playback.title}</strong><small>{playback.needsFeedback?'세션을 마치고 기록해 주세요':`${playback.playing?'재생 중':'일시정지'} · ${time(remaining)} 남음`}</small></span></button>
      <div className="sound-mini-volume"><Volume2 size={15}/><Slider aria-label="사운드 음량" min={0} max={100} step={1} value={[playback.volume]} onValueChange={value=>command('volume',value[0])}/></div>
      <button className="sound-mini-toggle" aria-label={playback.needsFeedback?'사운드 세션 기록하기':playback.playing?'사운드 일시정지':'사운드 이어 듣기'} disabled={playback.busy||!playback.ready} onClick={()=>{if(playback.needsFeedback||!playback.activated)onOpen();else command('toggle')}}>{playback.busy?<LoaderCircle className="animate-spin" size={18}/>:playback.playing?<Pause size={19}/>:<Play size={19}/>}</button>
    </aside>}
  </>;
}
