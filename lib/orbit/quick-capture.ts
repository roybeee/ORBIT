import {addDays,weekday} from './dates.ts';
import {automaticProject} from './classify.ts';
import type {Note,Project,Task,WorkspaceData} from './model.ts';
import type {WorkspaceAction} from './validation.ts';

// 빠른 기록: one text box that becomes a memo, a meeting note, a task or a calendar event.
// Reading is deterministic and local so the sheet reacts while typing and saves without a
// round-trip; the owner can override the guessed kind with one tap before saving.

export type CaptureKind = 'note' | 'meeting' | 'task' | 'event';
export const captureKindLabel: Record<CaptureKind, string> = {note:'메모',meeting:'회의록',task:'할 일',event:'일정'};
export const CAPTURE_INBOX_ID = 'capture-inbox';
export const CAPTURE_TAG = '빠른 기록';

export interface CaptureContext {
  today: string;
  projects: Project[];
  tasks?: Task[];
  notes?: Note[];
}
export interface CaptureReading {
  kind: CaptureKind;
  // True when the text named the kind itself (할 일:, 일정:, 메모:, 회의:, - [ ]).
  explicit: boolean;
  title: string;
  body: string;
  date?: string;
  start?: number;
  minutes?: number;
  project?: { projectId: string; matched: string[] };
}

const WEEKDAYS = '일월화수목금토';
const MEETING = /(미팅|회의|면담|인터뷰|meeting|미팅록|상담)/i;
const PHONE = /(통화|전화|콜(?![가-힣])|\bcall\b)/i;
// A first line that ends in an action verb reads as a to-do.
const TASK_END = /(하기|해야\s*(함|해|된다|됨|지)?|할\s*것|할것|보내기|드리기|받기|연락(하기)?|요청(하기)?|제출(하기)?|준비(하기)?|확인(하기)?|예약(하기)?|작성(하기)?|정리(하기)?|검토(하기)?|전달(하기)?|공유(하기)?|체크(하기)?|주문(하기)?|결제(하기)?|사기|만들기|올리기|보기)\s*[.!~]*$/;
const PREFIX = /^\s*(?:(할\s*일|투두|todo|할일)|(일정|약속|캘린더)|(메모|노트|memo|note)|(회의록?|미팅(?:록)?))\s*[:：]\s*/i;
const CHECKBOX = /^\s*[-*]?\s*\[\s?\]\s*/;

type Span = { index: number; length: number };
interface DateHit extends Span { date: string }
interface TimeHit extends Span { start: number; end?: number }

function pad(n: number) { return String(n).padStart(2, '0'); }
function validDay(year: number, month: number, day: number) {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function findDate(text: string, today: string): DateHit | undefined {
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  const hits: DateHit[] = [];
  const add = (m: RegExpExecArray | null, date: string | undefined) => { if (m && date) hits.push({ index: m.index, length: m[0].length, date }); };
  const relative: [RegExp, number][] = [[/(오늘|금일)/, 0], [/(내일\s*모레|모레)/, 2], [/내일(?!\s*모레)/, 1], [/글피/, 3], [/어제/, -1]];
  for (const [pattern, days] of relative) add(pattern.exec(text), addDays(today, days));
  const week = /(이번\s*주|금주|다음\s*주|담주|차주|다다음\s*주)?\s*([월화수목금토일])요일/.exec(text);
  if (week) {
    const target = WEEKDAYS.indexOf(week[2]);
    const scope = week[1]?.replace(/\s/g, '');
    const monday = addDays(today, -((weekday(today) + 6) % 7));
    const offset = (target + 6) % 7;
    let date: string;
    if (!scope) {
      const ahead = (target - weekday(today) + 7) % 7;
      date = addDays(today, ahead);
    } else date = addDays(monday, offset + (scope === '다다음주' ? 14 : scope === '이번주' || scope === '금주' ? 0 : 7));
    add(week, date);
  } else {
    const nextWeek = /(다음\s*주|담주|차주)(?!\s*[월화수목금토일])/.exec(text);
    if (nextWeek) add(nextWeek, addDays(addDays(today, -((weekday(today) + 6) % 7)), 7));
    const weekend = /(이번\s*)?주말/.exec(text);
    if (weekend) add(weekend, addDays(today, (6 - weekday(today) + 7) % 7));
  }
  const full = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(text);
  const slash = /(?<![\d.])(\d{1,2})[/.](\d{1,2})(?![\d.]|\s*(?:배|%|퍼))/.exec(text);
  for (const m of [full, slash]) {
    if (!m) continue;
    const mo = Number(m[1]), da = Number(m[2]);
    if (mo < 1 || mo > 12 || !validDay(year, mo, da)) continue;
    let date = `${year}-${pad(mo)}-${pad(da)}`;
    // A month-day well in the past means next year (a deadline in January written in December).
    if (date < addDays(today, -60) && validDay(year + 1, mo, da)) date = `${year + 1}-${pad(mo)}-${pad(da)}`;
    add(m, date);
  }
  if (!full) {
    const day = /(?<![\d월/.])(\d{1,2})\s*일(?!\s*(?:동안|간|째|정도|치|분))/.exec(text);
    if (day) {
      const da = Number(day[1]);
      let y = year, mo = month;
      if (validDay(y, mo, da) && `${y}-${pad(mo)}-${pad(da)}` < today) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
      if (validDay(y, mo, da)) add(day, `${y}-${pad(mo)}-${pad(da)}`);
    }
  }
  return hits.sort((a, b) => a.index - b.index)[0];
}

const MERIDIEM = '(오전|오후|아침|낮|점심|저녁|밤|새벽|am|pm)';
function hour24(hour: number, meridiem: string | undefined) {
  const m = meridiem?.toLowerCase();
  if (m && /오후|저녁|밤|pm/.test(m)) return hour < 12 ? hour + 12 : hour;
  if (m === '낮' || m === '점심') return hour < 6 ? hour + 12 : hour;
  if (m && /오전|아침|새벽|am/.test(m)) return hour === 12 ? 0 : hour;
  // Without a meridiem a bare 1–7 o'clock is a working-hours afternoon ("3시 미팅").
  return hour >= 1 && hour <= 7 ? hour + 12 : hour;
}
const CLOCK = `${MERIDIEM}?\\s*(\\d{1,2})(?:\\s*시(?!간)\\s*(?:(\\d{1,2})\\s*분|(반))?|:(\\d{2}))`;
export function findTime(text: string): TimeHit | undefined {
  const pattern = new RegExp(`${CLOCK}(?:\\s*(?:~|-|–|부터|에서)\\s*${CLOCK}(?:\\s*까지)?)?`, 'i');
  const m = pattern.exec(text);
  if (!m) return undefined;
  const lead = m[0].length - m[0].trimStart().length;
  const read = (meridiem: string | undefined, h: string, min: string | undefined, half: string | undefined, colon: string | undefined, inherit?: string) => {
    const hour = Number(h), minute = Number(colon ?? min ?? (half ? 30 : 0));
    if (hour > 24 || minute > 59) return undefined;
    // 15:00 style needs no meridiem guess.
    const value = colon !== undefined || hour >= 13 ? hour : hour24(hour, meridiem ?? inherit);
    return value * 60 + minute;
  };
  const start = read(m[1], m[2], m[3], m[4], m[5]);
  if (start === undefined || start >= 1440) return undefined;
  let end = m[7] !== undefined ? read(m[6], m[7], m[8], m[9], m[10], m[1]) : undefined;
  if (end !== undefined && end <= start && end + 720 <= 1440 && end + 720 > start) end += 720;
  if (end !== undefined && (end <= start || end > 1440)) end = undefined;
  return { index: m.index + lead, length: m[0].trim().length, start, end };
}

export function findMinutes(text: string): number | undefined {
  const hours = /(\d{1,2})\s*시간(\s*반)?(?:\s*(\d{1,2})\s*분)?/.exec(text);
  if (hours) return Number(hours[1]) * 60 + (hours[2] ? 30 : Number(hours[3] ?? 0));
  const minutes = /(?<!시\s*)(?<!\d)(\d{1,3})\s*분\s*(?:간|동안|짜리)?/.exec(text);
  return minutes ? Number(minutes[1]) : undefined;
}

function strip(line: string, spans: Span[]) {
  // Blank every covered character first so overlapping spans cannot shift each other.
  // Spans are UTF-16 offsets from RegExp, so split into code units (not code points).
  const chars = line.split('');
  for (const s of spans) {
    // A particle glued to the removed date or time ("금요일까지", "3시에") goes with it.
    const glued = /^(?:까지|에는|에|부터|엔|쯤)/.exec(line.slice(s.index + s.length))?.[0].length ?? 0;
    for (let i = s.index; i < s.index + s.length + glued && i < chars.length; i++) chars[i] = ' ';
  }
  const out = chars.join('');
  return out
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:에는|에|부터|까지|엔|,|·|-)\s+/, '')
    .replace(/^(?:에는|에|까지)\s*(?=\S)/, '')
    .replace(/\s+(?:에|에는|까지)$/, '')
    .trim();
}

function shorten(text: string, max = 60) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + '…';
}

export function readCapture(raw: string, ctx: CaptureContext): CaptureReading {
  let text = raw.replace(/\r\n?/g, '\n').trim();
  let kind: CaptureKind | undefined;
  const prefix = PREFIX.exec(text);
  if (prefix) {
    kind = prefix[1] ? 'task' : prefix[2] ? 'event' : prefix[3] ? 'note' : 'meeting';
    text = text.slice(prefix[0].length).trim();
  } else if (CHECKBOX.test(text)) {
    kind = 'task';
    text = text.replace(CHECKBOX, '').trim();
  }
  const explicit = !!kind;
  const lines = text.split('\n');
  const first = lines[0] ?? '';
  const rest = lines.slice(1).join('\n').trim();
  const dateHit = findDate(first, ctx.today);
  const timeHit = findTime(dateHit ? first.slice(0, dateHit.index) + ' '.repeat(dateHit.length) + first.slice(dateHit.index + dateHit.length) : first);
  const spans: Span[] = [dateHit, timeHit].filter((x): x is DateHit | TimeHit => !!x);
  const withoutWhen = strip(first, spans);
  const minutes = findMinutes(withoutWhen);
  const multiline = lines.filter(l => l.trim()).length >= 3 || text.length > 280;
  if (!kind) {
    if (timeHit && !multiline) kind = 'event';
    else if (!multiline && (TASK_END.test(first.trim()) || /까지/.test(first) || (dateHit && !MEETING.test(first)))) kind = 'task';
    else if (MEETING.test(first) && (multiline || rest)) kind = 'meeting';
    else kind = 'note';
  }
  const durationSpan = minutes !== undefined ? /(\d{1,2}\s*시간(\s*반)?(\s*\d{1,2}\s*분)?|\d{1,3}\s*분\s*(간|동안|짜리)?)/.exec(withoutWhen) : null;
  const actionTitle = durationSpan ? strip(withoutWhen, [{ index: durationSpan.index, length: durationSpan[0].length }]) : withoutWhen;
  let title: string;
  if (kind === 'task' || kind === 'event') title = shorten(actionTitle || first || text, 120);
  else title = shorten(first || text, 60);
  if (!title) title = kind === 'event' ? '새 일정' : kind === 'task' ? '새 할 일' : '빠른 메모';
  const body = kind === 'task' || kind === 'event' ? rest : text;
  const project = automaticProject(text, ctx.projects, ctx.tasks ?? [], ctx.notes ?? []);
  return {
    kind,
    explicit,
    title,
    body,
    date: dateHit?.date,
    start: timeHit?.start,
    minutes: timeHit?.end !== undefined ? timeHit.end - timeHit.start : minutes,
    project: project ? { projectId: project.projectId, matched: project.matched } : undefined,
  };
}

export function captureInboxProject(today: string): Project {
  return { id: CAPTURE_INBOX_ID, name: '빠른 기록함', goal: '빠르게 적은 메모와 할 일. 프로젝트가 정해지면 옮깁니다.', color: '#8a94a6', symbol: '✎', due: addDays(today, 365), priority: 1, keywords: [] };
}

const clampMinutes = (value: number | undefined, fallback: number, low: number, high: number) =>
  Math.min(high, Math.max(low, Math.round((value ?? fallback) / 5) * 5 || fallback));

// The one command the sheet sends. Notes and tasks without a confident project go to
// 빠른 기록함 in the same command, so the save never waits on a separate project write.
export function captureAction(reading: CaptureReading, kind: CaptureKind, input: { id: string; today: string; data: Pick<WorkspaceData, 'projects'>; nowMinute?: number }): WorkspaceAction {
  const { id, today, data } = input;
  const projectId = reading.project?.projectId && data.projects.some(p => p.id === reading.project!.projectId) ? reading.project.projectId : undefined;
  const inbox = projectId ? undefined : data.projects.find(p => p.id === CAPTURE_INBOX_ID) ?? captureInboxProject(today);
  const tags = (base: string) => [base, CAPTURE_TAG];
  if (kind === 'event') {
    const fallbackStart = Math.min(1380, Math.ceil(((input.nowMinute ?? 540) + 1) / 30) * 30);
    const start = Math.min(1435, reading.start ?? fallbackStart);
    const minutes = Math.min(1440 - start, clampMinutes(reading.minutes, 60, 5, 720));
    const category = PHONE.test(reading.title) ? 'phone' : MEETING.test(reading.title) ? 'meeting' : 'work';
    return {
      type: 'event.upsert',
      event: {
        id, title: reading.title, date: reading.date ?? today, start, end: start + minutes, kind: 'meeting',
        description: reading.body || undefined, scope: 'work', category,
        ...(projectId ? { projectId } : {}), projectAutoLink: !projectId,
      },
    };
  }
  if (kind === 'task') {
    return {
      type: 'task.upsert',
      ...(inbox && !data.projects.some(p => p.id === inbox.id) ? { project: inbox } : {}),
      autoAssign: !projectId,
      task: {
        id, title: reading.title, projectId: projectId ?? inbox!.id, status: 'todo',
        duration: clampMinutes(reading.minutes, 30, 5, 480), due: reading.date && reading.date >= today ? reading.date : today,
        impact: 3, focus: false, definition: reading.body.slice(0, 4000) || '결과물을 확인하고 완료 처리',
        category: PHONE.test(reading.title) ? 'phone' : 'work', scope: 'work',
      },
    };
  }
  const body = reading.body.slice(0, 100000);
  return {
    type: 'note.upsert',
    ...(inbox && !data.projects.some(p => p.id === inbox.id) ? { project: inbox } : {}),
    note: {
      id, title: reading.title, kind: kind === 'meeting' ? 'meeting' : 'wiki', projectId: projectId ?? inbox!.id,
      summary: body.replace(/\s+/g, ' ').slice(0, 95), body, tags: tags(kind === 'meeting' ? '회의록' : '개인 기록'), updated: reading.date && reading.date <= today ? reading.date : today,
    },
  };
}

// Action lines inside a meeting note or memo ("- 샘플 금요일까지 발송", "→ 견적서 회신하기",
// "TODO: 계약서 검토"). Offered in the sheet so the follow-ups are registered with the note in
// one save, linked to it, instead of being re-typed or waiting for a separate review.
export interface CaptureFollowUp { line: number; title: string; date?: string; minutes?: number }
const BULLET = /^\s*(?:[-*•·]|→|->|=>|\d+[.)]|\[\s?\])\s*/;
const ACTION_PREFIX = /^\s*(?:할\s*일|todo|액션|action|to\s*do)\s*[:：]\s*/i;
export function captureFollowUps(text: string, today: string): CaptureFollowUp[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: CaptureFollowUp[] = [];
  for (let i = 1; i < lines.length && out.length < 8; i++) {
    const raw = lines[i];
    const prefixed = ACTION_PREFIX.test(raw) || /^\s*[-*]?\s*\[\s?\]/.test(raw) || /^\s*(?:→|->|=>)/.test(raw);
    const line = raw.replace(ACTION_PREFIX, '').replace(BULLET, '').trim();
    if (line.length < 3 || line.length > 120) continue;
    const date = findDate(line, today);
    const actionable = prefixed || TASK_END.test(line) || (/까지/.test(line) && !!date);
    if (!actionable) continue;
    const minutes = findMinutes(line);
    const title = strip(line, date ? [date] : []).replace(/^까지\s*/, '').trim() || line;
    out.push({ line: i + 1, title: shorten(title, 120), date: date?.date, minutes });
  }
  return out;
}
// One task per chosen follow-up, linked to the note and its project.
export function followUpAction(item: CaptureFollowUp, input: { id: string; noteId: string; noteTitle: string; projectId: string; today: string }): WorkspaceAction {
  return {
    type: 'task.upsert',
    task: {
      id: input.id, title: item.title, projectId: input.projectId, status: 'todo',
      duration: clampMinutes(item.minutes, 30, 5, 480), due: item.date && item.date >= input.today ? item.date : input.today,
      impact: 3, focus: false, definition: `‘${input.noteTitle.slice(0, 80)}’에서 정한 후속 조치`, noteId: input.noteId,
      category: PHONE.test(item.title) ? 'phone' : 'work', scope: 'work',
    },
  };
}
