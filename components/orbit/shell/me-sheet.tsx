'use client';
import {ChevronRight,Clock3,Link2,Settings2,Smartphone} from 'lucide-react';
import type {ReactNode} from 'react';
import {Sheet,SheetContent,SheetDescription,SheetHeader,SheetTitle} from '@/components/ui/sheet';
import type {View} from '@/lib/orbit/model';
import {areas,viewLabels} from '@/lib/orbit/navigation';
import {viewIcons} from './view-icons';

const hints:Partial<Record<View,string>>={automation:'예약 실행 · 승인 · ODA 반영',sound:'몰입·휴식 소리',data:'기록 살펴보기 · 휴지통',backup:'내보내기 · 선택 복원'};

function Row({icon,label,hint,onClick,current,disabled}:{icon:ReactNode;label:string;hint:string;onClick:()=>void;current?:boolean;disabled?:boolean}){
 return <button className="me-row" onClick={onClick} disabled={disabled} aria-current={current?'page':undefined}><span className="me-row-icon">{icon}</span><span className="me-row-text"><strong>{label}</strong><small>{hint}</small></span><ChevronRight size={17} aria-hidden="true"/></button>;
}

// 나: rarely used settings and management, kept out of the daily tabs.
export function MeSheet({open,onOpenChange,displayName,view,demo,loaded,navigate,onSettings,onConnections,onRuntime}:{open:boolean;onOpenChange:(open:boolean)=>void;displayName:string;view:View;demo:boolean;loaded:boolean;navigate:(v:View)=>void;onSettings:()=>void;onConnections:()=>void;onRuntime:()=>void}){
 const views=areas.find(a=>a.id==='me')?.views??[];
 return <Sheet open={open} onOpenChange={onOpenChange}>
  <SheetContent side="right" className="me-sheet">
   <SheetHeader className="me-sheet-header"><span className="avatar" aria-hidden="true">{displayName.slice(0,1)}</span><div><SheetTitle>{displayName}</SheetTitle><SheetDescription>가끔 쓰는 설정과 관리 기능입니다.</SheetDescription></div></SheetHeader>
   <nav className="me-groups" aria-label="나">
    <section><h2>나의 기준</h2>
     <Row icon={<Settings2 size={19}/>} label="업무 시간·계획 기준" hint="BRAINY 리듬 · 핵심 결과물 개수 · 여유 시간" onClick={onSettings}/>
     <Row icon={<Clock3 size={19}/>} label="자동 실행" hint="내일 제안 준비 시각 · 저녁 기준" onClick={onRuntime} disabled={demo||!loaded}/>
     <Row icon={<Link2 size={19}/>} label="계정·연결" hint="Google · Plaud · Hermes · Slack · Discord" onClick={onConnections} disabled={demo||!loaded}/>
    </section>
    <section><h2>관리</h2>
     {views.map(id=>{const Icon=viewIcons[id];return <Row key={id} icon={<Icon size={19}/>} label={viewLabels[id]} hint={hints[id]??''} current={view===id} onClick={()=>navigate(id)}/>;})}
    </section>
    <section><h2>앱</h2>
     <a className="me-row" href="/install"><span className="me-row-icon"><Smartphone size={19}/></span><span className="me-row-text"><strong>기기별 설치 안내</strong><small>Mac · Windows · 휴대폰</small></span><ChevronRight size={17} aria-hidden="true"/></a>
    </section>
   </nav>
  </SheetContent>
 </Sheet>;
}
