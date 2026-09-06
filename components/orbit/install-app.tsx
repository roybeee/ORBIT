'use client';

import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,CheckCircle2,Copy,Download,ExternalLink,Laptop,Monitor,Orbit,ShieldCheck,Smartphone,Wifi,X} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {browserLabels,guideBrowser,installGuide,installPlatforms,installRootUrl,platformLabels,type SupportedPlatform,type InstallBrowser} from '@/lib/orbit/installation';
import {usePwa} from './pwa-provider';

const platformIcons={mac:Laptop,windows:Monitor,android:Smartphone,ios:Smartphone};
function InstallSteps({steps}:{steps:{title:string;text:string}[]}){return <ol className="install-steps">{steps.map((step,i)=><li key={step.title}><span>{i+1}</span><div><strong>{step.title}</strong><p>{step.text}</p></div></li>)}</ol>}

export function InstallBanner(){
 const {ready,standalone,installed,platform}=usePwa();
 const [dismissed,setDismissed]=useState(true);
 useEffect(()=>{try{setDismissed(sessionStorage.getItem('orbit-install-later')==='1')}catch{setDismissed(false)}},[]);
 if(!ready||standalone||installed||dismissed)return null;
 const Device=platform==='mac'||platform==='windows'?Monitor:Smartphone;
 return <aside className="install-banner" aria-label="기기에 Orbit 설치"><span className="install-banner-icon"><Device size={21}/></span><a href="/install"><strong>매일 여는 나의 운영실</strong><span>{platformLabels[platform]}에 Orbit 설치하기 <ArrowRight size={13}/></span></a><button className="icon-button" aria-label="이번 방문에서는 설치 안내 닫기" onClick={()=>{setDismissed(true);try{sessionStorage.setItem('orbit-install-later','1')}catch{}}}><X size={17}/></button></aside>;
}

export function InstallSettings(){
 const {standalone,platform}=usePwa();
 return <><a className="secondary-button full-width" href="/install"><Download size={17}/>{standalone?'기기별 설치 및 사용 안내':platformLabels[platform]+'에 Orbit 설치하기'}<ArrowRight size={15}/></a><p className="form-hint">Mac · Windows · 휴대폰에 설치하고 같은 계정의 기록을 이어서 사용합니다.</p></>;
}

// Safari's Add to Dock can use the page currently open as its launch URL.
// Present manual installation on the actual agent route, then remove setup
// parameters before installation so the installed app opens the conversation.
export function InstallRootHint(){
 const {ready,standalone}=usePwa();
 const [manual,setManual]=useState<{platform:SupportedPlatform;browser:InstallBrowser}|null>(null);
 useEffect(()=>{
  if(!ready)return;if(standalone)setManual(null);const url=new URL(location.href),selected=url.searchParams.get('install');
  if(!installPlatforms.includes(selected as SupportedPlatform))return;
  const chosen=url.searchParams.get('browser'),browser:InstallBrowser=['safari','chrome','edge'].includes(chosen??'')?chosen as InstallBrowser:'other';
  url.searchParams.delete('install');url.searchParams.delete('browser');history.replaceState(history.state,'',url.pathname+url.search+url.hash);
  if(!standalone)setManual({platform:selected as SupportedPlatform,browser});
 },[ready,standalone]);
 if(!manual)return null;
 const guide=installGuide(manual.platform,manual.browser);
 return <Dialog open onOpenChange={open=>{if(!open)setManual(null)}}><DialogContent className="install-instruction-dialog"><DialogHeader><DialogTitle>{platformLabels[manual.platform]}에 Orbit 설치</DialogTitle><DialogDescription>설치하면 이 대화 화면에서 시작합니다.</DialogDescription></DialogHeader><div className="install-menu-callout"><strong>{guide.steps[1].title}</strong><p>{guide.steps[1].text}</p></div><p className="install-dialog-note">설치가 끝나면 {guide.launcher}에서 Orbit을 열어 주세요.</p><button className="primary-button" onClick={()=>setManual(null)}>안내 닫고 계속하기</button><a href="/install" className="text-button">다른 기기·브라우저 설치 방법 <ArrowRight size={15}/></a></DialogContent></Dialog>;
}

export default function InstallApp(){
 const {ready,standalone,installed,canInstall,installing,platform,browser,install}=usePwa();
 const [selected,setSelected]=useState<SupportedPlatform>('mac'),[chosenBrowser,setChosenBrowser]=useState<InstallBrowser>('safari');
 const [message,setMessage]=useState(''),[copied,setCopied]=useState(false),[url,setUrl]=useState('');
 useEffect(()=>{
  if(!ready)return;
  const requested=new URL(location.href).searchParams.get('device');
  const device=installPlatforms.includes(requested as SupportedPlatform)?requested as SupportedPlatform:platform==='other'?'mac':platform;
  setSelected(device);setChosenBrowser(guideBrowser(device,device===platform?browser:'other'));
 },[ready,platform,browser]);
 useEffect(()=>setUrl(new URL('/',location.origin).href),[]);
 const guide=installGuide(selected,chosenBrowser),onThisDevice=selected===platform||platform==='other';
 const changeDevice=(value:string)=>{const next=value as SupportedPlatform;setSelected(next);setChosenBrowser(guideBrowser(next,next===platform?browser:'other'));setMessage('');setCopied(false)};
 const startInstall=async()=>{
  const result=await install();
  setMessage(result==='accepted'?'설치 요청을 보냈습니다. 완료되면 '+guide.launcher+'에서 Orbit을 열어 주세요.':result==='dismissed'?'설치를 취소했습니다. 아래 브라우저 메뉴에서도 다시 설치할 수 있습니다.':result==='failed'?'설치 요청을 완료하지 못했습니다. 아래 브라우저 메뉴로 다시 설치해 주세요.':'이 브라우저에서는 아래 메뉴 안내에 따라 설치해 주세요.');
 };
 const copy=async()=>{try{await navigator.clipboard.writeText(url);setCopied(true);setMessage('주소를 복사했습니다. '+platformLabels[selected]+'의 '+browserLabels[guide.browser]+'에서 열어 주세요.')}catch{setMessage('아래 앱 주소를 선택해 직접 복사해 주세요.')}};
 return <main className="install-page">
  <header className="install-header"><a href="/" className="text-button"><ArrowLeft size={17}/>내 워크스페이스</a><span>MAC · WINDOWS · MOBILE</span></header>
  <div className="install-layout">
   <section className="install-hero" aria-labelledby="install-title">
    <div className="install-logo"><Orbit size={40}/></div>
    <h1 id="install-title">Orbit을<br/>내 기기에.</h1>
    <p>컴퓨터에서 정리하고,<br/>폰에서 이어서 실행하세요.</p>
    <div className="install-device-summary"><Monitor size={18}/><span>독립된 앱 창 · 같은 계정의 기록</span></div>
    {standalone?<div className="install-success" role="status"><CheckCircle2 size={19}/>{platformLabels[platform]}의 앱으로 실행 중입니다</div>:installed?<div className="install-success" role="status"><CheckCircle2 size={19}/>설치 완료 · 기기의 Orbit 아이콘으로 실행하세요</div>:ready&&!onThisDevice?<button className="primary-button install-primary" onClick={()=>void copy()} disabled={!url}><Copy size={19}/>{platformLabels[selected]}에서 열 주소 복사</button>:canInstall?<button className="primary-button install-primary" onClick={()=>void startInstall()} disabled={installing}><Download size={20}/>{installing?'설치 확인 중…':platformLabels[platform]+'에 Orbit 설치하기'}</button>:<a href="#install-steps" className="primary-button install-primary"><Download size={19}/>{platformLabels[selected]} 설치 방법<ArrowRight size={17}/></a>}
    <a href="/#agent" className="install-continue">{standalone?'헤르메스와 대화 시작하기':'Orbit 먼저 열어 보기'}<ArrowRight size={15}/></a>
    {message&&<p className="install-feedback" role="status">{message}</p>}
    <p className="install-account-note">폰에서 쓰던 것과 같은 ChatGPT 계정으로 로그인하세요. 업무·위키·대화 기록을 이어서 사용할 수 있습니다.</p>
   </section>
   <section id="install-steps" className="install-card install-main-card" aria-labelledby="install-heading">
    <div className="install-section-title"><span>01</span><h2 id="install-heading">설치할 기기를 선택하세요</h2></div>
    <Tabs value={selected} onValueChange={changeDevice}>
     <TabsList className="install-platform-tabs" aria-label="설치할 기기">{installPlatforms.map(id=>{const Device=platformIcons[id];return <TabsTrigger key={id} value={id}><Device size={16}/>{id==='ios'?'iPhone':id==='android'?'갤럭시 · Android':platformLabels[id]}</TabsTrigger>})}</TabsList>
     {installPlatforms.map(id=><TabsContent key={id} value={id} className="install-guide-content">
      <div className="install-browser-row"><div><strong>{platformLabels[id]} 설치</strong><p>{ready&&platform===id?browserLabels[browser]+'에서 열고 있습니다.':'설치할 기기의 브라우저에서 진행하세요.'}</p></div>{(id==='mac'||id==='windows')&&<Select value={guide.browser} onValueChange={value=>{setChosenBrowser(value as InstallBrowser);setMessage('')}}><SelectTrigger className="install-browser-select" aria-label="설치에 사용할 브라우저"><SelectValue/></SelectTrigger><SelectContent>{(id==='mac'?['safari','chrome','edge']:['edge','chrome']).map(b=><SelectItem key={b} value={b}>{browserLabels[b as InstallBrowser]}</SelectItem>)}</SelectContent></Select>}</div>
      <InstallSteps steps={guide.steps}/>
      {ready&&!onThisDevice?<button className="secondary-button install-open" onClick={()=>void copy()} disabled={!url}><Copy size={17}/>{platformLabels[selected]}에서 열 주소 복사</button>:<a href={installRootUrl(id,guide.browser)} className="secondary-button install-open">Orbit 열고 설치 <ArrowRight size={17}/></a>}
      <details className="install-help"><summary>설치 버튼이나 메뉴가 보이지 않나요?</summary><p>{id==='mac'&&guide.browser==='safari'?'Safari의 Dock에 추가는 macOS Sonoma 14 이상에서 지원합니다. 메뉴가 없다면 위에서 Chrome 또는 Microsoft Edge를 선택해 설치 방법을 확인하세요.':'앱 안의 브라우저나 시크릿 창에서는 설치 기능이 제한될 수 있습니다. 안내된 브라우저의 일반 창에서 앱 주소를 열고 로그인하세요.'} 이미 설치했다면 기기에 있는 Orbit 아이콘으로 실행하세요.</p><a href={guide.source} target="_blank" rel="noreferrer">{browserLabels[guide.browser]} 공식 설치 안내 <ExternalLink size={13}/></a></details>
     </TabsContent>)}
    </Tabs>
    <div className="install-address"><label htmlFor="install-url">다른 기기에서도 같은 앱 주소</label><div><input id="install-url" value={url} readOnly onFocus={e=>e.target.select()} aria-label="Orbit 앱 주소"/><button className="icon-button" onClick={()=>void copy()} aria-label="앱 주소 복사" disabled={!url}>{copied?<Check size={18}/>:<Copy size={18}/>}</button></div></div>
   </section>
  </div>
  <section className="install-card install-routine-card" aria-labelledby="start-heading"><div className="install-section-title"><span>02</span><h2 id="start-heading">설치 후에도 같은 Orbit</h2></div><div className="install-routine"><a href="/#agent"><span>대화</span><div><strong>헤르메스와 다음 행동 정리</strong><p>연결 설정과 저장된 대화를 이어갑니다.</p></div><ArrowRight size={17}/></a><a href="/#review"><span>저녁</span><div><strong>오늘을 돌아보는 5분</strong><p>해낸 일, 막힌 일과 에너지를 기록합니다.</p></div><ArrowRight size={17}/></a><a href="/#proposal"><span>내일</span><div><strong>제안을 승인하거나 보류</strong><p>승인한 집중 시간이 일정에 반영됩니다.</p></div><ArrowRight size={17}/></a></div></section>
  <section className="install-card" aria-labelledby="share-heading"><h2 id="share-heading">캡처한 화면을 Orbit으로 보내기</h2><p>갤럭시의 Chrome에서 Orbit을 설치한 뒤, 갤러리 → 이미지 선택 → 공유 → Orbit을 누르세요. 새 대화·기존 대화·일정 중 보관할 곳을 선택할 수 있습니다.</p><p>이미 설치했다면 Orbit을 열었다가 완전히 닫고 다시 열어 주세요. 공유 목록 갱신에는 하루 이상 걸릴 수 있습니다. 그동안 대화와 일정의 파일 첨부 버튼으로 바로 올릴 수 있습니다.</p><p>iPhone·iPad에서는 앱 안의 파일 첨부를 사용하세요. Mac·Windows에서는 파일을 끌어다 놓거나 첨부 버튼으로 선택할 수 있습니다.</p><a className="text-button" href="/share">받은 파일 열기 <ArrowRight size={15}/></a></section>
  <footer className="install-foot"><p><ShieldCheck size={16}/>내 계정으로 로그인해 사용하는 개인 공간</p><p><Wifi size={16}/>업무 불러오기·저장은 인터넷 연결이 필요합니다.</p><p>업데이트는 앱을 완전히 닫고 다시 열면 반영됩니다.</p></footer>
 </main>;
}
