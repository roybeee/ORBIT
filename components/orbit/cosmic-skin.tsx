'use client';

import {useEffect,useState,type CSSProperties} from 'react';
import {Sparkles,Pause} from 'lucide-react';

const preferenceKey='orbit:cosmic-motion';
const starPositions=Array.from({length:22},(_,i)=>({x:(i*47+9)%100,y:(i*31+7)%100,delay:-(i*1.7),size:i%5===0?3:2}));

/** Only the animation preference is device-local; no workspace records are changed. */
export function useCosmicMotion(){
  const [enabled,setEnabled]=useState(true);
  const [reduced,setReduced]=useState(true);
  const [visible,setVisible]=useState(true);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMedia=()=>setReduced(media.matches);
    const syncVisibility=()=>setVisible(document.visibilityState==='visible');
    const syncPreference=()=>{try{setEnabled(localStorage.getItem(preferenceKey)!=='off')}catch{/* Storage is optional. */}};
    syncMedia();syncVisibility();syncPreference();
    media.addEventListener('change',syncMedia);
    document.addEventListener('visibilitychange',syncVisibility);
    window.addEventListener('storage',syncPreference);
    return()=>{media.removeEventListener('change',syncMedia);document.removeEventListener('visibilitychange',syncVisibility);window.removeEventListener('storage',syncPreference)};
  },[]);
  useEffect(()=>{
    document.documentElement.dataset.orbitMotion=enabled&&!reduced?'full':'still';
    document.documentElement.dataset.orbitVisible=visible?'yes':'no';
    return()=>{delete document.documentElement.dataset.orbitMotion;delete document.documentElement.dataset.orbitVisible};
  },[enabled,reduced,visible]);
  return {enabled:enabled&&!reduced,reduced,toggle:()=>setEnabled(current=>{const next=!current;try{localStorage.setItem(preferenceKey,next?'on':'off')}catch{/* Keep the preference for this session. */}return next})};
}

export function CosmicBackdrop(){
  return <div className="cosmic-backdrop" aria-hidden="true"><div className="cosmic-nebula cosmic-motion"/><div className="cosmic-shade"/><div className="cosmic-stars">{starPositions.map((star,i)=><i className="cosmic-star cosmic-motion" key={i} style={{left:star.x+'%',top:star.y+'%','--star-size':star.size+'px','--star-delay':star.delay+'s'} as CSSProperties}/>)}</div></div>;
}

export function CosmicMotionToggle({enabled,reduced,onToggle}:{enabled:boolean;reduced:boolean;onToggle:()=>void}){
  return <button type="button" className="cosmic-toggle" aria-pressed={enabled} aria-label="우주 애니메이션" title={reduced?'기기의 동작 줄이기 설정에 따라 정지된 배경을 표시합니다.':enabled?'우주 애니메이션 끄기':'우주 애니메이션 켜기'} disabled={reduced} onClick={onToggle}>{enabled?<Sparkles size={16}/>:<Pause size={16}/>}<span>우주 효과</span><small>{enabled?'ON':'OFF'}</small></button>;
}
