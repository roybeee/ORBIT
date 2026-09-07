import type { Task, Project, Goal, Improvement, Quadrant, Cognition } from './model.ts';
import { calibrate, inferQuadrant } from './planner.ts';
// The coach checks a task while it is being written, started and finished — not afterwards.
// Every check is advice: nothing here blocks a save (속전속결).
export interface CoachCheck {
  id: string;
  level: 'ok' | 'info' | 'warn';
  title: string;
  detail?: string;
  fix?: { label: string; patch: Partial<Task> };
}
export interface CoachContext {
  today: string;
  tasks: Task[];
  projects: Project[];
  goals: Goal[];
  improvements: Improvement[];
  dominoProjectId?: string;
  factor: number;
}
export type TaskDraft = Pick<
  Task,
  'id' | 'title' | 'projectId' | 'duration' | 'due' | 'definition' | 'impact' | 'status'
> &
  Partial<Pick<Task, 'quadrant' | 'cognition' | 'must' | 'focus'>>;
const HANDOFF =
  /(전달|발송|보내|송부|회신|답장|승인|서명|날인|입금|송금|계약|게시|업로드|제출|공유|넘기|넘긴|넘어간|수령|확정|등록|배포|출시|오픈|완성본|최종본|발행|발주|결제|예약|에게|께|메일|카톡|슬랙|slack|pdf|docx|링크)/i;
export const handoffLike = (definition: string) => HANDOFF.test(definition.trim());
const HIGH = /(기획|설계|전략|분석|검토|작성|초안|제안서|보고서|계획|모델|결정|협상|IR|계약서|디자인)/i;
const EXTERNAL = /(미팅|회의|통화|콜|방문|미팅|인터뷰|면담|발표|피칭|상담)/i;
const LOW = /(정리|입력|전송|발송|출력|예약|확인|이체|정산|업로드|복사|이동)/i;
export function guessCognition(title: string): Cognition {
  if (EXTERNAL.test(title)) return 'external';
  if (HIGH.test(title)) return 'high';
  if (LOW.test(title)) return 'low';
  return 'mid';
}
export function coachTask(draft: TaskDraft, ctx: CoachContext): CoachCheck[] {
  const checks: CoachCheck[] = [];
  const definition = draft.definition ?? '';
  if (!definition.trim())
    checks.push({
      id: 'definition',
      level: 'warn',
      title: '완료 조건이 비어 있습니다',
      detail:
        '무엇이 상대방 손에 넘어가면 끝난 것인지 한 줄로 적어 주세요. 예: 제안서 PDF를 김 대표에게 발송',
    });
  else if (handoffLike(definition))
    checks.push({
      id: 'definition',
      level: 'ok',
      title: '완료 조건이 인계 기준으로 검증할 수 있게 적혀 있습니다',
    });
  else
    checks.push({
      id: 'definition',
      level: 'warn',
      title: '완료 조건이 “내 손에서 끝남”으로 읽힙니다',
      detail: '누구에게 무엇이 넘어가야 완료인지 덧붙여 주세요. 예: 검토 의견을 반영한 회신 메일 발송',
    });
  const quadrant: Quadrant = inferQuadrant({ ...(draft as Task), impact: draft.impact ?? 3 }, ctx.today);
  if (!draft.quadrant)
    checks.push({
      id: 'quadrant',
      level: 'info',
      title: `사분면 추정: ${quadrant}`,
      detail: '중요도와 마감으로 추정했습니다. 다르면 직접 골라 주세요.',
      fix: { label: `${quadrant}로 지정`, patch: { quadrant } },
    });
  if (quadrant === 'D')
    checks.push({
      id: 'delegate',
      level: 'warn',
      title: '중요하지도 급하지도 않은 D 업무입니다',
      detail: '내일 제안에 배치되지 않습니다. 위임하거나 과감히 포기할 후보로 다룹니다.',
    });
  const cognition = draft.cognition ?? guessCognition(draft.title ?? '');
  if (!draft.cognition)
    checks.push({
      id: 'cognition',
      level: 'info',
      title: `인지 등급 추정: ${cognition === 'high' ? '고위' : cognition === 'low' ? '저위' : cognition === 'external' ? '외부' : '중위'}`,
      detail: '고위 인지 업무는 집중이 가장 좋은 구간에, 외부 일정은 그 밖에 배치합니다.',
      fix: { label: '추정값 적용', patch: { cognition } },
    });
  if (ctx.factor !== 1 && draft.duration) {
    const suggested = calibrate(draft.duration, ctx.factor);
    if (suggested !== draft.duration)
      checks.push({
        id: 'estimate',
        level: 'info',
        title: `최근 같은 종류의 일은 예상의 ${ctx.factor}배 걸렸습니다`,
        detail: `${draft.duration}분 → ${suggested}분을 권합니다. 제안 엔진은 자동으로 보정합니다.`,
        fix: { label: `${suggested}분으로`, patch: { duration: suggested } },
      });
  }
  if ((draft.duration ?? 0) > 240)
    checks.push({
      id: 'split',
      level: 'warn',
      title: '4시간이 넘는 일입니다',
      detail: '완료 가능한 하위 결과물로 쪼개면 예측도 실행률도 올라갑니다.',
    });
  if (draft.due && draft.due < ctx.today)
    checks.push({
      id: 'due',
      level: 'warn',
      title: '마감이 지났습니다',
      detail: '새 마감을 정하거나 오늘 반드시 종결로 올리세요.',
    });
  const project = ctx.projects.find((p) => p.id === draft.projectId);
  if (project && ctx.dominoProjectId === project.id && cognition === 'high' && draft.status !== 'done')
    checks.push({
      id: 'laser',
      level: 'info',
      title: '도미노 프로젝트의 고위 인지 업무 — 오늘의 Goal Laser 후보',
      detail: '내일 제안이 집중 구간에 연속 시간을 먼저 확보합니다.',
    });
  if (project && !project.goalId && ctx.goals.length)
    checks.push({
      id: 'goal',
      level: 'info',
      title: '이 프로젝트는 목표에 연결되어 있지 않습니다',
      detail: '프로젝트 화면에서 목표를 연결하면 이 일이 어느 이정표를 밀어내는지 보입니다.',
    });
  const rules = ctx.improvements.filter(
    (i) => i.active && (i.kind === 'estimate' || i.kind === 'buffer' || i.kind === 'placement'),
  );
  if (rules.length)
    checks.push({
      id: 'rules',
      level: 'info',
      title: `적용 중인 규칙 ${rules.length}개`,
      detail: rules
        .slice(0, 2)
        .map((r) => `★ ${r.rule}`)
        .join(' · '),
    });
  return checks;
}
export const deviation = (estimate: number, actual: number) => (estimate > 0 ? actual / estimate - 1 : 0);
export const needsFeedback = (outcome: Task['outcome'], estimate: number, actual?: number) =>
  outcome !== 'done' || (typeof actual === 'number' && Math.abs(deviation(estimate, actual)) > 0.3);
