'use client';

import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,CheckCircle2,Copy,Download,Orbit,ShieldCheck,Smartphone,Wifi,X} from 'lucide-react';
import {usePwa,type PhonePlatform} from './pwa-provider';

export function InstallBanner(){
  const {ready,standalone,installed}=usePwa();
  const [dismissed,setDismissed]=useState(true);
  useEffect(()=>{try{setDismissed(sessionStorage.getItem('orbit-install-later')==='1')}catch{setDismissed(false)}},[]);
  if(!ready||standalone||installed||dismissed)return null;
  return <aside className="install-banner" aria-label="휴대폰에 Orbit 설치"><span className="install-banner-icon"><Smartphone size={21}/></span><a href="/install"><strong>매일 여는 나의 운영실</strong><span>홈 화면에 Orbit 설치하기 <ArrowRight size={13}/></span></a><button className="icon-button" aria-label="이번 방문에서는 설치 안내 닫기" onClick={()=>{setDismissed(true);try{sessionStorage.setItem('orbit-install-later','1')}catch{}}}><X size={17}/></button></aside>;
}

export function InstallSettings(){
  const {standalone}=usePwa();
  return <><a className="secondary-button full-width" href="/install"><Smartphone size={17}/>{standalone?'설치 및 사용 안내':'휴대폰에 Orbit 설치하기'}<ArrowRight size={15}/></a><p className="form-hint">홈 화면에서 바로 실행합니다. 저장한 기록은 같은 계정의 기기에서 이어 볼 수 있습니다.</p></>;
}

export default function InstallApp(){
  const {ready,standalone,installed,canInstall,installing,platform,install}=usePwa();
  const [selected,setSelected]=useState<PhonePlatform>('android');
  const [message,setMessage]=useState(''),[copied,setCopied]=useState(false),[url,setUrl]=useState('');
  useEffect(()=>{if(ready)setSelected(platform==='other'?'android':platform)},[ready,platform]);
  useEffect(()=>setUrl(new URL('/install',location.origin).href),[]);
  const startInstall=async()=>{
    const result=await install();
    setMessage(result==='accepted'?'설치 요청을 보냈습니다. 설치가 끝나면 홈 화면에서 Orbit 아이콘을 눌러 주세요.':result==='dismissed'?'설치를 취소했습니다. 아래 브라우저 메뉴에서도 다시 설치할 수 있습니다.':'아래 안내에 따라 브라우저 메뉴에서 설치해 주세요.');
  };
  const copy=async()=>{try{await navigator.clipboard.writeText(url);setCopied(true);setMessage('주소를 복사했습니다. Chrome 또는 Safari 주소창에 붙여 넣으세요.')}catch{setMessage('아래 주소를 길게 눌러 직접 복사해 주세요.')}};
  return <main className="install-page">
    <header className="install-header"><a href="/" className="text-button"><ArrowLeft size={17}/>내 워크스페이스</a><span>ORBIT FOR MOBILE</span></header>
    <section className="install-hero">
      <div className="install-logo"><Orbit size={43}/></div>
      <span className="install-eyebrow">오늘의 실행부터, 내일의 계획까지.</span>
      <h1>{standalone?'나의 운영실이 손안에.':'나의 운영실을\n홈 화면으로.'}</h1>
      <p>일정, 할 일, 프로젝트와 나만의 지식을<br/>폰에서 바로 열고 이어가세요.</p>
      {standalone?<div className="install-success" role="status"><CheckCircle2 size={19}/>설치한 앱으로 실행 중입니다</div>:installed?<div className="install-success" role="status"><CheckCircle2 size={19}/>설치 완료 · 홈 화면의 Orbit을 열어 주세요</div>:canInstall?<button className="primary-button install-primary" onClick={()=>void startInstall()} disabled={installing}><Download size={20}/>{installing?'설치 확인 중…':'Orbit 설치하기'}</button>:<a href="#install-steps" className="primary-button install-primary"><Smartphone size={19}/>폰에 설치하는 방법<ArrowRight size={17}/></a>}
      <a href="/" className="install-continue">{standalone?'오늘의 업무 시작하기':'먼저 사용해 보기'}<ArrowRight size={15}/></a>
      {message&&<p className="install-feedback" role="status">{message}</p>}
    </section>
    <section id="install-steps" className="install-card" aria-labelledby="install-heading">
      <div className="install-section-title"><span>01</span><h2 id="install-heading">내 폰에 설치하기</h2></div>
      <div className="install-platforms" role="group" aria-label="휴대폰 종류">{[{id:'android' as const,label:'갤럭시 · Android'},{id:'ios' as const,label:'iPhone'}].map(item=><button key={item.id} aria-pressed={selected===item.id} onClick={()=>setSelected(item.id)}>{item.label}</button>)}</div>
      {selected==='ios'?<ol className="install-steps"><li><span>1</span><div><strong>Safari에서 이 주소를 열어 주세요</strong><p>안내가 나오면 지금 사용하는 ChatGPT 계정으로 로그인합니다.</p></div></li><li><span>2</span><div><strong>공유 → 홈 화면에 추가</strong><p>브라우저의 공유 메뉴를 여세요. ‘웹 앱으로 열기’가 보이면 켜 주세요.</p></div></li><li><span>3</span><div><strong>‘추가’를 누르고 Orbit 실행</strong><p>홈 화면에 생긴 아이콘을 눌러 나의 업무를 시작합니다.</p></div></li></ol>:<ol className="install-steps"><li><span>1</span><div><strong>Chrome에서 이 주소를 열어 주세요</strong><p>ChatGPT 안에서 열었다면 상단 ⋮ 메뉴의 ‘Chrome에서 열기’를 선택하거나 아래 주소를 복사해 Chrome에 붙여 넣으세요.</p></div></li><li><span>2</span><div><strong>로그인 후 ‘Orbit 설치하기’</strong><p>지금 사용하는 ChatGPT 계정으로 로그인하세요. 설치 버튼이 없으면 Chrome ⋮ → ‘설치 및 바로가기 만들기’ 또는 ‘홈 화면에 추가’ → ‘설치’를 선택합니다.</p></div></li><li><span>3</span><div><strong>홈 화면에서 Orbit 실행</strong><p>폰에 생긴 Orbit 아이콘을 눌러 주세요. 메뉴 이름은 브라우저 버전에 따라 다를 수 있습니다.</p></div></li></ol>}
      <div className="install-address"><label htmlFor="install-url">브라우저에서 열 주소</label><div><input id="install-url" value={url} readOnly onFocus={e=>e.target.select()} aria-label="Orbit 설치 주소"/><button className="icon-button" onClick={()=>void copy()} aria-label="설치 주소 복사">{copied?<Check size={18}/>:<Copy size={18}/>}</button></div></div>
      <details className="install-help"><summary>설치 메뉴가 보이지 않나요?</summary><p>앱 안의 브라우저에서는 설치 메뉴가 없을 수 있습니다. 일반 Chrome 또는 Safari로 열고, 로그인 후 다시 확인해 주세요. 이미 설치했다면 홈 화면의 Orbit 아이콘으로 실행하면 됩니다. 설치가 되기 전에도 ‘먼저 사용해 보기’에서 업무를 저장할 수 있습니다.</p><a href={selected==='ios'?'https://support.apple.com/ko-kr/guide/iphone/iphea86e5236/ios':'https://support.google.com/chrome/answer/9658361?hl=ko&co=GENIE.Platform%3DAndroid'} target="_blank" rel="noreferrer">브라우저 공식 설치 안내 ↗</a></details>
    </section>
    <section className="install-card" aria-labelledby="start-heading"><div className="install-section-title"><span>02</span><h2 id="start-heading">첫 하루는 이렇게</h2></div><div className="install-routine"><a href="/#projects"><span>시작</span><div><strong>첫 프로젝트와 할 일</strong><p>원하는 결과물과 마감일을 정해 주세요.</p></div><ArrowRight size={17}/></a><a href="/#review"><span>저녁</span><div><strong>오늘을 돌아보는 5분</strong><p>해낸 일, 막힌 일과 에너지를 기록합니다.</p></div><ArrowRight size={17}/></a><a href="/#proposal"><span>내일</span><div><strong>제안을 승인하거나 보류</strong><p>승인한 집중 시간이 일정에 반영됩니다.</p></div><ArrowRight size={17}/></a></div></section>
    <footer className="install-foot"><p><ShieldCheck size={16}/>내 계정으로 로그인해 사용하는 개인 공간</p><p><Wifi size={16}/>업무 불러오기·저장은 인터넷 연결이 필요합니다.</p><p>새 업데이트는 앱을 완전히 닫고 다시 열면 반영됩니다.</p></footer>
  </main>;
}
