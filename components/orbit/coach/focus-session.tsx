'use client';
import { useEffect, useState } from 'react';
import { Play, Square, CheckCircle2, Timer } from 'lucide-react';
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
import { needsFeedback, handoffLike } from '@/lib/orbit/coach';
export interface RecordInput {
  outcome: Outcome;
  actualMinutes: number;
  reason?: OutcomeReason;
  rule?: string;
  ruleKind?: ImprovementKind;
}
const elapsedNow = (startedAt?: string) =>
  startedAt ? Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 60000)) : 0;
// Execution-stage companion: Dip in (start), a visible clock, and a completion check that
// asks for the outcome, the actual minutes and — when the plan and reality diverged — a rule.
export function FocusSession({
  task,
  busy,
  demo,
  onStart,
  onStop,
  onRecord,
}: {
  task: Task;
  busy: boolean;
  demo?: boolean;
  onStart: () => Promise<boolean> | void;
  onStop: () => Promise<boolean> | void;
  onRecord: (input: RecordInput) => Promise<boolean> | void;
}) {
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!task.startedAt) return;
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, [task.startedAt]);
  void tick;
  const running = !!task.startedAt,
    elapsed = elapsedNow(task.startedAt),
    total = (task.actualMinutes ?? 0) + elapsed;
  return (
    <div className="focus-session">
      <div className="focus-session-clock">
        <Timer size={15} />
        {running ? (
          <span>
            집중 중 · <b>{elapsed}분</b> 경과{task.actualMinutes ? ` (누적 ${total}분)` : ''} · 예상{' '}
            {task.duration}분
          </span>
        ) : (
          <span>
            {task.actualMinutes ? `지금까지 ${task.actualMinutes}분 · ` : ''}예상 {task.duration}분
          </span>
        )}
      </div>
      <div className="focus-session-buttons">
        {task.status !== 'done' &&
          (running ? (
            <button className="secondary-button" disabled={busy} onClick={() => void onStop()}>
              <Square size={14} /> 잠시 멈춤
            </button>
          ) : (
            <button className="primary-button" disabled={busy || demo} onClick={() => void onStart()}>
              <Play size={14} /> 집중 시작
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
      {open && (
        <RecordDialog
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
  const [outcome, setOutcome] = useState<Outcome>(task.status === 'done' ? 'done' : 'done');
  const [actual, setActual] = useState(String(prefill || task.duration));
  const [reason, setReason] = useState<OutcomeReason>('time');
  const [handoff, setHandoff] = useState(false);
  const [rule, setRule] = useState('');
  const [ruleKind, setRuleKind] = useState<ImprovementKind>('estimate');
  const actualMinutes = Math.max(0, Math.min(1440, Number(actual) || 0));
  const askFeedback = needsFeedback(outcome, task.duration, actualMinutes);
  const ratio = task.duration ? Math.round((actualMinutes / task.duration) * 100) / 100 : 1;
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle>완료 체크 · {task.title}</DialogTitle>
          <DialogDescription>결과와 실제 시간을 남기면 다음 계획의 예측이 정확해집니다.</DialogDescription>
        </DialogHeader>
        <form
          className="dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            void onRecord({
              outcome,
              actualMinutes,
              reason: outcome === 'done' ? undefined : reason,
              rule: askFeedback && rule.trim() ? rule.trim() : undefined,
              ruleKind: askFeedback && rule.trim() ? ruleKind : undefined,
            });
          }}
        >
          <label className="form-label">결과</label>
          <RadioGroup
            className="review-radio"
            value={outcome}
            onValueChange={(v) => setOutcome(v as Outcome)}
          >
            {(Object.keys(outcomeLabel) as Outcome[]).map((o) => (
              <label key={o}>
                <RadioGroupItem value={o} />
                {outcomeLabel[o]}
              </label>
            ))}
          </RadioGroup>
          {outcome === 'done' && (
            <label className="focus-choice coach-handoff">
              <Checkbox checked={handoff} onCheckedChange={(v) => setHandoff(v === true)} />
              <span>
                완료 조건을 충족했습니다 — <em>{task.definition}</em>
                {!handoffLike(task.definition) && (
                  <small>업무는 필요한 전달까지, 개인 목표는 실제 실천·결과까지 확인해 주세요.</small>
                )}
              </span>
            </label>
          )}
          <div className="field-grid">
            <div>
              <label className="form-label" htmlFor="record-actual">
                실제 걸린 시간(분)
              </label>
              <input
                id="record-actual"
                type="number"
                min={0}
                max={1440}
                step={5}
                className="form-field"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
              />
              <p className="form-hint">
                예상 {task.duration}분 → 실제 {actualMinutes}분{task.duration ? ` (${ratio}배)` : ''}
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
            <div className="coach-feedback">
              <p>
                {outcome === 'done'
                  ? `예상과 ${Math.round(Math.abs(ratio - 1) * 100)}% 차이가 났습니다.`
                  : '계획대로 되지 않았습니다.'}{' '}
                원인과 대안을 떠올린 뒤, 다음부터 지킬 규칙 한 줄만 남겨 주세요. 감정 표현은 규칙이 아닙니다.
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
            </div>
          )}
          <button
            type="submit"
            className="primary-button full-width"
            style={{ marginTop: 20 }}
            disabled={busy || (outcome === 'done' && !handoff)}
          >
            <CheckCircle2 size={16} /> {outcome === 'done' ? '완료로 기록 · 내가 해냄!' : '결과 기록'}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
