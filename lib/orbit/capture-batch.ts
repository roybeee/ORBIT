import {findDate, findTime, readCapture, shorten, strip, TASK_END, type CaptureContext, type CaptureKind, type CaptureReading} from './quick-capture.ts';

// 여러 건 빠른 기록: one spoken (or typed) stream of several things becomes several records,
// each with a short calendar-friendly title and its own kind. The split and titles here are
// deterministic and local; when the server's model is available it refines them
// (organizedItems), and dates and times are always read locally from each item's own words.

export interface BatchItem {
  // The words of this item as said or typed; kept as the record's body so nothing is lost.
  source: string;
  kind: CaptureKind;
  title: string;
  reading: CaptureReading;
}

const KINDS: readonly CaptureKind[] = ['note', 'meeting', 'task', 'event'];

// Spoken connectives that start a new item, and clause endings that close one.
const CONNECTIVE = /(?:^|\s|,)(?:그리고\s*또|그리고|그\s*다음(?:에|으로)?|그다음(?:에|으로)?|또한|또|다음으로|추가로|하나\s*더|마지막으로|(?:첫|두|세|네|다섯)\s*번째(?:로|는)?|첫째|둘째|셋째|넷째)(?=\s|,|$)[\s,]*/g;
const CLAUSE_END = /(?<=(?:해야\s*(?:돼|해|함|한다|된다|됨|지)(?:요)?|돼요?|있어요?|있음|있고|있구요|하고요?|할게요?|할\s*거야|예정(?:이야|이에요|임|입니다)?|거든요?|입니다|합니다|해\s*줘|해\s*줘요|해\s*둬|잡혀\s*있어요?))\s+(?=\S)/g;
const PUNCT = /[.!?。]+(?=\s|$)|\n+/g;
const BULLET_LINE = /^\s*(?:[-*•·]|→|->|=>|\d+[.)]|\[\s?\])\s*/;

// Words a speaker says while thinking; they never belong in a title.
const LEADING_FILLER = /^(?:음+|어+|아+|에+|으+|그+|저기|저|이제|일단|그러니까|그니까|뭐|좀|그리고|또|아\s*참|맞다|참|이번에(?!\s*(?:주|달)))(?:\s+|[,.]\s*)/;
const INNER_FILLER = /(?<=\s|^)(?:좀|약간|그냥|일단|이제|진짜|되게|혹시|음+|어+)(?=\s)/g;
const SUBJECT = /^(?:내가|제가|나는|저는|우리가|저희가|우리|저희)\s+/;
const REQUEST_TAIL = /\s*(?:(?:을|를)\s*)?(?:메모|기록|등록|저장|추가)\s*(?:해|해서|하고)?\s*(?:줘|줘요|둬|둬요|놔|놔줘|주세요|줄래|하자|해)?\s*$/;
const FORGET_TAIL = /\s*(?:하는\s*(?:거|것)\s*)?잊지\s*말(?:고|자|기|아야지)?\s*$/;
const EXIST_TAIL = /\s*(?:이|가)?\s*(?:잡혀\s*)?(?:있어요|있어|있음|있고|있구요|있다|있대|있습니다|있대요)\s*$/;
const COPULA_TAIL = /(?:이야|이에요|입니다|예요|이다|이고|이요)\s*$/;
const PARTICLE_TAIL = /(?<=[가-힣]{2})(?:을|를|은|는|이|가|에|도|랑|하고)\s*$/;

// Hangul syllable helpers to turn "보내야 돼" into "보내기" and "드려야" into "드리기".
const BASE = 0xac00;
const vowelOf = (ch: string) => ((ch.charCodeAt(0) - BASE) % 588) / 28 | 0;
const finalOf = (ch: string) => (ch.charCodeAt(0) - BASE) % 28;
const isHangul = (ch: string | undefined) => !!ch && ch.charCodeAt(0) >= BASE && ch.charCodeAt(0) <= 0xd7a3;
const withVowel = (ch: string, vowel: number) => String.fromCharCode(BASE + ((ch.charCodeAt(0) - BASE) / 588 | 0) * 588 + vowel * 28);
// Vowel indexes: ㅏ0 ㅐ1 ㅓ4 ㅔ5 ㅕ6 ㅗ8 ㅘ9 ㅜ13 ㅝ14 ㅡ18 ㅣ20
function verbStem(word: string): string {
  if (word.endsWith('해')) return word.slice(0, -1) + '하';
  if (word.endsWith('돼')) return word.slice(0, -1) + '되';
  const last = word.at(-1)!, before = word.at(-2);
  if (!isHangul(last)) return word;
  // 받아 → 받, 읽어 → 읽: a bare 아/어 after a closed syllable is the ending, not the stem.
  if ((last === '아' || last === '어') && isHangul(before) && finalOf(before!) !== 0) return word.slice(0, -1);
  if (finalOf(last) !== 0) return word;
  const v = vowelOf(last);
  if (v === 6) return word.slice(0, -1) + withVowel(last, 20); // 드려 → 드리
  if (v === 9) return word.slice(0, -1) + withVowel(last, 8); // 봐 → 보
  if (v === 14) return word.slice(0, -1) + withVowel(last, 13); // 줘 → 주
  return word;
}

// "IR 덱 보내야 돼" → "IR 덱 보내기"; "정리해야 할 것 같아" → "정리하기"; "연락할 거야" → "연락하기".
function nounForm(text: string): string {
  const must = /(\S+?)야\s*(?:돼요?|되요?|해요?|함|한다|된다|됨|지|할\s*것\s*같아요?|될\s*것\s*같아요?|하는데|겠다|겠어)\s*$/.exec(text) ?? /(\S+?[해아어여워와])야\s*$/.exec(text);
  if (must && isHangul(must[1].at(-1))) return text.slice(0, must.index) + verbStem(must[1]) + '기';
  const plan = /(\S+?)할\s*(?:거야|거예요|거임|게요?|예정(?:이야|이에요|임)?)\s*$|(\S+?)(?:하려고|하자|해야지|할게요?)\s*$/.exec(text);
  if (plan) return text.slice(0, plan.index) + (plan[1] ?? plan[2]) + '하기';
  const ask = /(\S+?)(?:해\s*줘요?|해\s*주세요)\s*$/.exec(text);
  if (ask) return text.slice(0, ask.index) + ask[1] + '하기';
  return text;
}

// A short, calendar-friendly title from what was said: fillers, the when, and the
// "please note this" phrasing go; an obligation reads as an action ("~하기").
export function spokenTitle(source: string, today: string, max = 40): string {
  const date = findDate(source, today);
  const masked = date ? source.slice(0, date.index) + ' '.repeat(date.length) + source.slice(date.index + date.length) : source;
  const time = findTime(masked);
  let text = strip(source.replace(/\n+/g, ' '), [date, time].filter((x): x is NonNullable<typeof x> => !!x));
  for (let i = 0; i < 4 && LEADING_FILLER.test(text); i++) text = text.replace(LEADING_FILLER, '');
  text = text.replace(INNER_FILLER, ' ').replace(SUBJECT, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    const before = text;
    text = text.replace(REQUEST_TAIL, '').replace(FORGET_TAIL, '').replace(EXIST_TAIL, '').trim();
    text = nounForm(text).replace(COPULA_TAIL, '').replace(/[,.!?~\s]+$/, '').trim();
    if (text === before) break;
  }
  text = text.replace(PARTICLE_TAIL, '').replace(/^(?:에|에는|까지|부터|은|는)\s+/, '').trim();
  return shorten(text, max);
}

// Spoken hints for the kind of one item, on top of readCapture's reading.
function spokenKind(source: string, reading: CaptureReading): CaptureKind {
  if (reading.explicit) return reading.kind;
  if (/(?:메모|기록)\s*(?:해|해서|하고)?\s*(?:줘|둬|놔|주세요|하자)|아이디어|생각(?:해\s*보|난\s*거)/.test(source) && reading.start === undefined) return 'note';
  if (/회의록|미팅\s*(?:내용|정리)/.test(source)) return 'meeting';
  if (reading.start !== undefined) return 'event';
  if (/(?:일정|약속)\s*(?:잡아|넣어|등록)/.test(source)) return 'event';
  if (reading.kind === 'note' && (/해야|까지|하기\b/.test(source) || TASK_END.test(nounForm(source.trim())))) return 'task';
  return reading.kind;
}

function itemFrom(source: string, ctx: CaptureContext, kind?: CaptureKind, title?: string): BatchItem {
  const reading = readCapture(source, ctx);
  const chosen = kind ?? spokenKind(source, reading);
  const named = title?.trim() || spokenTitle(source, ctx.today) || reading.title;
  return { source, kind: chosen, title: named, reading: { ...reading, kind: chosen, title: named, body: source } };
}

const signal = (segment: string, today: string) => {
  const reading = readCapture(segment, { today, projects: [] });
  return reading.explicit || reading.start !== undefined || !!findDate(segment, today) || /해야|까지|(?:메모|기록|등록)\s*(?:해|해서)?\s*(?:줘|둬)/.test(segment) || TASK_END.test(nounForm(segment.trim())) || reading.kind === 'event';
};

// Where one stream of speech (or several plain lines) holds more than one thing.
// Bulleted lines stay with their heading (a meeting note and its follow-ups), and a
// split is only offered when at least two pieces each name a time, a deadline or an action.
export function splitCapture(raw: string, today: string): string[] {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.slice(1).some(l => BULLET_LINE.test(l))) return [text];
  const pieces = text
    .replace(PUNCT, '\u0000')
    .replace(CONNECTIVE, '\u0000')
    .replace(CLAUSE_END, '\u0000')
    .split('\u0000')
    .map(p => p.replace(/^[\s,]+|[\s,]+$/g, ''))
    .filter(Boolean);
  // A fragment too short to stand alone ("응", "네") rides with the piece before it.
  const merged: string[] = [];
  for (const piece of pieces) {
    const meaningful = piece.replace(LEADING_FILLER, '').replace(/[^가-힣a-zA-Z0-9]/g, '').length >= 3;
    if (!meaningful && merged.length) merged[merged.length - 1] += ' ' + piece;
    else if (!meaningful) continue;
    else merged.push(piece);
  }
  if (merged.length < 2 || merged.filter(p => signal(p, today)).length < 2) return [text];
  return merged.slice(0, 12);
}

export function batchItems(raw: string, ctx: CaptureContext): BatchItem[] {
  return splitCapture(raw, ctx.today).map(source => itemFrom(source, ctx));
}

// The model's answer, checked: known kinds, short titles, and each item's own words (source)
// so dates and times are read locally. Anything malformed means the local reading stands.
export function organizedItems(answer: unknown, raw: string, ctx: CaptureContext): BatchItem[] | null {
  const items = (answer as { items?: unknown })?.items;
  if (!Array.isArray(items) || !items.length || items.length > 12) return null;
  const out: BatchItem[] = [];
  for (const entry of items) {
    const item = entry as { kind?: unknown; title?: unknown; source?: unknown };
    if (typeof item.title !== 'string' || typeof item.source !== 'string') return null;
    const kind = KINDS.includes(item.kind as CaptureKind) ? item.kind as CaptureKind : undefined;
    const title = item.title.replace(/\s+/g, ' ').trim().slice(0, 80);
    const source = item.source.replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!title || !source) return null;
    out.push(itemFrom(source, ctx, kind, shorten(title, 60)));
  }
  // An answer that dropped most of what was said is not a summary of it.
  const said = raw.replace(/\s+/g, '').length, kept = out.reduce((n, i) => n + i.source.replace(/\s+/g, '').length, 0);
  if (said && kept < said * 0.5) return null;
  return out;
}

export const ORGANIZE_INSTRUCTIONS = [
  '너는 한국어로 말하거나 적은 메모를 기록 단위로 나누는 정리 도우미다.',
  '입력에 서로 다른 일이 여러 개 있으면 항목을 나누고, 하나뿐이면 항목 1개만 만든다. 최대 12개.',
  '각 항목: kind는 event(시간이 있는 약속·미팅·일정), task(해야 할 일·마감), note(아이디어·참고 메모), meeting(이미 한 회의의 내용) 중 하나.',
  'title은 캘린더와 목록에서 한눈에 알아볼 수 있는 25자 이내의 명사형 요약이다. 날짜·시간·"메모해 줘" 같은 요청 표현·말버릇은 넣지 않는다. 예: "금요일까지 IR 덱 수정본 보내야 돼" → "IR 덱 수정본 보내기".',
  'source는 그 항목에 해당하는 입력 원문 구간을 그대로 옮긴다(날짜·시간 표현 포함, 고치거나 요약하지 않는다).',
  '없는 사실을 만들지 않는다. 반환 형식: {"items":[{"kind":"task","title":"...","source":"..."}]}',
].join('\n');
