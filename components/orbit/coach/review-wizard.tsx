'use client';
import { useEffect, useMemo, useState, useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Moon,
  HeartHandshake,
  ClipboardCheck,
  MessageCircleQuestion,
} from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {readDraft,saveDraft,clearDraft} from '@/lib/orbit/device-drafts';
import { agentRequest } from '@/components/orbit/agent/connections';
import { needsFeedback } from '@/lib/orbit/coach';
import { reviewCandidates, reviewReflection, type ReviewCandidate, type ReviewEvidence, type CandidateState, type ReviewReflection } from '@/lib/orbit/review-evidence';
import { habitStreak } from '@/lib/orbit/derived';
import {
  outcomeLabel,
  reasonLabel,
  improvementKindLabel,
  type WorkspaceData,
  type Outcome,
  type OutcomeReason,
  type ImprovementKind,
  type ReviewDetail,
  type Proposal,
} from '@/lib/orbit/model';
type Decision = 'confirmed' | 'pending' | 'accepted' | 'edited' | 'unknown';
interface ItemBase {
  outcome?: Outcome;
  actual: string;
  reason: OutcomeReason;
  decision?: Decision;
  actualSource?: 'timer' | 'record' | 'input';
  actualUnknown?: boolean;
}
interface ItemDraft extends ItemBase {
  taskId: string;
  title: string;
  estimate: number;
  source: string;
  // Evidence-first review: what the records say, kept apart from what the user decided.
  state?: CandidateState;
  suggested?: Outcome;
  suggestedReason?: OutcomeReason;
  basis?: string;
  evidence?: ReviewEvidence[];
  timer?: ReviewCandidate['timer'];
  calendarMinutes?: number;
  editing?: boolean;
  initial?: ItemBase;
}
const baseOf = (i: ItemBase): ItemBase => ({ outcome: i.outcome, actual: i.actual, reason: i.reason, decision: i.decision, actualSource: i.actualSource, actualUnknown: i.actualUnknown });
const changed = (i: ItemDraft) => !!i.initial && JSON.stringify(baseOf(i)) !== JSON.stringify(baseOf(i.initial));
export function fromCandidate(c: ReviewCandidate): ItemDraft {
  const timer = c.timer && c.timer.since > 0 ? String(c.timer.total) : '';
  const base: ItemBase =
    c.state === 'confirmed'
      ? { outcome: c.outcome, reason: c.reason ?? 'other', decision: 'confirmed', actual: c.actual !== undefined ? String(c.actual) : timer, actualSource: c.actual !== undefined ? 'record' : timer ? 'timer' : undefined }
      : { reason: c.reason ?? 'other', decision: 'pending', actual: timer, actualSource: timer ? 'timer' : undefined };
  return {
    ...base,
    taskId: c.taskId,
    title: c.title,
    estimate: c.estimate,
    source: c.source,
    state: c.state,
    ...(c.state === 'suggested' ? { suggested: c.outcome, suggestedReason: c.reason } : {}),
    basis: c.basis,
    evidence: c.evidence,
    timer: c.timer,
    calendarMinutes: c.calendarMinutes,
    initial: base,
  };
}
const untouched = (i: ItemDraft) => !!i.initial && !changed(i);
// Saved-review rows are confirmed results; drafts from before this screen carry no decision yet.
const normalize = (i: ItemDraft): ItemDraft => (i.decision ? i : { ...i, decision: i.outcome ? 'edited' : 'pending' });
interface FeedbackDraft {
  cause: string;
  alternative: string;
  rule: string;
  kind: ImprovementKind;
}
// Shape of the per-device draft persisted while the wizard is open (see saveDraft below).
interface ReviewDraft {
  baseVersion: string;
  items: ItemDraft[];
  feedback: Record<string, FeedbackDraft>;
  dayRule: FeedbackDraft;
  bed: string;
  wake: string;
  exercise: string;
  meals: string;
  mood: string;
  habitChecks: string[];
  energy: Proposal['energy'];
  smallWins: string[];
  gratitude: string[];
  win: string;
  block: string;
  quick?: boolean;
  step?: number;
  savedSleep?: number;
  openedAt?: number;
}
const STEPS = ['오늘 항목 결과', '원인 · 대안 · 규칙', '에너지 · 습관', '내가 해냄 · 감사'] as const;
const toMinutes = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
export { plannedItems } from '@/lib/orbit/review-evidence';
const badgeOf = (i: ItemDraft): [string, string] =>
  i.decision === 'unknown' ? ['아직 모름', 'unknown']
  : i.decision === 'accepted' ? ['추정 → 맞음', 'accepted']
  : i.decision === 'edited' ? ['직접 확인', 'edited']
  : i.decision === 'confirmed' ? ['확정', 'confirmed']
  : i.suggested ? ['추정 · 확인 필요', 'suggested']
  : ['확인 필요', 'open'];
// One result row: record-based basis and source lines, the user's decision, and the measured time.
function CandidateRow({ i, laser, choose, accept, unknown, undo, update, open }: {
  i: ItemDraft; laser: boolean;
  choose: (i: ItemDraft, o: Outcome) => void; accept: (i: ItemDraft) => void; unknown: (i: ItemDraft) => void; undo: (i: ItemDraft) => void;
  update: (taskId: string, patch: Partial<ItemDraft>) => void; open?: (kind: 'task' | 'note', id: string) => void;
}) {
  const [badge, tone] = badgeOf(i);
  const picking = i.editing || (!i.outcome && !(i.decision === 'pending' && i.suggested) && i.decision !== 'unknown');
  const timerTotal = i.timer && i.timer.total > 0 ? i.timer.total : undefined;
  return (
    <div className={`wizard-item review-candidate ${laser ? 'is-laser' : ''}`}>
      <div className="wizard-item-head">
        <div>
          <small>{i.source} · <span className={`candidate-badge badge-${tone}`}>{badge}</span></small>
          <strong>{i.title}</strong>
        </div>
        {changed(i) && <button type="button" className="text-button" onClick={() => undo(i)}>되돌리기</button>}
      </div>
      {i.basis && <p className="candidate-basis">{i.basis}</p>}
      {!!i.evidence?.length && (
        <details className="candidate-evidence">
          <summary>원문 근거 {i.evidence.length}개</summary>
          <ul>
            {i.evidence.map((e, n) => (
              <li key={n}>
                <span>{e.label}</span>
                <q>{e.quote}</q>
                {open && e.ref && (e.ref.type === 'note' || e.ref.type === 'task') && (
                  <button type="button" className="text-button" onClick={() => open(e.ref!.type as 'note' | 'task', e.ref!.id)}>열기</button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="candidate-decision">
        {i.decision === 'pending' && i.suggested && !i.editing ? (
          <>
            <span className="candidate-guess">추정: {outcomeLabel[i.suggested]}</span>
            <button type="button" className="primary-button compact" onClick={() => accept(i)}>맞음</button>
            <button type="button" className="secondary-button compact" onClick={() => update(i.taskId, { editing: true })}>수정</button>
            <button type="button" className="secondary-button compact" onClick={() => unknown(i)}>아직 모름</button>
          </>
        ) : picking ? (
          <>
            <div className="outcome-buttons" role="group" aria-label={`${i.title} 결과`}>
              {(Object.keys(outcomeLabel) as Outcome[]).map((o) => (
                <button type="button" key={o} className={i.outcome === o ? `active outcome-${o}` : ''} onClick={() => choose(i, o)}>{outcomeLabel[o]}</button>
              ))}
            </div>
            <button type="button" className="secondary-button compact" onClick={() => unknown(i)}>아직 모름</button>
          </>
        ) : (
          <>
            <span className={`candidate-guess ${i.outcome ? 'outcome-' + i.outcome : ''}`}>{i.outcome ? `결과: ${outcomeLabel[i.outcome]}` : '저장하지 않고 상태를 그대로 둡니다'}</span>
            <button type="button" className="secondary-button compact" onClick={() => update(i.taskId, { editing: true })}>수정</button>
          </>
        )}
      </div>
      {i.decision !== 'unknown' && i.outcome !== 'skipped' && (
        <div className="candidate-time">
          <label>
            예상 {i.estimate}분 → 실제
            <input type="number" min={0} max={1440} step={5} className="form-field" value={i.actualUnknown ? '' : i.actual} disabled={i.actualUnknown} placeholder="분"
              onChange={(e) => update(i.taskId, { actual: e.target.value, actualSource: 'input', actualUnknown: false })} />
          </label>
          {timerTotal !== undefined && String(timerTotal) !== i.actual && (
            <button type="button" className="text-button" onClick={() => update(i.taskId, { actual: String(timerTotal), actualSource: 'timer', actualUnknown: false })}>
              타이머 {timerTotal}분 불러오기
            </button>
          )}
          <button type="button" className={`text-button ${i.actualUnknown ? 'is-on' : ''}`} aria-pressed={!!i.actualUnknown}
            onClick={() => update(i.taskId, { actualUnknown: !i.actualUnknown, ...(!i.actualUnknown ? { actual: '' } : {}) })}>
            {i.actualUnknown ? '실제 시간 미확인 ✓' : '미확인으로 두기'}
          </button>
          <small className="candidate-time-note">
            {i.actualSource === 'timer' && !i.actualUnknown ? `집중 타이머 누적값${i.timer?.running ? ' (진행 중인 세션 포함)' : ''}. ` : ''}
            {i.actualSource === 'record' && !i.actualUnknown ? '이미 기록된 값. ' : ''}
            {i.calendarMinutes ? `캘린더 배정 ${i.calendarMinutes}분은 실제 수행시간으로 쓰지 않습니다.` : ''}
          </small>
        </div>
      )}
      {i.outcome && i.outcome !== 'done' && i.decision !== 'unknown' && (
        <Select value={i.reason} onValueChange={(v) => update(i.taskId, { reason: v as OutcomeReason })}>
          <SelectTrigger className="form-select" aria-label="끝내지 못한 이유"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(reasonLabel) as OutcomeReason[]).map((r) => (
              <SelectItem key={r} value={r}>{reasonLabel[r]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
// Evening PAFI companion: walks through outcomes → feedback → energy/habits → small wins,
// then saves one review (detail rows included) and generates tomorrow's proposal.
export function ReviewWizard({
  data,
  ownerId,
  reviewDate,
  today,
  busy,
  demo,
  onSave,
  open,
}: {
  data: WorkspaceData;
  ownerId: string;
  reviewDate: string;
  today: string;
  busy: boolean;
  demo: boolean;
  onSave: (
    review: { date: string; win: string; block: string; energy: Proposal['energy'] },
    detail: ReviewDetail,
    reflection: ReviewReflection,
  ) => Promise<boolean>;
  open?: (kind: 'task' | 'note', id: string) => void;
}) {
  const existing = data.reviews.find((r) => r.date === reviewDate);
  // Local records first; the server adds note bodies that live outside the workspace aggregate.
  const planned = useMemo(() => reviewCandidates(data, reviewDate, today, new Date()), [data, reviewDate, today]);
  const habits = data.habits ?? [];
  // The parent remounts this wizard (key = date + saved version), so drafts initialise from props once.
  const [step, setStep] = useState(0);
  const [items, setItems] = useState<ItemDraft[]>(() => planned.map(fromCandidate));
  const [evidenceState, setEvidenceState] = useState<'local' | 'loading' | 'server' | 'failed'>(demo ? 'local' : 'loading');
  // Set on mount (or restored from the device draft) so the effect check measures open → save.
  const openedAt = useRef(0);
  useEffect(() => {
    if (!openedAt.current) openedAt.current = Date.now();
  }, []);
  const [feedback, setFeedback] = useState<Record<string, FeedbackDraft>>({});
  const [dayRule, setDayRule] = useState<FeedbackDraft>({
    cause: '',
    alternative: '',
    rule: '',
    kind: 'other',
  });
  const [bed, setBed] = useState(''),
    [wake, setWake] = useState(''),
    [exercise, setExercise] = useState(''),
    [meals, setMeals] = useState(''),
    [mood, setMood] = useState('');
  const [habitChecks, setHabitChecks] = useState<string[]>(
    () => existing?.habitChecks ?? habits.filter((h) => h.log.includes(reviewDate)).map((h) => h.id),
  );
  const [energy, setEnergy] = useState<Proposal['energy']>(existing?.energy ?? 'normal');
  const [smallWins, setSmallWins] = useState<string[]>(['', '', '']);
  const [gratitude, setGratitude] = useState<string[]>(['', '', '']);
  const [win, setWin] = useState(existing?.win ?? ''),
    [block, setBlock] = useState(existing?.block ?? '');
  const [loading, setLoading] = useState(!demo && !!existing?.hasDetail);
  const [ready,setReady]=useState(false),[quick,setQuick]=useState(true),[draftError,setDraftError]=useState('');
  const dirty=useRef(false);
  const [conflict,setConflict]=useState<ReviewDraft|null>(null);
  // Sleep minutes from the saved review drive rendering (sleepMinutes fallback), so they live in state rather than a ref.
  const [savedSleep,setSavedSleep]=useState<number|undefined>(undefined);
  const hydrate=(d:ReviewDraft)=>{if(d.openedAt)openedAt.current=d.openedAt;setItems(current=>[...d.items.map(normalize),...current.filter(i=>!d.items.some(v=>v.taskId===i.taskId))]);setFeedback(d.feedback);setDayRule(d.dayRule);setBed(d.bed);setWake(d.wake);setExercise(d.exercise);setMeals(d.meals);setMood(d.mood);setHabitChecks(d.habitChecks);setEnergy(d.energy);setSmallWins(d.smallWins);setGratitude(d.gratitude);setWin(d.win);setBlock(d.block);setQuick(d.quick??true);setStep(d.step??0);setSavedSleep(d.savedSleep);};
  // Saved detail rows are fetched once; every setState below happens after the network round trip.
  useEffect(() => {
    const draft=!demo&&readDraft<ReviewDraft>(ownerId,'review',reviewDate);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores the device draft from localStorage once after mount; it cannot be read during server rendering or hydration, and the wizard must show the draft (or the conflict notice) before any network request
    if(draft&&Array.isArray(draft.items)&&draft.feedback&&draft.dayRule&&Array.isArray(draft.habitChecks)&&Array.isArray(draft.smallWins)&&Array.isArray(draft.gratitude)&&['bed','wake','exercise','meals','mood','energy','win','block'].every(k=>typeof (draft as unknown as Record<string,unknown>)[k]==='string')){if(draft.baseVersion===(existing?.updatedAt??'')){hydrate(draft);dirty.current=true;setLoading(false);setReady(true);return;}setConflict(draft);}
    if (demo || !existing?.hasDetail) {setReady(true);return;}
    let active = true;
    const timer = setTimeout(() => setLoading(true), 0);
    void agentRequest('/api/reviews?date=' + reviewDate)
      .then((r: { detail: ReviewDetail | null }) => {
        if(!active)return;if(!r.detail){setDraftError('저장된 회고 상세를 확인하지 못했습니다. 다시 열어 주세요.');return;}
        const d = r.detail; setSavedSleep(d.energy.sleepMinutes);
        setItems(current => [
          ...d.items.map((saved): ItemDraft => {const known=current.find(i=>i.taskId===saved.taskId);const base:ItemBase={outcome:saved.outcome,actual:saved.actualMinutes === undefined ? '' : String(saved.actualMinutes),reason:saved.reason ?? 'other',decision:'confirmed',actualSource:saved.actualMinutes === undefined ? undefined : 'record'};return {...base,taskId:saved.taskId,title:saved.title,estimate:saved.estimateMinutes,source:'저장된 회고',state:'confirmed',basis:'저장한 회고의 결과입니다. 다르면 수정하세요.',evidence:[{kind:'record' as const,label:'저장된 회고',quote:`${reviewDate} 회고에 저장한 결과입니다.`,ref:{type:'task' as const,id:saved.taskId}},...(known?.evidence??[]).filter(e=>e.kind!=='record')].slice(0,4),timer:known?.timer,calendarMinutes:known?.calendarMinutes,initial:base};}),
          ...current.filter(i=>!d.items.some(saved=>saved.taskId===i.taskId)),
        ]);
        const fb: Record<string, FeedbackDraft> = {};
        for (const f of d.feedback)
          if (f.taskId)
            fb[f.taskId] = {
              cause: f.cause,
              alternative: f.alternative,
              rule: f.rule,
              kind: f.kind ?? 'other',
            };
          else
            setDayRule({ cause: f.cause, alternative: f.alternative, rule: f.rule, kind: f.kind ?? 'other' });
        setFeedback(fb);
        if (d.energy.sleepMinutes) {
          setWake('');
          setBed('');
        }
        setExercise(d.energy.exercise ?? '');
        setMeals(d.energy.meals ?? '');
        setMood(d.energy.mood ?? '');
        setHabitChecks(d.habitChecks);
        setSmallWins([...d.smallWins, '', '', ''].slice(0, Math.max(3, d.smallWins.length)));
        setGratitude([...d.gratitude, '', '', ''].slice(0, 3));setReady(true);
      })
      .catch(() => {if(active)setDraftError('기존 회고를 불러오지 못했습니다. 연결 후 다시 열어 주세요.');})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [reviewDate, demo, existing?.hasDetail]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- persists the draft to localStorage after every change; the error state only reports a failed write of that external store
  useEffect(()=>{if(!ready||demo||!dirty.current||conflict)return;try{saveDraft(ownerId,'review',reviewDate,{baseVersion:existing?.updatedAt??'',items,feedback,dayRule,bed,wake,exercise,meals,mood,habitChecks,energy,smallWins,gratitude,win,block,quick,step,savedSleep,openedAt:openedAt.current});setDraftError('');}catch{setDraftError('기기 임시 저장에 실패했습니다. 입력을 복사해 보관해 주세요.');}},[ready,demo,ownerId,reviewDate,items,feedback,dayRule,bed,wake,exercise,meals,mood,habitChecks,energy,smallWins,gratitude,win,block,quick,step,savedSleep]);
  // Source lines from note bodies (meetings, Slack-filed records, mail) are read on the server. Only rows the
  // user has not touched yet are refreshed; decisions already made on this device are never replaced.
  useEffect(() => {
    if (demo) return;
    let active = true;
    void agentRequest('/api/reviews?evidence=1&date=' + reviewDate)
      .then((r: { candidates?: ReviewCandidate[] }) => {
        if (!active || !Array.isArray(r.candidates)) return;
        const server = r.candidates;
        setItems((current) => [
          ...current.map((i) => {
            const c = server.find((x) => x.taskId === i.taskId);
            if (!c) return i;
            if (untouched(i) && i.source !== '저장된 회고') return { ...fromCandidate(c), source: i.source };
            return i.evidence && i.initial ? { ...i, evidence: i.source === '저장된 회고' ? [...i.evidence.filter((e) => e.kind === 'record'), ...c.evidence.filter((e) => e.kind !== 'record')].slice(0, 4) : c.evidence } : { ...i, evidence: c.evidence, basis: c.basis, state: i.state ?? c.state, timer: c.timer, calendarMinutes: c.calendarMinutes, ...(c.state === 'suggested' && !i.outcome ? { suggested: c.outcome, suggestedReason: c.reason } : {}) };
          }),
          ...server.filter((c) => !current.some((i) => i.taskId === c.taskId)).map(fromCandidate),
        ]);
        setEvidenceState('server');
      })
      .catch(() => {
        if (active) setEvidenceState('failed');
      });
    return () => {
      active = false;
    };
  }, [reviewDate, demo]);
  const sleepMinutes = (() => {
    const b = toMinutes(bed),
      w = toMinutes(wake);
    if (b === null || w === null) return savedSleep;
    return (w - b + 1440) % 1440 || undefined;
  })();
  const undecided = items.filter((i) => !i.outcome && i.decision !== 'unknown').length;
  const needing = items.filter(
    (i) => i.outcome && needsFeedback(i.outcome, i.estimate, i.actual ? Number(i.actual) : undefined),
  );
  const laser = data.tasks.find((t) => t.laserDate === reviewDate);
  const executed = items.length
    ? Math.round((items.filter((i) => i.outcome === 'done').length / items.length) * 100)
    : null;
  const update = (taskId: string, patch: Partial<ItemDraft>) =>
    {dirty.current=true;setItems((list) => list.map((i) => (i.taskId === taskId ? { ...i, ...patch } : i)));}
  const choose = (i: ItemDraft, o: Outcome) =>
    update(i.taskId, {
      outcome: o,
      editing: false,
      decision: i.state === 'confirmed' && o === i.initial?.outcome ? 'confirmed' : i.suggested === o ? 'accepted' : 'edited',
      ...(o !== 'done' && i.suggested === o && i.suggestedReason ? { reason: i.suggestedReason } : {}),
    });
  const accept = (i: ItemDraft) => i.suggested && choose(i, i.suggested);
  const unknown = (i: ItemDraft) => update(i.taskId, { outcome: undefined, decision: 'unknown', editing: false });
  const undo = (i: ItemDraft) => i.initial && update(i.taskId, { ...i.initial, editing: false });
  const fb = (taskId: string) =>
    feedback[taskId] ?? { cause: '', alternative: '', rule: '', kind: 'other' as ImprovementKind };
  const setFb = (taskId: string, patch: Partial<FeedbackDraft>) =>
    setFeedback((f) => ({ ...f, [taskId]: { ...fb(taskId), ...patch } }));
  const save = async () => {
    const decided = items.filter((i, n) => i.outcome && i.decision !== 'unknown' && items.findIndex((x) => x.taskId === i.taskId) === n);
    if(!ready||loading||conflict)return false;if(decided.length>100){setDraftError('한 번에 최대 100개 결과를 저장할 수 있습니다. 일부 결과 선택을 해제해 주세요.');return false;}
    const detail: ReviewDetail = {
      date: reviewDate,
      // Only answered rows are saved: a pending suggestion or '아직 모름' never becomes 완료 or 못함.
      items: decided
        .map((i) => ({
          taskId: i.taskId,
          title: i.title.slice(0, 160),
          outcome: i.outcome!,
          estimateMinutes: i.estimate,
          ...(i.actual && !i.actualUnknown ? { actualMinutes: Math.max(0, Math.min(1440, Number(i.actual) || 0)) } : {}),
          ...(i.outcome !== 'done' ? { reason: i.reason } : {}),
        })),
      feedback: [
        ...Object.entries(feedback)
          .filter(([, f]) => f.cause.trim() || f.alternative.trim() || f.rule.trim())
          .map(([taskId, f]) => ({
            taskId,
            cause: f.cause.trim().slice(0, 200),
            alternative: f.alternative.trim().slice(0, 200),
            rule: f.rule.trim().slice(0, 200),
            kind: f.kind,
          })),
        ...(dayRule.rule.trim() || dayRule.cause.trim()
          ? [
              {
                cause: dayRule.cause.trim().slice(0, 200),
                alternative: dayRule.alternative.trim().slice(0, 200),
                rule: dayRule.rule.trim().slice(0, 200),
                kind: dayRule.kind,
              },
            ]
          : []),
      ].slice(0, 5),
      energy: {
        ...(sleepMinutes ? { sleepMinutes } : {}),
        ...(exercise.trim() ? { exercise: exercise.trim().slice(0, 120) } : {}),
        ...(meals.trim() ? { meals: meals.trim().slice(0, 200) } : {}),
        ...(mood.trim() ? { mood: mood.trim().slice(0, 200) } : {}),
      },
      smallWins: smallWins
        .map((s) => s.trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, 5),
      gratitude: gratitude
        .map((s) => s.trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, 3),
      habitChecks: habitChecks.filter((id) => habits.some((h) => h.id === id)).slice(0, 3),
      confirmation: {
        shown: Math.min(100, items.length),
        confirmed: Math.min(100, decided.length),
        unknown: Math.min(100, items.filter((i) => i.decision === 'unknown').length),
        accepted: Math.min(100, decided.filter((i) => i.decision === 'accepted').length),
        edited: Math.min(100, decided.filter((i) => i.decision === 'edited').length),
        seconds: Math.max(0, Math.min(86400, Math.round((Date.now() - openedAt.current) / 1000))),
      },
    };
    const reflection = reviewReflection(data, detail, today, new Date(), items.filter((i) => i.decision === 'unknown').map((i) => i.title));
    const ok=await onSave({date:reviewDate,win,block,energy},detail,reflection);if(ok&&!demo)clearDraft(ownerId,'review',reviewDate);return ok;
  };
  const stepIcon = [ClipboardCheck, MessageCircleQuestion, Moon, HeartHandshake][step];
  const Icon = stepIcon;
  const pendingCount = items.filter((i) => !i.outcome && i.decision !== 'unknown').length;
  const evidenceNote = <p className="muted candidate-status" role="status">{evidenceState==='loading'?'회의록·Slack 기록 원문에서 근거를 찾는 중… 앱에 있는 기록으로 먼저 보여줍니다.':evidenceState==='failed'?'원문 근거를 불러오지 못해 앱에 있는 기록만 보여줍니다.':''}{pendingCount?` 확인 전 ${pendingCount}개는 저장되지 않습니다.`:''}</p>;
  if(conflict)return <div className="review-wizard"><p>다른 기기에서 저장된 회고와 이 기기의 초안이 다릅니다.</p><p>기기 초안: {conflict.win||'(성과 미입력)'} / {conflict.block||'(막힌 점 미입력)'}</p><button className="primary-button" disabled={!ready} onClick={()=>{hydrate(conflict);dirty.current=true;setConflict(null);setReady(true);}}>기기 초안을 이어서 검토</button><button className="secondary-button" onClick={()=>{clearDraft(ownerId,'review',reviewDate);setConflict(null);dirty.current=false;}}>서버의 최신 회고 사용</button></div>;
  if(!ready)return <div className="review-wizard" role="status">{draftError||'저장된 회고를 확인하고 있습니다…'}</div>;
  if(quick)return <div className="review-wizard" onChangeCapture={()=>{dirty.current=true}}><h3>1분 회고 · 근거 보고 확인</h3><p className="muted">기록에서 찾은 결과 후보입니다. 맞음 · 수정 · 아직 모름으로 답하면 됩니다. 답하지 않았거나 ‘아직 모름’인 결과는 완료·실패로 저장하지 않습니다.</p>{evidenceNote}{draftError&&<p role="alert">{draftError}</p>}<div className="wizard-body">{items.length===0&&<p className="wizard-empty">이 날짜에 확인할 결과 후보가 없습니다.</p>}{items.map(i=><CandidateRow key={i.taskId} i={i} laser={i.taskId===laser?.id} choose={choose} accept={accept} unknown={unknown} undo={undo} update={update} open={open}/>)}<label>오늘의 성과<input className="form-field" maxLength={500} value={win} onChange={e=>setWin(e.target.value)} placeholder="작은 진전도 좋아요"/></label><label>막힌 점 · 내일 이어갈 일<input className="form-field" maxLength={500} value={block} onChange={e=>setBlock(e.target.value)}/></label><label>지금 에너지<select className="form-field" value={energy} onChange={e=>setEnergy(e.target.value as Proposal['energy'])}><option value="low">낮음 · 회복 우선</option><option value="normal">보통</option><option value="high">높음</option></select></label><p className="muted">기기 임시 보관 중 · 서버 저장은 아래 버튼으로 확인합니다.</p><div className="order-actions"><button className="primary-button" disabled={busy||loading} onClick={()=>void save()}>확인한 결과 저장 · 내일 제안</button><button className="secondary-button" onClick={()=>setQuick(false)}>자세히 회고하기</button></div></div></div>;
  return (
    <div className="review-wizard" onChangeCapture={()=>{dirty.current=true}}><button className="text-button" onClick={()=>setQuick(true)}>1분 회고로 돌아가기</button>{draftError&&<p role="alert">{draftError}</p>}
      <ol className="wizard-steps" aria-label="회고 단계">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'active' : i < step ? 'done' : ''}>
            <button type="button" onClick={() => i < step && setStep(i)} disabled={i > step}>
              <span>{i + 1}</span>
              {s}
            </button>
          </li>
        ))}
      </ol>
      {loading && <p className="muted">저장된 회고를 불러오는 중…</p>}
      <div className="wizard-body">
        <h3>
          <Icon size={17} /> {STEPS[step]}
        </h3>
        {step === 0 && (
          <>
            <p className="muted">
              기록에서 찾은 결과 후보마다 맞음 · 수정 · 아직 모름을 고르고, 아는 만큼만 실제 시간을 적으세요.{' '}
              {executed !== null && `실행률 ${executed}%`}
            </p>
            {items.length === 0 && (
              <p className="wizard-empty">이 날짜에 계획된 항목이 없습니다. 다음 단계로 넘어가도 됩니다.</p>
            )}
            {items.map((i) => (
              <CandidateRow key={i.taskId} i={i} laser={i.taskId === laser?.id} choose={choose} accept={accept} unknown={unknown} undo={undo} update={update} open={open} />
            ))}
          </>
        )}
        {step === 1 && (
          <>
            <p className="muted">
              {needing.length
                ? `계획과 달랐던 ${needing.length}개 항목만 묻습니다. 원인 → 대안 → 다음부터 지킬 규칙 한 줄. 감정만 적는 것은 피드백이 아닙니다.`
                : '오늘은 계획대로 진행됐습니다. 하루 전체에서 지킬 규칙이 하나 떠오르면 남겨 주세요.'}
            </p>
            {needing.map((i) => (
              <div key={i.taskId} className="wizard-feedback">
                <strong>
                  {i.title} · {i.outcome && outcomeLabel[i.outcome]}
                  {i.actual && ` · 예상 ${i.estimate}분 / 실제 ${i.actual}분`}
                </strong>
                <input
                  className="form-field"
                  maxLength={200}
                  placeholder="원인 (가설이어도 좋습니다)"
                  value={fb(i.taskId).cause}
                  onChange={(e) => setFb(i.taskId, { cause: e.target.value })}
                />
                <input
                  className="form-field"
                  maxLength={200}
                  placeholder="대안"
                  value={fb(i.taskId).alternative}
                  onChange={(e) => setFb(i.taskId, { alternative: e.target.value })}
                />
                <div className="wizard-rule">
                  <input
                    className="form-field"
                    maxLength={200}
                    placeholder="★ 다음부터 지킬 규칙 한 줄"
                    value={fb(i.taskId).rule}
                    onChange={(e) => setFb(i.taskId, { rule: e.target.value })}
                  />
                  <Select
                    value={fb(i.taskId).kind}
                    onValueChange={(v) => setFb(i.taskId, { kind: v as ImprovementKind })}
                  >
                    <SelectTrigger className="form-select" aria-label="규칙 종류">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(improvementKindLabel) as ImprovementKind[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {improvementKindLabel[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
            <div className="wizard-feedback">
              <strong>하루 전체</strong>
              <input
                className="form-field"
                maxLength={200}
                placeholder="원인"
                value={dayRule.cause}
                onChange={(e) => setDayRule({ ...dayRule, cause: e.target.value })}
              />
              <div className="wizard-rule">
                <input
                  className="form-field"
                  maxLength={200}
                  placeholder="★ 지킬 규칙 (선택)"
                  value={dayRule.rule}
                  onChange={(e) => setDayRule({ ...dayRule, rule: e.target.value })}
                />
                <Select
                  value={dayRule.kind}
                  onValueChange={(v) => setDayRule({ ...dayRule, kind: v as ImprovementKind })}
                >
                  <SelectTrigger className="form-select" aria-label="규칙 종류">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(improvementKindLabel) as ImprovementKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {improvementKindLabel[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <p className="muted">한 줄씩, 답하지 않아도 됩니다. 수면과 컨디션은 내일 예산의 근거가 됩니다.</p>
            <div className="field-grid">
              <label className="form-label">
                취침
                <input
                  type="time"
                  className="form-field"
                  value={bed}
                  onChange={(e) => setBed(e.target.value)}
                />
              </label>
              <label className="form-label">
                기상
                <input
                  type="time"
                  className="form-field"
                  value={wake}
                  onChange={(e) => setWake(e.target.value)}
                />
              </label>
            </div>
            {sleepMinutes && (
              <p className="form-hint">
                수면 {Math.floor(sleepMinutes / 60)}시간 {sleepMinutes % 60}분
              </p>
            )}
            <label className="form-label" htmlFor="rv-exercise">
              운동
            </label>
            <input
              id="rv-exercise"
              className="form-field"
              maxLength={120}
              placeholder="예: 걷기 30분"
              value={exercise}
              onChange={(e) => setExercise(e.target.value)}
            />
            <label className="form-label" htmlFor="rv-meals">
              식단
            </label>
            <input
              id="rv-meals"
              className="form-field"
              maxLength={200}
              placeholder="예: 점심 과식 후 오후 나른함"
              value={meals}
              onChange={(e) => setMeals(e.target.value)}
            />
            <label className="form-label" htmlFor="rv-mood">
              감정
            </label>
            <input
              id="rv-mood"
              className="form-field"
              maxLength={200}
              placeholder="예: 미팅 뒤 긴장, 저녁엔 안정"
              value={mood}
              onChange={(e) => setMood(e.target.value)}
            />
            {habits.length > 0 && (
              <>
                <label className="form-label">오늘 지킨 습관</label>
                <div className="habit-checks">
                  {habits.map((h) => (
                    <label key={h.id} className="focus-choice">
                      <Checkbox
                        checked={habitChecks.includes(h.id)}
                        onCheckedChange={(v) =>
                          setHabitChecks((c) =>
                            v ? [...new Set([...c, h.id])] : c.filter((x) => x !== h.id),
                          )
                        }
                      />
                      {h.mode === 'keep' ? '지킬' : '버릴'} · {h.title}{' '}
                      <small>D+{habitStreak(h, today)}</small>
                    </label>
                  ))}
                </div>
              </>
            )}
            <label className="form-label">내일의 예상 에너지</label>
            <RadioGroup
              className="review-radio"
              value={energy}
              onValueChange={(v) => setEnergy(v as Proposal['energy'])}
              aria-label="내일 예상 에너지"
            >
              {[
                { v: 'low', l: '여유롭게' },
                { v: 'normal', l: '평소처럼' },
                { v: 'high', l: '집중해서' },
              ].map((e) => (
                <label key={e.v}>
                  <RadioGroupItem value={e.v} />
                  {e.l}
                </label>
              ))}
            </RadioGroup>
            {sleepMinutes !== undefined && sleepMinutes < 360 && energy !== 'low' && (
              <p className="form-hint">수면이 6시간 미만입니다. 내일 예산을 여유롭게 잡는 것을 권합니다.</p>
            )}
          </>
        )}
        {step === 3 && (
          <>
            <p className="muted">
              {executed !== null && executed < 50
                ? '계획대로 안 된 날일수록 먼저 “내가 해냄”부터. 아주 작은 것도 좋습니다.'
                : '오늘 해낸 작은 것들과 감사한 일을 남기세요. 수치가 아니라 경험을 적습니다.'}
            </p>
            <label className="form-label">내가 해냄!</label>
            {smallWins.map((v, i) => (
              <input
                key={i}
                className="form-field wizard-line"
                maxLength={60}
                placeholder={['예: Goal Laser를 끝냈다', '예: 산책 20분', '예: 미룬 메일 회신'][i] ?? ''}
                value={v}
                onChange={(e) => setSmallWins((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
              />
            ))}
            {smallWins.length < 5 && (
              <button type="button" className="text-button" onClick={() => setSmallWins((l) => [...l, ''])}>
                + 하나 더
              </button>
            )}
            <label className="form-label">감사한 일 3가지</label>
            {gratitude.map((v, i) => (
              <input
                key={i}
                className="form-field wizard-line"
                maxLength={60}
                value={v}
                onChange={(e) => setGratitude((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
              />
            ))}
            <label className="form-label" htmlFor="rv-win">
              오늘 만든 결과물, 잘한 점
            </label>
            <textarea
              id="rv-win"
              className="form-field"
              value={win}
              onChange={(e) => setWin(e.target.value)}
              placeholder="무엇을 앞으로 움직였나요?"
            />
            <label className="form-label" htmlFor="rv-block">
              끝내지 못한 일과 그 이유
            </label>
            <textarea
              id="rv-block"
              className="form-field"
              value={block}
              onChange={(e) => setBlock(e.target.value)}
              placeholder="시간이 부족했나요, 결정이나 회신이 필요했나요?"
            />
          </>
        )}
      </div>
      <div className="wizard-nav">
        <button
          type="button"
          className="secondary-button"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          <ArrowLeft size={15} /> 이전
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            className="primary-button"
            disabled={step === 0 && undecided > 0}
            onClick={() => setStep((s) => s + 1)}
          >
            {step === 0 && undecided > 0 ? `확인할 결과 ${undecided}개 남음` : '다음'} <ArrowRight size={15} />
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            disabled={busy || undecided > 0}
            onClick={() => void save()}
          >
            <Sparkles size={16} /> 회고 저장하고 내일 제안 보기
          </button>
        )}
      </div>
      {existing && (
        <p className="saved-note">이 날짜의 회고가 저장되어 있습니다. 다시 저장하면 덮어씁니다.</p>
      )}
    </div>
  );
}
