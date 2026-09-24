'use client';
import {eventScopes,eventScope,eventScopeLabels,type EventScope} from '@/lib/orbit/event-details';
import {GoogleEventEditor} from './google-event-editor';
import {EventPostpone} from './event-postpone';
import {questReadiness} from '@/lib/orbit/pacemaker';
import {CalendarEventDelivery} from './agent/calendar-controls';
import { useState, useMemo, useEffect, useRef, type CSSProperties } from 'react';
import Link from 'next/link';
import {afterPopupClose,replacePopupRoute,pushPopupRoute,ensurePopupHistory} from '@/components/ui/use-popup-history';
import {AppNavigation,AreaSections,SearchTrigger} from './shell/app-navigation';
import {OrbitSearch,useSearchShortcut,type SearchAction} from './shell/orbit-search';
import {MeSheet} from './shell/me-sheet';
import {IaIntro} from './shell/ia-intro';
import {OrbitDock} from './shell/orbit-dock';
import {InboxPanel} from './inbox/inbox-panel';
import {useEveningHour} from './today/use-evening-hour';
import {areaOf,inboxCounts,viewLabels} from '@/lib/orbit/navigation';
import {CityThemeProvider,CityThemeButton,CityScreenBanner} from './city-themes';
import {illustrationTheme,screenIllustration} from '@/lib/orbit/city-themes';
import {AppearanceShortcut} from './appearance';
import {CosmicBackdrop,CosmicMotionToggle,useCosmicMotion} from './cosmic-skin';
import {ExperimentsPanel,ContactsPanel,MonthlyPanel} from './phase4/workbench';
import {VoicePanel} from './phase4/voice';
import {FollowupPanel} from './phase2/followup';
import {LearningPanel} from './phase2/learning';
import {BackupPanel} from './phase2/backup';
import {DataManager} from './data-manager';
import type {TrashRecord} from '@/lib/orbit/data-manager';
import {PortfolioPanel,SignalsPanel,MeetingsPanel} from './phase3/executive';
import {protectedEvents} from '@/lib/orbit/allocation-policy';
import { SoundStation } from './sound/station';
import { DailyBriefPanel } from './brief/daily-brief';
import { ShareIntake } from './attachments/share-intake';
import type { StoredAttachment } from '@/lib/orbit/attachments/types';
import { AttachmentProvider, useAttachments } from './attachments/provider';
import { AttachmentInput, EventFiles } from './attachments/files';
import {
  Orbit,
  Sun,
  CalendarDays,
  CheckCheck,
  FolderKanban,
  MoreHorizontal,
  BookOpen,
  Library,
  Moon,
  Sparkles,
  Plus,
  ChevronRight,
  ArrowRight,
  ArrowUpRight,
  Clock3,
  Search,
  Check,
  Pause,
  Play,
  MessageSquare,
  Link2,
  FileText,
  Layers,
  Target,
  Inbox,
  Settings2,
  Download,
  Pencil,
  Trash2,
  CloudCheck,
  AlertCircle,
  ChevronLeft,
  RefreshCw,
  MessagesSquare,
  Crosshair,
  Wand2,
  Network,
  LayoutGrid,
  Headphones,
  Database,
} from 'lucide-react';
import {
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {Choice} from './choice';
import {WorkspaceSettings} from './workspace-settings';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {NotificationCenter,type NewsSummary} from './notifications';
import type {AgentAction} from '@/lib/orbit/agent/types';
import { Toaster, toast } from 'sonner';
import { focusIds } from '@/lib/orbit/derived';
import {PlaudPanel} from '@/components/orbit/plaud-panel';
import {GotemMetricsCard} from '@/components/orbit/gotem-metrics-card';
import { NoteLibrary } from '@/components/orbit/note-library';
import { NoteDetail } from '@/components/orbit/note-detail';
import { InstallRootHint } from '@/components/orbit/install-app';
import {WorkspaceDashboard} from './dashboard';
import type {WorkOrder} from '@/lib/orbit/agent/orders-schema';
import {TodayHome} from './today-home';
import {CalendarSyncStatus} from './calendar-sync';
import {CalendarAgenda} from './calendar-agenda';
import {CalendarTasks} from './calendar-tasks';
import {QuickTaskSchedule} from './quick-task-schedule';
import {calendarTimeline} from '@/lib/orbit/calendar-timeline';
import {ProjectHub} from './project-hub';
import {ProjectActions,type ProjectIntent} from './project-actions';
import {CalendarDateStrip} from './calendar-date-strip';
import {ItemColorPicker} from './item-color-picker';
import {CalendarColors} from './calendar-colors';
import {taskCalendarEvents,calendarCategories,categoryLabels,categoryOf,categoryColor,calendarItemColor,type CalendarCategory} from '@/lib/orbit/calendar-categories';
import {ProjectDetailPanel} from './project-detail';
import {registrationOverlap} from '@/lib/orbit/overlap-review';
import {eventCommand,moveRestriction,canEditCalendarEvent} from '@/lib/orbit/calendar-move';
import type {CalendarEvent} from '@/lib/orbit/model';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
import {GoalDashboard} from './coach/goal-dashboard';
import {Understanding} from './coach/understanding';
import { AgentWorkspace } from '@/components/orbit/agent/chat';
import { AsidePanel } from '@/components/orbit/aside/panel';
import { AutomationPanel } from '@/components/orbit/automation/panel';
import { agentRequest } from '@/components/orbit/agent/connections';
import {readDraft,saveDraft,clearDraft} from '@/lib/orbit/device-drafts';
import { setRequestOwner } from '@/lib/orbit/request-owner';
import { useWorkspace } from '@/lib/orbit/use-workspace';
import { TaskCoach } from '@/components/orbit/coach/task-coach';
import { FocusSession, type RecordInput } from '@/components/orbit/coach/focus-session';
import { ReviewWizard } from '@/components/orbit/coach/review-wizard';
import { TodayLaser } from '@/components/orbit/coach/today-laser';
import { GoalsPanel } from '@/components/orbit/coach/goals-panel';
import { WeeklyStats } from '@/components/orbit/coach/weekly-stats';
import { ReflectionCard, ConfirmationTrend } from '@/components/orbit/coach/review-reflection';
import type { ReviewReflection } from '@/lib/orbit/review-evidence';
import { coachTask } from '@/lib/orbit/coach';
import { suggestProject, automaticProject, projectDraft, assignmentPlan } from '@/lib/orbit/classify';
import { WikiLibrary, WikiRelated } from '@/components/orbit/wiki/wiki-library';
import { GraphView } from '@/components/orbit/graph/graph-view';
import { AssignDialog } from '@/components/orbit/coach/assign-dialog';
import { addDays, todayInZone, koreanDate, weekDates, weekday, minuteInZone } from '@/lib/orbit/dates';
import type { Preferences } from '@/lib/orbit/model';
import type { WorkspaceAction } from '@/lib/orbit/validation';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { calibrationFactor } from '@/lib/orbit/planner';
import {
  formatTime,
  durationText,
  statusLabel,
  quadrantLabel,
  cognitionLabel,
  withDefaults,
  type View,
  type Task,
  type TaskStatus,
  type Note,
  type Project,
  type Proposal,
  type Quadrant,
  type Cognition,
  type ReviewDetail,
} from '@/lib/orbit/model';
const navigation: { id: View; label: string; icon: typeof Sun }[] = [
  { id: 'inbox', label: '결재함', icon: Inbox },
  { id: 'dashboard', label: '전체 현황', icon: LayoutGrid },
  { id: 'data', label: '데이터 관리', icon: Database },
  { id: 'agent', label: 'AI 에이전트', icon: MessagesSquare },
  { id: 'aside', label: 'ASIDE 실행', icon: Network },
  { id: 'automation', label: '서버 자동화', icon: Clock3 },
  { id: 'goals', label: '나의 목표', icon: Target },
  { id: 'portfolio', label: '사업별 시간 배분', icon: Layers },
  { id: 'signals', label: '운영 신호', icon: AlertCircle },
  { id: 'meetings', label: '회의 브리핑', icon: MessagesSquare },
  { id: 'today', label: '오늘', icon: Sun },
  { id: 'calendar', label: '일정', icon: CalendarDays },
  { id: 'tasks', label: '할 일', icon: CheckCheck },
  { id: 'followup', label: '결정·위임 추적', icon: CheckCheck },
  { id: 'experiments', label: '사업 실험', icon: Sparkles },
  { id: 'contacts', label: '사람·거래처', icon: MessagesSquare },
  { id: 'monthly', label: '월간 개선 보고', icon: Layers },
  { id: 'voice', label: '음성 브리핑', icon: Headphones },
  { id: 'learning', label: '계획 개선', icon: Sparkles },
  { id: 'backup', label: '백업·복구', icon: Download },
  { id: 'projects', label: '프로젝트', icon: FolderKanban },
  { id: 'sound', label: '사운드스테이션', icon: Headphones },
  { id: 'understanding', label: '나를 이해하는 기록', icon: Sparkles },
  { id: 'wiki', label: '개인 위키', icon: BookOpen },
  { id: 'knowledge', label: '지식창고', icon: Library },
  { id: 'review', label: '저녁 회고', icon: Moon },
  { id: 'proposal', label: '내일 제안', icon: Sparkles },
];
const pageInfo: Record<View, { title: string; subtitle: string; eyebrow: string }> = {
  inbox:{title:'결재함',subtitle:'승인·보류·확인이 필요한 것만 출처와 함께 모았습니다.',eyebrow:'DECISIONS'},
  experiments:{title:'지식에서 사업 실험으로',subtitle:'작게 실행하고 근거로 판단합니다.',eyebrow:'EXPERIMENTS'},
  contacts:{title:'사람·거래처',subtitle:'만남 전에 합의와 약속을 확인합니다.',eyebrow:'PEOPLE'},
  monthly:{title:'월간 업무방식 개선',subtitle:'중단·위임·표준화하고 다음 달 효과를 확인합니다.',eyebrow:'MONTHLY REVIEW'},
  voice:{title:'음성 지시·아침 브리핑',subtitle:'짧게 듣고 말하고, 확인한 내용만 실행합니다.',eyebrow:'VOICE'},
  data:{title:'데이터 관리',subtitle:'나의 기록을 살펴보고, 연결하고, 정리합니다.',eyebrow:'MY DATA'},
  portfolio:{title:'사업별 시간 배분',subtitle:'이번 주 집중할 사업과 지켜야 할 시간을 함께 정합니다.',eyebrow:'WEEKLY ALLOCATION'},
  signals:{title:'운영 신호',subtitle:'확인한 수치의 변화에서 필요한 판단과 후속 행동을 찾습니다.',eyebrow:'OPERATING SIGNALS'},
  meetings:{title:'회의 브리핑',subtitle:'이전 결정과 약속을 준비하고, 회의에서 바뀐 것을 실행으로 연결합니다.',eyebrow:'MEETING BRIEF'},
  followup:{title:'결정·위임 추적',subtitle:'판단의 근거와 맡긴 결과를 끝까지 확인합니다.',eyebrow:'FOLLOW THROUGH'},
  learning:{title:'계획 개선',subtitle:'실제 기록으로 예상 시간을 보정하고 다음 계획을 조정합니다.',eyebrow:'LEARNING'},
  backup:{title:'백업·복구',subtitle:'기록을 보관하고 필요한 항목을 확인한 뒤 복원합니다.',eyebrow:'MY RECORDS'},
  automation: {title:'서버 자동화',subtitle:'예약 실행부터 승인과 ODA 반영까지.',eyebrow:'AUTOMATION'},
  aside: {title:'ASIDE 실행',subtitle:'로그인된 웹 업무를 맡기고, 결과를 프로젝트에 연결합니다.',eyebrow:'BROWSER WORKSPACE'},
  sound: {title: '사운드스테이션', subtitle: '몰입할 때, 쉬어갈 때. 나의 페이스를 위한 소리.', eyebrow: 'ORBIT SOUND'},
  dashboard: {title:'전체 현황',subtitle:'프로젝트와 지식, 매일의 실행이 연결되어 성과로 확장됩니다.',eyebrow:'ORBIT / GALAXY'},
  goals: {title:'나의 목표',subtitle:'원하는 삶에서 오늘의 한 걸음까지. 목표와 퀘스트를 연결합니다.',eyebrow:'MY ORBIT'},
  understanding: {title:'나를 이해하는 기록',subtitle:'흩어진 일상을 연결해, 나에게 맞는 길을 찾아갑니다.',eyebrow:'UNDERSTANDING ME'},
  agent: { title: 'Orbit 에이전트', subtitle: '대화에서 실행까지.', eyebrow: 'ORBIT AGENT' },
  today: {
    title: '오늘, 중요한 일부터.',
    subtitle: '할 일의 끝을 넘어, 결과물에 가까워지는 하루.',
    eyebrow: 'TODAY',
  },
  calendar: { title: '일정', subtitle: 'Google 일정과 나의 집중 시간을 한눈에.', eyebrow: 'CALENDAR' },
  tasks: { title: '할 일', subtitle: '모든 행동에는 끝내야 할 결과물이 있습니다.', eyebrow: 'ACTION' },
  projects: {
    title: '프로젝트',
    subtitle: '지금 어디에 있고, 다음에 무엇을 해야 하는지.',
    eyebrow: 'PROJECTS',
  },
  wiki: {
    title: '개인 위키',
    subtitle: '회의의 맥락과 결정, 나만의 운영 원칙을 쌓는 곳.',
    eyebrow: 'MY WIKI',
  },
  knowledge: {
    title: '지식창고',
    subtitle: '좋은 생각을 모으고, 필요한 프로젝트에 연결합니다.',
    eyebrow: 'KNOWLEDGE',
  },
  review: {
    title: '하루를 돌아보는 5분',
    subtitle: '오늘의 경험으로 내일의 계획을 더 정확하게.',
    eyebrow: 'EVENING REVIEW',
  },
  proposal: {
    title: '일별 실행 제안',
    subtitle: '오늘까지의 진척에서, 목표를 앞당길 다음 행동으로. Goal Laser가 1순위입니다.',
    eyebrow: 'NEXT DAY',
  },
};
function Empty({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <Inbox size={30} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
function Status({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`status ${status === 'doing' ? 'status-blue' : status === 'waiting' ? 'status-orange' : status === 'done' ? 'status-green' : 'status-gray'}`}
    >
      {statusLabel[status]}
    </span>
  );
}
function ProjectLabel({ project }: { project?: Project }) {
  return project ? (
    <span className="project-label">
      <span className="project-dot" style={{ '--project-color': project.color } as CSSProperties} />
      {project.name}
    </span>
  ) : (
    <span className="project-label">개인</span>
  );
}
// Shape of the per-device form draft persisted while a create sheet is open (see saveDraft(ownerId,'form',…) below).
type FormDraft = {
  id: string; newTitle: string; newBody: string;
  newColor?: string | null; newCategory?: CalendarCategory; newScope?: EventScope; newTaskMemo?: string; newProject?: string;
  newDuration?: string; newDate?: string; newTime?: string; newFocus?: boolean; newBlocker?: string; newCheckDate?: string;
  newQuadrant?: Quadrant | 'auto'; newCognition?: Cognition | 'auto'; newMust?: boolean; newKeywords?: string; projectTouched?: boolean;
};
function WorkspaceContent({
  demo = false,
  displayName = '황인범',
  ownerId = '',
}: {
  demo?: boolean;
  displayName?: string;
  ownerId?: string;
}) {
  const cosmic=useCosmicMotion();
  const { snapshot, loaded, busy, failure, online, mutate, retry, refresh, discardRequestAndRefresh, hasPending, pauseRefresh, acceptSnapshot } =
    useWorkspace(demo, ownerId);
  const notificationLinkOpened=useRef(false);
  useEffect(()=>{const changed=()=>{if(!hasPending)void refresh()};window.addEventListener('orbit-meeting-approved',changed);return()=>window.removeEventListener('orbit-meeting-approved',changed)},[hasPending,refresh]);
  const data = snapshot.data,
    preferences = data.preferences;
  const { tasks, projects, notes, events } = data;
  const [clock, setClock] = useState(() => new Date());
  const TODAY = demo ? '2026-09-06' : todayInZone(preferences.timeZone, clock),
    TOMORROW = addDays(TODAY, 1);
  const [view, setView] = useState<View>('today');
  const [homeOrders,setHomeOrders]=useState<WorkOrder[]>([]);
  const [dataEditing, setDataEditing] = useState(false);
  const [demoDataTrash, setDemoDataTrash] = useState<TrashRecord[]>([]);
  const [projectAction,setProjectAction]=useState<{id:string;mode:'menu'|'delete'}|null>(null);
  const [projectManaging,setProjectManaging]=useState(false);
  const [dataInitialTab,setDataInitialTab]=useState<'records'|'trash'>('records');
  const [proposalDate, setProposalDate] = useState(TOMORROW);
  const [attachmentDraft, setAttachmentDraft] = useState('event-draft:initial');
  const eventUploads = useAttachments(attachmentDraft);
  const [briefLaunch, setBriefLaunch] = useState<{ date: string; id: string }>();
  const [reflection, setReflection] = useState<ReviewReflection | null>(null);
  const [searchOpen,setSearchOpen]=useState(false);
  const [meOpen,setMeOpen]=useState(false);
  const [aiActions,setAiActions]=useState<AgentAction[]|null>(null);
  const [news,setNews]=useState<NewsSummary|null>(null);
  const [newsOpen,setNewsOpen]=useState(false);
  const [dockOpen,setDockOpen]=useState(false);
  const eveningHour=useEveningHour(demo);
  const [search, setSearch] = useState('');
  const [taskFilter, setTaskFilter] = useState('all');
  const [calendarDate, setCalendarDate] = useState(TODAY);
  const [calendarTab,setCalendarTab]=useState('timeline');
  const [scheduleTask,setScheduleTask]=useState<{id:string;date:string}|null>(null);
  const previousToday=useRef(TODAY);
  useEffect(()=>{const previous=previousToday.current;previousToday.current=TODAY;if(previous!==TODAY){setCalendarDate(date=>date===previous?TODAY:date);window.dispatchEvent(new Event('orbit:calendar-changed'));}},[TODAY]);
  const [newCategory,setNewCategory]=useState<CalendarCategory>('work');
  const [newColor,setNewColor]=useState<string|null>(null);
  const [detail, setDetail] = useState<{ kind: 'task' | 'note' | 'project' | 'event'; id: string; revision?:number; projectIntent?:ProjectIntent } | null>(
    null,
  );
  // Declared after setDetail so the effect does not reference it before its declaration.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- opens the record named by the ?note/?task notification link once the workspace has loaded; the query string is only readable on the client
  useEffect(()=>{if(!loaded||notificationLinkOpened.current)return;notificationLinkOpened.current=true;const q=new URLSearchParams(location.search);if(q.get('note'))setDetail({kind:'note',id:q.get('note')!});else if(q.get('task'))setDetail({kind:'task',id:q.get('task')!});},[loaded]);
  const [create, setCreate] = useState<
    'task' | 'meeting' | 'wiki' | 'knowledge' | 'project' | 'event' | null
  >(null);
  const createId=useRef('');
  const [formDraftError,setFormDraftError]=useState('');
  const [editingNoteRevision, setEditingNoteRevision] = useState<number | undefined>(),
    [exporting, setExporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null),
    [newTitle, setNewTitle] = useState(''),
    [newBody, setNewBody] = useState(''),
    [newTaskMemo,setNewTaskMemo]=useState(''),
    [newScope,setNewScope]=useState<EventScope>('personal'),
    [newProject, setNewProject] = useState(''),
    [newDuration, setNewDuration] = useState('45'),
    [newDate, setNewDate] = useState(TODAY),
    [newTime, setNewTime] = useState('10:00'),
    [newFocus, setNewFocus] = useState(false),
    [newBlocker, setNewBlocker] = useState(''),
    [newCheckDate, setNewCheckDate] = useState(''),
    [newQuadrant, setNewQuadrant] = useState<Quadrant | 'auto'>('auto'),
    [newCognition, setNewCognition] = useState<Cognition | 'auto'>('auto'),
    [newMust, setNewMust] = useState(false),
    [newKeywords, setNewKeywords] = useState(''),
    [projectTouched, setProjectTouched] = useState(false),
    [brainyOpen, setBrainyOpen] = useState(false),
    [assignOpen, setAssignOpen] = useState(false),
    [projectsMode, setProjectsMode] = useState<'cards' | 'graph'>('cards');
  // eslint-disable-next-line react-hooks/set-state-in-effect -- persists the open form to localStorage after every change; the error state only reports a failed write of that external store
  useEffect(()=>{if(demo||!create||editingId||(!newTitle&&!newBody&&!newTaskMemo))return;try{saveDraft(ownerId,'form',create,{id:createId.current,newTitle,newBody,newProject,newDuration,newDate,newTime,newFocus,newBlocker,newCheckDate,newQuadrant,newCognition,newMust,newKeywords,newCategory,newColor,newScope,newTaskMemo,projectTouched});setFormDraftError('');}catch{setFormDraftError('기기 임시 저장에 실패했습니다. 내용을 복사해 보관해 주세요.');}},[demo,ownerId,create,editingId,newTitle,newBody,newProject,newDuration,newDate,newTime,newFocus,newBlocker,newCheckDate,newQuadrant,newCognition,newMust,newKeywords,newCategory,newColor,newScope,newTaskMemo,projectTouched]);
  const [discardCreateConfirm,setDiscardCreateConfirm]=useState(false);
  const [discardProjectConfirm,setDiscardProjectConfirm]=useState(false);
  const [calendarInteracting, setCalendarInteracting] = useState(false);
  const [unconfirmedCalendarMove, setUnconfirmedCalendarMove] = useState<CalendarEvent | null>(null);
  const liveCalendar = useRef({events,data,busy,hasPending});
  useEffect(()=>{liveCalendar.current = {events,data,busy,hasPending};});
  const [energy, setEnergy] = useState<Proposal['energy']>('normal'),
    [reviewDate, setReviewDate] = useState(TODAY);
  const [deferId, setDeferId] = useState<string | null>(null),
    [deferReason, setDeferReason] = useState(''),
    [revisitDate, setRevisitDate] = useState(addDays(TOMORROW, 1));
  const [settingsOpen, setSettingsOpen] = useState(false),
    [settingsDraft, setSettingsDraft] = useState<Preferences>(preferences),
    [deleteTarget, setDeleteTarget] = useState<{
      kind: 'task' | 'project' | 'note' | 'event';
      id: string;
      title: string;
    } | null>(null),
    [refreshConfirm, setRefreshConfirm] = useState(false);
  const completed = tasks.filter((t) => t.status === 'done' && t.completedOn === TODAY);
  const focus = tasks.filter((t) => focusIds(data, TODAY).has(t.id));
  const waiting = tasks
    .filter(
      (t) => t.status === 'waiting' || (t.status !== 'done' && t.planHoldUntil && t.planHoldUntil <= TODAY),
    )
    .sort((a, b) =>
      (a.checkDate ?? a.planHoldUntil ?? '9999').localeCompare(b.checkDate ?? b.planHoldUntil ?? '9999'),
    );
  const projectById = (id: string) => projects.find((p) => p.id === id);
  const progress = (id: string) => {
    const list = tasks.filter((t) => t.projectId === id);
    return list.length ? Math.round((list.filter((t) => t.status === 'done').length / list.length) * 100) : 0;
  };
  useEffect(() => {
    pauseRefresh(
      !!create || !!scheduleTask || calendarInteracting ||
        dataEditing || projectManaging || !!projectAction ||
        settingsOpen ||
        brainyOpen ||
        assignOpen ||
        view === 'agent' ||
        view === 'review' ||
        detail?.kind === 'note',
    );
    return () => pauseRefresh(false);
  }, [create, scheduleTask, calendarInteracting, dataEditing, projectManaging, projectAction, settingsOpen, brainyOpen, assignOpen, view, detail?.kind, pauseRefresh]);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  // Follow the day rollover during render instead of one commit later.
  const [seenTomorrow, setSeenTomorrow] = useState(TOMORROW);
  if (seenTomorrow !== TOMORROW) {
    setSeenTomorrow(TOMORROW);
    setProposalDate(TOMORROW);
  }
  useEffect(() => {
    ensurePopupHistory();
    const v = location.hash.slice(1) as View;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the initial view comes from location.hash, which only exists on the client after mount; the server renders the default view
    if (navigation.some((n) => n.id === v)) setView(v);
    else {const url=new URL(location.href);const initial=url.searchParams.has('conversation')||url.searchParams.has('chatProject')?'agent':'today';setView(initial);replacePopupRoute(null,url.pathname+url.search+'#'+initial);}
    const handle = () => {
      const next = location.hash.slice(1) as View;
      setView(navigation.some((n) => n.id === next) ? next : 'today');
      setSearch('');
      setDetail(null);
    };
    window.addEventListener('hashchange', handle);
    window.addEventListener('popstate', handle);
    return () => {
      window.removeEventListener('hashchange', handle);
      window.removeEventListener('popstate', handle);
    };
  }, []);
  const navigate = (v: View) => {
    setSearchOpen(false);
    setMeOpen(false);
    setDockOpen(false);
    setView(v);
    setDetail(null);
    setSearch('');
    afterPopupClose(()=>{if(location.hash!==`#${v}`)pushPopupRoute(null,`#${v}`);window.scrollTo({top:0,behavior:'instant'});});
  };
  const perform = async (action: WorkspaceAction, message?: string) => {
    const review=registrationOverlap(liveCalendar.current.data,action);
    if(review&&(action.type==='event.upsert'||action.type==='task.schedule'||action.type==='proposal.approve')){
      if(!window.confirm(review.message))return false;
      action={...action,overlapConfirmation:review.confirmation};
    }
    const ok = await mutate(action);
    if (ok && message) toast.success(message);
    return ok;
  };
  const openTaskSchedule=(id:string,date=calendarDate)=>{
    if(busy||hasPending)return;
    setDetail(null);setScheduleTask({id,date});
  };
  const closeTaskSchedule=(next?:()=>void)=>{
    setScheduleTask(null);if(next)afterPopupClose(next);
  };
  const moveCalendarEvent = async (before: CalendarEvent, after: CalendarEvent): Promise<boolean> => {
    const current = liveCalendar.current;
    const saved = current.events.find(e => e.id === before.id);
    if (!saved || saved.start !== before.start || saved.end !== before.end || saved.date !== before.date) {
      toast.error('일정이 변경되었습니다. 최신 시간을 확인한 뒤 다시 옮겨 주세요.'); return false;
    }
    if (current.busy || current.hasPending || moveRestriction(saved)) {
      toast.error('저장 상태를 확인한 뒤 다시 옮겨 주세요.'); return false;
    }
    const target = {...saved,start:after.start,end:after.end};
    const ok = await perform(eventCommand(target));
    if (ok) {
      setUnconfirmedCalendarMove(null);
      toast.success(`${formatTime(target.start)}–${formatTime(target.end)}로 변경했습니다.`,{
        duration:8000,
        action:{label:'실행 취소',onClick:()=>{void (async()=>{
          const latest=liveCalendar.current;
          const event=latest.events.find(e=>e.id===target.id);
          if(!event||event.start!==target.start||event.end!==target.end||event.date!==target.date){toast.error('일정이 다시 변경되어 취소할 수 없습니다.');return;}
          const original={...event,start:before.start,end:before.end};
          if(await perform(eventCommand(original),'원래 시간으로 되돌렸습니다.')) window.dispatchEvent(new Event('orbit:calendar-changed'));
        })();}},
      });
      window.dispatchEvent(new Event('orbit:calendar-changed'));
    } else {
      setUnconfirmedCalendarMove(target);
    }
    return ok;
  };
  const toggleTask = async (id: string) => {
    const original = tasks.find((t) => t.id === id);
    if (!original) return;
    const next: TaskStatus = original.status === 'done' ? 'todo' : 'done';
    await perform(
      { type: 'task.status', id, status: next },
      next === 'done' ? '결과물 완료로 기록했습니다.' : '다시 할 일로 옮겼습니다.',
    );
  };
  const openCreate = (kind: NonNullable<typeof create>,contextProjectId?:string) => {
    setAttachmentDraft('event-draft:' + crypto.randomUUID());
    if (kind !== 'project' && kind !== 'event' && kind !== 'task' && projects.length === 0) {
      kind = 'project';
      toast('먼저 첫 프로젝트를 만들어 주세요.');
    }
    createId.current=crypto.randomUUID();
    setEditingId(null);
    setEditingNoteRevision(undefined);
    setNewTitle('');setNewColor(null);setNewCategory(kind==='event'?'meeting':'work');
    setNewBody('');setNewTaskMemo('');setNewScope(kind==='task'?'work':'personal');
    setNewProject(
      kind === 'event'
        ? (detail?.kind === 'project' ? detail.id : 'auto')
        : detail?.kind === 'project'
          ? detail.id
          : detail?.kind === 'note'
            ? (notes.find((n) => n.id === detail.id)?.projectId ?? projects[0]?.id ?? '')
            : (projects[0]?.id ?? ''),
    );
    setNewDuration('45');
    setNewDate(kind === 'event' && view === 'calendar' ? calendarDate : TODAY);
    setNewTime('10:00');
    setNewFocus(kind === 'task' && focus.filter((t) => t.status !== 'done').length < preferences.focusLimit);
    setNewBlocker('');
    setNewCheckDate('');
    setNewQuadrant('auto');
    setNewCognition('auto');
    setNewMust(false);
    setNewKeywords('');
    setProjectTouched(false);
    const restored=!demo&&readDraft<FormDraft>(ownerId,'form',kind);
    if(restored&&typeof restored.id==='string'&&typeof restored.newTitle==='string'&&typeof restored.newBody==='string'){
      createId.current=restored.id;setNewTitle(restored.newTitle);setNewColor(restored.newColor??null);setNewCategory(restored.newCategory??(kind==='event'?'meeting':'work'));setNewBody(restored.newBody);setNewScope(restored.newScope??(kind==='task'?'work':'personal'));setNewTaskMemo(restored.newTaskMemo??'');setNewProject(restored.newProject??'');setNewDuration(restored.newDuration??'45');setNewDate(restored.newDate??TODAY);setNewTime(restored.newTime??'10:00');setNewFocus(!!restored.newFocus);setNewBlocker(restored.newBlocker??'');setNewCheckDate(restored.newCheckDate??'');setNewQuadrant(restored.newQuadrant??'auto');setNewCognition(restored.newCognition??'auto');setNewMust(!!restored.newMust);setNewKeywords(restored.newKeywords??'');setProjectTouched(!!restored.projectTouched);toast('이 기기에 임시 보관한 작성을 복원했습니다.');
    }
    if(contextProjectId&&projects.some(p=>p.id===contextProjectId)){setNewProject(contextProjectId);setProjectTouched(true);if((projects.find(p=>p.id===contextProjectId)?.status??'active')!=='active')setNewFocus(false);}
    setCreate(kind);
  };
  const openProject = (id:string,intent:ProjectIntent='overview')=>setDetail({kind:'project',id,projectIntent:intent});
  const openProjectTrash = ()=>{setDetail(null);setDataInitialTab('trash');navigate('data')};
  const openProjectChat = (id:string) => {
    setDetail(null);
    const url=new URL(location.href);
    url.searchParams.set('chatProject',id);
    url.searchParams.delete('conversation');
    replacePopupRoute(null,url.pathname+url.search+url.hash);
    navigate('agent');
    window.dispatchEvent(new CustomEvent('orbit:open-chat',{detail:{projectId:id}}));
  };
  const saveReview = async (
    review: { date: string; win: string; block: string; energy: Proposal['energy'] },
    reviewDetail: ReviewDetail,
    reviewReflection?: ReviewReflection,
  ) => {
    const ok = await perform(
      { type: 'review.save', review, detail: reviewDetail },
      '회고와 규칙·실제 시간을 저장했습니다. 이 내용을 포함해 내일의 실행안을 분석합니다.',
    );
    if (ok) {
      const date = addDays(review.date, 1);
      setReflection(reviewReflection ?? null);
      setEnergy(review.energy);
      setProposalDate(date);
      setBriefLaunch({ date, id: crypto.randomUUID() });
      navigate('proposal');
    }
    return ok;
  };
  const recordTask = (t: Task, input: RecordInput) =>
    perform(
      {
        type: 'task.record',
        id: t.id,
        outcome: input.outcome,
        actualMinutes: input.actualMinutes,
        reason: input.reason,
        rule: input.rule,
        ruleKind: input.ruleKind,
      },
      input.outcome === 'done'
        ? '내가 해냄! 결과와 실제 시간을 기록했습니다.'
        : input.rule
          ? '결과와 규칙 ★를 기록했습니다.'
          : '결과를 기록했습니다.',
    );
  // 자동 안분: while a new task is being written and the project was not chosen by hand, a
  // confident keyword match selects the project; the coach shows lower-confidence suggestions.
  const eventMatch = create === 'event' && newProject === 'auto' ? automaticProject(newTitle,projects,tasks,notes) : undefined;
  const eventCandidates = create === 'event' && newProject === 'auto' && !eventMatch ? suggestProject(newTitle,projects,tasks,notes).filter(p=>p.confidence==='high') : [];
  const draftProject = create === 'task' && !editingId ? projectDraft(newTitle, newDate) : undefined;
  const autoProject = create === 'task' && !editingId && !projectTouched && newTitle.trim()
    ? automaticProject(`${newTitle} ${newBody}`, projects, tasks, notes) : undefined;
  const ambiguousProject = create === 'task' &&
    suggestProject(`${newTitle} ${newBody}`, projects, tasks, notes).some((p) => p.confidence === 'high');
  const newProjectCandidate = draftProject && !ambiguousProject &&
    !projects.some((p) => p.id === draftProject.id || p.name.replace(/\s/g, '') === draftProject.name.replace(/\s/g, ''))
      ? draftProject : undefined;
  const taskProject = autoProject?.projectId ??
    (!editingId && !projectTouched && newProjectCandidate ? newProjectCandidate.id :
      projects.some((p) => p.id === newProject) || newProjectCandidate?.id === newProject ? newProject : projects[0]?.id ?? '');
  const selectedDraft = newProjectCandidate?.id === taskProject ? newProjectCandidate : undefined;
  const assignable = useMemo(() => assignmentPlan(tasks, projects, notes).assignments.length, [tasks, projects, notes]);
  const coachContext = {
    today: TODAY,
    tasks,
    projects,
    notes,
    goals: data.goals ?? [],
    improvements: data.improvements ?? [],
    dominoProjectId: data.dominoProjectId,
  };
  const draftChecks =
    create === 'task'
      ? coachTask(
          {
            id: editingId ?? 'draft',
            title: newTitle,
            projectId: taskProject,
            duration: Number(newDuration),
            due: newDate,
            definition: newBody,
            impact: tasks.find((t) => t.id === editingId)?.impact ?? 3,
            status: tasks.find((t) => t.id === editingId)?.status ?? 'todo',
            quadrant: newQuadrant === 'auto' ? undefined : newQuadrant,
            cognition: newCognition === 'auto' ? undefined : newCognition,
            must: newMust,
          },
          {
            ...coachContext,
            factor: calibrationFactor(
              tasks,
              {
                id: editingId ?? 'draft',
                projectId: taskProject,
                cognition: newCognition === 'auto' ? undefined : newCognition,
              } as Task,
              TODAY,
              data.executionHistory,
            ),
          },
        )
      : [];
  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newTitle.trim()) return;
    if (create === 'event' && !editingId && eventUploads.busy) return;
    const startAfterSave=create==='task'&&(event.nativeEvent as SubmitEvent).submitter?.getAttribute('data-start')==='true';
    const id = editingId ?? (createId.current ||= crypto.randomUUID());
    let action: WorkspaceAction;
    if (create === 'task') {
      if (!taskProject) { toast.error('연결할 프로젝트를 선택해 주세요.'); return; }
      const old = tasks.find((t) => t.id === id);
      action = {
        type: 'task.upsert',
        project: selectedDraft,
        autoAssign: !editingId && !projectTouched,
        task: {
          ...old,
          id,
          title: newTitle.trim(),
          projectId: taskProject,
          status: old?.status ?? 'todo',
          duration: Number(newDuration),
          due: newDate,
          category:newCategory,
          color:newColor,
          description:newTaskMemo,
          scope:newScope,
          impact: old?.impact ?? 3,
          focus: newFocus&&(projects.find(p=>p.id===taskProject)?.status??'active')==='active',
          focusDate: newFocus&&(projects.find(p=>p.id===taskProject)?.status??'active')==='active' ? (old?.focusDate ?? TODAY) : undefined,
          definition: newBody.trim() || '결과물을 확인하고 완료 처리',
          blocker: newBlocker.trim() || undefined,
          checkDate: newCheckDate || undefined,
          noteId: old?.noteId ?? (detail?.kind === 'note' ? detail.id : undefined),
          quadrant: newQuadrant === 'auto' ? undefined : newQuadrant,
          cognition: newCognition === 'auto' ? undefined : newCognition,
          must: newMust || undefined,
        },
      };
    } else if (create === 'project') {
      const old = projects.find((p) => p.id === id);
      action = {
        type: 'project.upsert',
        project: {
          id,
          name: newTitle.trim(),
          goal: newBody.trim(),
          color: old?.color ?? '#7f8fd2',
          symbol: old?.symbol ?? newTitle.slice(0, 1),
          due: newDate,
          priority: old?.priority ?? 3,
          ...(old?.goalId ? { goalId: old.goalId } : {}),
          keywords: newKeywords
            .split(/[,、\n]/)
            .map((k) => k.trim())
            .filter(Boolean)
            .slice(0, 12),
        },
      };
    } else if (create === 'event') {
      if(eventCandidates.length){toast.error('연결할 프로젝트를 선택해 주세요.');return;}
      const [h, m] = newTime.split(':').map(Number);
      const start = h * 60 + m;
      if (!Number.isFinite(start) || start + Number(newDuration) > 1440) { toast.error('종료 시간은 같은 날 자정 이전으로 선택해 주세요.'); return; }
      const old = events.find((e) => e.id === id);
      action = {
        type: 'event.upsert',
        attachmentIds: editingId ? undefined : eventUploads.ready.map((f) => f.id),
        event: {
          ...old,
          id,
          title: newTitle.trim(),
          date: newDate,
          start,
          end: start + Number(newDuration),
          kind: old?.kind ?? 'meeting',
          description:newBody,
          scope:newScope,
          category:newCategory,
          color:newColor,
          projectId: newProject === 'none' || newProject === 'auto' ? undefined : newProject,
          projectAutoLink: newProject === 'auto',
          projectLink: undefined,
        },
      };
    } else {
      const old = notes.find((n) => n.id === id);
      const kind = create === 'meeting' ? 'meeting' : create === 'knowledge' ? 'knowledge' : 'wiki';
      action = {
        type: 'note.upsert',
        expectedNoteRevision: editingId ? editingNoteRevision : undefined,
        note: {
          id,
          title: newTitle.trim(),
          kind,
          projectId: newProject,
          summary: newBody.trim().slice(0, 95),
          body: newBody.trim(),
          tags: old?.tags ?? [
            kind === 'meeting' ? '회의록' : kind === 'knowledge' ? '참고 자료' : '개인 기록',
          ],
          updated: TODAY,
        },
      };
    }
    if (await perform(action, editingId ? '수정 내용을 저장했습니다.' : '저장했습니다.')) {
      if (create === 'event') {
        eventUploads.clear(eventUploads.ready.map((f) => f.id));
        await eventUploads.completeShare(
          attachmentDraft,
          eventUploads.ready.map((f) => f.id),
        );
        setCalendarDate(newDate);
        navigate('calendar');
      }
      if(create==='project'&&!editingId){navigate('projects');setDetail({kind:'project',id});}
      if(!editingId&&create)clearDraft(ownerId,'form',create);
      setCreate(null);
      if(startAfterSave){if(await perform({type:'task.start',id},'저장하고 집중을 시작했습니다.'))setDetail({kind:'task',id});}
    }
  };
  const openEdit = (kind: 'task' | 'project' | 'note' | 'event', id: string, loadedNote?: Note) => {
    setAttachmentDraft('event:' + id);
    setEditingId(id);
    if (kind === 'task') {
      const t = tasks.find((t) => t.id === id)!;
      setDetail(null);
      setCreate('task');
      setNewTitle(t.title);setNewColor(t.color??null);setNewCategory(categoryOf(t));
      setNewBody(t.definition);setNewTaskMemo(t.description??'');setNewScope(eventScope(t));
      setNewProject(t.projectId);
      setNewDuration(String(t.duration));
      setNewDate(t.due);
      setNewFocus(t.focus);
      setNewBlocker(t.blocker ?? '');
      setNewCheckDate(t.checkDate ?? '');
      setNewQuadrant(t.quadrant ?? 'auto');
      setNewCognition(t.cognition ?? 'auto');
      setNewMust(!!t.must);
    } else if (kind === 'project') {
      const p = projectById(id)!;
      setCreate('project');
      setNewTitle(p.name);
      setNewBody(p.goal);
      setNewDate(p.due);
      setNewKeywords((p.keywords ?? []).join(', '));
    } else if (kind === 'note') {
      const n = loadedNote ?? notes.find((n) => n.id === id)!;
      if (n.bodyStored) {
        toast.error('본문을 먼저 불러와 주세요.');
        return;
      }
      setEditingNoteRevision(n.revision ?? 1);
      setCreate(n.kind);
      setNewTitle(n.title);
      setNewBody(n.body);
      setNewProject(n.projectId);
    } else {
      const e = events.find((e) => e.id === id)!;
      setDetail(null);
      setCreate('event');
      setNewTitle(e.title);setNewBody(e.description??'');setNewScope(eventScope(e));setNewColor(e.color??null);setNewCategory(categoryOf(e));
      setNewProject(e.projectId ?? 'none');
      setNewDate(e.date);
      setNewTime(formatTime(e.start));
      setNewDuration(String(e.end - e.start));
    }
  };
  const openSettings = () => {
    setSettingsDraft(preferences);
    setSettingsOpen(true);
  };
  const downloadData = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      let file: Blob;
      if (demo)
        file = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...snapshot }, null, 2)], {
          type: 'application/json',
        });
      else {
        const response = await fetch('/api/export', { cache: 'no-store' });
        if (!response.ok) throw new Error('내보내기를 완료하지 못했습니다. 다시 시도해 주세요.');
        file = await response.blob();
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orbit-backup-${TODAY}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('문서 본문을 포함한 기록을 내보냈습니다.');
    } catch (error) {
      toast.error((error as Error).message || '내보내기에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setExporting(false);
    }
  };
  const filteredTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (taskFilter === 'all' || t.status === taskFilter) &&
          (t.title.includes(search) || projects.find((p) => p.id === t.projectId)?.name.includes(search)),
      ),
    [tasks, taskFilter, search, projects],
  );
  const taskDetail = detail?.kind === 'task' ? tasks.find((t) => t.id === detail.id) : null;
  const noteDetail = detail?.kind === 'note' ? notes.find((n) => n.id === detail.id) : null;
  const projectDetail = detail?.kind === 'project' ? projectById(detail.id) : null;
  const eventDetail = detail?.kind === 'event' ? events.find((e) => e.id === detail.id) : null;
  const postponeTarget = eventDetail?.google?.orbitEventId ? events.find((e) => e.id === eventDetail.google!.orbitEventId) ?? eventDetail : eventDetail;
  const currentWeek = weekDates(calendarDate);
  const miniWeek = weekDates(TODAY);
  const reviewCompleted = tasks.filter((t) => t.status === 'done' && t.completedOn === reviewDate);
  const reviewFocus = tasks.filter((t) => focusIds(data, reviewDate).has(t.id));
  const calendarTaskEvents=taskCalendarEvents(data,TODAY);
  const selectedCalendarTaskIds=new Set(calendarTaskEvents.filter(e=>e.date===calendarDate).map(e=>e.taskId));
  const selectedCalendarTasks=tasks.filter(t=>selectedCalendarTaskIds.has(t.id));
  const selectedEvents = [...events,...protectedEvents(data,calendarDate)].map(e=>({...e,category:preferences.eventCategories?.[e.id]??e.category})).filter((e) => e.date === calendarDate).sort((a, b) => Number(!!b.allDay)-Number(!!a.allDay)||a.start - b.start);
  const calendarInbox=tasks.filter(t=>t.status==='waiting');
  const selectedTimeline=calendarTimeline(tasks,selectedEvents,calendarDate,TODAY);
  const todayRemaining = focus.filter((t) => t.status !== 'done').reduce((s, t) => s + t.duration, 0);
  const renderTimeline = (date: string) => {
    const list = [...events,...protectedEvents(data,date)].filter((e) => e.date === date).sort((a, b) => Number(!!b.allDay)-Number(!!a.allDay)||a.start - b.start);
    return list.length ? (
      list.map((e) => (
        <div className="timeline-item" key={e.id}>
          <time>{formatTime(e.start)}</time>
          <button
            className={`timeline-event ${
              e.kind === 'break'
                ? 'tone-gray'
                : withDefaults(preferences).colorBy === 'cognition'
                  ? `cog-${tasks.find((t) => t.id === e.taskId)?.cognition ?? (e.kind === 'meeting' ? 'external' : 'mid')}`
                  : e.projectId === 'pizza'
                    ? 'tone-teal'
                    : e.projectId === 'ofd'
                      ? 'tone-peach'
                      : ''
            }`}
            onClick={() =>
              e.id.startsWith('protected:') ? navigate('portfolio') : e.taskId ? setDetail({ kind: 'task', id: e.taskId }) : setDetail({ kind: 'event', id: e.id })
            }
          >
            <strong>{e.title}</strong>
            <small>
              {formatTime(e.start)} – {formatTime(e.end)} ·{' '}
              {e.kind === 'focus' ? '집중 시간' : e.kind === 'break' ? '나를 위한 시간' : '미팅'}
            </small>
          </button>
        </div>
      ))
    ) : (
      <Empty title="비어 있는 하루" description="승인한 제안과 추가한 일정이 여기에 표시됩니다." />
    );
  };
  const projectMini = (p: Project) => (
    <button
      className="project-mini"
      key={p.id}
      onClick={() => setDetail({ kind: 'project', id: p.id })}
      style={{ '--project-color': p.color } as CSSProperties}
    >
      <div className="mini-top">
        <span className="project-square" style={{ color: p.color, background: `${p.color}18` }}>
          {p.symbol}
        </span>
        <span
          className={`status ${tasks.some((t) => t.projectId === p.id && t.status === 'waiting') ? 'status-orange' : 'status-gray'}`}
        >
          {tasks.some((t) => t.projectId === p.id && t.status === 'waiting') ? '확인 필요' : '진행 중'}
        </span>
      </div>
      <div>
        <h3>{p.name}</h3>
        <p>
          {tasks.filter((t) => t.projectId === p.id && t.status !== 'done').length}개 할 일 ·{' '}
          {p.due.slice(5).replace('-', '/')} 목표
        </p>
      </div>
      <div>
        <div className="progress-label">
          <span>등록 업무 기준</span>
          <span>{progress(p.id)}%</span>
        </div>
        <Progress value={progress(p.id)} className="project-progress" aria-label={`${p.name} 업무 완료율`} />
      </div>
    </button>
  );
  const shareToChat = async (id: string | null, files: StoredAttachment[], shareId: string) => {
    if (!id) {
      const c = await agentRequest('/api/agent/conversations', 'POST', {
        id: crypto.randomUUID(),
        title: '공유한 자료',
        projectId: null,
      });
      id = c.id;
    }
    if (!eventUploads.adoptAt('chat:' + id, files))
      throw new Error('이 대화의 첨부가 8개를 넘습니다. 첨부를 정리하거나 새 대화를 선택해 주세요.');
    eventUploads.registerShare(
      'chat:' + id,
      shareId,
      files.map((f) => f.id),
    );
    const url = new URL(location.href);
    url.searchParams.set('conversation', id!);
    url.searchParams.delete('chatProject');
    replacePopupRoute(null,url.pathname + url.search + '#agent');
    navigate('agent');
    window.dispatchEvent(new CustomEvent('orbit:open-chat', { detail: { id } }));
  };
  const shareToEvent = async (id: string | null, files: StoredAttachment[], shareId: string) => {
    if (!id) {
      openCreate('event');
      const scope = 'event-draft:' + crypto.randomUUID();
      setAttachmentDraft(scope);
      if (!eventUploads.adoptAt(scope, files)) return false;
      eventUploads.registerShare(
        scope,
        shareId,
        files.map((f) => f.id),
      );
      return true;
    }
    const prior = await agentRequest('/api/attachments?type=event&id=' + encodeURIComponent(id));
    const ids = [...new Set([...prior.items.map((f: StoredAttachment) => f.id), ...files.map((f) => f.id)])];
    const ok = await perform(
      { type: 'event.attach', id, attachmentIds: ids },
      '공유 파일을 일정에 보관했습니다.',
    );
    if (ok) {
      navigate('calendar');
      setDetail({ kind: 'event', id });
    }
    return ok;
  };
  const inbox = inboxCounts({today:TODAY,proposals:data.proposals,aiPending:aiActions?aiActions.filter(a=>a.state==='pending'||a.state==='applying').length:null,orders:homeOrders,decisions:data.decisions,delegations:data.delegations});
  const openSearch = () => setSearchOpen(true);
  // Orbit opens beside the current screen (dock); the 대화 page itself stays a full view.
  const openOrbit = () => { if (view !== 'agent') setDockOpen(true); };
  const askOrbit = (text?: string) => { openOrbit(); if (text) window.dispatchEvent(new CustomEvent('orbit:compose', { detail: { text } })); };
  const detailProject = detail?.kind === 'project' ? projects.find(p => p.id === detail.id) : undefined;
  const dockContext = detailProject ? `프로젝트 · ${detailProject.name}`
    : detail?.kind === 'task' ? `할 일 · ${tasks.find(t => t.id === detail.id)?.title ?? '선택한 할 일'}`
    : detail?.kind === 'note' ? `기록 · ${notes.find(n => n.id === detail.id)?.title ?? '선택한 기록'}`
    : detail?.kind === 'event' ? `일정 · ${events.find(e => e.id === detail.id)?.title ?? '선택한 일정'}`
    : areaOf(view).views[0] === view ? `${areaOf(view).label} 화면` : `${areaOf(view).label} · ${viewLabels[view]}`;
  const searchActions: SearchAction[] = [
    {id:'task',label:'새 할 일',hint:'제목만 적어도 됩니다',icon:<Plus/>,keywords:['할 일 추가','투두'],disabled:!loaded||busy,run:()=>openCreate(projects.length?'task':'project')},
    {id:'event',label:'새 일정',hint:'Google 일정과 함께 저장',icon:<CalendarDays/>,keywords:['일정 추가','캘린더'],disabled:!loaded||busy,run:()=>openCreate('event')},
    {id:'project',label:'새 프로젝트',hint:'목표 결과물부터',icon:<FolderKanban/>,keywords:['프로젝트 추가'],disabled:!loaded||busy,run:()=>openCreate('project')},
    {id:'review',label:'저녁 회고 시작',hint:'PAFI 4단계 · 5분',icon:<Moon/>,keywords:['회고하기','하루 마무리'],run:()=>navigate('review')},
    {id:'ask',label:'Orbit에게 묻기',hint:'대화 열기',icon:<MessagesSquare/>,keywords:['질문','AI','채팅'],run:()=>askOrbit()},
    {id:'settings',label:'업무 시간·계획 기준',hint:'설정',icon:<Settings2/>,keywords:['설정','환경','리듬'],run:openSettings},
  ];
  useSearchShortcut(setSearchOpen);
  return (
    <CityThemeProvider preferences={data.preferences} view={view} title={navigation.find(n=>n.id===view)?.label??pageInfo[view].title} busy={busy||hasPending||!loaded} perform={perform} demo={demo}><SidebarProvider className={`galaxy-workspace ${view==='projects'?'project-flow-workspace':''} ${view==='today'?'mission-workspace':''} ${dockOpen&&view!=='agent'?'has-orbit-dock':''}`} data-illustration-collection={illustrationTheme(screenIllustration(data.preferences,view)).collection} style={{ '--sidebar-width': '248px', '--illustration-accent':illustrationTheme(screenIllustration(data.preferences,view)).accent } as CSSProperties}>
      <CosmicBackdrop/>
      {!demo && <InstallRootHint />}
      <a href="#main-content" className="skip-link">
        본문으로 이동
      </a>
      <AppNavigation
        view={view}
        navigate={navigate}
        inboxCount={inbox.total}
        newsUnread={news?.unread??0}
        dockOpen={dockOpen}
        onOrbit={()=>view==='agent'?undefined:setDockOpen(open=>!open)}
        displayName={displayName}
        onMe={()=>setMeOpen(true)}
        onSearch={openSearch}
      />
      <OrbitSearch open={searchOpen} onOpenChange={setSearchOpen} view={view} navigate={navigate} actions={searchActions}/>
      <MeSheet open={meOpen} onOpenChange={setMeOpen} displayName={displayName} view={view} demo={demo} loaded={loaded} navigate={navigate} onSettings={()=>{setMeOpen(false);afterPopupClose(openSettings)}} onConnections={()=>{setMeOpen(false);afterPopupClose(()=>window.dispatchEvent(new Event('orbit:connections')))}} onRuntime={()=>{setMeOpen(false);afterPopupClose(()=>window.dispatchEvent(new Event('orbit:runtime')))}} onNews={()=>{setMeOpen(false);afterPopupClose(()=>setNewsOpen(true))}}/>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="breadcrumb-brand">ORBIT</span>
            <ChevronRight size={13} />
            <strong>{areaOf(view).label}</strong>
            {areaOf(view).views[0]!==view&&<><ChevronRight size={13} className="breadcrumb-sub"/><span className="breadcrumb-sub">{viewLabels[view]}</span></>}
          </div>
          <div className="top-actions"><SearchTrigger onSearch={openSearch} open={searchOpen}/><NotificationCenter key={ownerId} ownerId={ownerId} demo={demo} trigger={false} open={newsOpen} onOpenChange={setNewsOpen} onSummary={setNews}/><CityThemeButton/><AppearanceShortcut/>
            <button className="me-trigger" onClick={()=>setMeOpen(true)} aria-haspopup="dialog" aria-expanded={meOpen} aria-label="나 · 설정과 관리 열기">{displayName.slice(0,1)}</button>

            {loaded && (
              <ShareIntake ownerId={ownerId} demo={demo} snapshot={snapshot} onChat={shareToChat} onEvent={shareToEvent} />
            )}

            {view==='tasks'&&<button
              className="new-button"
              disabled={!loaded || busy}
              onClick={() => openCreate(projects.length ? 'task' : 'project')}
            >
              <Plus size={16} />
              {projects.length ? '새 할 일' : '첫 프로젝트'}
            </button>}
          </div>
        </header>
        {demo ? (
          <div className="demo-bar">
            예시 체험 · 변경은 저장되지 않습니다. <Link href="/">내 워크스페이스로 이동 →</Link>
          </div>
        ) : (
          <div className={`sync-bar ${failure || !online ? 'has-error' : ''}`} hidden={loaded&&!busy&&!failure&&online} role="status">
            {!online ? (
              <>
                <AlertCircle size={15} />
                <span>오프라인 · 연결 후 저장해 주세요. 작성 중인 화면을 유지해 주세요.</span>
              </>
            ) : failure ? (
              <>
                <AlertCircle size={15} />
                <span>{failure.message}</span>
                <button onClick={() => void retry()}>다시 시도</button>
                <button onClick={() => (hasPending ? setRefreshConfirm(true) : void refresh())}>
                  최신 내용 불러오기
                </button>
              </>
            ) : (
              <>
                <CloudCheck size={15} />
                <span>
                  {busy
                    ? '저장소와 연결 중…'
                    : !loaded
                      ? '내 업무를 불러오는 중…'
                      : snapshot.updatedAt
                        ? '저장됨 · 기기 간 공유'
                        : '개인 워크스페이스 · 첫 기록을 시작하세요'}
                </span>
                {loaded && (
                  <button onClick={() => void refresh()} aria-label="최신 내용 새로고침">
                    <RefreshCw size={14} />
                  </button>
                )}
              </>
            )}
          </div>
        )}
        <main
          id="main-content"
          className={`content ${view === 'agent' ? 'agent-content' : view === 'sound' ? 'sound-content' : ''} ${!loaded ? 'is-loading' : ''}`}
        >
          {loaded&&!demo&&<IaIntro onSearch={openSearch}/>}
          <div className={`page-heading ${view === 'agent' || view === 'sound' ? 'agent-page-heading' : ''}`}>
            <div>
              <div className="eyebrow">
                {view === 'today'
                  ? koreanDate(TODAY)
                  : view === 'proposal'
                    ? koreanDate(proposalDate)
                    : pageInfo[view].eyebrow}
              </div>
              <h1>{view==='today'?'오늘':view==='projects'?'프로젝트':view==='wiki'||view==='knowledge'?'기록':pageInfo[view].title}</h1>
              {!['today','projects','wiki','knowledge','inbox'].includes(view)&&<p>{pageInfo[view].subtitle}</p>}
            </div>
            {view === 'projects' ? <div className="heading-actions"><button className="primary-button" aria-label="새 프로젝트 추가" disabled={busy||!loaded} onClick={()=>openCreate('project')}><Plus size={20}/><span>프로젝트 추가</span></button><DropdownMenu><DropdownMenuTrigger asChild><button className="secondary-button" aria-label="프로젝트 보기·정리"><MoreHorizontal size={20}/></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={()=>setProjectsMode(projectsMode==='cards'?'graph':'cards')}>{projectsMode==='cards'?'관계 그래프':'프로젝트 목록'}</DropdownMenuItem><DropdownMenuItem onSelect={()=>navigate('tasks')}>전체 할 일</DropdownMenuItem><DropdownMenuItem onSelect={()=>navigate('goals')}>목표</DropdownMenuItem><DropdownMenuItem onSelect={openProjectTrash}>휴지통</DropdownMenuItem><DropdownMenuItem onSelect={()=>setAssignOpen(true)}>프로젝트 자동 분류</DropdownMenuItem><DropdownMenuItem onSelect={()=>setBrainyOpen(true)}>목표 관리</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div> : view==='wiki'||view==='knowledge'?<DropdownMenu><DropdownMenuTrigger asChild><button className="primary-button"><Plus size={16}/>기록 추가</button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={()=>openCreate('wiki')}>문서</DropdownMenuItem><DropdownMenuItem onSelect={()=>openCreate('meeting')}>회의록</DropdownMenuItem><DropdownMenuItem onSelect={()=>openCreate('knowledge')}>참고 자료</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : view === 'calendar' ? (
              <button className="secondary-button" onClick={() => openCreate('event')}>
                <Plus size={16} />
                일정 추가
              </button>
            ) : null}
          </div>
          <AreaSections view={view} navigate={navigate} inboxCount={inbox.total} newsUnread={news?.unread??0}/>
          {loaded&&!['today','projects','inbox'].includes(view)&&<CityScreenBanner compact={view==='agent'||view==='sound'}/>}
          {!loaded && (
            <section className="load-state" role="status">
              <RefreshCw size={22} />
              <h2>
                {!online
                  ? '인터넷 연결을 기다리는 중'
                  : failure
                    ? '아직 업무를 불러오지 못했습니다'
                    : '저장된 업무를 불러오는 중'}
              </h2>
              <p>
                {!online
                  ? '연결되면 저장한 업무를 다시 불러옵니다.'
                  : (failure?.message ?? '잠시만 기다려 주세요.')}
              </p>
              {failure?.code === 'AUTH' ? (
                <a className="primary-button" href="/signin-with-chatgpt?return_to=%2F" target="_top">
                  ChatGPT로 로그인
                </a>
              ) : (
                failure && (
                  <button className="primary-button" onClick={() => void retry()}>
                    다시 불러오기
                  </button>
                )
              )}
            </section>
          )}
          {loaded && (
            <OrbitDock mode={view==='agent'?'page':dockOpen?'dock':'hidden'} context={dockContext} onClose={()=>setDockOpen(false)} onExpand={()=>navigate('agent')}
              onAttachContext={()=>window.dispatchEvent(new CustomEvent('orbit:compose',{detail:{text:`[보고 있던 화면] ${dockContext}`,append:true}}))}>
              <AgentWorkspace
                visible={view==='agent'||dockOpen}
                onPendingActions={setAiActions}
                onOrdersChange={setHomeOrders}
                ownerId={ownerId}
                perform={perform}
                onOpenRecord={setDetail}
                busy={busy || hasPending}
                onGoals={() => setBrainyOpen(true)}
                demo={demo}
                displayName={displayName}
                snapshot={snapshot}
                onWorkspaceChange={() => void refresh()}
                navigate={navigate}
              />
            </OrbitDock>
          )}
          {loaded && <AsidePanel visible={view==='aside'} snapshot={snapshot} perform={perform} busy={busy||hasPending} demo={demo} onAsk={text=>{askOrbit(text)}}/>}
          {loaded && <AutomationPanel visible={view==='automation'} snapshot={snapshot} perform={perform} busy={busy||hasPending} demo={demo} onAsk={text=>{askOrbit(text)}}/>}
          <SoundStation visible={view === 'sound'} demo={demo} onOpen={() => {setDetail(null);navigate('sound')}} />
          {loaded && ['experiments','contacts','monthly'].includes(view)&&(()=>{const Panel=view==='experiments'?ExperimentsPanel:view==='contacts'?ContactsPanel:MonthlyPanel;return <Panel data={data} today={TODAY} busy={busy||hasPending} perform={perform} onOpen={(kind,id,revision)=>setDetail({kind,id,revision})} onAsk={text=>{askOrbit(text)}}/>})()}
          {loaded&&view==='voice'&&<VoicePanel data={data} today={TODAY} onAsk={text=>{askOrbit(text)}}/>}
          {loaded && view==='followup'&&<FollowupPanel data={data} today={TODAY} busy={busy||hasPending} perform={perform} onOpen={(kind,id,revision)=>setDetail({kind,id,revision})}/>}
          {loaded && view==='learning'&&<LearningPanel data={data} today={TODAY} busy={busy||hasPending} perform={perform} onOpen={id=>setDetail({kind:'task',id})}/>}
          {loaded && view==='backup'&&<BackupPanel snapshot={snapshot} demo={demo} busy={busy||hasPending} onRefresh={refresh}/>}
          {loaded && view==='data'&&<DataManager initialTab={dataInitialTab} snapshot={snapshot} demo={demo} demoTrash={demoDataTrash} setDemoTrash={setDemoDataTrash} busy={busy||hasPending} today={TODAY} onRefresh={refresh} onSnapshot={acceptSnapshot} onEditing={setDataEditing} onCreate={openCreate} onEdit={openEdit} onNavigate={navigate} onConnections={()=>{window.dispatchEvent(new Event('orbit:connections'))}} perform={perform}/>}
          {loaded && (view==='portfolio'||view==='signals'||view==='meetings')&&(()=>{const Panel=view==='portfolio'?PortfolioPanel:view==='signals'?SignalsPanel:MeetingsPanel;return <Panel data={data} today={TODAY} now={demo?new Date('2026-09-06T03:00:00Z'):clock} demo={demo} busy={busy||hasPending} perform={perform} onOpen={(kind,id,revision)=>setDetail({kind,id,revision})} onAsk={text=>{askOrbit(text)}} onNavigate={navigate}/>})()}
          {loaded && view === 'dashboard' && <WorkspaceDashboard onTimeSettings={openSettings} data={data} now={demo?new Date('2026-09-06T03:00:00Z'):clock} busy={busy||hasPending} demo={demo} perform={perform} navigate={navigate} onOpen={setDetail} onGoals={()=>setBrainyOpen(true)} onCreate={()=>openCreate('task')} onAsk={text=>{askOrbit(text)}} onCalendar={date=>{setCalendarDate(date);navigate('calendar')}} onProposal={date=>{setProposalDate(date);navigate('proposal')}} onCoachSettings={()=>{openOrbit();window.dispatchEvent(new Event('orbit:coach-settings'))}}/>}
          {loaded && view === 'goals' && <GoalDashboard data={data} today={TODAY} busy={busy||hasPending} demo={demo} perform={perform} onManage={()=>setBrainyOpen(true)} onOpen={setDetail} onAsk={text=>{askOrbit(text)}}/>}
          {loaded && view === 'understanding' && <Understanding data={data} today={TODAY} busy={busy||hasPending} demo={demo} perform={perform} onOpen={setDetail} navigate={navigate} onAsk={text=>{askOrbit(text)}} onConnect={()=>{window.dispatchEvent(new Event('orbit:connections'))}}/>}
          {loaded&&view==='inbox'&&<InboxPanel data={data} today={TODAY} nowMinute={demo?720:minuteInZone(preferences.timeZone,clock)} counts={inbox} orders={homeOrders} actions={aiActions??[]} snapshot={snapshot} news={news} busy={busy||hasPending} demo={demo} perform={perform} onProposal={date=>{setProposalDate(date);navigate('proposal')}} onNews={()=>setNewsOpen(true)} onOpenNote={id=>setDetail({kind:'note',id})} onOpenConversation={id=>{openOrbit();window.dispatchEvent(new CustomEvent('orbit:open-chat',{detail:{id}}))}} onAskOrbit={text=>{askOrbit(text)}} onReviewDeferred={()=>{openOrbit();window.dispatchEvent(new Event('orbit:review'))}} onOrder={id=>{openOrbit();window.dispatchEvent(new CustomEvent('orbit:orders',{detail:{id}}))}} onFollowup={()=>navigate('followup')}/>}
          {loaded&&view==='today'&&<TodayHome eveningHour={eveningHour} inboxCount={inbox.total} onInbox={()=>navigate('inbox')} orders={homeOrders} onOrder={id=>{openOrbit();window.dispatchEvent(new CustomEvent('orbit:orders',{detail:{id}}))}} onTimeSettings={openSettings} data={data} now={demo?new Date('2026-09-06T03:00:00Z'):clock} busy={busy||hasPending} demo={demo} perform={perform} onOpen={setDetail} navigate={navigate} onCreate={()=>openCreate(projects.length?'task':'project')} onAsk={text=>{askOrbit(text)}} onCalendar={date=>{setCalendarDate(date);navigate('calendar')}} onProposal={date=>{setProposalDate(date);navigate('proposal')}} onReview={date=>{setReviewDate(date);navigate('review')}}/>}
          {view === 'tasks' && (
            <>
              <div className="view-toolbar">
                <Tabs value={taskFilter} onValueChange={setTaskFilter} className="filter-tabs">
                  <TabsList aria-label="할 일 상태">
                    {[
                      { v: 'all', l: '전체' },
                      { v: 'doing', l: '진행 중' },
                      { v: 'waiting', l: '대기' },
                      { v: 'done', l: '완료' },
                    ].map((i) => (
                      <TabsTrigger value={i.v} key={i.v}>
                        {i.l}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                <label className="search-box">
                  <Search size={16} />
                  <input
                    aria-label="할 일 검색"
                    placeholder="할 일, 프로젝트 검색"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <button
                  className="secondary-button"
                  onClick={() => setAssignOpen(true)}
                  title="제목의 키워드로 프로젝트를 다시 배정합니다"
                >
                  <Wand2 size={15} />
                  프로젝트 자동 안분{assignable ? <span className="number">{assignable}</span> : null}
                </button>
              </div>
              <section className="full-card">
                {filteredTasks.length ? (
                  filteredTasks.map((t) => (
                    <div className={`task-list-row ${t.status === 'done' ? 'task-done' : ''}`} key={t.id} style={{borderLeft:`4px solid ${calendarItemColor(t,preferences,'task')}`}}>
                      <div className="task-check">
                        <Checkbox
                          checked={t.status === 'done'}
                          onCheckedChange={() => toggleTask(t.id)}
                          aria-label={`${t.title} 완료`}
                        />
                      </div>
                      <div className="task-info">
                        <button className="task-title" onClick={() => setDetail({ kind: 'task', id: t.id })}>
                          {t.title}
                        </button>
                        <div className="task-meta">
                          <ProjectLabel project={projectById(t.projectId)} />
                          <span>{t.due.slice(5).replace('-', '/')} 마감 · {categoryLabels[categoryOf(t)]}</span>
                          {t.dependsOn?.length ? <span>선행 작업 {t.dependsOn.length}개</span> : null}
                        </div>
                      </div>
                      <div className="row-side">
                        <Status status={t.status} />
                        <span className="task-duration">{t.duration}분</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty
                    title="표시할 할 일이 없습니다"
                    description="필터를 바꾸거나 새 할 일을 추가해 보세요."
                  />
                )}
              </section>
            </>
          )}
          {view === 'projects' && projectsMode === 'graph' && (
            <>
            {assignable > 0 && <div className="info-banner">
              <Wand2 size={18} /><span>키워드로 분류할 할 일이 {assignable}개 있습니다. 프로젝트를 생성하거나 연결하면 그래프에도 반영됩니다.</span>
              <button className="secondary-button" onClick={() => setAssignOpen(true)}>지금 분류하기</button>
            </div>}
            <GraphView
              data={data}
              onOpen={(ref) => {
                if (ref.kind === 'goal') setBrainyOpen(true);
                else if (ref.kind !== 'keyword') setDetail({ kind: ref.kind, id: ref.id });
              }}
            />
            </>
          )}
          {loaded && view === 'projects' && projectsMode === 'cards' && <ProjectHub onReorder={ids=>perform({type:'project.reorder',ids},'프로젝트 순서를 저장했습니다.')} data={data} today={TODAY} busy={busy||hasPending||!loaded} onOpen={openProject} onOpenTask={id=>setDetail({kind:'task',id})} onCreateTask={id=>openCreate('task',id)} onCreateProject={()=>openCreate('project')} onManage={id=>setProjectAction({id,mode:'menu'})} onTrash={openProjectTrash}/>}

          {loaded&&(view==='wiki'||view==='knowledge')&&<>{!demo&&view==='wiki'&&<GotemMetricsCard/>}{!demo&&<PlaudPanel projects={data.projects} onRefresh={refresh} onOpen={id=>setDetail({kind:'note',id})} onAsk={text=>{askOrbit(text)}}/>}<WikiLibrary key={view} initialKind={view==='knowledge'?'knowledge':''} onAsk={text=>{askOrbit(text)}} data={data} revision={snapshot.revision} perform={perform} demo={demo} busy={busy||hasPending} onRefresh={refresh} onOpen={(kind,id)=>setDetail({kind,id})}/><details className="workspace-more"><summary>기록 관리</summary><div className="workspace-links"><button onClick={()=>navigate('understanding')}>나를 이해하는 기록</button><button onClick={()=>navigate('data')}>전체 데이터 관리</button><button onClick={()=>navigate('backup')}>백업·복구</button></div></details></>}
          <CalendarSyncStatus active={view==='calendar'} demo={demo} loaded={loaded} date={calendarDate} timeZone={preferences.timeZone} paused={dataEditing||calendarInteracting||!!scheduleTask||!!create||settingsOpen||!!deleteTarget||hasPending} workspaceBusy={busy} onSynced={refresh}/>
          {loaded && view === 'calendar' && (
            <div className="calendar-two-col">
              <section className="full-card calendar-main">
                <div className="section-title">
                  <h2>
                    {calendarDate.slice(0, 4)}년 {Number(calendarDate.slice(5, 7))}월
                  </h2>
                  <div className="calendar-controls">
                    <button
                      className="icon-button"
                      aria-label="이전 주"
                      onClick={() => setCalendarDate(addDays(calendarDate, -7))}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button className="secondary-button" onClick={() => setCalendarDate(TODAY)}>
                      오늘
                    </button>
                    <button
                      className="icon-button"
                      aria-label="다음 주"
                      onClick={() => setCalendarDate(addDays(calendarDate, 7))}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
                <CalendarDateStrip onStep={days=>setCalendarDate(date=>addDays(date,days))}><div className="calendar-days">
                  {currentWeek.map((date) => (
                    <button
                      key={date}
                      onClick={() => setCalendarDate(date)}
                      className={calendarDate === date ? 'active' : ''}
                      aria-pressed={calendarDate === date}
                    >
                      <span>{['일', '월', '화', '수', '목', '금', '토'][weekday(date)]}</span>
                      <strong>{Number(date.slice(-2))}</strong>
                      <span className={`calendar-day-dot ${[...events,...calendarTaskEvents].some(e=>e.date===date)?'has-events':''}`} aria-hidden="true" />
                    </button>
                  ))}
                </div>
                </CalendarDateStrip>
                <CalendarColors preferences={preferences} disabled={busy||hasPending||demo} onSave={p=>void perform({type:'preferences.update',preferences:p},'일정·할 일 색상을 저장했습니다.')}/>
                <Tabs value={calendarTab} onValueChange={setCalendarTab} className="calendar-content-tabs">
                <TabsList aria-label="날짜별 할 일과 일정" className="calendar-tab-list">
                  <TabsTrigger value="timeline">타임라인 <span>{selectedTimeline.length}</span></TabsTrigger>
                  <TabsTrigger value="tasks">할 일 <span>{selectedCalendarTasks.filter(t=>t.status!=='done').length}</span></TabsTrigger>
                  <TabsTrigger value="events">일정 <span>{selectedEvents.length}</span></TabsTrigger>
                  <TabsTrigger value="waiting">대기함 <span>{calendarInbox.length}</span></TabsTrigger>
                </TabsList>
                {hasPending&&unconfirmedCalendarMove&&<div className="calendar-move-pending" role="status"><strong>시간 변경 결과를 확인하고 있어요</strong><p>{unconfirmedCalendarMove.title} · {formatTime(unconfirmedCalendarMove.start)}–{formatTime(unconfirmedCalendarMove.end)}로 변경 요청</p><p>현재는 마지막으로 확인한 시간을 표시합니다. 연결되면 저장 결과를 다시 확인합니다.</p><button className="text-button" disabled={busy} onClick={()=>void retry()}>저장 결과 확인</button></div>}
                <TabsContent value="tasks"><CalendarTasks tasks={selectedCalendarTasks} projects={projects} preferences={preferences} date={calendarDate} today={TODAY} disabled={busy||hasPending} onOpen={id=>selectedCalendarTasks.find(t=>t.id===id)?.status!=='done'&&selectedTimeline.some(e=>e.id==='task-due:'+id)?openTaskSchedule(id):setDetail({kind:'task',id})} onToggle={id=>void toggleTask(id)}/></TabsContent>
                <TabsContent value="waiting"><CalendarTasks tasks={calendarInbox} projects={projects} preferences={preferences} date={calendarDate} today={TODAY} disabled={busy||hasPending} inbox onOpen={id=>openTaskSchedule(id)} onToggle={id=>void toggleTask(id)} onResume={id=>void perform({type:'task.status',id,status:'todo'},'할 일 목록으로 복귀했습니다.')}/></TabsContent>
                <TabsContent value="timeline">
                  <div className="section-title"><h2>{Number(calendarDate.slice(-2))}일 타임라인</h2><span className="muted">{selectedTimeline.length}개</span></div>
                  <CalendarAgenda key={'timeline:'+calendarDate} events={selectedTimeline} timelineTasks={tasks} date={calendarDate} onToggleTask={id=>void toggleTask(id)} onScheduleTask={id=>openTaskSchedule(id)} onDeleteTask={id=>perform({type:'task.delete',id},'할 일을 삭제했습니다.')} preferences={preferences} projects={projects} disabled={busy||hasPending} onInteractionChange={setCalendarInteracting} onMove={moveCalendarEvent} onEdit={id=>openEdit('event',id)} onDelete={event=>setDeleteTarget({kind:'event',id:event.id,title:event.title})} onOpen={e=>e.id.startsWith('protected:')?navigate('portfolio'):e.taskId?setDetail({kind:'task',id:e.taskId}):setDetail({kind:'event',id:e.id})}/>
                </TabsContent>
                <TabsContent value="events">
                <div className="section-title">
                  <h2>{Number(calendarDate.slice(-2))}일 일정</h2>
                  <span className="muted">{selectedEvents.length}개</span>
                </div>

                <div className="calendar-full-events"><CalendarAgenda key={calendarDate} events={selectedEvents} colorTasks={tasks} preferences={preferences} projects={projects} disabled={busy||hasPending} onInteractionChange={setCalendarInteracting} onMove={moveCalendarEvent} onEdit={id=>openEdit('event',id)} onDelete={event=>setDeleteTarget({kind:'event',id:event.id,title:event.title})} onOpen={e=>e.id.startsWith('protected:')?navigate('portfolio'):e.taskId?setDetail({kind:'task',id:e.taskId}):setDetail({kind:'event',id:e.id})}/></div>
                </TabsContent></Tabs>
              </section>
              <aside className="review-summary">
                <h2>시간을 비워두는 것도 계획</h2>
                <p className="muted">
                  갑작스러운 일에 대응할 여유를 남깁니다. 내일 제안은 가용 시간의{' '}
                  {Math.round((1 - preferences.bufferFraction) * 100)}% 안에서 배치합니다.
                </p>
                <button
                  className="secondary-button full-width"
                  style={{ marginTop: 22 }}
                  onClick={() => navigate('proposal')}
                >
                  <Sparkles size={16} />
                  내일 제안 확인
                </button>
              </aside>
            </div>
          )}
          {view === 'review' && (
            <div className="review-grid">
              <section className="full-card review-card">
                <div className="section-title">
                  <h2>
                    <Wand2 size={17} /> PAFI 회고 · 계획과 실제의 차이에서 규칙을
                  </h2>
                  <input
                    className="date-input"
                    type="date"
                    max={TODAY}
                    value={reviewDate}
                    aria-label="회고 날짜"
                    onChange={(e) => {
                      if (e.target.value) setReviewDate(e.target.value);
                    }}
                  />
                </div>
                <ReviewWizard
                  ownerId={ownerId}
                  key={`${reviewDate}:${data.reviews.find((r) => r.date === reviewDate)?.updatedAt ?? ''}:${loaded}`}
                  data={data}
                  reviewDate={reviewDate}
                  today={TODAY}
                  busy={busy}
                  demo={demo}
                  onSave={saveReview}
                  open={(kind, id) => setDetail({ kind, id })}
                />
              </section>
              <aside className="review-summary">
                <h2>{koreanDate(reviewDate, false)} 실행 기록</h2>
                <div className="metric-row">
                  <span>완료한 할 일</span>
                  <strong>{reviewCompleted.length}개</strong>
                </div>
                <div className="metric-row">
                  <span>완료한 핵심 결과물</span>
                  <strong>
                    {reviewFocus.filter((t) => t.status === 'done' && t.completedOn === reviewDate).length} /{' '}
                    {reviewFocus.length}
                  </strong>
                </div>
                <div className="metric-row">
                  <span>현재 대기 중인 업무</span>
                  <strong>{waiting.length}개</strong>
                </div>
                <div className="metric-row">
                  <span>완료 업무의 예상 시간 합</span>
                  <strong>{reviewCompleted.reduce((s, t) => s + t.duration, 0)}분</strong>
                </div>
                <div className="metric-row">
                  <span>완료 업무의 실제 시간 합</span>
                  <strong>{reviewCompleted.reduce((s, t) => s + (t.actualMinutes ?? 0), 0)}분</strong>
                </div>
                <p className="quote">계획과 실제의 차이는 실패가 아니라, 다음 계획을 위한 정보입니다.</p>
                <div className="divider" />
                <WeeklyStats data={data} endDate={reviewDate} />
                <ConfirmationTrend today={TODAY} demo={demo} />
              </aside>
            </div>
          )}
          {view === 'proposal' && reflection && reflection.next === proposalDate && (
            <ReflectionCard reflection={reflection} onClose={() => setReflection(null)} />
          )}
          {view === 'proposal' && (
            <DailyBriefPanel
              snapshot={snapshot}
              date={proposalDate}
              setDate={setProposalDate}
              energy={energy}
              setEnergy={setEnergy}
              busy={busy || !loaded || hasPending}
              demo={demo}
              refresh={async () => {
                if (!hasPending) await refresh();
              }}
              perform={perform}
              navigate={navigate}
              open={(kind, id) => setDetail({ kind, id })}
              launch={briefLaunch}
            />
          )}
        </main>
      </div>
      <ProjectActions target={projectAction} onClose={()=>setProjectAction(null)} snapshot={snapshot} busy={busy||hasPending||!loaded} demo={demo} demoTrash={demoDataTrash} setDemoTrash={setDemoDataTrash} onSnapshot={acceptSnapshot} onRefresh={refresh} onOpen={openProject} onEdit={id=>openEdit('project',id)} onChat={openProjectChat} onDeleted={id=>{if(detail?.kind==='project'&&detail.id===id)setDetail(null)}} onNavigate={view=>{setDetail(null);setDataInitialTab('records');navigate(view)}} onWorking={setProjectManaging}/>
      <Sheet
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) {if(projectDetail&&dataEditing){if(!busy&&!hasPending)setDiscardProjectConfirm(true);return;}setDetail(null);}
        }}
      >
        <SheetContent className={`w-full sm:max-w-[520px] p-0 flex flex-col ${projectDetail ? 'project-detail-sheet' : ''}`} side="right" showCloseButton={!projectDetail}>
          <SheetHeader className={`px-7 pt-9 pb-5 border-b ${projectDetail?'project-flow-sheet-header':taskDetail?'task-detail-header':''}`}>
            {projectDetail&&<SheetClose className="project-detail-back" disabled={busy||hasPending} aria-label="프로젝트 목록으로 돌아가기"><ChevronLeft size={22}/></SheetClose>}
            <SheetTitle className="text-xl leading-relaxed">
              {taskDetail?.title ??
                noteDetail?.title ??
                (projectDetail?'프로젝트':undefined) ??
                eventDetail?.title ??
                '상세 보기'}
            </SheetTitle>
            <SheetDescription>
              {taskDetail
                ? '할 일 · 완료 기준과 연결된 맥락'
                : noteDetail
                  ? '기록 · 프로젝트와 다음 행동'
                  : projectDetail
                    ? '프로젝트 · 목표와 현재 진행'
                    : eventDetail
                      ? '일정 · 시간과 연결 업무'
                      : ''}
            </SheetDescription>
            {taskDetail&&<button type="button" className="task-edit-button" disabled={busy||hasPending} onClick={()=>openEdit('task',taskDetail.id)}><Pencil size={18}/><span>할 일 수정</span><ChevronRight size={18}/></button>}
          </SheetHeader>
          <div className="sheet-body">
            {taskDetail && (
              <>
                <label className="form-label">일정 구분</label><Choice value={eventScope(taskDetail)} label="할 일 일정 구분" onChange={scope=>{if(!busy&&!hasPending)void perform({type:'task.upsert',task:{...taskDetail,scope:scope as EventScope}},'할 일 구분을 저장했습니다.')}} items={eventScopes.map(value=>({value,label:eventScopeLabels[value]}))}/>
                <label className="form-label">카테고리</label><Choice value={categoryOf(taskDetail)} label="할 일 카테고리" onChange={category=>{if(!busy&&!hasPending)void perform({type:'task.upsert',task:{...taskDetail,category:category as CalendarCategory}},'할 일 카테고리를 저장했습니다.')}} items={calendarCategories.map(value=>({value,label:categoryLabels[value]}))}/>
                <ItemColorPicker value={taskDetail.color??null} defaultColor={categoryColor(categoryOf(taskDetail),preferences,'task')} disabled={busy||hasPending} onChange={color=>{if(!busy&&!hasPending)void perform({type:'task.upsert',task:{...taskDetail,color}},'할 일 색상을 저장했습니다.')}}/>
                <div className="event-memo-detail"><span className="form-label">메모</span><p className="event-memo-text">{taskDetail.description||'할 일 수정에서 메모를 추가할 수 있습니다.'}</p><p className="form-hint">Google 연결 시 마감일 일정과 배정한 시간에 자동으로 반영됩니다.</p></div><CalendarEventDelivery eventId={'task-due:'+taskDetail.id} demo={demo}/>
                <div className="detail-keyvalue">
                  <span>연결 프로젝트</span>
                  <button className="text-button" onClick={()=>setDetail({kind:'project',id:taskDetail.projectId})}>{projectById(taskDetail.projectId)?.name}<ChevronRight size={14}/></button>
                </div>
                <div className="detail-keyvalue">
                  <span>마감일</span>
                  <strong>{taskDetail.due}</strong>
                </div>
                <div className="detail-keyvalue">
                  <span>예상 시간</span>
                  <strong>
                    {durationText(taskDetail.duration)}
                    {taskDetail.actualMinutes ? ` · 실제 ${durationText(taskDetail.actualMinutes)}` : ''}
                  </strong>
                </div>
                <div className="detail-keyvalue">
                  <span>BRAINY</span>
                  <strong className="brainy-meta">
                    <span className="brainy-badge">{taskDetail.quadrant ?? '사분면 자동'}</span>
                    <span
                      className={`brainy-badge ${taskDetail.cognition ? `cog-${taskDetail.cognition}` : ''}`}
                    >
                      {taskDetail.cognition
                        ? cognitionLabel[taskDetail.cognition].split(' · ')[0]
                        : '인지 자동'}
                    </span>
                    {taskDetail.must && <span className="brainy-badge">반드시 종결</span>}
                    {taskDetail.laserDate && (
                      <span className="brainy-badge">Laser {taskDetail.laserDate.slice(5)}</span>
                    )}
                    {taskDetail.unplanned && <span className="brainy-badge">+ 계획 밖</span>}
                  </strong>
                </div>
                {taskDetail.status!=='done'&&<button className="secondary-button full-width task-schedule-entry" disabled={busy||hasPending} onClick={()=>openTaskSchedule(taskDetail.id,view==='calendar'?calendarDate:TODAY)}>시간 배정하기 <ArrowRight size={17}/></button>}
                <FocusSession
                  task={taskDetail}
                  startReason={questReadiness(data,taskDetail,TODAY).canStart ? undefined : questReadiness(data,taskDetail,TODAY).reason}
                  busy={busy}
                  demo={demo}
                  onStart={() =>
                    perform({ type: 'task.start', id: taskDetail.id }, '집중 시작. 한 번에 하나만.')
                  }
                  onStop={() =>
                    perform({ type: 'task.stop', id: taskDetail.id }, '지금까지의 시간을 기록했습니다.')
                  }
                  onRecord={(input) => recordTask(taskDetail, input)}
                />
                <TaskCoach
                  compact
                  checks={coachTask(taskDetail, {
                    ...coachContext,
                    factor: calibrationFactor(tasks, taskDetail, TODAY,data.executionHistory),
                  })}
                />
                <label className="form-label">진행 상태</label>
                <Choice
                  value={taskDetail.status}
                  label="진행 상태"
                  onChange={(v) =>
                    void perform(
                      { type: 'task.status', id: taskDetail.id, status: v as TaskStatus },
                      '상태를 저장했습니다.',
                    )
                  }
                  items={Object.entries(statusLabel).map(([value, label]) => ({ value, label }))}
                />
                <div className="sheet-actions">
                  <button
                    className="secondary-button"
                    disabled={events.some(
                      (e) => e.taskId === taskDetail.id && e.date === TODAY && e.id.startsWith('approved:'),
                    )}
                    onClick={() =>
                      void perform(
                        {
                          type: 'task.focus',
                          id: taskDetail.id,
                          focus: !(taskDetail.focus && taskDetail.focusDate === TODAY),
                        },
                        '핵심 결과물을 변경했습니다.',
                      )
                    }
                  >
                    <Target size={15} />
                    {events.some(
                      (e) => e.taskId === taskDetail.id && e.date === TODAY && e.id.startsWith('approved:'),
                    )
                      ? '오늘 승인한 결과물'
                      : taskDetail.focus && taskDetail.focusDate === TODAY
                        ? '오늘 핵심에서 해제'
                        : '오늘 핵심으로'}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={taskDetail.status === 'done'}
                    onClick={() =>
                      void perform(
                        {
                          type: 'task.laser',
                          id: taskDetail.id,
                          date: TODAY,
                          laser: taskDetail.laserDate !== TODAY,
                        },
                        taskDetail.laserDate === TODAY
                          ? 'Goal Laser를 해제했습니다.'
                          : '오늘의 Goal Laser로 지정했습니다.',
                      )
                    }
                  >
                    <Crosshair size={15} />
                    {taskDetail.laserDate === TODAY ? '오늘 Laser 해제' : '오늘의 Goal Laser로'}
                  </button>

                </div>
                <h3>완료 기준</h3>
                <p className="definition">{taskDetail.definition}</p>
                {taskDetail.planHoldUntil && (
                  <>
                    <h3>계획 보류</h3>
                    <p>
                      {taskDetail.planHoldReason}
                      <br />
                      {koreanDate(taskDetail.planHoldUntil)} 다시 검토
                    </p>
                    <button
                      className="link-card"
                      onClick={() => {
                        const plan = data.proposals.find((p) => p.id === taskDetail.planHoldProposalId);
                        if (plan) setProposalDate(plan.date);
                        setDetail(null);
                        navigate('proposal');
                      }}
                    >
                      <Pause size={15} />
                      보류한 제안에서 다시 검토
                    </button>
                  </>
                )}
                {taskDetail.blocker && (
                  <>
                    <h3>현재 막힌 이유</h3>
                    <p>{taskDetail.blocker}</p>
                    <p className="muted">
                      다음 확인 ·{' '}
                      {taskDetail.checkDate ? koreanDate(taskDetail.checkDate) : '확인일을 정해 주세요'}
                    </p>
                  </>
                )}
                {taskDetail.dependsOn?.length ? (
                  <>
                    <h3>먼저 끝나야 하는 일</h3>
                    {taskDetail.dependsOn.map((id) => (
                      <button key={id} className="link-card" onClick={() => setDetail({ kind: 'task', id })}>
                        <Link2 size={16} />
                        {tasks.find((t) => t.id === id)?.title}
                      </button>
                    ))}
                  </>
                ) : null}
                {taskDetail.noteCitation && (
                  <>
                    <h3>회의록 원문</h3>
                    <blockquote className="task-citation">{taskDetail.noteCitation.quote}</blockquote>
                    <p className="form-hint">
                      회의록 버전 {taskDetail.noteCitation.revision} · {taskDetail.noteCitation.line}행에서
                      승인한 행동
                    </p>
                  </>
                )}
                {taskDetail.noteId && (
                  <>
                    <h3>이 일이 생긴 맥락</h3>
                    <button
                      className="link-card"
                      onClick={() => setDetail({ kind: 'note', id: taskDetail.noteId! })}
                    >
                      <FileText size={17} />
                      {notes.find((n) => n.id === taskDetail.noteId)?.title}
                      <ChevronRight size={14} />
                    </button>
                  </>
                )}
                <button
                  className="text-button danger-text"
                  style={{ marginTop: 20 }}
                  onClick={() =>
                    setDeleteTarget({ kind: 'task', id: taskDetail.id, title: taskDetail.title })
                  }
                >
                  <Trash2 size={14} />할 일 삭제
                </button>
                <div className="sheet-actions">
                  <button className="primary-button" onClick={() => toggleTask(taskDetail.id)}>
                    <Check size={16} />
                    {taskDetail.status === 'done' ? '완료 취소' : '결과물 완료'}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setDetail(null);
                      navigate('proposal');
                    }}
                  >
                    내일 계획으로
                    <ArrowRight size={16} />
                  </button>
                </div>
              </>
            )}
            {noteDetail && (
              <><NoteDetail requestedRevision={detail?.revision}
                key={`${noteDetail.id}:${detail?.revision??noteDetail.revision ?? 1}`}
                meta={noteDetail}
                notes={notes}
                onNote={(id)=>setDetail({kind:'note',id})}
                tasks={tasks}
                demo={demo}
                busy={busy}
                defaultDue={TOMORROW}
                projectName={projectById(noteDetail.projectId)?.name}
                onAction={perform}
                onEdit={(n) => openEdit('note', n.id, n)}
                onDelete={() => setDeleteTarget({ kind: 'note', id: noteDetail.id, title: noteDetail.title })}
                onTask={(id) => setDetail({ kind: 'task', id })}
                onProject={() => setDetail({ kind: 'project', id: noteDetail.projectId })}
                onNewTask={() => openCreate('task')}
              />{noteDetail.kind==='wiki'&&<WikiRelated data={data} note={noteDetail} onOpen={(kind,id)=>setDetail({kind,id})}/>}</>
            )}
            {projectDetail && <ProjectDetailPanel key={projectDetail.id+':'+(detail?.projectIntent??'overview')} intent={detail?.projectIntent} onManage={()=>setProjectAction({id:projectDetail.id,mode:'menu'})} project={projectDetail} data={data} today={TODAY} busy={busy||hasPending||!loaded} perform={perform} onOpen={(kind,id,revision)=>setDetail({kind,id,revision})} onCreate={openCreate} onEdit={()=>openEdit('project',projectDetail.id)} onDelete={()=>setProjectAction({id:projectDetail.id,mode:'delete'})} onChat={()=>openProjectChat(projectDetail.id)} onEditing={setDataEditing} followup={<FollowupPanel data={data} today={TODAY} busy={busy||hasPending||demo} perform={perform} initialProjectId={projectDetail.id} initialTab="delegations" onOpen={(kind,id,revision)=>setDetail({kind,id,revision})}/>}/>}
            {eventDetail && (
              <>
                {eventDetail.id.startsWith('google:') ? (eventDetail.google?.orbitEventId&&events.some(e=>e.id===eventDetail.google!.orbitEventId) ? <button className="primary-button event-edit-entry" disabled={busy||hasPending} onClick={()=>{const original=events.find(e=>e.id===eventDetail.google!.orbitEventId)!;if(canEditCalendarEvent(original))openEdit('event',original.id);else{setProposalDate(original.date);setDetail(null);navigate('proposal')}}}><Pencil size={16}/>연결된 일정 수정</button> : <GoogleEventEditor key={ownerId+':'+eventDetail.id} storageKey={eventDetail.google?JSON.stringify([eventDetail.google.calendarId,eventDetail.google.eventId]):eventDetail.id} eventId={eventDetail.id} ownerId={ownerId} disabled={demo||busy||hasPending} onEditing={setDataEditing} onSaved={async event=>{await refresh();setCalendarDate(event.date);setDetail({kind:'event',id:event.id});window.dispatchEvent(new Event('orbit:calendar-changed'));toast.success('일정 수정 내용을 Google Calendar에 저장했습니다.')}}/>) : canEditCalendarEvent(eventDetail) ? <button className="primary-button event-edit-entry" disabled={busy||hasPending} onClick={()=>openEdit('event',eventDetail.id)}><Pencil size={16}/>일정 수정</button> : null}
                {postponeTarget&&(postponeTarget.id.startsWith('google:')||canEditCalendarEvent(postponeTarget))&&<EventPostpone key={ownerId+':'+postponeTarget.id} event={postponeTarget} timeZone={preferences.timeZone} ownerId={ownerId} storageKey={postponeTarget.google?JSON.stringify([postponeTarget.google.calendarId,postponeTarget.google.eventId]):postponeTarget.id} disabled={demo||busy||hasPending} onSaved={async(event,external)=>{if(external){await refresh();setCalendarDate(event.date);setDetail({kind:'event',id:event.id});toast.success('일정을 미루고 Google Calendar에 저장했습니다.');window.dispatchEvent(new Event('orbit:calendar-changed'));return true}const ok=await perform(eventCommand(event));if(ok){setCalendarDate(event.date);setDetail({kind:'event',id:event.id});toast.success('일정을 미뤘습니다.');window.dispatchEvent(new Event('orbit:calendar-changed'))}return ok}}/>}
                <label className="form-label">카테고리</label><Choice value={preferences.eventCategories?.[eventDetail.id]??categoryOf(eventDetail)} label="일정 카테고리" onChange={v=>{if(!busy&&!hasPending)void perform(canEditCalendarEvent(eventDetail)?eventCommand({...eventDetail,category:v as CalendarCategory}):{type:'preferences.update',preferences:{...preferences,eventCategories:{...preferences.eventCategories,[eventDetail.id]:v as CalendarCategory}}},'일정 카테고리를 저장했습니다.')}} items={calendarCategories.map(c=>({value:c,label:categoryLabels[c]}))}/><ItemColorPicker value={preferences.eventColors?.[eventDetail.id]??eventDetail.color??null} defaultColor={tasks.find(t=>t.id===eventDetail.taskId)?.color??categoryColor(preferences.eventCategories?.[eventDetail.id]??categoryOf(eventDetail),preferences,eventDetail.taskId?'task':'event')} disabled={busy||hasPending} onChange={color=>{if(!busy&&!hasPending)void perform(canEditCalendarEvent(eventDetail)?eventCommand({...eventDetail,color}):{type:'preferences.update',preferences:{...preferences,eventColors:{...preferences.eventColors,[eventDetail.id]:color}}},'일정 색상을 저장했습니다.')}}/>
                <div className="event-memo-detail"><span className="form-label">일정 구분</span><p>{eventScopeLabels[eventScope(eventDetail)]}</p><span className="form-label">메모</span><p className="event-memo-text">{eventDetail.description||'일정 수정에서 메모를 추가할 수 있습니다.'}</p></div>
                <EventFiles
                  key={eventDetail.id}
                  eventId={eventDetail.id}
                  demo={demo}
                  onSave={(ids) =>
                    perform(
                      { type: 'event.attach', id: eventDetail.id, attachmentIds: ids },
                      '일정에 첨부파일을 보관했습니다.',
                    )
                  }
                />
                <div className="detail-keyvalue">
                  <span>날짜</span>
                  <strong>{koreanDate(eventDetail.date)}</strong>
                </div>
                <div className="detail-keyvalue">
                  <span>시간</span>
                  <strong>
                    {formatTime(eventDetail.start)}–{formatTime(eventDetail.end)}
                  </strong>
                </div>
                {eventDetail.projectId && (
                  <button
                    className="link-card"
                    onClick={() => setDetail({ kind: 'project', id: eventDetail.projectId! })}
                  >
                    <FolderKanban size={16} />
                    {projectById(eventDetail.projectId)?.name}
                  </button>
                )}
                {eventDetail.taskId && (
                  <button
                    className="link-card"
                    onClick={() => setDetail({ kind: 'task', id: eventDetail.taskId! })}
                  >
                    <CheckCheck size={16} />
                    연결된 할 일
                  </button>
                )}
                {!eventDetail.id.startsWith('google:')&&<CalendarEventDelivery eventId={eventDetail.id} demo={demo}/>}
                <div className="sheet-actions">
                  {eventDetail.id.startsWith('google:') ? (
                    <a
                      className="secondary-button"
                      href="https://calendar.google.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Google Calendar에서 보기 <ArrowUpRight size={15} />
                    </a>
                  ) : eventDetail.id.startsWith('approved:') ? (
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setProposalDate(eventDetail.date);
                        setDetail(null);
                        navigate('proposal');
                      }}
                    >
                      제안에서 승인 관리
                    </button>
                  ) : (
                    <>
                      <button
                        className="secondary-button danger-text"
                        onClick={() =>
                          setDeleteTarget({ kind: 'event', id: eventDetail.id, title: eventDetail.title })
                        }
                      >
                        <Trash2 size={15} />
                        일정 삭제
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
      {scheduleTask&&<QuickTaskSchedule key={scheduleTask.id+':'+scheduleTask.date} data={data} taskId={scheduleTask.id} initialDate={scheduleTask.date} now={clock} busy={busy} pending={hasPending} demo={demo} onSave={action=>perform(action,'시간을 배정했습니다.')} onRetry={()=>void retry()} onClose={()=>closeTaskSchedule()} onHold={()=>perform({type:'task.hold',id:scheduleTask.id},'할 일 대기함으로 옮겼습니다.')} onHeld={()=>closeTaskSchedule(()=>{setCalendarTab('waiting');navigate('calendar')})} onDetails={()=>{const id=scheduleTask.id;closeTaskSchedule(()=>setDetail({kind:'task',id}))}} onSaved={(date,eventId)=>closeTaskSchedule(()=>{setCalendarDate(date);setCalendarTab('timeline');navigate('calendar');window.dispatchEvent(new Event('orbit:calendar-changed'));requestAnimationFrame(()=>requestAnimationFrame(()=>document.getElementById('agenda-row-'+eventId)?.scrollIntoView({block:'center',behavior:'instant'})))})}/>}
      <Dialog
        open={!!create}
        onOpenChange={(open) => {
          if (!open) {
            if(create==='task'||create==='event'){if(!busy&&!hasPending)setDiscardCreateConfirm(true);}
            else setCreate(null);
          }
        }}
      >
        <DialogContent className={`orbit-create-dialog ${create === 'event' ? 'event-create-dialog' : create==='task'?'task-create-dialog':''}`}>
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? create==='task'?'할 일 수정':create==='event'?'일정 수정':'내용 수정'
                : create === 'task'
                  ? '새 할 일'
                  : create === 'project'
                    ? '새 프로젝트'
                    : create === 'event'
                      ? '일정 추가'
                      : create === 'knowledge'
                        ? '지식 추가'
                        : create === 'wiki'
                          ? '위키 문서 추가'
                          : '회의록 추가'}
            </DialogTitle>
            <DialogDescription>
              {demo
                ? '예시 체험의 변경은 저장되지 않습니다.'
                : create === 'event' ? '언제, 무엇을 할지 정해 보세요.' : '내 워크스페이스에 저장합니다.'}
            </DialogDescription>
          </DialogHeader>
          <form className="dialog-form" onSubmit={submitCreate}>{formDraftError&&<p role="alert">{formDraftError}</p>}
            <label className="form-label" htmlFor="new-title">
              {create === 'task' ? '무엇을 끝내야 하나요?' : '제목'}
            </label>
            {create==='task'?<textarea className="form-field task-title-input" id="new-title" required maxLength={160} rows={3} value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="예: 가맹 제안서 초안 완성"/>:<input
              className="form-field"
              id="new-title"
              required
              maxLength={160}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="제목을 입력하세요"
            />}
            {create !== 'project' && create !== 'event' && (
              <>
                <label className="form-label">연결 프로젝트</label>
                <Choice
                  value={create === 'task' ? taskProject : newProject}
                  onChange={(v) => {
                    setProjectTouched(true);
                    setNewProject(v);
                  }}
                  label="연결 프로젝트"
                  items={[
                    ...projects.map((p) => ({ value: p.id, label: p.name })),
                    ...(create === 'task' && newProjectCandidate ? [{ value: newProjectCandidate.id, label: `${newProjectCandidate.name} · 새 프로젝트` }] : []),
                  ]}
                />
                {create === 'task' && selectedDraft && <p className="form-hint auto-project"><Wand2 size={12} /> 저장하면 <b>{selectedDraft.name}</b> 프로젝트를 만들고 이 할 일을 연결합니다. 프로젝트 목표일은 할 일의 마감일로 시작합니다.</p>}
                {create === 'task' &&
                  autoProject?.confidence === 'high' &&
                  taskProject === autoProject.projectId && (
                    <p className="form-hint auto-project">
                      <Wand2 size={12} /> 키워드 ‘{autoProject.matched.slice(0, 2).join('’, ‘')}’으로{' '}
                      <b>{projectById(autoProject.projectId)?.name}</b>에 저장됩니다. 다른 프로젝트를
                      고르면 그대로 둡니다.
                    </p>
                  )}
              </>
            )}
            {(create === 'task' || create === 'project') && (
              <div className="field-grid">
                <div>
                  <label className="form-label" htmlFor="new-date">
                    목표일
                  </label>
                  <input
                    id="new-date"
                    type="date"
                    className="form-field"
                    value={newDate}
                    required
                    onChange={(e) => setNewDate(e.target.value)}
                  />
                </div>
                {create !== 'project' && (
                  <div>
                    <label className="form-label">예상 시간</label>
                    <Choice
                      value={newDuration}
                      onChange={setNewDuration}
                      label="예상 시간"
                      items={[...new Set([15, 30, 45, 60, 90, 120, 180, 240, Number(newDuration) || 45])]
                        .sort((a, b) => a - b)
                        .map((v) => ({ value: String(v), label: `${v}분` }))}
                    />
                  </div>
                )}
              </div>
            )}
            {create === 'task' && <><label className="form-label">일정 구분</label><Choice value={newScope} onChange={value=>setNewScope(value as EventScope)} label="할 일 일정 구분" items={eventScopes.map(value=>({value,label:eventScopeLabels[value]}))}/><label className="form-label" htmlFor="task-memo">메모</label><textarea id="task-memo" className="form-field" rows={5} maxLength={20000} value={newTaskMemo} onChange={e=>setNewTaskMemo(e.target.value)} placeholder="통화 내용, 준비 사항 등을 적어 주세요."/><p className="form-hint">Google 연결 시 메모·구분·색상이 마감일 일정과 배정한 시간에 자동으로 반영됩니다.</p></>}
            {create === 'event' && (
              <>
                <label className="form-label">일정 구분</label><Choice value={newScope} onChange={value=>setNewScope(value as EventScope)} label="일정 구분" items={eventScopes.map(value=>({value,label:eventScopeLabels[value]}))}/>
                <label className="form-label" htmlFor="event-memo">메모</label><textarea id="event-memo" className="form-field" rows={5} maxLength={20000} value={newBody} onChange={e=>setNewBody(e.target.value)} placeholder="통화 내용, 준비 사항 등을 적어 주세요."/>
                <p className="form-hint">Google 연결 시 메모도 Calendar의 설명에 반영됩니다.</p>
                <label className="form-label" htmlFor="event-date">날짜</label>
                <input id="event-date" type="date" className="form-field" value={newDate} required onChange={e=>setNewDate(e.target.value)}/>
                <div className="field-grid event-time-fields">
                  <div><label className="form-label" htmlFor="new-time">시작</label><input type="time" id="new-time" required className="form-field" value={newTime} onChange={e=>setNewTime(e.target.value)}/></div>
                  <div><label className="form-label">소요 시간</label><Choice value={newDuration} onChange={setNewDuration} label="소요 시간" items={[...new Set([15,30,45,60,90,120,180,240,Number(newDuration)||45])].sort((a,b)=>a-b).map(v=>({value:String(v),label:durationText(v)}))}/></div>
                </div>
                <p className="event-end-summary"><Clock3 size={15}/>{(()=>{const [h,m]=newTime.split(':').map(Number);const end=h*60+m+Number(newDuration);return Number.isFinite(end)?end<=1440?`${formatTime(end)}에 끝나요`:'종료 시간이 다음 날을 넘어요. 시간을 조정해 주세요.':''})()}</p>
                <label className="form-label">프로젝트 <span className="optional-label">선택</span></label>
                <Choice value={newProject} onChange={v=>{setProjectTouched(true);setNewProject(v)}} label="연결 프로젝트" items={[{value:'auto',label:'이름으로 자동 연결'},{value:'none',label:'연결 안 함'},...projects.map(p=>({value:p.id,label:p.name}))]}/>
                {eventMatch&&<p className="muted">{projects.find(p=>p.id===eventMatch.projectId)?.name}에 연결됩니다 · {eventMatch.matched.join(', ')}</p>}
                {!!eventCandidates.length&&<p role="status">여러 프로젝트가 일치합니다. 연결할 프로젝트를 선택해 주세요: {eventCandidates.map(c=>projects.find(p=>p.id===c.projectId)?.name).join(', ')}</p>}
              </>
            )}
            {(create==='task'||create==='event')&&<><label className="form-label">카테고리</label><Choice value={newCategory} onChange={v=>setNewCategory(v as CalendarCategory)} label="카테고리" items={calendarCategories.map(c=>({value:c,label:categoryLabels[c]}))}/><ItemColorPicker value={newColor} onChange={setNewColor} disabled={busy||hasPending} defaultColor={(create==='event'&&tasks.find(t=>t.id===events.find(e=>e.id===editingId)?.taskId)?.color)||categoryColor(newCategory,preferences,create==='task'||!!events.find(e=>e.id===editingId)?.taskId?'task':'event')}/></>}
            {create === 'task' && (
              <details className="task-advanced"><summary>추가 설정 · 우선순위와 대기 조건</summary>
                <div className="field-grid">
                  <div>
                    <label className="form-label">사분면</label>
                    <Choice
                      value={newQuadrant}
                      onChange={(v) => setNewQuadrant(v as Quadrant | 'auto')}
                      label="사분면"
                      items={[
                        { value: 'auto', label: '자동 추정' },
                        ...(Object.keys(quadrantLabel) as Quadrant[]).map((q) => ({
                          value: q,
                          label: quadrantLabel[q],
                        })),
                      ]}
                    />
                  </div>
                  <div>
                    <label className="form-label">인지 등급</label>
                    <Choice
                      value={newCognition}
                      onChange={(v) => setNewCognition(v as Cognition | 'auto')}
                      label="인지 등급"
                      items={[
                        { value: 'auto', label: '자동 추정' },
                        ...(Object.keys(cognitionLabel) as Cognition[]).map((c) => ({
                          value: c,
                          label: cognitionLabel[c],
                        })),
                      ]}
                    />
                  </div>
                </div>
                <div className="choice-row">
                  <label className="focus-choice">
                    <Checkbox checked={newFocus&&(projects.find(p=>p.id===taskProject)?.status??'active')==='active'} disabled={(projects.find(p=>p.id===taskProject)?.status??'active')!=='active'} onCheckedChange={(v) => setNewFocus(v === true)} />
                    핵심 결과물로 지정
                  </label>
                  <label className="focus-choice">
                    <Checkbox checked={newMust} onCheckedChange={(v) => setNewMust(v === true)} />
                    반드시 종결 (오늘 상대방 손에 넘긴다)
                  </label>
                </div>
                <label className="form-label" htmlFor="task-blocker">
                  대기·후속 확인 메모
                </label>
                <input
                  id="task-blocker"
                  className="form-field"
                  value={newBlocker}
                  onChange={(e) => setNewBlocker(e.target.value)}
                  placeholder="예: 운영 계획 회신 대기"
                />
                <label className="form-label" htmlFor="task-check-date">
                  다음 확인일
                </label>
                <input
                  id="task-check-date"
                  type="date"
                  className="form-field"
                  value={newCheckDate}
                  onChange={(e) => setNewCheckDate(e.target.value)}
                />
              </details>
            )}
            {create !== 'event' && (
              <>
                <label className="form-label" htmlFor="new-body">
                  {create === 'task' ? '완료 기준' : create === 'project' ? '최종 결과물' : '내용'}
                </label>
                <textarea
                  className="form-field"
                  id="new-body"
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder={
                    create === 'task'
                      ? '무엇이 있으면 이 일이 끝난 것인가요?'
                      : '핵심 내용, 결정한 사항, 다음 행동을 남겨 주세요.'
                  }
                />
                {create === 'project' && (
                  <>
                    <label className="form-label" htmlFor="new-keywords">
                      키워드 (쉼표로 구분)
                    </label>
                    <input
                      id="new-keywords"
                      className="form-field"
                      value={newKeywords}
                      maxLength={400}
                      onChange={(e) => setNewKeywords(e.target.value)}
                      placeholder="예: OFD, 도넛, 가맹 — 할 일 제목에 이 말이 있으면 이 프로젝트로 자동 안분"
                    />
                  </>
                )}
              </>
            )}
            {create === 'task' && (
              <TaskCoach
                checks={draftChecks}
                onFix={(patch) => {
                  if (patch.quadrant) setNewQuadrant(patch.quadrant);
                  if (patch.cognition) setNewCognition(patch.cognition);
                  if (patch.duration) setNewDuration(String(patch.duration));
                  if (patch.projectId) {
                    setProjectTouched(true);
                    setNewProject(patch.projectId);
                  }
                }}
              />
            )}
            {create === 'event' && !editingId && (
              <details className="event-attachments"><summary><Plus size={15}/>파일 첨부{eventUploads.ready.length ? ` · ${eventUploads.ready.length}개` : ' (선택)'}</summary><AttachmentInput scope={attachmentDraft} disabled={demo || busy} /></details>
            )}
            <div className="create-form-footer">
            {create==='task'&&!editingId&&<button type="submit" data-start="true" className="secondary-button" disabled={busy||hasPending||!loaded||!!newBlocker.trim()||(projects.find(p=>p.id===taskProject)?.status??'active')!=='active'}><Play size={16}/>추가하고 시작</button>}
            {create==='task'&&<button type="button" className="secondary-button task-edit-cancel" disabled={busy||hasPending} onClick={()=>setDiscardCreateConfirm(true)}>취소</button>}
            {create==='event'&&<p className="form-hint event-sync-hint"><CalendarDays size={14}/>연결된 Google 캘린더에도 반영됩니다.</p>}
            <button
              type="submit"
              disabled={busy || !loaded || (create === 'event' && !editingId && eventUploads.busy)}
              className="primary-button full-width"
            >
              <Check size={16} />
              {busy ? '저장 중…' : editingId ? '변경 저장' : create==='event' ? '일정 저장' : '추가하기'}
            </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deferId}
        onOpenChange={(open) => {
          if (!open) setDeferId(null);
        }}
      >
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>보류 이유를 남겨 주세요</DialogTitle>
            <DialogDescription>보류한 제안은 일정에 추가되지 않습니다.</DialogDescription>
          </DialogHeader>
          <label htmlFor="defer" className="form-label">
            왜 지금 진행하지 않나요?
          </label>
          <textarea
            id="defer"
            className="form-field"
            value={deferReason}
            onChange={(e) => setDeferReason(e.target.value)}
            placeholder="예: 협업사 회신 후 진행 / 이번 주에는 중요도가 낮음"
          />
          <label className="form-label" htmlFor="revisit">
            다음 검토일
          </label>
          <input
            id="revisit"
            type="date"
            className="form-field"
            min={addDays(proposalDate, 1)}
            value={revisitDate}
            onChange={(e) => setRevisitDate(e.target.value)}
          />
          <button
            disabled={busy || !deferReason.trim() || !revisitDate}
            className="primary-button"
            onClick={async () => {
              if (
                deferId &&
                (await perform(
                  {
                    type: 'proposal.defer',
                    date: proposalDate,
                    itemId: deferId,
                    reason: deferReason.trim(),
                    revisitDate,
                  },
                  '보류 이유와 다음 검토일을 저장했습니다.',
                ))
              )
                setDeferId(null);
            }}
          >
            <Pause size={16} />
            보류하기
          </button>
        </DialogContent>
      </Dialog>
      <WorkspaceSettings settingsOpen={settingsOpen} setSettingsOpen={setSettingsOpen}
        settingsDraft={settingsDraft} setSettingsDraft={setSettingsDraft} busy={busy} navigate={navigate} cosmic={cosmic}
        exporting={exporting} loaded={loaded} demo={demo} downloadData={downloadData}
        onSave={preferences=>perform({type:'preferences.update',preferences},'업무 설정을 저장했습니다. 다음 제안 생성부터 적용됩니다.')}/>
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 항목을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.title}
              <br />
              {deleteTarget?.kind==='event'&&<>ORBIT에서 삭제합니다. Google에 등록된 일정은 Google 캘린더에서 별도로 삭제해 주세요.<br /></>}
              삭제 전 백업·복구 화면에서 백업하면 선택 복구할 수 있습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                if (
                  deleteTarget &&
                  (await perform(
                    { type: `${deleteTarget.kind}.delete`, id: deleteTarget.id } as WorkspaceAction,
                    '삭제했습니다.',
                  ))
                ) {
                  setDeleteTarget(null);
                  setDetail(null);
                }
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={discardProjectConfirm} onOpenChange={setDiscardProjectConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>저장하지 않고 나가시겠습니까?</AlertDialogTitle><AlertDialogDescription>작성 중인 프로젝트 설정은 저장되지 않습니다.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>계속 작성</AlertDialogCancel><AlertDialogAction disabled={busy||hasPending} onClick={e=>{e.preventDefault();if(busy||hasPending)return;setDiscardProjectConfirm(false);setDetail(null);setDataEditing(false);}}>나가기</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={discardCreateConfirm} onOpenChange={setDiscardCreateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>저장하지 않고 나가시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>{editingId?'수정한 내용은 저장되지 않습니다.':create==='event'?'작성 중인 일정은 저장되지 않습니다.':'작성 중인 할 일은 저장되지 않습니다.'}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={()=>setDiscardCreateConfirm(false)}>계속 작성</AlertDialogCancel>
            <AlertDialogAction disabled={busy||hasPending} onClick={event=>{event.preventDefault();if(busy||hasPending)return;if(!editingId&&create)clearDraft(ownerId,'form',create);setDiscardCreateConfirm(false);setCreate(null);setNewTitle('');setNewBody('');setFormDraftError('');}}>나가기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={refreshConfirm} onOpenChange={setRefreshConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>저장 결과를 다시 확인할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              서버의 최신 내용을 불러오고 현재 재시도 대기를 해제합니다. 미확인 요청은 이 기기의 복구 기록에 남습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => void discardRequestAndRefresh()}>최신 내용 불러오기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {assignOpen && (
        <AssignDialog
          data={data}
          busy={busy || !loaded}
          demo={demo}
          perform={perform}
          onClose={() => setAssignOpen(false)}
        />
      )}
      {brainyOpen && (
        <GoalsPanel
          data={data}
          today={TODAY}
          busy={busy}
          demo={demo}
          onClose={() => setBrainyOpen(false)}
          perform={perform}
        />
      )}
      <Toaster position="top-center" richColors />
    </SidebarProvider></CityThemeProvider>
  );
}

export default function Workspace(props: { demo?: boolean; displayName?: string; ownerId?: string }) {
  setRequestOwner(props.ownerId ?? '');
  return (
    <AttachmentProvider key={props.ownerId??'demo'}>
      <WorkspaceContent {...props} />
    </AttachmentProvider>
  );
}
