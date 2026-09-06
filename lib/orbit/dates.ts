export function todayInZone(timeZone='Asia/Seoul',now=new Date()){return new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now)}
export function addDays(date:string,days:number){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
export function weekday(date:string){return new Date(date+'T12:00:00Z').getUTCDay()}
export function weekDates(date:string){const start=addDays(date,-((weekday(date)+6)%7));return Array.from({length:7},(_,i)=>addDays(start,i))}
export function koreanDate(date:string,withWeekday=true){return new Intl.DateTimeFormat('ko-KR',{timeZone:'UTC',month:'long',day:'numeric',...(withWeekday?{weekday:'long' as const}:{})}).format(new Date(date+'T12:00:00Z'))}
export function validDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value}
