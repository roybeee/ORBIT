import {todayInZone} from './dates.ts';
import type {CalendarEvent,Preferences,Task,WorkspaceData} from './model';
export const calendarCategories = ['work','meeting','phone','personal','health','learning','rest'] as const;
export type CalendarCategory = typeof calendarCategories[number];
export const categoryLabels:Record<CalendarCategory,string>={work:'업무',meeting:'미팅',phone:'전화',personal:'개인',health:'건강',learning:'학습',rest:'휴식'};
export const categoryDefaults:Record<CalendarCategory,string>={work:'#5484ed',meeting:'#a4bdfc',phone:'#ffb878',personal:'#dbadff',health:'#7ae7bf',learning:'#fbd75b',rest:'#46d6db'};
export const taskCategoryDefaults:Record<CalendarCategory,string>={work:'#7ae7bf',meeting:'#dbadff',phone:'#ffb878',personal:'#ffb878',health:'#46d6db',learning:'#a4bdfc',rest:'#fbd75b'};
export const calendarPalette=[['#5484ed','파랑','9'],['#a4bdfc','연파랑','1'],['#dbadff','보라','3'],['#7ae7bf','초록','2'],['#fbd75b','노랑','5'],['#46d6db','청록','7'],['#ffb878','주황','6'],['#f83a22','빨강','11']] as const;
export function categoryOf(item:Pick<CalendarEvent,'category'|'kind'>|Pick<Task,'category'>):CalendarCategory{return item.category??('kind' in item?(item.kind==='break'?'rest':item.kind==='focus'?'work':'meeting'):'work')}
export function categoryColor(category:CalendarCategory,preferences?:Pick<Preferences,'categoryColors'|'taskCategoryColors'>,kind:'event'|'task'='event'){return (kind==='task'?preferences?.taskCategoryColors?.[category]:undefined)??preferences?.categoryColors?.[category]??(kind==='task'?taskCategoryDefaults:categoryDefaults)[category]}
export function googleCategoryColor(category:CalendarCategory,preferences:Preferences,kind:'event'|'task'='event'){return calendarPalette.find(p=>p[0]===categoryColor(category,preferences,kind))?.[2]??'9'}
export function calendarItemColor(item:{id?:string;color?:string|null;category?:CalendarCategory;kind?:CalendarEvent['kind']},preferences:Preferences|undefined,kind:'event'|'task',linkedTask?:Task){
 return (item.id?preferences?.eventColors?.[item.id]:undefined)??item.color??linkedTask?.color??categoryColor(item.id&&preferences?.eventCategories?.[item.id]||categoryOf(item),preferences,kind);
}
export function googleItemColor(event:CalendarEvent,preferences:Preferences,task?:Task){return calendarPalette.find(p=>p[0]===calendarItemColor(event,preferences,event.taskId?'task':'event',task))?.[2]??'9'}
// Virtual due-date rows never enter the planner's busy intervals or duplicate task records.
export function taskCalendarDate(task:Task,today:string){return task.status==='done'?(task.completedOn??task.due):task.due<today?today:task.due}
export function taskCalendarEvent(task:Task,today=task.due):CalendarEvent{return {id:'task-due:'+task.id,taskId:task.id,projectId:task.projectId,title:(task.status==='done'?'✓ ':'')+task.title,date:taskCalendarDate(task,today),start:0,end:1440,kind:'focus',allDay:true,description:task.description,scope:task.scope,color:task.color,category:categoryOf(task)}}
export function taskCalendarEvents(data:WorkspaceData,today=todayInZone(data.preferences.timeZone)){return data.tasks.filter(task=>task.status!=='waiting').map(task=>taskCalendarEvent(task,today))}
// A task linked to a Google Task already appears in Google Calendar through Google Tasks, so it gets no reminder.
export function taskCalendarSource(task:Task,preferences:Preferences,today=todayInZone(preferences.timeZone)){if(task.googleTask)return 'google-task';const event=taskCalendarEvent(task,today);return JSON.stringify([event.title,event.date,event.category,calendarItemColor(task,preferences,'task'),event.description,event.scope])}
