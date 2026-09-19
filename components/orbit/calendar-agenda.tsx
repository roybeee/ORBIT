'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownUp, Clock3, GripVertical, Pencil, LockKeyhole } from 'lucide-react';
import type { CalendarEvent, Project } from '@/lib/orbit/model';
import { formatTime } from '@/lib/orbit/model';
import { HOLD_MS, MOVE_SLOP, moveConflict, moveRestriction, shiftedEvent } from '@/lib/orbit/calendar-move';

type Props = {
  events: CalendarEvent[]; projects: Project[]; disabled: boolean;
  onOpen: (event: CalendarEvent) => void;
  onEdit: (id: string) => void;
  onMove: (before: CalendarEvent, after: CalendarEvent) => Promise<boolean>;
  onInteractionChange: (active: boolean) => void;
};
type Session = {
  event: CalendarEvent; x: number; y: number; currentY: number; scrollY: number;
  active: boolean; moved: boolean; input: 'touch' | 'pointer'; pointerId: number;
  timer?: ReturnType<typeof setTimeout>; frame?: number;
};
type Preview = { event: CalendarEvent; delta: number; saving?: boolean };

export function CalendarAgenda(props: Props) {
  const root = useRef<HTMLDivElement>(null), latest = useRef(props), session = useRef<Session | null>(null);
  latest.current = props;
  const [preview, setPreview] = useState<Preview | null>(null);
  const saving = useRef(false), suppressClickUntil = useRef(0), alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const element = root.current!;
    const changed = () => {
      const s = session.current;
      if (!s?.active) return;
      const delta = s.currentY - s.y + window.scrollY - s.scrollY;
      setPreview({ event: shiftedEvent(s.event, delta), delta });
    };
    const clear = () => {
      const s = session.current;
      if (s?.timer) clearTimeout(s.timer);
      if (s?.frame) cancelAnimationFrame(s.frame);
      session.current = null;
      latest.current.onInteractionChange(false);
    };
    const cancel = () => {
      if (session.current?.active) suppressClickUntil.current = Date.now() + 700;
      clear();
      if (!saving.current) setPreview(null);
    };
    const autoScroll = () => {
      const s = session.current;
      if (!s?.active) return;
      const bottom = window.innerHeight - 100;
      const speed = s.currentY < 100 ? -Math.min(12, (100 - s.currentY) / 5) :
        s.currentY > bottom ? Math.min(12, (s.currentY - bottom) / 5) : 0;
      if (speed) { window.scrollBy({ top: speed, behavior: 'instant' }); changed(); }
      s.frame = requestAnimationFrame(autoScroll);
    };
    const begin = (target: EventTarget | null, x: number, y: number, input: Session['input'], pointerId: number) => {
      if (session.current || saving.current || latest.current.disabled) return;
      const button = target instanceof Element ? target.closest<HTMLElement>('[data-move-event]') : null;
      const event = latest.current.events.find(e => e.id === button?.dataset.moveEvent);
      if (!event || moveRestriction(event)) return;
      const s: Session = { event: { ...event }, x, y, currentY: y, scrollY: window.scrollY, active: false, moved: false, input, pointerId };
      session.current = s;
      latest.current.onInteractionChange(true);
      s.timer = setTimeout(() => {
        if (session.current !== s || latest.current.disabled) { cancel(); return; }
        s.active = true;
        suppressClickUntil.current = Date.now() + 700;
        if (typeof navigator.vibrate === 'function') navigator.vibrate(18);
        changed();
      }, HOLD_MS);
    };
    const move = (x: number, y: number, event: Event) => {
      const s = session.current;
      if (!s) return;
      if (!s.active) {
        if (Math.hypot(x - s.x, y - s.y) > MOVE_SLOP) cancel();
        return; // Ordinary scrolling remains native before the long press.
      }
      if (s.input === 'touch' && !event.cancelable) { cancel(); return; }
      if (event.cancelable) event.preventDefault();
      s.currentY = y;
      if (!s.moved && Math.abs(y - s.y) > MOVE_SLOP) {
        s.moved = true;
        s.frame = requestAnimationFrame(autoScroll);
      }
      changed();
    };
    const finish = async () => {
      const s = session.current;
      if (!s) return;
      if (!s.active) { clear(); return; }
      const after = shiftedEvent(s.event, s.currentY - s.y + window.scrollY - s.scrollY);
      suppressClickUntil.current = Date.now() + 700;
      clear();
      if (!s.moved || after.start === s.event.start) { setPreview(null); return; }
      saving.current = true;
      latest.current.onInteractionChange(true);
      setPreview({ event: after, delta: 0, saving: true });
      try { await latest.current.onMove(s.event, after); }
      finally {
        saving.current = false;
        if (alive.current) { setPreview(null); latest.current.onInteractionChange(false); }
      }
    };
    const touchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { cancel(); return; }
      const t = e.touches[0]; begin(e.target, t.clientX, t.clientY, 'touch', t.identifier);
    };
    const touchMove = (e: TouchEvent) => {
      const s = session.current;
      if (!s || s.input !== 'touch') return;
      if (e.touches.length !== 1) { cancel(); return; }
      const t = e.touches[0]; move(t.clientX, t.clientY, e);
    };
    const touchEnd = (e: TouchEvent) => {
      if (session.current?.input !== 'touch') return;
      if (session.current.active && e.cancelable) e.preventDefault();
      void finish();
    };
    const pointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      begin(e.target, e.clientX, e.clientY, 'pointer', e.pointerId);
    };
    const pointerMove = (e: PointerEvent) => {
      if (session.current?.input === 'pointer' && session.current.pointerId === e.pointerId) move(e.clientX, e.clientY, e);
    };
    const pointerUp = (e: PointerEvent) => {
      if (session.current?.input === 'pointer' && session.current.pointerId === e.pointerId) void finish();
    };
    const pointerCancel = (e: PointerEvent) => { if (session.current?.input === 'pointer' && session.current.pointerId === e.pointerId) cancel(); };
    const contextMenu = (e: Event) => { if (session.current || Date.now() < suppressClickUntil.current) e.preventDefault(); };
    const keyDown = (e: KeyboardEvent) => { if (e.key === 'Escape' && session.current) { e.preventDefault(); cancel(); } };
    const visibility = () => { if (document.hidden) cancel(); };
    element.addEventListener('touchstart', touchStart, { passive: true });
    // Install before the gesture: changing touch-action after activation is too late on Android.
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('touchend', touchEnd, { passive: false });
    document.addEventListener('touchcancel', cancel);
    document.addEventListener('touchstart', eMulti, { passive: true });
    function eMulti(e: TouchEvent) { if (e.touches.length > 1) cancel(); }
    element.addEventListener('pointerdown', pointerDown);
    document.addEventListener('pointermove', pointerMove);
    document.addEventListener('pointerup', pointerUp);
    document.addEventListener('pointercancel', pointerCancel);
    element.addEventListener('contextmenu', contextMenu);
    document.addEventListener('keydown', keyDown);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', cancel);
    return () => {
      alive.current = false; clear();
      element.removeEventListener('touchstart', touchStart);
      document.removeEventListener('touchmove', touchMove);
      document.removeEventListener('touchend', touchEnd);
      document.removeEventListener('touchcancel', cancel);
      document.removeEventListener('touchstart', eMulti);
      element.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('pointermove', pointerMove);
      document.removeEventListener('pointerup', pointerUp);
      document.removeEventListener('pointercancel', pointerCancel);
      element.removeEventListener('contextmenu', contextMenu);
      document.removeEventListener('keydown', keyDown);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', cancel);
    };
  }, []);

  const conflict = preview && moveConflict(preview.event, props.events);
  return <div ref={root} className={`calendar-agenda ${preview ? 'is-moving' : ''}`}>
    <p id="calendar-move-help" className="calendar-gesture-hint"><ArrowDownUp size={15} />길게 누른 뒤 위아래로 이동 · 15분씩 조정</p>
    {!props.events.length && <div className="calendar-empty"><Clock3 size={25}/><strong>예정된 일정이 없어요</strong><p>상단의 일정 추가로 하루를 계획해 보세요.</p></div>}
    {props.events.map(event => {
      const active = preview?.event.id === event.id;
      const shown = active ? preview.event : event;
      const restriction = moveRestriction(event);
      const project = props.projects.find(p => p.id === event.projectId);
      return <div className={`agenda-row ${active ? 'agenda-moving' : ''}`} key={event.id}>
        <time className="agenda-time">{formatTime(shown.start)}<span>{formatTime(shown.end)}</span></time>
        <div className={`agenda-card ${active && conflict ? 'has-conflict' : ''}`}
          style={{ '--event-color': project?.color ?? (event.kind === 'focus' ? '#74ddef' : event.kind === 'break' ? '#7ee0b6' : '#bbadff'), transform: active && !preview.saving ? `translateY(${preview.delta}px)` : undefined } as CSSProperties}>
          <button type="button" className="agenda-event" data-move-event={event.id}
            aria-describedby={!restriction ? 'calendar-move-help' : undefined}
            aria-label={`${event.title}, ${formatTime(shown.start)}부터 ${formatTime(shown.end)}까지${restriction ? ', ' + restriction : ''}`}
            onClick={e => { if (Date.now() < suppressClickUntil.current || saving.current) { e.preventDefault(); return; } props.onOpen(event); }}>
            <strong>{event.title}</strong>
            <span className="agenda-meta">{project?.name ?? (event.kind === 'focus' ? '집중 시간' : event.kind === 'break' ? '휴식' : '개인 일정')}<span>·</span>{event.end - event.start}분</span>
            {restriction && <span className="agenda-restriction"><LockKeyhole size={12}/>{restriction}</span>}
            {active && <span className="agenda-new-time">{formatTime(shown.start)}–{formatTime(shown.end)}{preview.saving ? ' · 저장 중…' : ''}</span>}
            {!restriction && <GripVertical size={18} className="agenda-grip" aria-hidden="true"/>}
          </button>
          {!restriction && <button type="button" className="agenda-edit" aria-label={`${event.title} 시간 변경`} disabled={props.disabled || !!preview} onClick={() => props.onEdit(event.id)}><Pencil size={15}/><span>시간 변경</span></button>}
        </div>
      </div>;
    })}
    {preview && <div className={`calendar-drag-feedback ${conflict ? 'has-conflict' : ''}`} role="status" aria-live="polite">
      <ArrowDownUp size={20}/><div><strong>{formatTime(preview.event.start)} — {formatTime(preview.event.end)}</strong><span>{preview.saving ? '변경한 시간을 저장하는 중…' : conflict ? `‘${conflict.title}’ 일정과 겹쳐요 · 다른 시간으로 이동하세요` : '위로는 더 일찍 · 아래로는 더 늦게 · 놓으면 저장'}</span></div>
    </div>}
  </div>;
}
