import type { CalendarEvent } from './model';

export const HOLD_MS = 420;
export const MOVE_SLOP = 9;
export const PIXELS_PER_STEP = 24;
export const STEP_MINUTES = 15;

export function moveRestriction(event: CalendarEvent): string | null {
  if (event.id.startsWith('google:')) return 'Google에서 시간 변경';
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
  return events.find(other => other.id !== event.id && other.google?.orbitEventId !== event.id &&
    other.date === event.date && other.start < event.end && other.end > event.start);
}

// Google metadata belongs to imported records, not the strict workspace command schema.
export function eventCommand(event: CalendarEvent) {
  const { id, title, date, start, end, kind, projectId, taskId } = event;
  return { type: 'event.upsert' as const, event: { id, title, date, start, end, kind, projectId, taskId } };
}
