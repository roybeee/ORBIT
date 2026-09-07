'use client';
import { AlertTriangle, CheckCircle2, Info, Wand2 } from 'lucide-react';
import type { Task } from '@/lib/orbit/model';
import type { CoachCheck } from '@/lib/orbit/coach';
// Plan-stage companion: shows what the coach noticed while a task is being written.
// Fixes are one-tap patches to the form; nothing here blocks saving.
export function TaskCoach({
  checks,
  compact = false,
  onFix,
}: {
  checks: CoachCheck[];
  compact?: boolean;
  onFix?: (patch: Partial<Task>) => void;
}) {
  const warn = checks.filter((c) => c.level === 'warn').length,
    info = checks.filter((c) => c.level === 'info').length;
  const visible = compact ? checks.filter((c) => c.level !== 'ok') : checks;
  if (!visible.length) return null;
  return (
    <section className={`coach-panel ${compact ? 'is-compact' : ''}`} aria-label="코치 체크">
      <header>
        <strong>
          <Wand2 size={14} /> 코치 체크
        </strong>
        <span>
          {warn ? `경고 ${warn}` : '경고 없음'} · 안내 {info}
        </span>
      </header>
      <ul>
        {visible.map((c) => (
          <li key={c.id} className={`coach-${c.level}`}>
            {c.level === 'warn' ? (
              <AlertTriangle size={15} />
            ) : c.level === 'ok' ? (
              <CheckCircle2 size={15} />
            ) : (
              <Info size={15} />
            )}
            <div>
              <b>{c.title}</b>
              {c.detail && <p>{c.detail}</p>}
            </div>
            {c.fix && onFix && (
              <button type="button" className="coach-fix" onClick={() => onFix(c.fix!.patch)}>
                {c.fix.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
