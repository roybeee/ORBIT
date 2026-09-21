'use client';
import {calendarCategories,categoryLabels,categoryColor,calendarPalette} from '@/lib/orbit/calendar-categories';
import type {Preferences} from '@/lib/orbit/model';

export function CalendarColors({preferences,disabled,onSave}:{preferences:Preferences;disabled:boolean;onSave:(p:Preferences)=>void}){
 return <details className="calendar-color-settings">
  <summary>일정·할 일 색상</summary>
  <p className="form-hint">색상 변경은 Google Calendar에도 반영됩니다. 개별 지정 색상이 우선 적용됩니다.</p>
  <div className="calendar-color-groups">{(['event','task'] as const).map(kind=>
   <fieldset key={kind} disabled={disabled}>
    <legend>{kind==='event'?'일정':'할 일'}</legend>
    {calendarCategories.map(category=>{
     const color=categoryColor(category,preferences,kind);
     return <label key={category}>
      <span className="category-swatch" style={{background:color}} aria-hidden="true"/>
      <span>{categoryLabels[category]}</span>
      <select aria-label={`${kind==='event'?'일정':'할 일'} ${categoryLabels[category]} 색상`} value={color} onChange={e=>{
       // Preserve inherited task colors when editing an event palette independently.
       const taskCategoryColors=Object.fromEntries(calendarCategories.map(c=>[c,categoryColor(c,preferences,'task')]));
       onSave(kind==='task'?{...preferences,taskCategoryColors:{...taskCategoryColors,[category]:e.target.value}}:{...preferences,taskCategoryColors,categoryColors:{...preferences.categoryColors,[category]:e.target.value}});
      }}>{calendarPalette.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
     </label>;
    })}
   </fieldset>
  )}</div>
 </details>;
}
