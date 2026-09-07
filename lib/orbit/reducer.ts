import { planFromBrief } from './brief/planning.ts';
import type { WorkspaceData, Task, Proposal, Improvement } from './model.ts';
import type { WorkspaceAction } from './validation.ts';
import { todayInZone, addDays } from './dates.ts';
import { meetingCandidates } from './meeting.ts';
import { focusIds } from './derived.ts';
import { generateProposal, approveProposalItem, overlaps, calibrationFactor } from './planner.ts';
export class DomainError extends Error {}
const fail = (message: string): never => {
  throw new DomainError(message);
};
function replace<T extends { id: string }>(list: T[], record: T) {
  return list.some((x) => x.id === record.id)
    ? list.map((x) => (x.id === record.id ? record : x))
    : [...list, record];
}
export const LIMITS = { goals: 12, improvements: 40, habits: 3, risks: 10, habitLog: 400 };
export function validateLinks(data: WorkspaceData) {
  const projectIds = new Set(data.projects.map((p) => p.id));
  const taskIds = new Set(data.tasks.map((t) => t.id));
  const noteIds = new Set(data.notes.map((n) => n.id));
  const goalIds = new Set((data.goals ?? []).map((g) => g.id));
  for (const t of data.tasks) {
    if (!projectIds.has(t.projectId)) fail('연결할 프로젝트가 없습니다.');
    if (t.noteId && !noteIds.has(t.noteId)) fail('연결할 기록이 없습니다.');
    for (const id of t.dependsOn ?? [])
      if (id === t.id || !taskIds.has(id)) fail('선행 작업을 확인해 주세요.');
  }
  const visit = (id: string, seen: Set<string>, done: Set<string>) => {
    if (seen.has(id)) fail('선행 작업이 순환하고 있습니다.');
    if (done.has(id)) return;
    seen.add(id);
    for (const dep of data.tasks.find((t) => t.id === id)?.dependsOn ?? []) visit(dep, seen, done);
    seen.delete(id);
    done.add(id);
  };
  const done = new Set<string>();
  for (const t of data.tasks) visit(t.id, new Set(), done);
  for (const n of data.notes) if (!projectIds.has(n.projectId)) fail('기록의 프로젝트를 확인해 주세요.');
  for (const e of data.events) {
    if (e.projectId && !projectIds.has(e.projectId)) fail('일정의 프로젝트를 확인해 주세요.');
    if (e.taskId && !taskIds.has(e.taskId)) fail('일정의 할 일을 확인해 주세요.');
  }
  for (const p of data.projects)
    if (p.goalId && !goalIds.has(p.goalId)) fail('프로젝트의 목표를 확인해 주세요.');
  for (const g of data.goals ?? [])
    if (g.parentId && (g.parentId === g.id || !goalIds.has(g.parentId))) fail('상위 목표를 확인해 주세요.');
  if (data.dominoProjectId && !projectIds.has(data.dominoProjectId)) fail('도미노 프로젝트를 확인해 주세요.');
  for (const r of data.risks ?? [])
    if (r.projectId && !projectIds.has(r.projectId)) fail('리스크의 프로젝트를 확인해 주세요.');
  const laserDates = data.tasks.filter((t) => t.laserDate).map((t) => t.laserDate!);
  if (new Set(laserDates).size !== laserDates.length) fail('하루의 Goal Laser는 하나입니다.');
  if (data.tasks.filter((t) => t.startedAt).length > 1) fail('집중 세션은 한 번에 하나만 진행합니다.');
  if ((data.goals ?? []).length > LIMITS.goals) fail(`목표는 ${LIMITS.goals}개까지 둘 수 있습니다.`);
  if ((data.habits ?? []).length > LIMITS.habits)
    fail('습관은 지킬 습관 1개와 버릴 습관 2개, 최대 3개입니다.');
  if ((data.risks ?? []).length > LIMITS.risks)
    fail(`상시 리스크는 ${LIMITS.risks}개까지 둡니다. 해결된 것을 닫아 주세요.`);
  if ((data.improvements ?? []).length > LIMITS.improvements)
    fail('지켜갈 규칙이 너무 많습니다. 오래된 규칙을 정리해 주세요.');
}
const elapsedMinutes = (startedAt: string, now: Date) =>
  Math.max(0, Math.round((now.getTime() - Date.parse(startedAt)) / 60000));
function addImprovement(data: WorkspaceData, improvement: Improvement) {
  const list = data.improvements ?? [];
  if (list.some((i) => i.rule.trim() === improvement.rule.trim() && i.active)) return;
  const next = replace(list, improvement);
  while (next.length > LIMITS.improvements) {
    const inactive = next.findIndex((i) => !i.active);
    if (inactive < 0) fail('지켜갈 규칙이 40개에 도달했습니다. 오래된 규칙을 정리해 주세요.');
    next.splice(inactive, 1);
  }
  data.improvements = next;
}
export function applyAction(
  current: WorkspaceData,
  action: WorkspaceAction,
  now = new Date(),
): WorkspaceData {
  const data = structuredClone(current);
  const today = todayInZone(data.preferences.timeZone, now);
  const task = (id: string) => data.tasks.find((t) => t.id === id) ?? fail('할 일을 찾을 수 없습니다.');
  const proposal = (date: string) =>
    data.proposals.find((p) => p.date === date) ?? fail('제안을 먼저 생성해 주세요.');
  const saveProposal = (p: Proposal) => {
    data.proposals = replace(data.proposals, p);
  };
  const plannerOptions = (date: string) => ({
    dominoProjectId: data.dominoProjectId,
    calibration: (t: Task) => calibrationFactor(data.tasks, t, date),
  });
  const finishSession = (t: Task) => {
    if (!t.startedAt) return;
    t.actualMinutes = (t.actualMinutes ?? 0) + elapsedMinutes(t.startedAt, now);
    delete t.startedAt;
  };
  const assertFocusRoom = (t: Task, date: string) => {
    if (
      data.tasks.filter((x) => x.id !== t.id && x.focus && x.focusDate === date && x.status !== 'done')
        .length >= data.preferences.focusLimit
    )
      fail('핵심 결과물 개수를 초과했습니다. 기존 항목을 조정해 주세요.');
  };
  switch (action.type) {
    case 'project.upsert':
      data.projects = replace(data.projects, action.project);
      break;
    case 'project.delete':
      if (
        data.tasks.some((t) => t.projectId === action.id) ||
        data.notes.some((n) => n.projectId === action.id) ||
        data.events.some((e) => e.projectId === action.id)
      )
        fail('연결된 할 일·기록·일정을 먼저 정리해 주세요.');
      data.projects = data.projects.filter((p) => p.id !== action.id);
      if (data.dominoProjectId === action.id) delete data.dominoProjectId;
      data.risks = (data.risks ?? []).map((r) =>
        r.projectId === action.id ? { ...r, projectId: undefined } : r,
      );
      break;
    case 'project.domino':
      if (action.id === null) delete data.dominoProjectId;
      else {
        if (!data.projects.some((p) => p.id === action.id)) fail('도미노로 지정할 프로젝트가 없습니다.');
        data.dominoProjectId = action.id;
      }
      break;
    case 'goal.upsert':
      data.goals = replace(data.goals ?? [], action.goal);
      break;
    case 'goal.delete':
      if (
        data.projects.some((p) => p.goalId === action.id) ||
        (data.goals ?? []).some((g) => g.parentId === action.id)
      )
        fail('이 목표에 연결된 프로젝트나 하위 목표를 먼저 정리해 주세요.');
      data.goals = (data.goals ?? []).filter((g) => g.id !== action.id);
      break;
    case 'task.upsert': {
      const t = { ...action.task };
      const old = data.tasks.find((x) => x.id === t.id);
      t.noteCitation = old?.noteId === t.noteId ? old?.noteCitation : undefined;
      // Execution history survives edits that omit it (agent proposals send full records).
      for (const key of [
        'actualMinutes',
        'outcome',
        'outcomeReason',
        'startedAt',
        'laserDate',
        'unplanned',
      ] as const)
        if (t[key] === undefined && old?.[key] !== undefined) (t as Record<string, unknown>)[key] = old[key];
      if (
        !old &&
        t.due === today &&
        data.proposals.some((p) => p.date === today) &&
        t.unplanned === undefined
      )
        t.unplanned = true;
      if (t.focus) {
        t.focusDate = t.focusDate ?? today;
        assertFocusRoom(t, t.focusDate);
      }
      if (t.status === 'done') t.completedOn = t.completedOn ?? today;
      data.tasks = replace(data.tasks, t);
      for (const e of data.events.filter((e) => e.taskId === t.id)) {
        e.title = t.title;
        e.projectId = t.projectId;
      }
      break;
    }
    case 'task.status': {
      const t = task(action.id);
      t.status = action.status;
      t.completedOn = action.status === 'done' ? today : undefined;
      if (action.status === 'done') finishSession(t);
      if (action.status !== 'done') delete t.outcome;
      break;
    }
    case 'task.focus': {
      const t = task(action.id);
      if (action.focus) assertFocusRoom(t, today);
      if (action.focus && t.planHoldUntil && t.planHoldUntil > today)
        fail('아직 보류 중인 업무입니다. 제안 화면에서 먼저 다시 검토해 주세요.');
      t.focus = action.focus;
      t.focusDate = action.focus ? today : undefined;
      break;
    }
    case 'task.laser': {
      const t = task(action.id);
      if (action.laser) {
        if (t.status === 'done') fail('완료한 일은 Goal Laser로 지정할 수 없습니다.');
        const other = data.tasks.find((x) => x.id !== t.id && x.laserDate === action.date);
        if (other) fail(`${action.date}의 Goal Laser는 이미 "${other.title}"입니다. 하루에 하나만 둡니다.`);
        if (!(t.focus && t.focusDate === action.date)) assertFocusRoom(t, action.date);
        t.laserDate = action.date;
        t.focus = true;
        t.focusDate = action.date;
      } else if (t.laserDate === action.date) delete t.laserDate;
      break;
    }
    case 'task.assign': {
      for (const { id, projectId } of action.assignments) {
        const t = task(id);
        if (!data.projects.some((p) => p.id === projectId)) fail('옮길 프로젝트를 찾을 수 없습니다.');
        t.projectId = projectId;
        for (const e of data.events.filter((e) => e.taskId === t.id)) e.projectId = projectId;
      }
      break;
    }
    case 'task.start': {
      const t = task(action.id);
      if (t.status === 'done') fail('완료한 일은 다시 시작할 수 없습니다. 상태를 먼저 바꿔 주세요.');
      const running = data.tasks.find((x) => x.id !== t.id && x.startedAt);
      if (running) fail(`"${running.title}" 집중 세션이 진행 중입니다. 먼저 끝내 주세요.`);
      if (!t.startedAt) t.startedAt = now.toISOString();
      if (t.status === 'todo') t.status = 'doing';
      break;
    }
    case 'task.stop': {
      const t = task(action.id);
      if (!t.startedAt) fail('진행 중인 집중 세션이 없습니다.');
      finishSession(t);
      break;
    }
    case 'task.record': {
      const t = task(action.id);
      finishSession(t);
      if (action.actualMinutes !== undefined) t.actualMinutes = action.actualMinutes;
      t.outcome = action.outcome;
      if (action.outcome === 'done') {
        t.status = 'done';
        t.completedOn = t.completedOn ?? today;
        delete t.outcomeReason;
      } else {
        t.outcomeReason = action.reason ?? 'other';
        if (action.outcome === 'partial' && t.status === 'todo') t.status = 'doing';
      }
      if (action.rule?.trim())
        addImprovement(data, {
          id: `rule:${t.id}:${today}`,
          rule: action.rule.trim(),
          kind: action.ruleKind ?? 'other',
          createdOn: today,
          active: true,
          source: t.title.slice(0, 60),
        });
      break;
    }
    case 'task.delete':
      if (data.tasks.some((t) => t.dependsOn?.includes(action.id)))
        fail('다른 업무의 선행 작업입니다. 연결을 먼저 해제해 주세요.');
      data.tasks = data.tasks.filter((t) => t.id !== action.id);
      data.events = data.events.filter((e) => e.taskId !== action.id);
      for (const p of data.proposals) {
        p.items = p.items.filter((i) => i.taskId !== action.id);
        p.unscheduled = p.unscheduled.filter((id) => id !== action.id);
        if (p.delegate) p.delegate = p.delegate.filter((id) => id !== action.id);
        if (p.laser?.taskId === action.id)
          p.laser = {
            status: 'none',
            minutes: 0,
            note: '삭제된 할 일이었습니다. 제안을 다시 생성해 주세요.',
          };
      }
      break;
    case 'note.upsert':
      data.notes = replace(data.notes, {
        ...action.note,
        updated: today,
        revision:
          (data.notes.find((n) => n.id === action.note.id)?.revision ??
            (data.notes.some((n) => n.id === action.note.id) ? 1 : 0)) + 1,
        bodyStored: false,
      });
      break;
    case 'note.restore':
      fail('이전 내용은 서버에서 확인한 뒤 복원해 주세요.');
      break;
    case 'meeting.acceptActions': {
      const note = data.notes.find((n) => n.id === action.noteId) ?? fail('회의록을 찾을 수 없습니다.');
      if ((note.revision ?? 1) !== action.expectedNoteRevision)
        fail('회의록이 변경됐습니다. 최신 내용을 확인해 주세요.');
      const candidates = meetingCandidates(note);
      for (const item of action.items) {
        const source =
          candidates.find((c) => c.line === item.line) ?? fail('원문에서 해당 행동을 확인할 수 없습니다.');
        if (
          data.tasks.some(
            (t) =>
              t.noteId === note.id &&
              t.noteCitation &&
              (t.noteCitation.quote === source.quote ||
                (t.noteCitation.revision === action.expectedNoteRevision &&
                  t.noteCitation.line === item.line)),
          )
        )
          continue;
        if (data.tasks.some((t) => t.id === item.id)) fail('이미 사용 중인 할 일 번호입니다.');
        data.tasks.push({
          id: item.id,
          title: item.title,
          projectId: note.projectId,
          status: 'todo',
          duration: item.duration,
          due: item.due,
          impact: 3,
          focus: false,
          definition: item.definition,
          noteId: note.id,
          noteCitation: { revision: action.expectedNoteRevision, line: item.line, quote: source.quote },
        });
      }
      break;
    }
    case 'note.delete':
      if (data.tasks.some((t) => t.noteId === action.id))
        fail('이 기록을 참조하는 할 일이 있습니다. 연결을 먼저 해제해 주세요.');
      data.notes = data.notes.filter((n) => n.id !== action.id);
      break;
    case 'event.upsert': {
      const e = action.event;
      if (e.id.startsWith('google:')) fail('Google 일정은 원본 캘린더에서 수정해 주세요.');
      if (e.id.startsWith('approved:')) fail('승인한 집중 시간은 제안 화면에서 조정해 주세요.');
      if (data.events.some((x) => x.id !== e.id && x.date === e.date && overlaps(x, e)))
        fail('같은 시간에 다른 일정이 있습니다.');
      data.events = replace(data.events, e);
      break;
    }
    case 'event.attach': {
      if (!data.events.some((e) => e.id === action.id)) fail('첨부할 일정을 찾을 수 없습니다.');
      break;
    }
    case 'event.delete': {
      if (action.id.startsWith('google:')) fail('Google 일정은 원본 캘린더에서 삭제해 주세요.');
      if (action.id.startsWith('approved:')) fail('집중 시간은 제안 화면에서 승인을 취소해 주세요.');
      data.events = data.events.filter((e) => e.id !== action.id);
      break;
    }
    case 'review.save':
    case 'review.saveGenerate': {
      if (action.review.date > today) fail('미래 날짜의 회고는 아직 기록할 수 없습니다.');
      const detail = action.detail;
      if (detail && detail.date !== action.review.date) fail('회고 상세의 날짜가 다릅니다.');
      let stats: NonNullable<WorkspaceData['reviews'][number]['stats']> | undefined;
      if (detail) {
        for (const item of detail.items) {
          const t = data.tasks.find((x) => x.id === item.taskId);
          if (!t) continue;
          finishSession(t);
          if (item.actualMinutes !== undefined) t.actualMinutes = item.actualMinutes;
          t.outcome = item.outcome;
          if (item.outcome === 'done') {
            if (t.status !== 'done') {
              t.status = 'done';
              t.completedOn = action.review.date;
            }
            delete t.outcomeReason;
          } else {
            t.outcomeReason = item.reason ?? 'other';
            if (item.outcome === 'partial' && t.status === 'todo') t.status = 'doing';
          }
        }
        for (const fb of detail.feedback)
          if (fb.rule.trim())
            addImprovement(data, {
              id: `rule:${action.review.date}:${fb.taskId ?? 'day'}:${(data.improvements ?? []).length}`,
              rule: fb.rule.trim(),
              kind: fb.kind ?? 'other',
              createdOn: action.review.date,
              active: true,
              source: fb.taskId
                ? data.tasks.find((t) => t.id === fb.taskId)?.title.slice(0, 60)
                : '저녁 회고',
            });
        for (const habitId of detail.habitChecks) {
          const habit = (data.habits ?? []).find((h) => h.id === habitId);
          if (habit && !habit.log.includes(action.review.date)) {
            habit.log = [...habit.log, action.review.date].sort().slice(-LIMITS.habitLog);
          }
        }
        const laserId = data.tasks.find((t) => t.laserDate === action.review.date)?.id;
        const laserItem = detail.items.find((i) => i.taskId === laserId);
        const done = detail.items.filter((i) => i.outcome === 'done').length;
        stats = {
          planned: detail.items.length,
          done,
          partial: detail.items.filter((i) => i.outcome === 'partial').length,
          skipped: detail.items.filter((i) => i.outcome === 'skipped').length,
          laserMinutes:
            laserItem?.actualMinutes ?? (laserItem?.outcome === 'done' ? laserItem.estimateMinutes : 0),
          executionRate: detail.items.length ? Math.round((done / detail.items.length) * 100) : 0,
        };
      }
      data.reviews = replace(data.reviews, {
        ...action.review,
        id: action.review.date,
        completedIds: data.tasks
          .filter((t) => t.completedOn === action.review.date && t.status === 'done')
          .map((t) => t.id),
        updatedAt: now.toISOString(),
        ...(stats ? { stats } : {}),
        ...(detail ? { habitChecks: detail.habitChecks, hasDetail: true } : {}),
        ...(detail?.smallWins[0] ? { highlight: detail.smallWins[0] } : {}),
      });
      if (action.type === 'review.save') break;
      const date = addDays(action.review.date, 1);
      saveProposal(
        generateProposal(
          data.tasks,
          data.events,
          date,
          action.review.energy,
          data.proposals.find((p) => p.date === date),
          data.preferences,
          plannerOptions(date),
        ),
      );
      break;
    }
    case 'proposal.brief':
      saveProposal(planFromBrief(data, action.brief, action.energy));
      break;
    case 'proposal.generate':
      saveProposal(
        generateProposal(
          data.tasks,
          data.events,
          action.date,
          action.energy,
          data.proposals.find((p) => p.date === action.date),
          data.preferences,
          plannerOptions(action.date),
        ),
      );
      break;
    case 'proposal.approve': {
      const p = proposal(action.date);
      if (p.date < today) fail('지난 날짜의 제안은 승인할 수 없습니다.');
      const item = p.items.find((i) => i.id === action.itemId) ?? fail('제안 항목을 찾을 수 없습니다.');
      if (item.draftTask && !data.tasks.some((t) => t.id === item.taskId)) {
        data.tasks.push({ ...item.draftTask });
      }
      const count = data.tasks.filter(
        (t) => t.id !== item.taskId && focusIds(data, p.date).has(t.id) && t.status !== 'done',
      ).length;
      if (item.state !== 'approved' && count >= data.preferences.focusLimit)
        fail('이미 지정한 핵심 결과물이 있습니다. 먼저 계획을 조정해 주세요.');
      const out = approveProposalItem(p, action.itemId, data.tasks, data.events);
      if (out.error) fail(out.error);
      saveProposal(out.proposal);
      data.events = out.events;
      const t = task(item.taskId);
      if (!t.focus) {
        t.focus = true;
        t.focusDate = p.date;
      }
      if (item.role === 'laser') {
        const other = data.tasks.find((x) => x.id !== t.id && x.laserDate === p.date);
        if (other) delete other.laserDate;
        t.laserDate = p.date;
      }
      delete t.planHoldUntil;
      delete t.planHoldReason;
      delete t.planHoldProposalId;
      break;
    }
    case 'proposal.defer': {
      const p = proposal(action.date),
        item = p.items.find((i) => i.id === action.itemId) ?? fail('제안 항목이 없습니다.');
      if (item.state === 'approved') fail('먼저 승인을 취소해 주세요.');
      if (action.revisitDate <= p.date) fail('다음 검토일은 계획 날짜 이후로 지정해 주세요.');
      item.state = 'deferred';
      item.deferReason = action.reason;
      item.revisitDate = action.revisitDate;
      const t =
        data.tasks.find((t) => t.id === item.taskId) ??
        item.draftTask ??
        fail('제안 업무를 찾을 수 없습니다.');
      t.planHoldUntil = action.revisitDate;
      t.planHoldReason = action.reason;
      t.planHoldProposalId = p.id;
      break;
    }
    case 'proposal.reconsider': {
      const item =
        proposal(action.date).items.find((i) => i.id === action.itemId) ?? fail('제안 항목이 없습니다.');
      if (item.state !== 'deferred') fail('보류한 항목만 다시 검토할 수 있습니다.');
      item.state = 'pending';
      delete item.deferReason;
      delete item.revisitDate;
      const t =
        data.tasks.find((t) => t.id === item.taskId) ??
        item.draftTask ??
        fail('제안 업무를 찾을 수 없습니다.');
      if (t.planHoldProposalId === proposal(action.date).id) {
        delete t.planHoldUntil;
        delete t.planHoldReason;
        delete t.planHoldProposalId;
      }
      break;
    }
    case 'proposal.revoke': {
      const p = proposal(action.date),
        item = p.items.find((i) => i.id === action.itemId) ?? fail('제안 항목이 없습니다.');
      if (item.state !== 'approved') fail('승인한 항목만 취소할 수 있습니다.');
      item.state = 'pending';
      data.events = data.events.filter((e) => e.id !== `approved:${item.id}`);
      const t = task(item.taskId);
      if (t.focusDate === p.date) {
        t.focus = false;
        t.focusDate = undefined;
      }
      if (item.role === 'laser' && t.laserDate === p.date) delete t.laserDate;
      break;
    }
    case 'preferences.update':
      data.preferences = { ...action.preferences, workDays: [...new Set(action.preferences.workDays)] };
      break;
    case 'improvement.add':
      addImprovement(data, action.improvement);
      break;
    case 'improvement.retire':
      data.improvements = (data.improvements ?? []).map((i) =>
        i.id === action.id ? { ...i, active: false } : i,
      );
      break;
    case 'habit.upsert': {
      const list = data.habits ?? [];
      if (!list.some((h) => h.id === action.habit.id) && list.length >= LIMITS.habits)
        fail('습관은 최대 3개(지킬 습관 1개, 버릴 습관 2개)입니다.');
      data.habits = replace(list, {
        ...action.habit,
        log: [...new Set(action.habit.log)].sort().slice(-LIMITS.habitLog),
      });
      break;
    }
    case 'habit.delete':
      data.habits = (data.habits ?? []).filter((h) => h.id !== action.id);
      break;
    case 'habit.check': {
      const habit = (data.habits ?? []).find((h) => h.id === action.id) ?? fail('습관을 찾을 수 없습니다.');
      if (action.date > today) fail('미래 날짜의 습관은 체크할 수 없습니다.');
      habit.log = action.checked
        ? [...new Set([...habit.log, action.date])].sort().slice(-LIMITS.habitLog)
        : habit.log.filter((d) => d !== action.date);
      break;
    }
    case 'risk.upsert': {
      const list = data.risks ?? [];
      if (!list.some((r) => r.id === action.risk.id) && list.length >= LIMITS.risks)
        fail(`상시 리스크는 ${LIMITS.risks}개까지 둡니다. 해결된 것을 먼저 닫아 주세요.`);
      data.risks = replace(list, action.risk);
      break;
    }
    case 'risk.close':
      data.risks = (data.risks ?? []).filter((r) => r.id !== action.id);
      break;
  }
  validateLinks(data);
  if (
    new TextEncoder().encode(JSON.stringify({ ...data, notes: data.notes.map((n) => ({ ...n, body: '' })) }))
      .byteLength > 950000
  )
    fail('현재 저장 용량에 가까워졌습니다. 기록을 내보내고 오래된 내용을 정리해 주세요.');
  return data;
}
