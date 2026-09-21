import type { CalendarEvent } from './model';
import type { CalendarEdit } from './agent/calendar-edit.ts';
import { addDays, validDate } from './dates.ts';

export const HOLD_MS = 420;
export const MOVE_SLOP = 9;
export const PIXELS_PER_STEP = 24;
export const STEP_MINUTES = 15;
export const SWIPE_ACTION_WIDTH = 144;
export const SWIPE_OPEN_THRESHOLD = 48;

export function canEditCalendarEvent(event: CalendarEvent): boolean {
  return !/^(google:|approved:|protected:|task-due:)/.test(event.id);
}

// Decide once before the hold starts; a vertical or diagonal scroll never becomes a swipe later.
export function calendarGestureIntent(dx: number, dy: number): 'pending' | 'swipe' | 'scroll' {
  if (Math.hypot(dx, dy) <= MOVE_SLOP) return 'pending';
  return Math.abs(dx) > Math.abs(dy) * 1.25 ? 'swipe' : 'scroll';
}

export function swipeOffset(initial: number, dx: number): number {
  return Math.max(-SWIPE_ACTION_WIDTH, Math.min(0, initial + dx));
}

export function moveRestriction(event: CalendarEvent): string | null {
  if (event.id.startsWith('task-due:')) return '할 일에서 날짜 변경';
  if (event.id.startsWith('google:')) return '상세에서 일정 수정';
  if (event.id.startsWith('approved:')) return '내일 제안에서 시간 변경';
  if (event.id.startsWith('protected:')) return '보호 시간 설정에서 변경';
  if (event.start === 0 && event.end === 1440) return '종일 일정';
  return null;
}

export function shiftedEvent(event: CalendarEvent, deltaY: number): CalendarEvent {
  const duration = event.end - event.start;
  const delta = Math.round(deltaY / PIXELS_PER_STEP) * STEP_MINUTES;
  const start = Math.max(0, Math.min(1440 - duration, event.start + delta));
  return { ...event, start, end: start + duration };
}

type WallTime = { date: string; minute: number };
const dayMinute = (date: string, minute: number) => Date.parse(date + 'T00:00:00Z') / 60000 + minute;

function validPostponedStart(date: string, minute: number, now: WallTime) {
  if (!validDate(date) || !Number.isInteger(minute) || minute < 0 || minute > 1439)
    throw new Error('새 시작 날짜와 시간을 확인해 주세요.');
  if (dayMinute(date, minute) < dayMinute(now.date, now.minute))
    throw new Error('과거 시각으로 일정을 미룰 수 없습니다.');
}

export function postponedEvent(event: CalendarEvent, date: string, start: number, now: WallTime): CalendarEvent {
  validPostponedStart(date, start, now);
  const duration = event.end - event.start;
  if (duration <= 0 || start + duration > 1440)
    throw new Error('기존 일정 길이를 유지할 수 있도록 종료 전 시간을 선택해 주세요.');
  return { ...event, date, start, end: start + duration };
}

export function postponedCalendarEdit(edit: CalendarEdit, date: string, start: number, now: WallTime): CalendarEdit {
  // The GET view also carries read-only metadata; PATCH accepts only edit fields.
  const { operationId, id, calendarId, eventId, etag, timeZone, title, startDate, endDate, allDay, start: oldStart, end: oldEnd, description, scope, overlapConfirmation } = edit;
  edit = { operationId, id, calendarId, eventId, etag, timeZone, title, startDate, endDate, allDay, start: oldStart, end: oldEnd, ...(description !== undefined ? { description } : {}), ...(scope !== undefined ? { scope } : {}), ...(overlapConfirmation !== undefined ? { overlapConfirmation } : {}) };
  validPostponedStart(date, edit.allDay ? 0 : start, now);
  if (edit.allDay) {
    const days = Math.round((Date.parse(edit.endDate + 'T00:00:00Z') - Date.parse(edit.startDate + 'T00:00:00Z')) / 86400000) + 1;
    if (days < 1) throw new Error('기존 일정 길이를 확인하지 못했습니다.');
    return { ...edit, startDate: date, endDate: addDays(date, days - 1) };
  }
  const duration = dayMinute(edit.endDate, edit.end) - dayMinute(edit.startDate, edit.start);
  if (duration <= 0) throw new Error('기존 일정 길이를 확인하지 못했습니다.');
  const end = start + duration;
  return { ...edit, startDate: date, endDate: addDays(date, Math.floor(end / 1440)), start, end: end % 1440 };
}

export function moveConflict(event: CalendarEvent, events: CalendarEvent[]): CalendarEvent | undefined {
  return events.find(other => !other.id.startsWith('task-due:') && other.id !== event.id && other.google?.orbitEventId !== event.id &&
    other.date === event.date && other.start < event.end && other.end > event.start);
}

// Google metadata belongs to imported records, not the strict workspace command schema.
export function eventCommand(event: CalendarEvent) {
  const { id, title, date, start, end, kind, projectId, taskId, category, color, description, scope, projectAutoLink, projectLink } = event;
  return { type: 'event.upsert' as const, event: { id, title, date, start, end, kind, projectId, taskId, category, color, description, scope, projectAutoLink, projectLink } };
}
