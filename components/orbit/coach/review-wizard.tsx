'use client';
import { useEffect, useMemo, useState } from 'react';
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
import { agentRequest } from '@/components/orbit/agent/connections';
import { needsFeedback } from '@/lib/orbit/coach';
import { habitStreak } from '@/lib/orbit/derived';
import {
  outcomeLabel,
  reasonLabel,
  improvementKindLabel,
  type WorkspaceData,
  type Task,
  type Outcome,
  type OutcomeReason,
  type ImprovementKind,
  type ReviewDetail,
  type Proposal,
} from '@/lib/orbit/model';
interface ItemDraft {
  taskId: string;
  title: string;
  estimate: number;
  outcome?: Outcome;
  actual: string;
  reason: OutcomeReason;
  source: string;
}
interface FeedbackDraft {
  cause: string;
  alternative: string;
  rule: string;
  kind: ImprovementKind;
}
const STEPS = ['오늘 항목 결과', '원인 · 대안 · 규칙', '에너지 · 습관', '내가 해냄 · 감사'] as const;
const toMinutes = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
export function plannedItems(data: WorkspaceData, date: string): { task: Task; source: string }[] {
  const approved = new Set(
    data.events
      .filter((e) => e.date === date && e.taskId && e.id.startsWith('approved:'))
      .map((e) => e.taskId!),
  );
  const rows: { task: Task; source: string; order: number }[] = [];
  for (const t of data.tasks) {
    if (t.laserDate === date) rows.push({ task: t, source: 'Goal Laser', order: 0 });
    else if ((t.focus && t.focusDate === date) || approved.has(t.id))
      rows.push({ task: t, source: '핵심 결과물', order: 1 });
    else if (t.completedOn === date) rows.push({ task: t, source: '오늘 완료', order: 2 });
    else if (t.unplanned && t.due === date) rows.push({ task: t, source: '계획에 없던 일 +', order: 3 });
    else if (t.due === date && t.status !== 'done') rows.push({ task: t, source: '오늘 마감', order: 4 });
  }
  return rows.sort((a, b) => a.order - b.order).slice(0, 12);
}
// Evening PAFI companion: walks through outcomes → feedback → energy/habits → small wins,
// then saves one review (detail rows included) and generates tomorrow's proposal.
export function ReviewWizard({
  data,
  reviewDate,
  today,
  busy,
  demo,
  onSave,
}: {
  data: WorkspaceData;
  reviewDate: string;
  today: string;
  busy: boolean;
  demo: boolean;
  onSave: (
    review: { date: string; win: string; block: string; energy: Proposal['energy'] },
    detail: ReviewDetail,
  ) => Promise<boolean>;
}) {
  const existing = data.reviews.find((r) => r.date === reviewDate);
  const planned = useMemo(() => plannedItems(data, reviewDate), [data, reviewDate]);
  const habits = data.habits ?? [];
  // The parent remounts this wizard (key = date + saved version), so drafts initialise from props once.
  const [step, setStep] = useState(0);
  const [items, setItems] = useState<ItemDraft[]>(() =>
    planned.map(({ task, source }) => ({
      taskId: task.id,
      title: task.title,
      estimate: task.duration,
      outcome: task.outcome ?? (task.status === 'done' ? 'done' : undefined),
      actual: task.actualMinutes ? String(task.actualMinutes) : '',
      reason: task.outcomeReason ?? 'time',
      source,
    })),
  );
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
  const [loading, setLoading] = useState(false);
  // Saved detail rows are fetched once; every setState below happens after the network round trip.
  useEffect(() => {
    if (demo || !existing?.hasDetail) return;
    let active = true;
    const timer = setTimeout(() => setLoading(true), 0);
    void agentRequest('/api/reviews?date=' + reviewDate)
      .then((r: { detail: ReviewDetail | null }) => {
        if (!active || !r.detail) return;
        const d = r.detail;
        setItems((current) =>
          current.map((i) => {
            const saved = d.items.find((x) => x.taskId === i.taskId);
            return saved
              ? {
                  ...i,
                  outcome: saved.outcome,
                  actual: saved.actualMinutes ? String(saved.actualMinutes) : i.actual,
                  reason: saved.reason ?? i.reason,
                }
              : i;
          }),
        );
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
        setGratitude([...d.gratitude, '', '', ''].slice(0, 3));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [reviewDate, demo, existing?.hasDetail]);
  const sleepMinutes = (() => {
    const b = toMinutes(bed),
      w = toMinutes(wake);
    if (b === null || w === null) return undefined;
    return (w - b + 1440) % 1440 || undefined;
  })();
  const undecided = items.filter((i) => !i.outcome).length;
  const needing = items.filter(
    (i) => i.outcome && needsFeedback(i.outcome, i.estimate, i.actual ? Number(i.actual) : undefined),
  );
  const laser = data.tasks.find((t) => t.laserDate === reviewDate);
  const executed = items.length
    ? Math.round((items.filter((i) => i.outcome === 'done').length / items.length) * 100)
    : null;
  const update = (taskId: string, patch: Partial<ItemDraft>) =>
    setItems((list) => list.map((i) => (i.taskId === taskId ? { ...i, ...patch } : i)));
  const fb = (taskId: string) =>
    feedback[taskId] ?? { cause: '', alternative: '', rule: '', kind: 'other' as ImprovementKind };
  const setFb = (taskId: string, patch: Partial<FeedbackDraft>) =>
    setFeedback((f) => ({ ...f, [taskId]: { ...fb(taskId), ...patch } }));
  const save = async () => {
    const detail: ReviewDetail = {
      date: reviewDate,
      items: items
        .filter((i) => i.outcome)
        .map((i) => ({
          taskId: i.taskId,
          title: i.title.slice(0, 160),
          outcome: i.outcome!,
          estimateMinutes: i.estimate,
          ...(i.actual ? { actualMinutes: Math.max(0, Math.min(1440, Number(i.actual) || 0)) } : {}),
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
    };
    return onSave({ date: reviewDate, win, block, energy }, detail);
  };
  const stepIcon = [ClipboardCheck, MessageCircleQuestion, Moon, HeartHandshake][step];
  const Icon = stepIcon;
  return (
    <div className="review-wizard">
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
              계획한 항목마다 결과를 고르고, 아는 만큼만 실제 시간을 적으세요.{' '}
              {executed !== null && `실행률 ${executed}%`}
            </p>
            {items.length === 0 && (
              <p className="wizard-empty">이 날짜에 계획된 항목이 없습니다. 다음 단계로 넘어가도 됩니다.</p>
            )}
            {items.map((i) => (
              <div key={i.taskId} className={`wizard-item ${i.taskId === laser?.id ? 'is-laser' : ''}`}>
                <div className="wizard-item-head">
                  <div>
                    <small>{i.source}</small>
                    <strong>{i.title}</strong>
                  </div>
                  <div className="outcome-buttons" role="group" aria-label={`${i.title} 결과`}>
                    {(Object.keys(outcomeLabel) as Outcome[]).map((o) => (
                      <button
                        type="button"
                        key={o}
                        className={i.outcome === o ? `active outcome-${o}` : ''}
                        onClick={() => update(i.taskId, { outcome: o })}
                      >
                        {outcomeLabel[o]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="wizard-item-fields">
                  <label>
                    예상 {i.estimate}분 → 실제
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      step={5}
                      className="form-field"
                      value={i.actual}
                      placeholder="분"
                      onChange={(e) => update(i.taskId, { actual: e.target.value })}
                    />
                  </label>
                  {i.outcome && i.outcome !== 'done' && (
                    <Select
                      value={i.reason}
                      onValueChange={(v) => update(i.taskId, { reason: v as OutcomeReason })}
                    >
                      <SelectTrigger className="form-select" aria-label="끝내지 못한 이유">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(reasonLabel) as OutcomeReason[]).map((r) => (
                          <SelectItem key={r} value={r}>
                            {reasonLabel[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
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
            {step === 0 && undecided > 0 ? `결과 ${undecided}개 남음` : '다음'} <ArrowRight size={15} />
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
