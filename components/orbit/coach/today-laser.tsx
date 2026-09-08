'use client';
import { Crosshair, Flag, ShieldAlert, Flame, Settings2, ChevronRight, Check } from 'lucide-react';
import { FocusSession, type RecordInput } from './focus-session';
import { habitStreak } from '@/lib/orbit/derived';
import { addDays, koreanDate } from '@/lib/orbit/dates';
import { formatTime, cognitionLabel, type WorkspaceData, type Task } from '@/lib/orbit/model';
import type { WorkspaceAction } from '@/lib/orbit/validation';
// Morning companion: the one Goal Laser, up to three must-close items, standing risks,
// habit streaks and yesterday's small win — everything BRAINY asks for in a 30-second glance.
export function TodayLaser({
  data,
  today,
  busy,
  demo,
  perform,
  onOpenTask,
  onManage,
  onRecord,
}: {
  data: WorkspaceData;
  today: string;
  busy: boolean;
  demo: boolean;
  perform: (action: WorkspaceAction, message?: string) => Promise<boolean>;
  onOpenTask: (id: string) => void;
  onManage: () => void;
  onRecord: (task: Task, input: RecordInput) => Promise<boolean>;
}) {
  const laser = data.tasks.find((t) => t.laserDate === today);
  const domino = data.projects.find((p) => p.id === data.dominoProjectId);
  const candidate = domino
    ? data.tasks
        .filter(
          (t) => t.projectId === domino.id && t.status !== 'done' && t.status !== 'waiting' && !t.blocker?.trim() && (!t.planHoldUntil || t.planHoldUntil <= today) && (t.dependsOn??[]).every(id=>data.tasks.find(d=>d.id===id)?.status==='done') && !t.laserDate,
        )
        .sort(
          (a, b) =>
            Number(b.cognition === 'high') - Number(a.cognition === 'high') ||
            b.impact - a.impact ||
            a.due.localeCompare(b.due),
        )[0]
    : undefined;
  const block = data.events.find(
    (e) => e.date === today && e.taskId === laser?.id && e.id.startsWith('approved:'),
  );
  const must = data.tasks
    .filter(
      (t) =>
        t.id !== laser?.id &&
        t.status !== 'done' &&
        ((t.must && t.due <= today) || (t.focus && t.focusDate === today)),
    )
    .slice(0, 3);
  const risks = [...(data.risks ?? [])].sort((a, b) => a.checkDate.localeCompare(b.checkDate));
  const habits = data.habits ?? [];
  const yesterday = data.reviews.find((r) => r.date === addDays(today, -1));
  const unplanned = data.tasks.filter((t) => t.unplanned && t.due === today && t.status !== 'done').length;
  return (
    <section className="laser-panel" aria-label="오늘의 Goal Laser">
      <header className="laser-head">
        <h2>
          <Crosshair size={18} /> 오늘의 Goal Laser
        </h2>
        <button className="text-button" onClick={onManage}>
          <Settings2 size={14} /> 목표·습관·리스크
        </button>
      </header>
      {laser ? (
        <article className="laser-task">
          <div className="laser-task-main">
            <button className="task-title" onClick={() => onOpenTask(laser.id)}>
              {laser.title}
            </button>
            <p className="task-description">{laser.definition}</p>
            <div className="task-meta">
              <span>{data.projects.find((p) => p.id === laser.projectId)?.name}</span>
              {block ? (
                <span>
                  {formatTime(block.start)}–{formatTime(block.end)} · {block.end - block.start}분 확보
                </span>
              ) : (
                <span>연속 시간 미확보 · 내일 제안에서 승인하세요</span>
              )}
              {laser.cognition && <span>{cognitionLabel[laser.cognition]}</span>}
            </div>
          </div>
          <FocusSession
            task={laser}
            busy={busy}
            demo={demo}
            onStart={() => perform({ type: 'task.start', id: laser.id }, '집중 시작. 한 번에 하나만.')}
            onStop={() => perform({ type: 'task.stop', id: laser.id }, '지금까지의 시간을 기록했습니다.')}
            onRecord={(input) => onRecord(laser, input)}
          />
        </article>
      ) : (
        <div className="laser-empty">
          {domino ? (
            candidate ? (
              <>
                <p>
                  <strong>{domino.name}</strong>에서 오늘 3시간을 쏟을 한 가지를 고르세요.
                </p>
                <button
                  className="primary-button"
                  disabled={busy || demo}
                  onClick={() =>
                    void perform(
                      { type: 'task.laser', id: candidate.id, date: today, laser: true },
                      '오늘의 Goal Laser로 지정했습니다.',
                    )
                  }
                >
                  <Crosshair size={15} /> “{candidate.title}”을(를) 오늘의 Laser로
                </button>
              </>
            ) : (
              <p>
                도미노 프로젝트 <strong>{domino.name}</strong>에 지금 진행할 수 있는 할 일이 없습니다. 할 일을
                추가해 주세요.
              </p>
            )
          ) : (
            <p>
              이것만 되면 나머지가 풀리는 <strong>도미노 프로젝트</strong>를 먼저 정하세요. 내일 제안이 집중
              구간에 연속 시간을 확보합니다.
            </p>
          )}
        </div>
      )}
      <div className="laser-grid">
        <div className="laser-col">
          <h3>
            <Flag size={15} /> 반드시 종결 <span className="number">{must.length}</span>
          </h3>
          {must.length === 0 && (
            <p className="muted">오늘 반드시 끝낼 항목을 할 일에서 ‘반드시 종결’로 표시하세요.</p>
          )}
          {must.map((t) => (
            <button key={t.id} className="laser-row" onClick={() => onOpenTask(t.id)}>
              <span>
                <strong>{t.title}</strong>
                <small>{t.definition}</small>
              </span>
              <ChevronRight size={14} />
            </button>
          ))}
          {unplanned > 0 && (
            <p className="form-hint">
              계획에 없던 일 + {unplanned}개가 오늘 추가됐습니다. 저녁 회고에서 함께 봅니다.
            </p>
          )}
        </div>
        <div className="laser-col">
          <h3>
            <ShieldAlert size={15} /> 상시 리스크 <span className="number">{risks.length}</span>
          </h3>
          {risks.length === 0 && (
            <p className="muted">업무 목록에 묻히면 안 되는 구조적 리스크를 여기에 둡니다.</p>
          )}
          {risks.slice(0, 4).map((r) => (
            <div key={r.id} className={`laser-row is-risk ${r.checkDate <= today ? 'is-due' : ''}`}>
              <span>
                <strong>{r.title}</strong>
                <small>
                  {r.checkDate <= today ? '확인일 도래 · ' : ''}
                  {koreanDate(r.checkDate, false)} 확인 · {r.condition || '해결 조건 미정'}
                </small>
              </span>
              <button
                className="icon-button"
                aria-label={`${r.title} 리스크 닫기`}
                disabled={busy || demo}
                onClick={() => void perform({ type: 'risk.close', id: r.id }, '리스크를 닫았습니다.')}
              >
                <Check size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
      <footer className="laser-foot">
        <div className="habit-strip" aria-label="습관">
          <Flame size={15} />
          {habits.length === 0 && <span className="muted">지킬 습관 1개, 버릴 습관 2개 — 10분 단위로.</span>}
          {habits.map((h) => {
            const checked = h.log.includes(today);
            return (
              <button
                key={h.id}
                className={`habit-chip ${checked ? 'checked' : ''}`}
                disabled={busy || demo}
                aria-pressed={checked}
                onClick={() =>
                  void perform(
                    { type: 'habit.check', id: h.id, date: today, checked: !checked },
                    checked ? '체크를 해제했습니다.' : '오늘 습관 체크! 내가 해냄.',
                  )
                }
              >
                {h.mode === 'keep' ? '지킬' : '버릴'} · {h.title}
                <b>D+{habitStreak(h, today)}</b>
              </button>
            );
          })}
        </div>
        {yesterday?.highlight && (
          <p className="laser-yesterday">
            어제의 내가 해냄 · <em>{yesterday.highlight}</em>
          </p>
        )}
      </footer>
    </section>
  );
}
