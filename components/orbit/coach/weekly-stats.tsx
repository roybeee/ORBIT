'use client';
import { weeklyStats } from '@/lib/orbit/derived';
import { reasonLabel, type WorkspaceData } from '@/lib/orbit/model';
// Weekly PAFI ledger — the only numbers BRAINY asks you to watch: execution rate (85% line),
// prediction accuracy (actual ÷ estimate), and whether the Goal Laser actually got its hours.
export function WeeklyStats({ data, endDate }: { data: WorkspaceData; endDate: string }) {
  const s = weeklyStats(data, endDate);
  return (
    <section className="weekly-stats" aria-label="주간 PAFI 결산">
      <h2>이번 주 PAFI 결산</h2>
      <p className="muted">
        {s.from.slice(5).replace('-', '/')}–{s.to.slice(5).replace('-', '/')} · 회고 {s.reviewedDays}일
      </p>
      <div className="metric-row">
        <span>계획 실행률 (목표선 85%)</span>
        <strong className={s.executionRate !== null && s.executionRate < 85 ? 'is-low' : ''}>
          {s.executionRate === null ? '—' : `${s.executionRate}%`}
        </strong>
      </div>
      <div className="metric-row">
        <span>예측 정확도 (실제 ÷ 예상)</span>
        <strong>{s.predictionAccuracy === null ? '—' : `${s.predictionAccuracy}배`}</strong>
      </div>
      <div className="metric-row">
        <span>Goal Laser 확보</span>
        <strong>
          {s.laserDays}일 · {Math.round(s.laserMinutes / 60)}시간
        </strong>
      </div>
      <div className="metric-row">
        <span>새 규칙 ★</span>
        <strong>{s.newRules}개</strong>
      </div>
      {s.topReasons.length > 0 && (
        <p className="day-summary">
          반복된 미완료 이유 · {s.topReasons.map((r) => `${reasonLabel[r.reason]} ${r.count}`).join(' · ')}
        </p>
      )}
      <p className="form-hint">
        실행률이 낮으면 항목을 늘리지 말고 예측을 보정합니다. 매일의 점수는 두지 않습니다.
      </p>
    </section>
  );
}
