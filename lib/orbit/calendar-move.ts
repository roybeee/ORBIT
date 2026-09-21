import type { CalendarEvent } from './model';

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

export function moveConflict(event: CalendarEvent, events: CalendarEvent[]): CalendarEvent | undefined {
  return events.find(other => !other.id.startsWith('task-due:') && other.id !== event.id && other.google?.orbitEventId !== event.id &&
    other.date === event.date && other.start < event.end && other.end > event.start);
}

// Google metadata belongs to imported records, not the strict workspace command schema.
export function eventCommand(event: CalendarEvent) {
  const { id, title, date, start, end, kind, projectId, taskId, category, color, description, scope, projectAutoLink, projectLink } = event;
  return { type: 'event.upsert' as const, event: { id, title, date, start, end, kind, projectId, taskId, category, color, description, scope, projectAutoLink, projectLink } };
}
