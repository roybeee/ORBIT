import type { DailyBrief } from './brief/schema';
export type View =
  'agent' | 'today' | 'calendar' | 'tasks' | 'projects' | 'wiki' | 'knowledge' | 'review' | 'proposal';
export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'done';
// BRAINY / GoTEM vocabulary carried by the domain model.
// Quadrant = Eisenhower matrix (A important+urgent, B important, C urgent, D neither).
// Cognition = cognitive load of the block (high / mid / low) or an external meeting/call.
export type Quadrant = 'A' | 'B' | 'C' | 'D';
export type Cognition = 'high' | 'mid' | 'low' | 'external';
export type Outcome = 'done' | 'partial' | 'skipped';
export type OutcomeReason = 'time' | 'waiting' | 'priority' | 'scope' | 'energy' | 'other';
export type ImprovementKind = 'buffer' | 'placement' | 'estimate' | 'habit' | 'decline' | 'other';
export interface Project {
  id: string;
  name: string;
  color: string;
  symbol: string;
  goal: string;
  due: string;
  priority: number;
  goalId?: string;
}
export interface Task {
  id: string;
  title: string;
  projectId: string;
  status: TaskStatus;
  duration: number;
  due: string;
  impact: number;
  focus: boolean;
  focusDate?: string;
  definition: string;
  noteId?: string;
  noteCitation?: { revision: number; line: number; quote: string };
  blocker?: string;
  checkDate?: string;
  completedOn?: string;
  dependsOn?: string[];
  result?: string;
  planHoldUntil?: string;
  planHoldReason?: string;
  planHoldProposalId?: string;
  quadrant?: Quadrant;
  cognition?: Cognition;
  must?: boolean;
  unplanned?: boolean;
  actualMinutes?: number;
  outcome?: Outcome;
  outcomeReason?: OutcomeReason;
  startedAt?: string;
  laserDate?: string;
}
export interface Goal {
  id: string;
  kind: 'life' | 'mid' | 'short' | 'concept';
  sentence: string;
  metric?: string;
  deadline?: string;
  parentId?: string;
}
export interface Improvement {
  id: string;
  rule: string;
  kind: ImprovementKind;
  createdOn: string;
  active: boolean;
  source?: string;
}
export interface Habit {
  id: string;
  title: string;
  mode: 'keep' | 'quit';
  startedOn: string;
  log: string[];
}
export interface Risk {
  id: string;
  title: string;
  checkDate: string;
  condition: string;
  projectId?: string;
}
export interface Note {
  id: string;
  title: string;
  kind: 'meeting' | 'wiki' | 'knowledge';
  projectId: string;
  summary: string;
  body: string;
  tags: string[];
  updated: string;
  revision?: number;
  bodyStored?: boolean;
}
export interface NoteRevision {
  revision: number;
  title: string;
  updatedAt: string;
}
export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  start: number;
  end: number;
  kind: 'meeting' | 'focus' | 'break';
  projectId?: string;
  taskId?: string;
}
export interface ProposalItem {
  draftTask?: Task;
  id: string;
  taskId: string;
  start: number;
  end: number;
  reason: string;
  state: 'pending' | 'approved' | 'deferred';
  deferReason?: string;
  revisitDate?: string;
  role?: 'laser' | 'must' | 'fill';
  quadrant?: Quadrant;
  cognition?: Cognition;
  factor?: number;
  estimate?: number;
}
export interface Proposal {
  brief?: DailyBrief;
  draftTasks?: Task[];
  id: string;
  date: string;
  items: ProposalItem[];
  unscheduled: string[];
  budget: number;
  energy: 'low' | 'normal' | 'high';
  laser?: { taskId?: string; status: 'placed' | 'failed' | 'none'; minutes: number; note: string };
  delegate?: string[];
}
export interface Rhythm {
  peakStart: number;
  peakEnd: number;
  lunchStart: number;
  lunchEnd: number;
}
export interface Preferences {
  timeZone: string;
  workStart: number;
  workEnd: number;
  workDays: number[];
  focusLimit: number;
  breakMinutes: number;
  bufferFraction: number;
  rhythm?: Rhythm;
  laserMinutes?: number;
  travelMinutes?: number;
  colorBy?: 'project' | 'cognition';
}
export interface ReviewStats {
  planned: number;
  done: number;
  partial: number;
  skipped: number;
  laserMinutes: number;
  executionRate: number;
}
export interface ReviewItem {
  taskId: string;
  title: string;
  outcome: Outcome;
  estimateMinutes: number;
  actualMinutes?: number;
  reason?: OutcomeReason;
}
export interface ReviewFeedback {
  taskId?: string;
  cause: string;
  alternative: string;
  rule: string;
  kind?: ImprovementKind;
}
export interface ReviewDetail {
  date: string;
  items: ReviewItem[];
  feedback: ReviewFeedback[];
  energy: { sleepMinutes?: number; exercise?: string; meals?: string; mood?: string };
  smallWins: string[];
  gratitude: string[];
  habitChecks: string[];
}
export interface DailyReview {
  id: string;
  date: string;
  win: string;
  block: string;
  energy: Proposal['energy'];
  completedIds: string[];
  updatedAt: string;
  stats?: ReviewStats;
  habitChecks?: string[];
  highlight?: string;
  hasDetail?: boolean;
}
export interface WorkspaceData {
  schemaVersion: 2 | 3;
  projects: Project[];
  tasks: Task[];
  notes: Note[];
  events: CalendarEvent[];
  proposals: Proposal[];
  reviews: DailyReview[];
  preferences: Preferences;
  goals?: Goal[];
  dominoProjectId?: string;
  improvements?: Improvement[];
  habits?: Habit[];
  risks?: Risk[];
}
export interface WorkspaceSnapshot {
  data: WorkspaceData;
  revision: number;
  updatedAt: string | null;
}
export const DEFAULT_RHYTHM: Rhythm = { peakStart: 540, peakEnd: 720, lunchStart: 720, lunchEnd: 780 };
export const DEFAULT_PREFERENCES: Preferences = {
  timeZone: 'Asia/Seoul',
  workStart: 540,
  workEnd: 1080,
  workDays: [1, 2, 3, 4, 5],
  focusLimit: 3,
  breakMinutes: 10,
  bufferFraction: 0.2,
  rhythm: { ...DEFAULT_RHYTHM },
  laserMinutes: 180,
  travelMinutes: 0,
  colorBy: 'project',
};
// Older stored preferences predate the BRAINY fields; fill them without persisting anything.
export const withDefaults = (p: Preferences): Required<Preferences> => ({
  ...p,
  rhythm: p.rhythm ?? { ...DEFAULT_RHYTHM },
  laserMinutes: p.laserMinutes ?? 180,
  travelMinutes: p.travelMinutes ?? 0,
  colorBy: p.colorBy ?? 'project',
});
export const emptyWorkspace = (): WorkspaceData => ({
  schemaVersion: 2,
  projects: [],
  tasks: [],
  notes: [],
  events: [],
  proposals: [],
  reviews: [],
  preferences: {
    ...DEFAULT_PREFERENCES,
    workDays: [...DEFAULT_PREFERENCES.workDays],
    rhythm: { ...DEFAULT_RHYTHM },
  },
});
export const TODAY = '2026-09-06';
export const TOMORROW = '2026-09-07';
export const formatTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export const durationText = (minute: number) =>
  minute >= 60 ? `${Math.floor(minute / 60)}시간${minute % 60 ? ` ${minute % 60}분` : ''}` : `${minute}분`;
export const statusLabel: Record<TaskStatus, string> = {
  todo: '예정',
  doing: '진행 중',
  waiting: '대기 중',
  done: '완료',
};
export const quadrantLabel: Record<Quadrant, string> = {
  A: 'A · 중요하고 급함',
  B: 'B · 중요하지만 급하지 않음',
  C: 'C · 급하지만 중요하지 않음',
  D: 'D · 중요하지도 급하지도 않음',
};
export const cognitionLabel: Record<Cognition, string> = {
  high: '고위 인지 · 기획·판단',
  mid: '중위 인지 · 처리·정리',
  low: '저위 인지 · 단순 작업',
  external: '외부 · 회의·통화',
};
export const outcomeLabel: Record<Outcome, string> = { done: '완료 ✓', partial: '부분 △', skipped: '못함 ✗' };
export const reasonLabel: Record<OutcomeReason, string> = {
  time: '시간 부족',
  waiting: '외부 대기',
  priority: '우선순위 변경',
  scope: '범위 과대',
  energy: '에너지 부족',
  other: '기타',
};
export const improvementKindLabel: Record<ImprovementKind, string> = {
  buffer: '버퍼',
  placement: '배치',
  estimate: '예측',
  habit: '습관',
  decline: '거절·위임',
  other: '기타',
};
