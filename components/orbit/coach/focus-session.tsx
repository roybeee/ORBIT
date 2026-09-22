'use client';
import { useEffect, useState } from 'react';
import { Play, Pause, CheckCircle2, Timer, Headphones } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  outcomeLabel,
  reasonLabel,
  improvementKindLabel,
  type Task,
  type Outcome,
  type OutcomeReason,
  type ImprovementKind,
} from '@/lib/orbit/model';
import { focusElapsedSeconds, formatFocusClock } from '@/lib/orbit/focus-clock';
import { needsFeedback, handoffLike } from '@/lib/orbit/coach';
export interface RecordInput {
  outcome: Outcome;
  actualMinutes?: number;
  reason?: OutcomeReason;
  rule?: string;
  ruleKind?: ImprovementKind;
}
// Execution-stage companion: Dip in (start), a visible clock, and a completion check that
// asks for the outcome, the actual minutes and — when the plan and reality diverged — a rule.
export function FocusSession({
  task,
  busy,
  demo,
  startReason,
  onStart,
  onStop,
  onRecord,
}: {
  task: Task;
  busy: boolean;
  demo?: boolean;
  startReason?: string;
  onStart: () => Promise<boolean> | void;
  onStop: () => Promise<boolean> | void;
  onRecord: (input: RecordInput) => Promise<boolean> | void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    if (!task.startedAt) return;
    const timer = window.setInterval(refresh, 1000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [task.id, task.startedAt]);
  const running = !!task.startedAt;
  const elapsed = focusElapsedSeconds(task.startedAt, now);
  const totalSeconds = (task.actualMinutes ?? 0) * 60 + elapsed;
  const total = Math.min(1440, (task.actualMinutes ?? 0) + Math.round(elapsed / 60));
  const tracked = running || task.actualMinutes !== undefined;
  const progress = task.duration > 0 ? Math.min(100, totalSeconds / (task.duration * 60) * 100) : 0;
  return (
    <div className={`focus-session focus-session-live${running ? ' is-running' : ''}`}>
      <div className="focus-clock-heading"><span><Timer size={16} /> {running ? '집중 중' : tracked ? '집중 기록' : '집중할 시간'}</span><span>목표 {task.duration}분</span></div>
      <div className="focus-clock-value" suppressHydrationWarning role="timer" aria-label="누적 집중 시간" aria-live="off">{formatFocusClock(totalSeconds)}</div>
      <p className="focus-clock-caption">{running ? task.actualMinutes ? `이번 집중 ${formatFocusClock(elapsed)} · 이전 기록 포함` : '집중한 시간이 실시간으로 쌓이고 있어요' : task.status === 'done' ? '완료한 업무의 집중 기록입니다' : tracked ? '저장한 시간부터 이어서 시작할 수 있어요'  : '시작을 누르면 시간을 측정합니다'}</p>
      <div className="focus-clock-progress" role="progressbar" aria-label="목표 시간 대비 집중 시간" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}><span style={{width: `${progress}%`}} /></div>
      <div className="focus-session-buttons">
        {task.status !== 'done' &&
          (running ? (
            <button className="secondary-button" disabled={busy} onClick={() => void onStop()}>
              <Pause size={16} /> 일시정지
            </button>
          ) : (
            <button className="primary-button" disabled={busy || demo || !!startReason} title={startReason} onClick={() => void onStart()}>
              <Play size={16} /> {tracked ? '이어서 집중' : '집중 시작'}
            </button>
          ))}
        <button
          className={running ? 'primary-button' : 'secondary-button'}
          disabled={busy}
          onClick={() => setOpen(true)}
        >
          <CheckCircle2 size={14} /> {task.status === 'done' ? '결과 다시 기록' : '끝내고 기록'}
        </button>
      </div>
      <button className="text-button focus-sound-button" onClick={() => window.dispatchEvent(new CustomEvent('orbit:sound-open',{detail:{goal:task.title,minutes:task.duration}}))}><Headphones size={16}/> 집중 사운드</button>
      {open && (
        <RecordDialog
          key={task.id}
          task={task}
          prefill={total}
          busy={busy}
          onClose={() => setOpen(false)}
          onRecord={async (input) => {
            const ok = await onRecord(input);
            if (ok !== false) setOpen(false);
          }}
        />
      )}
    </div>
  );
}
export function RecordDialog({
  task,
  prefill,
  busy,
  onClose,
  onRecord,
}: {
  task: Task;
  prefill: number;
  busy: boolean;
  onClose: () => void;
  onRecord: (input: RecordInput) => Promise<void> | void;
}) {
  const [outcome, setOutcome] = useState<Outcome>('done');
  const measured = !!task.startedAt || task.actualMinutes !== undefined;
  const [typedActual, setActual] = useState(measured ? String(prefill) : '');
  const [timeEdited, setTimeEdited] = useState(false);
  // Until the user edits the field, a measured task keeps following the live prefill.
  const actual = measured && !timeEdited ? String(prefill) : typedActual;
  const [reason, setReason] = useState<OutcomeReason>('time');
  const [handoff, setHandoff] = useState(false);
  const [rule, setRule] = useState('');
  const [ruleKind, setRuleKind] = useState<ImprovementKind>('estimate');
  const actualMinutes = actual.trim() === '' ? undefined : Number(actual);
  const validTime = actualMinutes === undefined || (Number.isInteger(actualMinutes) && actualMinutes >= 0 && actualMinutes <= 1440);
  const askFeedback = outcome !== 'done' || (actualMinutes !== undefined && needsFeedback(outcome, task.duration, actualMinutes));
  const ratio = task.duration && actualMinutes !== undefined ? Math.round((actualMinutes / task.duration) * 100) / 100 : 1;
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="focus-record-dialog">
        <DialogHeader>
          <DialogTitle>집중 결과 기록</DialogTitle>
          <DialogDescription>{task.title}</DialogDescription>
        </DialogHeader>
        <form
          className="dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || !validTime || (outcome === 'done' && !handoff)) return;
            void onRecord({
              outcome,
              actualMinutes,
              reason: outcome === 'done' ? undefined : reason,
              rule: askFeedback && rule.trim() ? rule.trim() : undefined,
              ruleKind: askFeedback && rule.trim() ? ruleKind : undefined,
            });
          }}
        >
          <label className="form-label" id="record-outcome-label">어디까지 진행했나요?</label>
          <RadioGroup
            className="review-radio"
            aria-labelledby="record-outcome-label"
            disabled={busy}
            value={outcome}
            onValueChange={(v) => setOutcome(v as Outcome)}
          >
            {(Object.keys(outcomeLabel) as Outcome[]).map((o) => (
              <label key={o} className={outcome === o ? 'is-selected' : ''}>
                <RadioGroupItem value={o} />
                {outcomeLabel[o]}
              </label>
            ))}
          </RadioGroup>
          {outcome === 'done' && (
            <div className="record-completion">
              <label className="focus-choice coach-handoff">
                <Checkbox checked={handoff} disabled={busy} onCheckedChange={(v) => setHandoff(v === true)} />
                <span>완료 기준을 충족했어요</span>
              </label>
              <details className="record-definition"><summary>완료 기준 확인</summary><p>{task.definition || '필요한 작업과 결과 전달을 모두 마쳤는지 확인해 주세요.'}</p>
                {!handoffLike(task.definition) && <p>업무는 전달까지, 개인 목표는 실천한 결과까지 확인해 주세요.</p>}
              </details>
            </div>
          )}
          <div className="field-grid">
            <div>
              <label className="form-label" htmlFor="record-actual">
                실제 집중 시간 · 분
              </label>
              <input
                id="record-actual"
                type="number"
                min={0}
                max={1440}
                step={1}
                placeholder="미측정 · 비워둘 수 있어요"
                inputMode="numeric"
                disabled={busy}
                className="form-field"
                value={actual}
                onChange={(e) => { setTimeEdited(true); setActual(e.target.value); }}
              />
              <p className="form-hint">
                {measured && !timeEdited ? '측정한 시간을 자동으로 입력했어요. 1분 단위로 반올림합니다.' : `예상 ${task.duration}분 · 실제 시간을 모르면 비워두세요. 시간 보정 표본에서 제외합니다.`}
              </p>
            </div>
            {outcome !== 'done' && (
              <div>
                <label className="form-label">끝내지 못한 이유</label>
                <Select value={reason} onValueChange={(v) => setReason(v as OutcomeReason)}>
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
              </div>
            )}
          </div>
          {askFeedback && (
            <details className="coach-feedback record-feedback"><summary>다음 집중을 위한 메모 (선택)</summary>
              <p>
                {outcome === 'done'
                  ? `예상과 ${Math.round(Math.abs(ratio - 1) * 100)}% 차이가 났습니다.`
                  : '계획대로 되지 않았습니다.'}{' '}
                다음에 도움이 될 방법을 한 줄로 남겨 보세요.
              </p>
              <label className="form-label" htmlFor="record-rule">
                다음부터 지킬 규칙 (선택)
              </label>
              <input
                id="record-rule"
                className="form-field"
                maxLength={200}
                value={rule}
                onChange={(e) => setRule(e.target.value)}
                placeholder="예: 미팅 뒤에는 이동·정리 30분을 먼저 비운다"
              />
              {rule.trim() && (
                <Select value={ruleKind} onValueChange={(v) => setRuleKind(v as ImprovementKind)}>
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
              )}
            </details>
          )}
          <div className="record-footer">
          {outcome === 'done' && !handoff && <p className="form-hint">완료 기준을 확인하고 위 항목에 체크해 주세요.</p>}
          <button
            type="submit"
            className="primary-button full-width"
            disabled={busy || !validTime || (outcome === 'done' && !handoff)}
          >
            <CheckCircle2 size={16} /> {busy ? '저장 중…' : outcome === 'done' ? '완료로 저장' : '결과 저장'}
          </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
