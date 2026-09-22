'use client';
import {eventScope,eventScopeLabels} from '@/lib/orbit/event-details';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownUp, Clock3, MoreHorizontal, Pencil, Trash2, LockKeyhole, CalendarPlus, ArrowRight } from 'lucide-react';
import type { CalendarEvent, Project, Preferences, Task } from '@/lib/orbit/model';
import {categoryOf,calendarItemColor,categoryLabels} from '@/lib/orbit/calendar-categories';
import {Checkbox} from '@/components/ui/checkbox';
import {taskDeleteDrag} from '@/lib/orbit/task-delete-gesture';
import { formatTime, statusLabel } from '@/lib/orbit/model';
import { HOLD_MS, MOVE_SLOP, SWIPE_ACTION_WIDTH, SWIPE_OPEN_THRESHOLD, canEditCalendarEvent, calendarGestureIntent, swipeOffset, moveConflict, moveRestriction, shiftedEvent } from '@/lib/orbit/calendar-move';

type Props = {
  onDeleteTask?: (id: string) => Promise<boolean>;
  colorTasks?:Task[]; timelineTasks?:Task[]; date?:string; onToggleTask?:(id:string)=>void; onScheduleTask?:(id:string)=>void;
  events: CalendarEvent[]; preferences?:Preferences; projects: Project[]; disabled: boolean;
  onOpen: (event: CalendarEvent) => void;
  onEdit: (id: string) => void;
  onDelete: (event: CalendarEvent) => void;
  onMove: (before: CalendarEvent, after: CalendarEvent) => Promise<boolean>;
  onInteractionChange: (active: boolean) => void;
};
type Session = {
  event: CalendarEvent; x: number; y: number; currentX: number; currentY: number; scrollY: number;
  active: boolean; moved: boolean; swiping: boolean; initialOffset: number; input: 'touch' | 'pointer'; pointerId: number;
  timer?: ReturnType<typeof setTimeout>; frame?: number;
  deleteTaskId?: string; width: number;
};
type Preview = { event: CalendarEvent; delta: number; saving?: boolean };

export function CalendarAgenda(props: Props) {
  const root = useRef<HTMLDivElement>(null), latest = useRef(props), session = useRef<Session | null>(null);
  useLayoutEffect(() => { latest.current = props; });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [deleting, setDeleting] = useState<{id:string;offset:number;ready:boolean;saving?:boolean}|null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [swipe, setSwipe] = useState<{id: string; offset: number} | null>(null);
  const openActions = useRef<string | null>(null);
  const focusActionsOnOpen = useRef(false);
  const showActions = (id: string | null) => { openActions.current = id; setOpenActionsId(id); };
  const saving = useRef(false), suppressClickUntil = useRef(0), alive = useRef(true);

  useEffect(() => {
    if (openActions.current && !props.events.some(e => e.id === openActions.current)) showActions(null);
  }, [props.events]);
  useEffect(() => {
    if (openActionsId && focusActionsOnOpen.current) {
      document.getElementById(`agenda-actions-${openActionsId}`)?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    }
    focusActionsOnOpen.current = false;
  }, [openActionsId]);

  useEffect(() => {
    alive.current = true;
    const element = root.current!;
    const changed = () => {
      const s = session.current;
      if (!s?.active) return;
      if (s.deleteTaskId) {
        setDeleting({id:s.event.id,...taskDeleteDrag(s.currentX-s.x,s.currentY-s.y,s.width)});
        return;
      }
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
      if (session.current?.active || session.current?.swiping) suppressClickUntil.current = Date.now() + 700;
      clear();
      setSwipe(null);
      if (!saving.current) setDeleting(null);
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
      const deleteTaskId = event?.id.startsWith('task-due:') && latest.current.onDeleteTask && latest.current.timelineTasks?.some(t=>t.id===event.taskId) ? event.taskId : undefined;
      if (!event || (!deleteTaskId && !canEditCalendarEvent(event))) return;
      const initialOffset = openActions.current === event.id ? -SWIPE_ACTION_WIDTH : 0;
      if (openActions.current !== event.id) showActions(null);
      const s: Session = { event: { ...event }, x, y, currentX: x, currentY: y, scrollY: window.scrollY, active: false, moved: false, swiping: false, initialOffset, input, pointerId, deleteTaskId, width:button?.closest('.agenda-card')?.getBoundingClientRect().width??240 };
      session.current = s;
      latest.current.onInteractionChange(true);
      if (deleteTaskId || !moveRestriction(event)) s.timer = setTimeout(() => {
        if (session.current !== s || latest.current.disabled) { cancel(); return; }
        s.active = true;
        showActions(null);
        suppressClickUntil.current = Date.now() + 700;
        if (typeof navigator.vibrate === 'function') navigator.vibrate(18);
        changed();
      }, HOLD_MS);
    };
    const move = (x: number, y: number, event: Event) => {
      const s = session.current;
      if (!s) return;
      if (!s.active && !s.swiping) {
        const intent = calendarGestureIntent(x - s.x, y - s.y);
        // A task requires a stationary hold first. Ordinary swipes only scroll.
        if (s.deleteTaskId && intent !== 'pending') { suppressClickUntil.current=Date.now()+700; cancel(); return; }
        if (intent === 'scroll') { cancel(); return; }
        if (intent === 'pending') return;
        if (s.timer) clearTimeout(s.timer);
        s.swiping = true;
        suppressClickUntil.current = Date.now() + 700;
      }
      if (s.input === 'touch' && !event.cancelable) { cancel(); return; }
      if (event.cancelable) event.preventDefault();
      if (s.deleteTaskId) { s.currentX=x; s.currentY=y; changed(); return; }
      if (s.swiping) {
        s.currentX = x;
        setSwipe({id: s.event.id, offset: swipeOffset(s.initialOffset, x - s.x)});
        return;
      }
      s.currentY = y;
      if (!s.moved && Math.abs(y - s.y) > MOVE_SLOP) {
        s.moved = true;
        s.frame = requestAnimationFrame(autoScroll);
      }
      changed();
    };
    const finish = async (x?:number,y?:number) => {
      const s = session.current;
      if (!s) return;
      if (s.deleteTaskId) {
        const result=taskDeleteDrag((x??s.currentX)-s.x,(y??s.currentY)-s.y,s.width);
        const remove=s.active&&result.ready&&!latest.current.disabled;
        if(s.active)suppressClickUntil.current=Date.now()+700;
        clear();
        if(!remove){setDeleting(null);return;}
        saving.current=true;latest.current.onInteractionChange(true);
        setDeleting({id:s.event.id,...result,saving:true});
        try {await latest.current.onDeleteTask?.(s.deleteTaskId);}
        finally {saving.current=false;if(alive.current){setDeleting(null);latest.current.onInteractionChange(false);}}
        return;
      }
      if (s.swiping) {
        const offset = swipeOffset(s.initialOffset, s.currentX - s.x);
        showActions(offset <= -SWIPE_OPEN_THRESHOLD ? s.event.id : null);
        suppressClickUntil.current = Date.now() + 700;
        setSwipe(null);
        clear();
        return;
      }
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
      const t=Array.from(e.changedTouches).find(t=>t.identifier===session.current?.pointerId);
      if(!t)return;
      if ((session.current.active || session.current.swiping) && e.cancelable) e.preventDefault();
      void finish(t.clientX,t.clientY);
    };
    const pointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      begin(e.target, e.clientX, e.clientY, 'pointer', e.pointerId);
    };
    const pointerMove = (e: PointerEvent) => {
      if (session.current?.input === 'pointer' && session.current.pointerId === e.pointerId) move(e.clientX, e.clientY, e);
    };
    const pointerUp = (e: PointerEvent) => {
      if (session.current?.input === 'pointer' && session.current.pointerId === e.pointerId) void finish(e.clientX,e.clientY);
    };
    const pointerCancel = (e: PointerEvent) => { if (session.current?.input === 'pointer' && session.current.pointerId === e.pointerId) cancel(); };
    const contextMenu = (e: Event) => { if (session.current || Date.now() < suppressClickUntil.current) e.preventDefault(); };
    const keyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (session.current || openActions.current)) {
        e.preventDefault(); cancel();
        if (openActions.current) document.getElementById(`agenda-actions-${openActions.current}`)?.parentElement?.querySelector<HTMLButtonElement>('.agenda-action-toggle')?.focus({preventScroll:true});
        showActions(null);
      }
    };
    const outside = (e: PointerEvent) => {
      const row = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-agenda-row]') : null;
      if (openActions.current && row?.dataset.agendaRow !== openActions.current) showActions(null);
    };
    const visibility = () => { if (document.hidden) { cancel(); showActions(null); } };
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
    document.addEventListener('pointerdown', outside);
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
      document.removeEventListener('pointerdown', outside);
      element.removeEventListener('contextmenu', contextMenu);
      document.removeEventListener('keydown', keyDown);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', cancel);
    };
  }, []);

  const conflict = preview && moveConflict(preview.event, props.events);
  const completedIds=new Set(props.timelineTasks?.filter(t=>t.status==='done').map(t=>t.id));
  const firstCompleted=props.events.findIndex(e=>completedIds.has(e.taskId??''));
  const completedCount=new Set(props.events.filter(e=>completedIds.has(e.taskId??'')).map(e=>e.taskId)).size;
  return <div ref={root} className={`calendar-agenda ${preview ? 'is-moving' : ''}`}>
    {!props.events.length && <div className="calendar-empty"><Clock3 size={25}/><strong>{props.timelineTasks?'이날 할 일과 일정이 없어요':'예정된 일정이 없어요'}</strong><p>상단의 일정 추가로 하루를 계획해 보세요.</p></div>}
    {props.events.map((event,index) => {
      const task=props.timelineTasks?.find(t=>t.id===event.taskId),untimed=event.id.startsWith('task-due:');
      const canSchedule=untimed&&task&&task.status!=='done'&&!!props.onScheduleTask;
      const active = preview?.event.id === event.id;
      const shown = active ? preview.event : event;
      const restriction = moveRestriction(event);
      const editable = canEditCalendarEvent(event);
      const actionsOpen = openActionsId === event.id;
      const swiping = swipe?.id === event.id;
      const deletingTask=deleting?.id===event.id?deleting:null;
      const offset = deletingTask ? deletingTask.offset : swiping ? swipe.offset : actionsOpen ? -SWIPE_ACTION_WIDTH : 0;
      const project = props.projects.find(p => p.id === event.projectId);
      return <Fragment key={event.id}>{index===firstCompleted&&<h3 className="calendar-completed-heading">완료한 할 일 <span>{completedCount}개</span></h3>}<div className={`agenda-row ${active ? 'agenda-moving' : ''} ${task?.status==='done'?'agenda-task-done':''}`} id={'agenda-row-'+event.id} data-agenda-row={event.id}>
        <time className="agenda-time">{shown.allDay?<>{untimed?(task?.status==='done'?'완료':'미배정'):'종일'}<span>{untimed?'할 일':'일정'}</span></>:<>{formatTime(shown.start)}<span>{formatTime(shown.end)}</span></>}</time>
        <div className="agenda-swipe-shell" style={{transform: active && !preview.saving ? `translateY(${preview.delta}px)` : undefined}}>
        <div className={`agenda-swipe-clip ${swiping || deletingTask ? 'is-swiping' : ''} ${actionsOpen ? 'actions-open' : ''} ${deletingTask ? 'is-deleting-task' : ''} ${deletingTask?.ready?'delete-ready':''}`}>
          {deletingTask&&<div className="agenda-delete-target" aria-hidden="true"><Trash2 size={24}/><span>{deletingTask.saving?'삭제 중…':deletingTask.ready?'놓으면 삭제':'오른쪽으로'}</span></div>}
          {editable && <div id={`agenda-actions-${event.id}`} className="agenda-swipe-actions" role="group" aria-label={`${event.title} 수정 및 삭제`} aria-hidden={!actionsOpen} style={{visibility: offset < 0 ? 'visible' : 'hidden'}}>
            <button type="button" className="agenda-action-edit" tabIndex={actionsOpen ? 0 : -1} disabled={props.disabled || !!preview || !actionsOpen || swiping} aria-label={`${event.title} 수정`} onClick={()=>{showActions(null);props.onEdit(event.id)}}><Pencil size={18}/><span>수정</span></button>
            <button type="button" className="agenda-action-delete" tabIndex={actionsOpen ? 0 : -1} disabled={props.disabled || !!preview || !actionsOpen || swiping} aria-label={`${event.title} 삭제`} onClick={()=>{showActions(null);props.onDelete(event)}}><Trash2 size={18}/><span>삭제</span></button>
          </div>}
        <div className={`agenda-card ${active && conflict ? 'has-conflict' : ''}`}
          style={{ '--event-color': calendarItemColor(event,props.preferences,event.taskId?'task':'event',task??props.colorTasks?.find(t=>t.id===event.taskId)), transform: `translateX(${offset}px)` } as CSSProperties}>
          {task&&props.onToggleTask&&<label className="agenda-task-checkbox"><Checkbox checked={task.status==='done'} disabled={props.disabled||!!preview||!!deleting} aria-label={`${task.title} ${task.status==='done'?'완료 취소':'완료'}`} onCheckedChange={()=>props.onToggleTask!(task.id)}/></label>}
          <button type="button" className="agenda-event" disabled={props.disabled&&!!canSchedule} data-move-event={event.id}
            aria-label={`${event.title}, ${shown.allDay?(untimed?'시간 미정 할 일':'종일 일정'):formatTime(shown.start)+'부터 '+formatTime(shown.end)+'까지'}${canSchedule?', 시간 배정':restriction ? ', ' + restriction : ''}`}
            onClick={e => { if (session.current?.active || Date.now() < suppressClickUntil.current || saving.current) { e.preventDefault(); return; } if(openActions.current === event.id){showActions(null);return;} if(canSchedule){props.onScheduleTask!(task!.id);return;} props.onOpen(event); }}>
            {props.timelineTasks&&<span className="agenda-type-label">{task?(untimed?'할 일':'할 일 · 일정'):'일정'}{task?.status==='done'?' · 완료':''}</span>}
            <strong>{task?.title??event.title}</strong>
            <span className="agenda-meta">{eventScopeLabels[eventScope(event)]}{project&&<><span>·</span>{project.name}</>}<span>·</span>{event.allDay?categoryLabels[categoryOf(event)]:`${event.end - event.start}분 · ${categoryLabels[categoryOf(event)]}`}</span>
            {task&&untimed&&<span className="agenda-task-status">예상 {task.duration}분 · {statusLabel[task.status]}{task.status!=='done'&&props.date&&task.due<props.date?` · 이월 (${task.due.slice(5).replace('-','/')} 마감)`:''}</span>}
            {canSchedule&&<span className="agenda-schedule-prompt"><CalendarPlus size={16}/>시간 배정<ArrowRight size={16}/></span>}
            {restriction && !canSchedule && <span className="agenda-restriction"><LockKeyhole size={12}/>{restriction}</span>}
            {active && <span className="agenda-new-time">{formatTime(shown.start)}–{formatTime(shown.end)}{preview.saving ? ' · 저장 중…' : ''}</span>}
          </button>
          {editable && <button type="button" className="agenda-action-toggle" aria-label={`${event.title} 수정·삭제 메뉴`} aria-expanded={actionsOpen} aria-controls={`agenda-actions-${event.id}`} disabled={props.disabled || !!preview || swiping} onClick={e=>{focusActionsOnOpen.current=e.detail===0;showActions(actionsOpen ? null : event.id)}}><MoreHorizontal size={20}/></button>}
        </div>
        </div>
        </div>
      </div></Fragment>;
    })}
    {deleting&&<div className="calendar-drag-feedback calendar-delete-feedback" role="status" aria-live="polite"><Trash2 size={20}/><div><strong>{deleting.saving?'할 일을 삭제하고 있어요':deleting.ready?'손을 놓으면 삭제됩니다':'오른쪽으로 밀어 삭제'}</strong><span>{deleting.saving?'저장 결과를 확인하고 있습니다':'왼쪽으로 되돌린 뒤 놓으면 취소'}</span></div></div>}
    {preview && <div className={`calendar-drag-feedback ${conflict ? 'has-conflict' : ''}`} role="status" aria-live="polite">
      <ArrowDownUp size={20}/><div><strong>{formatTime(preview.event.start)} — {formatTime(preview.event.end)}</strong><span>{preview.saving ? '변경한 시간을 저장하는 중…' : conflict ? `‘${conflict.title}’ 일정과 겹쳐요 · 놓으면 등록 여부를 확인합니다` : '위로는 더 일찍 · 아래로는 더 늦게 · 놓으면 저장'}</span></div>
    </div>}
  </div>;
}
