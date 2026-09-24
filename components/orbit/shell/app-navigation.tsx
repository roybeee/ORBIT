'use client';
import {Orbit,Search} from 'lucide-react';
import {useEffect,useRef} from 'react';
import {Sidebar,SidebarContent,SidebarFooter,SidebarGroup,SidebarGroupContent,SidebarHeader,SidebarMenu,SidebarMenuButton,SidebarMenuItem,useSidebar} from '@/components/ui/sidebar';
import {Kbd} from '@/components/ui/kbd';
import type {View} from '@/lib/orbit/model';
import {areaOf,badgeText,tabAreas,viewLabels,type Area} from '@/lib/orbit/navigation';
import {OrbitWordmark} from '../brand';
import {areaIcons,viewIcons} from './view-icons';

interface NavProps {view:View;navigate:(v:View)=>void;inboxCount:number;newsUnread:number;displayName:string;onMe:()=>void;onSearch:()=>void}

const tabLabel=(area:Area,count:number,news:number)=>area.id!=='inbox'?area.label:count>0?`${area.label}, 정할 일 ${count}건`:news>0?`${area.label}, 새 소식 있음`:area.label;
// A red count only for decisions; unread news alone shows a quiet dot.
function NavBadge({count,news=0}:{count:number;news?:number}){const text=badgeText(count);return text?<span className="nav-badge" aria-hidden="true">{text}</span>:news>0?<span className="nav-dot" aria-hidden="true"/>:null;}

// Four question tabs (오늘 · 결재함 · 프로젝트 · 기록) around the Orbit button; 나 holds rarely used management.
export function AppNavigation({view,navigate,inboxCount,newsUnread,displayName,onMe,onSearch}:NavProps){
 const {setOpenMobile}=useSidebar();
 const current=areaOf(view).id;
 const go=(v:View)=>{navigate(v);setOpenMobile(false)};
 const [first,second,...rest]=tabAreas;
 const tab=(area:Area)=>{const Icon=areaIcons[area.id];const on=current===area.id;return <button key={area.id} className={on?'active':''} onClick={()=>go(area.views[0])} aria-current={on?'page':undefined} aria-label={tabLabel(area,inboxCount,newsUnread)}><span className="nav-icon"><Icon/>{area.id==='inbox'&&<NavBadge count={inboxCount} news={newsUnread}/>}</span>{area.label}</button>;};
 const orbitOn=current==='orbit';
 return <>
  <Sidebar className="app-sidebar">
   <SidebarHeader className="p-0"><div className="brand"><OrbitWordmark/></div></SidebarHeader>
   <SidebarContent className="gap-0"><SidebarGroup className="px-4 pt-0"><SidebarGroupContent>
    <SidebarMenu>{tabAreas.map(area=>{const Icon=areaIcons[area.id];return <SidebarMenuItem key={area.id}><SidebarMenuButton className="nav-item" isActive={current===area.id} aria-current={current===area.id?'page':undefined} aria-label={tabLabel(area,inboxCount,newsUnread)} onClick={()=>go(area.views[0])}><Icon/><span>{area.label}</span>{area.id==='inbox'&&<NavBadge count={inboxCount} news={newsUnread}/>}</SidebarMenuButton></SidebarMenuItem>;})}</SidebarMenu>
    <div className="sidebar-shell-actions">
     <button className={`sidebar-orbit${orbitOn?' is-active':''}`} onClick={()=>go('agent')} aria-current={orbitOn?'page':undefined}><Orbit size={18}/><span>Orbit에게 묻기</span></button>
     <button className="sidebar-search" onClick={onSearch} aria-haspopup="dialog"><Search size={17}/><span>찾기</span><Kbd>⌘K</Kbd></button>
    </div>
   </SidebarGroupContent></SidebarGroup></SidebarContent>
   <SidebarFooter className="p-0"><button className={`user-box user-box-button${current==='me'?' is-active':''}`} onClick={onMe} aria-haspopup="dialog" aria-label="나 · 설정과 관리 열기"><span className="avatar">{displayName.slice(0,1)}</span><span className="user-box-text"><strong>{displayName}</strong><small>설정 · 연결 · 데이터</small></span></button></SidebarFooter>
  </Sidebar>
  <nav className="mobile-nav orbit-tabbar" aria-label="주요 화면">
   {tab(first)}{tab(second)}
   <button className={`orbit-tab${orbitOn?' active':''}`} onClick={()=>go('agent')} aria-current={orbitOn?'page':undefined}><span className="orbit-orb" aria-hidden="true"><Orbit/></span>Orbit</button>
   {rest.map(tab)}
  </nav>
 </>;
}

// One visible row of screens inside the current area. No dropdowns: every screen is one tap away.
export function AreaSections({view,navigate,inboxCount,newsUnread}:{view:View;navigate:(v:View)=>void;inboxCount:number;newsUnread:number}){
 const area=areaOf(view);
 const track=useRef<HTMLDivElement>(null);
 // Keep the current screen's chip in view when the row scrolls on a phone.
 useEffect(()=>{
  const center=()=>{const row=track.current,chip=row?.querySelector<HTMLElement>('[aria-current="page"]');if(row&&chip)row.scrollLeft=chip.offsetLeft-(row.clientWidth-chip.offsetWidth)/2;};
  const frame=requestAnimationFrame(center);
  void document.fonts?.ready.then(center);
  return()=>cancelAnimationFrame(frame);
 },[view]);
 if(area.views.length<2)return null;
 return <nav className="area-sections" aria-label={`${area.label} 화면`}><div className="area-sections-track" ref={track}>{area.views.map(id=>{const Icon=viewIcons[id];const on=view===id;return <button key={id} className={on?'is-selected':''} aria-current={on?'page':undefined} onClick={()=>navigate(id)}><Icon size={15} aria-hidden="true"/>{viewLabels[id]}{id==='inbox'&&<NavBadge count={inboxCount} news={newsUnread}/>}</button>;})}</div></nav>;
}

export function SearchTrigger({onSearch,open}:{onSearch:()=>void;open:boolean}){
 return <button className="search-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={onSearch}><Search size={19}/><span>찾기</span><Kbd className="search-kbd">⌘K</Kbd></button>;
}

