'use client';

import {createContext,useContext,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {Check,Globe2,Orbit,Palette,RotateCcw} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {illustrationThemes,illustrationTheme,screenIllustration,type IllustrationId,type IllustrationCollection} from '@/lib/orbit/city-themes';
import type {Preferences,View} from '@/lib/orbit/model';
import type {WorkspaceAction} from '@/lib/orbit/validation';

type Target={scope:'screen'|'default'|'project';id?:string;title:string};
type Context={open:(target?:Target)=>void;theme:ReturnType<typeof illustrationTheme>;disabled:boolean};
const CityContext=createContext<Context|null>(null);
function useCityThemes(){const context=useContext(CityContext);if(!context)throw new Error('CityThemeProvider is required');return context;}

export function CityThemeProvider({preferences,view,title,busy,perform,children,demo=false}:{preferences:Preferences;view:View;title:string;busy:boolean;perform:(action:WorkspaceAction,message?:string)=>Promise<boolean>;children:ReactNode;demo?:boolean}){
 const [target,setTarget]=useState<Target|null>(null),[selected,setSelected]=useState<IllustrationId|null>('seoul'),[saving,setSaving]=useState(false);
 const trigger=useRef<HTMLElement|null>(null);
 const [collection,setCollection]=useState<IllustrationCollection>('worlds');
 const [projectTarget,setProjectTarget]=useState<Target|null>(null);
 const valueFor=(t:Target)=>t.scope==='default'?preferences.illustrations?.defaultTheme??'seoul':t.scope==='project'?preferences.illustrations?.projects[t.id!]??null:preferences.illustrations?.screens[view]??null;
 const chooseTarget=(t:Target)=>{const value=valueFor(t);setSelected(value);setCollection(value?illustrationTheme(value).collection:'worlds');setTarget(t)};
 const open=(t:Target={scope:'screen',title})=>{trigger.current=document.activeElement as HTMLElement;setProjectTarget(t.scope==='project'?t:null);chooseTarget(t)};
 const inherited=target?.scope==='project'?screenIllustration(preferences,'projects'):preferences.illustrations?.defaultTheme??'seoul';
 const preview=illustrationTheme(selected??inherited);
 const save=async()=>{
  if(!target||saving||busy)return;
  setSaving(true);
  try{
   const action:WorkspaceAction=target.scope==='default'?{type:'illustration.default',theme:selected??'seoul'}:target.scope==='project'?{type:'illustration.project',id:target.id!,theme:selected}:{type:'illustration.screen',screen:view,theme:selected};
   if(await perform(action,demo?'체험 화면에 적용했습니다.':`${target.title} 테마를 저장했습니다.`))setTarget(null);
  }finally{setSaving(false)}
 };
 return <CityContext.Provider value={{open,theme:illustrationTheme(screenIllustration(preferences,view)),disabled:busy}}>
  {children}
  <Dialog open={!!target} onOpenChange={isOpen=>{if(!isOpen&&!saving&&!busy)setTarget(null)}}>
   <DialogContent className="city-theme-dialog" style={{'--illustration-accent':preview.accent} as CSSProperties} onCloseAutoFocus={event=>{event.preventDefault();trigger.current?.focus()}}>
    <DialogHeader><span className="city-collection-eyebrow"><Orbit size={15}/> ORBIT THEME COLLECTION</span><DialogTitle>나의 리듬에 맞는 풍경</DialogTitle><DialogDescription>우주와 자연, 세계 도시에서 배경을 골라보세요.</DialogDescription></DialogHeader>
    <div className="city-theme-scope"><label htmlFor="city-theme-scope">적용할 곳</label><select id="city-theme-scope" value={target?.scope??'screen'} disabled={saving||busy} onChange={e=>{const scope=e.target.value as Target['scope'];chooseTarget({scope,title:scope==='default'?'기본':scope==='project'?projectTarget!.title:title,...(scope==='project'?{id:projectTarget?.id}:{})})}}>{projectTarget&&<option value="project">이 프로젝트 · {projectTarget.title}</option>}<option value="screen">현재 화면 · {title}</option><option value="default">기본 테마 · 별도 설정 없는 화면</option></select></div>
    <Tabs className="theme-collection-tabs" value={collection} onValueChange={value=>setCollection(value as IllustrationCollection)}>
     <TabsList aria-label="테마 컬렉션"><TabsTrigger value="worlds" disabled={saving||busy}><Orbit size={16}/>오비트 월드 <span>{illustrationThemes.filter(t=>t.collection==='worlds').length}</span></TabsTrigger><TabsTrigger value="cities" disabled={saving||busy}><Globe2 size={16}/>세계 도시 <span>{illustrationThemes.filter(t=>t.collection==='cities').length}</span></TabsTrigger></TabsList>
    <div className="city-theme-scroll">
     <div className="city-theme-preview"><img src={preview.image} alt={`${preview.name} 일러스트 미리보기`} width="1600" height="1194"/><div><span>{preview.english}</span><strong>{preview.name}</strong><small>{preview.landmarks}</small></div></div>
     {(['worlds','cities'] as const).map(group=><TabsContent key={group} value={group}><div className="city-theme-grid" role="group" aria-label={group==='worlds'?'오비트 월드 일러스트 선택':'도시 일러스트 선택'}>{illustrationThemes.filter(t=>t.collection===group).map(theme=><button type="button" key={theme.id} className={`city-theme-card ${selected===theme.id?'is-selected':''}`} aria-pressed={selected===theme.id} aria-label={`${theme.name} 테마 선택`} disabled={saving||busy} onClick={()=>setSelected(theme.id)}><img src={theme.thumbnail} width="480" height="358" alt="" loading="lazy"/><span><strong>{theme.name}</strong><small>{group==='worlds'?theme.country:theme.english}</small></span>{selected===theme.id&&<i><Check size={15}/></i>}</button>)}</div></TabsContent>)}
     {target?.scope!=='default'&&<button className={`city-theme-inherit ${selected===null?'is-selected':''}`} disabled={saving||busy} aria-pressed={selected===null} onClick={()=>setSelected(null)}><RotateCcw size={16}/><span>{target?.scope==='project'?'프로젝트 화면 테마 따르기':'기본 테마 따르기'}<small>현재 {illustrationTheme(inherited).name}</small></span>{selected===null&&<Check size={17}/>}</button>}
    </div>
    </Tabs>
    <div className="city-theme-footer"><p><strong>{preview.name}{selected===null?' · 기본 설정':''}</strong><span>{target?.scope==='default'?'별도 테마를 지정하지 않은 화면에 적용':target?.scope==='project'?'이 프로젝트의 홈·목록·상세 표지에 적용':'현재 화면에만 적용'}</span><small>{demo?'체험 중에는 저장되지 않습니다.':'계정에 저장 · 다른 기기에서도 유지'}</small></p><button className="primary-button" disabled={saving||busy} onClick={()=>void save()}>{saving?'저장 중…':'테마 적용'}<Check size={17}/></button></div>
   </DialogContent>
  </Dialog>
 </CityContext.Provider>;
}

export function CityThemeButton({project}:{project?:{id:string;name:string}}){
 const {open,theme,disabled}=useCityThemes();
 return <button type="button" className={project?'project-city-button':'city-theme-trigger'} disabled={disabled} aria-label={project?'프로젝트 테마 설정':'화면 테마 설정'} onClick={()=>open(project?{scope:'project',id:project.id,title:project.name}:undefined)}><Palette size={18}/><span>{project?'표지 테마':theme.name}</span></button>;
}
export function CityScreenBanner({compact=false}:{compact?:boolean}){
 const {theme,open}=useCityThemes();
 return <section className={`city-screen-banner ${compact?'is-compact':''}`} aria-label={`${theme.name} 테마`}><img src={theme.image} width="1600" height="1194" alt=""/><div><span>{theme.collection==='worlds'?'A WORLD AT YOUR OWN PACE':'YOUR EVERYDAY, SOMEWHERE NEW'}</span><strong>{theme.english}</strong><p>{theme.name} · {theme.landmarks}</p></div><button onClick={()=>open()} aria-label="이 화면 테마 변경"><Palette size={17}/><span>테마 변경</span></button></section>;
}
