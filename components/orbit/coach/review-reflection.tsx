'use client';
import { useEffect, useState } from 'react';
import { CalendarCheck2, X } from 'lucide-react';
import { agentRequest } from '@/components/orbit/agent/connections';
import { addDays, koreanDate } from '@/lib/orbit/dates';
import { confirmationTrend, type ReviewReflection } from '@/lib/orbit/review-evidence';
import type { ReviewDetail } from '@/lib/orbit/model';

// Shown right after a review is saved: how each confirmed result changes tomorrow's plan.
export function ReflectionCard({ reflection, onClose }: { reflection: ReviewReflection; onClose: () => void }) {
  return (
    <section className="reflection-card" aria-label="회고가 내일 계획에 반영되는 방식">
      <div className="reflection-head">
        <h3>
          <CalendarCheck2 size={16} /> {koreanDate(reflection.date, false)} 회고 → {koreanDate(reflection.next, false)} 계획 반영
        </h3>
        <button type="button" className="icon-button" aria-label="닫기" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <ul>
        {reflection.lines.map((l, n) => (
          <li key={n} className={`reflection-${l.kind}`}>
            {l.text}
          </li>
        ))}
      </ul>
      <p className="muted">규칙 기반 플래너가 실제로 적용하는 내용만 적었습니다. 결과를 고치려면 회고를 다시 저장하세요.</p>
    </section>
  );
}

const pct = (v: number | null) => (v === null ? '—' : v + '%');
const secs = (v: number | null) => (v === null ? '—' : v >= 60 ? `${Math.floor(v / 60)}분 ${v % 60}초` : `${v}초`);
// Effect check for the evidence-first review: result confirmation rate and time, first 7 measured days vs the next 7.
export function ConfirmationTrend({ today, demo }: { today: string; demo: boolean }) {
  const [details, setDetails] = useState<ReviewDetail[] | null>(null);
  useEffect(() => {
    if (demo) return;
    let active = true;
    void agentRequest(`/api/reviews?from=${addDays(today, -61)}&to=${today}`)
      .then((r: { details?: ReviewDetail[] }) => {
        if (active) setDetails(r.details ?? []);
      })
      .catch(() => {
        if (active) setDetails([]);
      });
    return () => {
      active = false;
    };
  }, [today, demo]);
  if (demo || !details) return null;
  const trend = confirmationTrend(details);
  return (
    <div className="confirmation-trend">
      <h3>결과 확인 효과</h3>
      {!trend ? (
        <p className="muted">근거 확인 회고를 저장하면 첫 7일을 기준으로 다음 7일의 확인 비율과 시간을 비교합니다.</p>
      ) : (
        <>
          <div className="metric-row">
            <span>첫 7일 · {trend.baseline.days}회</span>
            <strong>
              확인 {pct(trend.baseline.rate)} · {secs(trend.baseline.medianSeconds)}
            </strong>
          </div>
          <div className="metric-row">
            <span>다음 7일 · {trend.next.days}회</span>
            <strong>{trend.next.days ? `확인 ${pct(trend.next.rate)} · ${secs(trend.next.medianSeconds)}` : '측정 전'}</strong>
          </div>
          <p className="muted">확인 비율 = 저장한 결과 ÷ 보여준 후보. 시간은 회고를 연 뒤 저장까지의 중앙값입니다.</p>
        </>
      )}
    </div>
  );
}
