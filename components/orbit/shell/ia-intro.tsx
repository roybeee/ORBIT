'use client';
import {Search,X} from 'lucide-react';
import {useEffect,useState} from 'react';

const KEY='orbit:ia-v2-intro-dismissed';
const read=()=>{try{return window.localStorage.getItem(KEY)==='1';}catch{return true;}};
const write=()=>{try{window.localStorage.setItem(KEY,'1');}catch{/* storage can be blocked; the card simply shows again */}};

// Shown once per device after the menu restructure so muscle memory has a bridge.
export function IaIntro({onSearch}:{onSearch:()=>void}){
 const [shown,setShown]=useState(false);
 // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists after hydration; the server and first client render both start hidden
 useEffect(()=>{setShown(!read());},[]);
 if(!shown)return null;
 const dismiss=()=>{write();setShown(false);};
 return <aside className="ia-intro" aria-label="메뉴 변경 안내">
  <div className="ia-intro-text"><strong>메뉴가 한 궤도로 바뀌었어요</strong>
   <ul><li>승인·보류·알림은 <b>결재함</b>에 모였습니다.</li><li>AI 대화는 가운데 <b>Orbit</b> 버튼으로 어디서나 엽니다.</li><li>설정·백업·자동화는 <b>나</b>에 있습니다. 예전 메뉴 이름으로 찾아도 나옵니다.</li></ul>
  </div>
  <div className="ia-intro-actions"><button className="primary-button" onClick={()=>{dismiss();onSearch();}}><Search size={16}/>찾기 열기</button><button className="icon-button" aria-label="안내 닫기" onClick={dismiss}><X size={18}/></button></div>
 </aside>;
}
