'use client';
import { GoalProgress } from './chief-panel';
import { domainLabels } from '@/lib/orbit/chief';
import { useState } from 'react';
import { Crosshair, Plus, Trash2, Flame, ShieldAlert, Star, Target } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { habitStreak } from '@/lib/orbit/derived';
import { improvementKindLabel, type WorkspaceData, type Goal, type ImprovementKind } from '@/lib/orbit/model';
import type { WorkspaceAction } from '@/lib/orbit/validation';
const goalKindLabel: Record<Goal['kind'], string> = {
  life: '인생의 꿈',
  mid: '5~7년 중장기',
  short: '1~3년 단기',
  concept: '올해의 컨셉',
};
// BRAINY setup: the Goal Laser funnel (dream → mid → short → this year's concept), the domino project,
// the 1 keep / 2 quit habits, standing risks and the rules kept from evening feedback.
export function GoalsPanel({
  data,
  today,
  busy,
  demo,
  onClose,
  perform,
}: {
  data: WorkspaceData;
  today: string;
  busy: boolean;
  demo: boolean;
  onClose: () => void;
  perform: (action: WorkspaceAction, message?: string) => Promise<boolean>;
}) {
  const goals = data.goals ?? [],
    habits = data.habits ?? [],
    risks = data.risks ?? [],
    rules = (data.improvements ?? []).filter((i) => i.active);
  const [domain,setDomain]=useState<NonNullable<Goal['domain']>>('work');
  const [kind, setKind] = useState<Goal['kind']>('short'),
    [sentence, setSentence] = useState(''),
    [metric, setMetric] = useState(''),
    [deadline, setDeadline] = useState(''),
    [parentId, setParentId] = useState('none');
  const [habitTitle, setHabitTitle] = useState(''),
    [habitMode, setHabitMode] = useState<'keep' | 'quit'>('keep');
  const [riskTitle, setRiskTitle] = useState(''),
    [riskDate, setRiskDate] = useState(today),
    [riskCondition, setRiskCondition] = useState(''),
    [riskProject, setRiskProject] = useState('none');
  const [ruleText, setRuleText] = useState(''),
    [ruleKind, setRuleKind] = useState<ImprovementKind>('buffer');
  const disabled = busy || demo;
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="bg-white settings-dialog">
        <DialogHeader>
          <DialogTitle>BRAINY 설정 · 목표 · 습관 · 리스크 · 규칙</DialogTitle>
          <DialogDescription>
            Goal Laser의 깔때기(꿈 → 중장기 → 단기 → 올해의 컨셉)와 도미노 프로젝트를 정하면 내일 제안이 그 한
            가지에 시간을 먼저 줍니다.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="goals" className="brainy-tabs">
          <TabsList aria-label="BRAINY 설정 구분">
            <TabsTrigger value="goals">목표·도미노</TabsTrigger>
            <TabsTrigger value="habits">습관</TabsTrigger>
            <TabsTrigger value="risks">리스크</TabsTrigger>
            <TabsTrigger value="rules">규칙 ★</TabsTrigger>
          </TabsList>
          <TabsContent value="goals" className="dialog-form">
            <label className="form-label">도미노 프로젝트 — 이것만 되면 나머지가 쉬워지는 한 가지</label>
            <Select
              value={data.dominoProjectId ?? 'none'}
              onValueChange={(v) =>
                void perform(
                  { type: 'project.domino', id: v === 'none' ? null : v },
                  '도미노 프로젝트를 정했습니다.',
                )
              }
            >
              <SelectTrigger className="form-select" aria-label="도미노 프로젝트">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">아직 정하지 않음</SelectItem>
                {data.projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="form-label">목표 계층</label>
            {goals.length === 0 && (
              <p className="muted">
                아직 목표가 없습니다. 크고 수치화된 한 문장으로, 기한과 함께 적어 주세요.
              </p>
            )}
            {(['life', 'mid', 'short', 'concept'] as Goal['kind'][]).map((k) =>
              goals
                .filter((g) => g.kind === k)
                .map((g) => (
                  <div key={g.id} className="goal-row">
                    <span className="status status-blue">{goalKindLabel[g.kind]}</span>
                    <div className="goal-sentence">
                      <strong>{g.sentence}</strong>
                      <small>{domainLabels[g.domain??'work']} · {g.status==='achieved'?'달성':g.status==='paused'?'보류':'진행 중'}{g.progress&&` · ${g.progress.current} / ${g.progress.target} ${g.progress.unit}`}</small>
                      <GoalProgress goal={g} today={today} perform={perform} disabled={disabled}/>
                      <small>
                        {g.metric && `${g.metric} · `}
                        {g.deadline ?? '기한 미정'}
                        {g.parentId &&
                          ` · ↑ ${goals.find((p) => p.id === g.parentId)?.sentence.slice(0, 24) ?? ''}`}
                        {' · 프로젝트 '}
                        {data.projects.filter((p) => p.goalId === g.id).length}개
                      </small>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="목표 삭제"
                      disabled={disabled}
                      onClick={() => void perform({ type: 'goal.delete', id: g.id }, '목표를 삭제했습니다.')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )),
            )}
            <form
              className="goal-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!sentence.trim()) return;
                const ok = await perform(
                  {
                    type: 'goal.upsert',
                    goal: {
                      id: crypto.randomUUID(),
                      kind,
                      domain,
                      sentence: sentence.trim(),
                      ...(metric.trim() ? { metric: metric.trim() } : {}),
                      ...(deadline ? { deadline } : {}),
                      ...(parentId !== 'none' ? { parentId } : {}),
                    },
                  },
                  '목표를 추가했습니다.',
                );
                if (ok) {
                  setSentence('');
                  setMetric('');
                  setDeadline('');
                }
              }}
            >
              <label>목표 분야<select className="form-field" value={domain} onChange={e=>setDomain(e.target.value as NonNullable<Goal['domain']>)}>{Object.entries(domainLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
              <div className="field-grid">
                <div>
                  <label className="form-label">종류</label>
                  <Select value={kind} onValueChange={(v) => setKind(v as Goal['kind'])}>
                    <SelectTrigger className="form-select" aria-label="목표 종류">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(goalKindLabel) as Goal['kind'][]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {goalKindLabel[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="form-label">상위 목표</label>
                  <Select value={parentId} onValueChange={setParentId}>
                    <SelectTrigger className="form-select" aria-label="상위 목표">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">없음</SelectItem>
                      {goals.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.sentence.slice(0, 40)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className="form-label" htmlFor="goal-sentence">
                크고 수치화된 한 문장
              </label>
              <input
                id="goal-sentence"
                className="form-field"
                maxLength={160}
                required
                value={sentence}
                onChange={(e) => setSentence(e.target.value)}
                placeholder="예: 2027년 안에 맵달BUNSIK 해외 마스터 프랜차이즈 2건을 계약한다"
              />
              <div className="field-grid">
                <div>
                  <label className="form-label" htmlFor="goal-metric">
                    수치
                  </label>
                  <input
                    id="goal-metric"
                    className="form-field"
                    maxLength={120}
                    value={metric}
                    onChange={(e) => setMetric(e.target.value)}
                    placeholder="예: 계약 2건"
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="goal-deadline">
                    기한
                  </label>
                  <input
                    id="goal-deadline"
                    type="date"
                    className="form-field"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                  />
                </div>
              </div>
              <button className="secondary-button" disabled={disabled || !sentence.trim()}>
                <Plus size={15} /> 목표 추가
              </button>
            </form>
            <label className="form-label">프로젝트 → 목표 연결</label>
            {data.projects.map((p) => (
              <div key={p.id} className="goal-row">
                <span className="goal-sentence">
                  <strong>
                    {p.name}
                    {data.dominoProjectId === p.id && (
                      <span className="status status-blue" style={{ marginLeft: 6 }}>
                        <Crosshair size={11} /> 도미노
                      </span>
                    )}
                  </strong>
                </span>
                <Select
                  value={p.goalId ?? 'none'}
                  onValueChange={(v) =>
                    void perform(
                      { type: 'project.upsert', project: { ...p, goalId: v === 'none' ? undefined : v } },
                      '프로젝트를 목표에 연결했습니다.',
                    )
                  }
                >
                  <SelectTrigger className="form-select goal-link" aria-label={`${p.name}의 목표`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">목표 없음</SelectItem>
                    {goals.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.sentence.slice(0, 40)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </TabsContent>
          <TabsContent value="habits" className="dialog-form">
            <p className="muted">
              올해 반드시 지킬 습관 1개와 버릴 습관 2개. 매일 10분이면 충분하도록 작게 정합니다. 100일이 한
              구간입니다.
            </p>
            {habits.map((h) => (
              <div key={h.id} className="goal-row">
                <span className={`status ${h.mode === 'keep' ? 'status-green' : 'status-orange'}`}>
                  {h.mode === 'keep' ? '지킬' : '버릴'}
                </span>
                <span className="goal-sentence">
                  <strong>{h.title}</strong>
                  <small>
                    D+{habitStreak(h, today)} 연속 · 누적 {h.log.length}일 · {h.startedOn} 시작
                  </small>
                </span>
                <button
                  className="icon-button"
                  aria-label="습관 삭제"
                  disabled={disabled}
                  onClick={() => void perform({ type: 'habit.delete', id: h.id }, '습관을 삭제했습니다.')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {habits.length < 3 && (
              <form
                className="goal-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!habitTitle.trim()) return;
                  const ok = await perform(
                    {
                      type: 'habit.upsert',
                      habit: {
                        id: crypto.randomUUID(),
                        title: habitTitle.trim(),
                        mode: habitMode,
                        startedOn: today,
                        log: [],
                      },
                    },
                    '습관을 추가했습니다. 오늘부터 D+1.',
                  );
                  if (ok) setHabitTitle('');
                }}
              >
                <div className="field-grid">
                  <div>
                    <label className="form-label">종류</label>
                    <Select value={habitMode} onValueChange={(v) => setHabitMode(v as 'keep' | 'quit')}>
                      <SelectTrigger className="form-select" aria-label="습관 종류">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="keep">지킬 습관</SelectItem>
                        <SelectItem value="quit">버릴 습관</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="form-label" htmlFor="habit-title">
                      10분 습관
                    </label>
                    <input
                      id="habit-title"
                      className="form-field"
                      maxLength={80}
                      value={habitTitle}
                      onChange={(e) => setHabitTitle(e.target.value)}
                      placeholder="예: 기상 후 30분 노폰"
                    />
                  </div>
                </div>
                <button className="secondary-button" disabled={disabled || !habitTitle.trim()}>
                  <Flame size={15} /> 습관 추가
                </button>
              </form>
            )}
          </TabsContent>
          <TabsContent value="risks" className="dialog-form">
            <p className="muted">
              업무 목록에 묻히지 않아야 하는 구조적 리스크. 확인일이 지나면 오늘 화면에서 강조됩니다.
            </p>
            {risks.map((r) => (
              <div key={r.id} className="goal-row">
                <span className={`status ${r.checkDate <= today ? 'status-orange' : 'status-gray'}`}>
                  {r.checkDate}
                </span>
                <span className="goal-sentence">
                  <strong>{r.title}</strong>
                  <small>
                    {r.condition || '해결 조건 미정'}
                    {r.projectId && ` · ${data.projects.find((p) => p.id === r.projectId)?.name ?? ''}`}
                  </small>
                </span>
                <button
                  className="icon-button"
                  aria-label="리스크 닫기"
                  disabled={disabled}
                  onClick={() => void perform({ type: 'risk.close', id: r.id }, '리스크를 닫았습니다.')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <form
              className="goal-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!riskTitle.trim()) return;
                const ok = await perform(
                  {
                    type: 'risk.upsert',
                    risk: {
                      id: crypto.randomUUID(),
                      title: riskTitle.trim(),
                      checkDate: riskDate,
                      condition: riskCondition.trim(),
                      ...(riskProject !== 'none' ? { projectId: riskProject } : {}),
                    },
                  },
                  '리스크를 등록했습니다.',
                );
                if (ok) {
                  setRiskTitle('');
                  setRiskCondition('');
                }
              }}
            >
              <label className="form-label" htmlFor="risk-title">
                리스크
              </label>
              <input
                id="risk-title"
                className="form-field"
                maxLength={160}
                value={riskTitle}
                onChange={(e) => setRiskTitle(e.target.value)}
                placeholder="예: 두 건의 현금 수요가 외부 일정에 동시에 걸려 있음"
              />
              <div className="field-grid">
                <div>
                  <label className="form-label" htmlFor="risk-date">
                    다음 확인일
                  </label>
                  <input
                    id="risk-date"
                    type="date"
                    className="form-field"
                    value={riskDate}
                    onChange={(e) => setRiskDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">연결 프로젝트</label>
                  <Select value={riskProject} onValueChange={setRiskProject}>
                    <SelectTrigger className="form-select" aria-label="리스크 프로젝트">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">없음</SelectItem>
                      {data.projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className="form-label" htmlFor="risk-condition">
                해결 조건
              </label>
              <input
                id="risk-condition"
                className="form-field"
                maxLength={300}
                value={riskCondition}
                onChange={(e) => setRiskCondition(e.target.value)}
                placeholder="예: 브릿지 한도 확보 또는 투자 납입 확정"
              />
              <button className="secondary-button" disabled={disabled || !riskTitle.trim()}>
                <ShieldAlert size={15} /> 리스크 등록
              </button>
            </form>
          </TabsContent>
          <TabsContent value="rules" className="dialog-form">
            <p className="muted">
              저녁 회고와 완료 체크에서 남긴 “다음부터 지킬 규칙”. 내일 제안의 이유에 ★로 인용되고
              헤르메스에게도 전달됩니다.
            </p>
            {rules.length === 0 && (
              <p className="muted">아직 규칙이 없습니다. 계획과 실제가 달랐던 날 저녁에 한 줄 남겨 보세요.</p>
            )}
            {rules.map((r) => (
              <div key={r.id} className="goal-row">
                <span className="status status-gray">{improvementKindLabel[r.kind]}</span>
                <span className="goal-sentence">
                  <strong>★ {r.rule}</strong>
                  <small>
                    {r.createdOn}
                    {r.source && ` · ${r.source}`}
                  </small>
                </span>
                <button
                  className="icon-button"
                  aria-label="규칙 보관"
                  disabled={disabled}
                  onClick={() =>
                    void perform({ type: 'improvement.retire', id: r.id }, '규칙을 보관했습니다.')
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <form
              className="goal-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!ruleText.trim()) return;
                const ok = await perform(
                  {
                    type: 'improvement.add',
                    improvement: {
                      id: crypto.randomUUID(),
                      rule: ruleText.trim(),
                      kind: ruleKind,
                      createdOn: today,
                      active: true,
                      source: '직접 입력',
                    },
                  },
                  '규칙을 추가했습니다.',
                );
                if (ok) setRuleText('');
              }}
            >
              <div className="field-grid">
                <div>
                  <label className="form-label">종류</label>
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
                </div>
                <div>
                  <label className="form-label" htmlFor="rule-text">
                    규칙 한 줄
                  </label>
                  <input
                    id="rule-text"
                    className="form-field"
                    maxLength={200}
                    value={ruleText}
                    onChange={(e) => setRuleText(e.target.value)}
                    placeholder="예: 외부 미팅 앞뒤로 이동 30분을 비운다"
                  />
                </div>
              </div>
              <button className="secondary-button" disabled={disabled || !ruleText.trim()}>
                <Star size={15} /> 규칙 추가
              </button>
            </form>
          </TabsContent>
        </Tabs>
        <p className="form-hint">
          <Target size={12} /> 목표는 12개, 습관은 3개, 리스크는 10개, 규칙은 40개까지 둡니다. 저장은 승인
          없이 바로 반영됩니다.
        </p>
      </DialogContent>
    </Dialog>
  );
}
