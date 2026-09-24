'use client';
import {Moon,Sun,Sunrise} from 'lucide-react';
import {dayModeLabels,type DayMode} from '@/lib/orbit/day-mode';

const icons={morning:Sunrise,day:Sun,evening:Moon} as const;

// Shows which part of the day the 오늘 tab follows, and lets the owner look ahead (e.g. review early).
export function DayModeSwitch({mode,now,onChange}:{mode:DayMode;now:DayMode;onChange:(mode:DayMode)=>void}){
 return <div className="day-mode-switch" role="group" aria-label="오늘 화면의 시간대">
  {(Object.keys(dayModeLabels) as DayMode[]).map(id=>{const Icon=icons[id];const on=id===mode;return <button key={id} type="button" aria-pressed={on} className={on?'is-selected':''} onClick={()=>onChange(id)}><Icon size={15} aria-hidden="true"/>{dayModeLabels[id]}{id===now&&<small> 지금</small>}</button>;})}
 </div>;
}
