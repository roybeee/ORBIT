'use client';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {Moon,Sun,Focus,Monitor,Check} from 'lucide-react';

export type OrbitTheme='dark'|'light'|'focus'|'system';
const key='orbit:appearance:v1';
const choices=[
  {id:'dark',name:'오비트',description:'깊고 차분한 우주',icon:Moon},
  {id:'light',name:'데이라이트',description:'밝고 선명한 화면',icon:Sun},
  {id:'focus',name:'집중',description:'배경 효과 없이 고요하게',icon:Focus},
  {id:'system',name:'기기 설정',description:'기기의 밝기 모드에 맞춤',icon:Monitor},
] as const;
const valid=(v:unknown):v is OrbitTheme=>choices.some(c=>c.id===v);
const AppearanceContext=createContext<{theme:OrbitTheme;setTheme:(v:OrbitTheme)=>void}>({theme:'dark',setTheme:()=>{}});
export function AppearanceProvider({children}:{children:ReactNode}){
  const [theme,setValue]=useState<OrbitTheme>('dark');
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    const sync=()=>{try{const stored=localStorage.getItem(key);setValue(valid(stored)?stored:'dark')}catch{}setReady(true)};
    sync();window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
  },[]);
  useEffect(()=>{
    if(!ready)return;
    const media=window.matchMedia('(prefers-color-scheme: light)');
    const apply=()=>{const resolved=theme==='system'?(media.matches?'light':'dark'):theme;document.documentElement.dataset.orbitTheme=resolved;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',resolved==='light'?'#F4F6FB':'#080B16')};
    apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);
  },[theme,ready]);
  const setTheme=(value:OrbitTheme)=>{setValue(value);try{localStorage.setItem(key,value)}catch{}};
  return <AppearanceContext.Provider value={{theme,setTheme}}>{children}</AppearanceContext.Provider>;
}
export function useOrbitAppearance(){return useContext(AppearanceContext)}
export function AppearanceSettings(){
  const {theme,setTheme}=useContext(AppearanceContext);
  return <section className="appearance-settings" aria-labelledby="appearance-label"><div className="appearance-heading"><h3 id="appearance-label">화면 테마</h3><span>이 기기에 자동 저장</span></div><div className="appearance-grid" role="group" aria-label="화면 테마 선택">{choices.map(({id,name,description,icon:Icon})=><button type="button" key={id} className={`appearance-option theme-preview-${id}`} aria-pressed={theme===id} onClick={()=>setTheme(id)}><span className="appearance-preview" aria-hidden="true"><i/><i/><i/></span><span className="appearance-name"><Icon size={16}/>{name}{theme===id&&<Check size={16}/>}</span><small>{description}</small></button>)}</div></section>;
}
export function AppearanceShortcut(){const {theme,setTheme}=useContext(AppearanceContext);const Icon=theme==='light'?Sun:theme==='focus'?Focus:Moon;return <button type="button" className="icon-button appearance-shortcut" aria-label="화면 테마 전환" title="화면 테마 전환 · 오비트 / 데이라이트 / 집중" onClick={()=>setTheme(theme==='dark'?'light':theme==='light'?'focus':'dark')}><Icon size={20}/></button>}
