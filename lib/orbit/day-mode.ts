// Which part of the day the 오늘 tab is in. The evening starts at the same hour the
// server prepares tomorrow's proposal (RuntimeConfig.eveningHour, default 21).
export type DayMode='morning'|'day'|'evening';
export const DEFAULT_EVENING_HOUR=21;
// Until 04:00 a late night still belongs to the evening, not to a new morning.
export const NIGHT_END=4*60;
// The preparation hour can be set as early as 00:00; the 오늘 tab still keeps the day
// usable and switches to the evening no earlier than this.
export const EARLIEST_EVENING=18*60;
export const dayModeLabels:Record<DayMode,string>={morning:'아침',day:'낮',evening:'저녁'};

export function dayMode({minute,workStart,eveningHour}:{minute:number;workStart:number;eveningHour:number}):DayMode{
 const evening=Math.max(eveningHour*60,EARLIEST_EVENING);
 if(minute<NIGHT_END||minute>=evening)return 'evening';
 // The first working hour is for the briefing and approving the plan.
 if(minute<Math.min(workStart+60,evening))return 'morning';
 return 'day';
}
