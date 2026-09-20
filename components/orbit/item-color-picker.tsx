'use client';
import {Check} from 'lucide-react';
import {calendarPalette} from '@/lib/orbit/calendar-categories';
export function ItemColorPicker({value,onChange,disabled=false,defaultColor,label='색상'}:{value:string|null;onChange:(color:string|null)=>void;disabled?:boolean;defaultColor:string;label?:string}){
 return <fieldset className="item-color-picker" disabled={disabled}><legend>{label}</legend>
  <div role="group" aria-label={label}>
   <button type="button" className="item-color-auto" aria-pressed={!value} onClick={()=>onChange(null)}><span style={{background:defaultColor}} aria-hidden="true"/>자동{!value&&<Check size={16}/>}</button>
   {calendarPalette.map(([color,name])=><button type="button" key={color} className="item-color-choice" aria-label={`${label} ${name}`} aria-pressed={value===color} onClick={()=>onChange(color)}><span style={{background:color}}>{value===color&&<Check size={18}/>}</span></button>)}
  </div>
 </fieldset>;
}
