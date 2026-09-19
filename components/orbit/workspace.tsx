'use client';
import {CalendarEventDelivery} from './agent/calendar-controls';
import { useState, useMemo, useEffect, useRef, type CSSProperties } from 'react';
import {OrbitWordmark} from './brand';
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
  MessageSquare,
  Link2,
  FileText,
  Layers,
  Menu,
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
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {Choice} from './choice';
import {WorkspaceSettings} from './workspace-settings';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Toaster, toast } from 'sonner';
import { focusIds } from '@/lib/orbit/derived';
import { NoteLibrary } from '@/components/orbit/note-library';
import { NoteDetail } from '@/components/orbit/note-detail';
import { InstallRootHint } from '@/components/orbit/install-app';
import {WorkspaceDashboard} from './dashboard';
import {TodayHome} from './today-home';
import {CalendarSyncStatus} from './calendar-sync';
import {CalendarAgenda} from './calendar-agenda';
import {ProjectHub} from './project-hub';
import {ProjectActions,type ProjectIntent} from './project-actions';
import {ProjectDetailPanel} from './project-detail';
import {eventCommand,moveConflict,moveRestriction} from '@/lib/orbit/calendar-move';
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
import { coachTask } from '@/lib/orbit/coach';
import { suggestProject, automaticProject, projectDraft, assignmentPlan } from '@/lib/orbit/classify';
import { WikiLibrary, WikiRelated } from '@/components/orbit/wiki/wiki-library';
import { GraphView } from '@/components/orbit/graph/graph-view';
import { AssignDialog } from '@/components/orbit/coach/assign-dialog';
import { addDays, todayInZone, koreanDate, weekDates, weekday } from '@/lib/orbit/dates';
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
const primaryNavigation: {id:View;label:string;icon:typeof Sun;children:View[]}[] = [
 {id:'today',label:'오늘',icon:Sun,children:['today','dashboard','review','proposal','voice','sound','monthly','learning']},
 {id:'agent',label:'대화',icon:MessagesSquare,children:['agent','aside','automation']},
 {id:'calendar',label:'일정',icon:CalendarDays,children:['calendar']},
 {id:'projects',label:'업무',icon:FolderKanban,children:['projects','tasks','goals','portfolio','signals','meetings','followup','experiments','contacts']},
 {id:'wiki',label:'기록',icon:BookOpen,children:['wiki','knowledge','understanding','data','backup']},
];
function primaryView(view:View){return primaryNavigation.find(n=>n.children.includes(view))??primaryNavigation[0];}
function AppNavigation({view,navigate,pending,displayName,onSettings,onAllMenu}:{view:View;navigate:(v:View)=>void;pending:number;displayName:string;onSettings:()=>void;onAllMenu:()=>void}){
 const {setOpenMobile}=useSidebar();
 const go=(v:View)=>{navigate(v);setOpenMobile(false)};
 return <><Sidebar className="app-sidebar"><SidebarHeader className="p-0"><div className="brand"><OrbitWordmark/></div></SidebarHeader><SidebarContent className="gap-0"><SidebarGroup className="px-4 pt-0"><SidebarGroupContent><SidebarMenu>{primaryNavigation.map(n=><SidebarMenuItem key={n.id}><SidebarMenuButton className="nav-item" isActive={primaryView(view).id===n.id} onClick={()=>go(n.id)}><n.icon/><span>{n.label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu><button className="all-menu-sidebar secondary-button" onClick={onAllMenu}><Menu size={18}/>전체 메뉴</button></SidebarGroupContent></SidebarGroup></SidebarContent><SidebarFooter className="p-0"><div className="user-box"><div className="avatar">{displayName.slice(0,1)}</div><div><strong>{displayName}</strong></div><button className="settings-link" aria-label="설정 열기" onClick={onSettings}><Settings2 size={19}/></button></div></SidebarFooter></Sidebar><nav className="mobile-nav" aria-label="주요 화면">{primaryNavigation.map(n=><button key={n.id} className={primaryView(view).id===n.id?'active':''} onClick={()=>go(n.id)} aria-current={primaryView(view).id===n.id?'page':undefined}><n.icon/>{n.label}</button>)}</nav></>;
}
function WorkspaceSections({view,navigate}:{view:View;navigate:(v:View)=>void}){
 const group=primaryView(view);
 if(group.id!=='projects')return null;
 return <nav className="workspace-sections" aria-label="업무 화면"><div>{(['projects','tasks','goals'] as View[]).map(id=><button key={id} className={view===id?'is-selected':''} aria-current={view===id?'page':undefined} onClick={()=>navigate(id)}>{id==='projects'?'프로젝트':id==='tasks'?'할 일':'목표'}</button>)}</div><DropdownMenu><DropdownMenuTrigger asChild><button className="secondary-button">업무 도구</button></DropdownMenuTrigger><DropdownMenuContent align="end">{group.children.filter(id=>!['projects','tasks','goals'].includes(id)).map(id=><DropdownMenuItem key={id} onSelect={()=>navigate(id)}>{navigation.find(n=>n.id===id)?.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></nav>;
}
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
  const data = snapshot.data,
    preferences = data.preferences;
  const { tasks, projects, notes, events } = data;
  const [clock, setClock] = useState(() => new Date());
  const TODAY = demo ? '2026-09-06' : todayInZone(preferences.timeZone, clock),
    TOMORROW = addDays(TODAY, 1);
  const [view, setView] = useState<View>('today');
  const [pendingAI,setPendingAI]=useState<number|null>(null);
  const [dataEditing, setDataEditing] = useState(false);
  const [demoDataTrash, setDemoDataTrash] = useState<TrashRecord[]>([]);
  const [projectAction,setProjectAction]=useState<{id:string;mode:'menu'|'delete'}|null>(null);
  const [projectManaging,setProjectManaging]=useState(false);
  const [dataInitialTab,setDataInitialTab]=useState<'records'|'trash'>('records');
  const [proposalDate, setProposalDate] = useState(TOMORROW);
  const [attachmentDraft, setAttachmentDraft] = useState('event-draft:initial');
  const eventUploads = useAttachments(attachmentDraft);
  const [briefLaunch, setBriefLaunch] = useState<{ date: string; id: string }>();
  const proposal: Proposal = data.proposals.find((p) => p.date === proposalDate) ?? {
    id: `plan:${proposalDate}`,
    date: proposalDate,
    items: [],
    unscheduled: [],
    budget: 0,
    energy: 'normal',
  };
  const [allMenuOpen,setAllMenuOpen]=useState(false);
  const menuTrigger=useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState('');
  const [taskFilter, setTaskFilter] = useState('all');
  const [calendarDate, setCalendarDate] = useState(TODAY);
  const [detail, setDetail] = useState<{ kind: 'task' | 'note' | 'project' | 'event'; id: string; revision?:number; projectIntent?:ProjectIntent } | null>(
    null,
  );
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
  useEffect(()=>{if(demo||!create||editingId||(!newTitle&&!newBody))return;try{saveDraft(ownerId,'form',create,{id:createId.current,newTitle,newBody,newProject,newDuration,newDate,newTime,newFocus,newBlocker,newCheckDate,newQuadrant,newCognition,newMust,newKeywords,projectTouched});setFormDraftError('');}catch{setFormDraftError('기기 임시 저장에 실패했습니다. 내용을 복사해 보관해 주세요.');}},[demo,ownerId,create,editingId,newTitle,newBody,newProject,newDuration,newDate,newTime,newFocus,newBlocker,newCheckDate,newQuadrant,newCognition,newMust,newKeywords,projectTouched]);
  const [calendarInteracting, setCalendarInteracting] = useState(false);
  const [unconfirmedCalendarMove, setUnconfirmedCalendarMove] = useState<CalendarEvent | null>(null);
  const liveCalendar = useRef({events,data,busy,hasPending});
  liveCalendar.current = {events,data,busy,hasPending};
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
  const pending = proposal.items.filter((i) => i.state === 'pending').length;
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
      !!create || calendarInteracting ||
        dataEditing || projectManaging || !!projectAction ||
        settingsOpen ||
        brainyOpen ||
        assignOpen ||
        view === 'agent' ||
        view === 'review' ||
        detail?.kind === 'note',
    );
    return () => pauseRefresh(false);
  }, [create, calendarInteracting, dataEditing, projectManaging, projectAction, settingsOpen, brainyOpen, assignOpen, view, detail?.kind, pauseRefresh]);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setProposalDate(TOMORROW);
  }, [TOMORROW]);
  useEffect(() => {
    const v = location.hash.slice(1) as View;
    if (navigation.some((n) => n.id === v)) setView(v);
    else {const url=new URL(location.href);const initial=url.searchParams.has('conversation')||url.searchParams.has('chatProject')?'agent':'today';setView(initial);history.replaceState(null,'',url.pathname+url.search+'#'+initial);}
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
    setAllMenuOpen(false);
    setView(v);
    setDetail(null);
    setSearch('');
    if (location.hash !== `#${v}`) history.pushState(null, '', `#${v}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const perform = async (action: WorkspaceAction, message?: string) => {
    const ok = await mutate(action);
    if (ok && message) toast.success(message);
    return ok;
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
    const conflict = moveConflict(target,[...current.events,...protectedEvents(current.data,target.date)]);
    if (conflict) { toast.error(`‘${conflict.title}’ 일정과 겹쳐 원래 시간으로 돌아왔습니다.`); return false; }
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
          if(moveConflict(original,[...latest.events,...protectedEvents(latest.data,original.date)])){toast.error('원래 시간에 다른 일정이 있어 되돌릴 수 없습니다.');return;}
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
    setNewTitle('');
    setNewBody('');
    setNewProject(
      kind === 'event'
        ? 'none'
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
    const restored=!demo&&readDraft<any>(ownerId,'form',kind);
    if(restored&&typeof restored.id==='string'&&typeof restored.newTitle==='string'&&typeof restored.newBody==='string'){
      createId.current=restored.id;setNewTitle(restored.newTitle);setNewBody(restored.newBody);setNewProject(restored.newProject??'');setNewDuration(restored.newDuration??'45');setNewDate(restored.newDate??TODAY);setNewTime(restored.newTime??'10:00');setNewFocus(!!restored.newFocus);setNewBlocker(restored.newBlocker??'');setNewCheckDate(restored.newCheckDate??'');setNewQuadrant(restored.newQuadrant??'auto');setNewCognition(restored.newCognition??'auto');setNewMust(!!restored.newMust);setNewKeywords(restored.newKeywords??'');setProjectTouched(!!restored.projectTouched);toast('이 기기에 임시 보관한 작성을 복원했습니다.');
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
    history.replaceState(null,'',url.pathname+url.search+url.hash);
    navigate('agent');
    window.dispatchEvent(new CustomEvent('orbit:open-chat',{detail:{projectId:id}}));
  };
  const saveReview = async (
    review: { date: string; win: string; block: string; energy: Proposal['energy'] },
    reviewDetail: ReviewDetail,
  ) => {
    const ok = await perform(
      { type: 'review.save', review, detail: reviewDetail },
      '회고와 규칙·실제 시간을 저장했습니다. 이 내용을 포함해 내일의 실행안을 분석합니다.',
    );
    if (ok) {
      const date = addDays(review.date, 1);
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
            ),
          },
        )
      : [];
  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newTitle.trim()) return;
    if (create === 'event' && !editingId && eventUploads.busy) return;
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
          projectId: newProject === 'none' ? undefined : newProject,
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
    }
  };
  const openEdit = (kind: 'task' | 'project' | 'note' | 'event', id: string, loadedNote?: Note) => {
    setAttachmentDraft('event:' + id);
    setEditingId(id);
    if (kind === 'task') {
      const t = tasks.find((t) => t.id === id)!;
      setCreate('task');
      setNewTitle(t.title);
      setNewBody(t.definition);
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
      setCreate('event');
      setNewTitle(e.title);
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
  const currentWeek = weekDates(calendarDate);
  const miniWeek = weekDates(TODAY);
  const reviewCompleted = tasks.filter((t) => t.status === 'done' && t.completedOn === reviewDate);
  const reviewFocus = tasks.filter((t) => focusIds(data, reviewDate).has(t.id));
  const selectedEvents = [...events,...protectedEvents(data,calendarDate)].filter((e) => e.date === calendarDate).sort((a, b) => a.start - b.start);
  const todayRemaining = focus.filter((t) => t.status !== 'done').reduce((s, t) => s + t.duration, 0);
  const renderTimeline = (date: string) => {
    const list = [...events,...protectedEvents(data,date)].filter((e) => e.date === date).sort((a, b) => a.start - b.start);
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
    history.replaceState(null, '', url.pathname + url.search + '#agent');
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
  return (
    <SidebarProvider className="galaxy-workspace" style={{ '--sidebar-width': '248px' } as CSSProperties}>
      <CosmicBackdrop/>
      {!demo && <InstallRootHint />}
      <a href="#main-content" className="skip-link">
        본문으로 이동
      </a>
      <AppNavigation
        view={view}
        navigate={navigate}
        pending={pending}
        displayName={displayName}
        onSettings={openSettings}
        onAllMenu={()=>setAllMenuOpen(true)}
      />
      <Sheet open={allMenuOpen} onOpenChange={setAllMenuOpen}>
        <SheetContent side="left" className="all-menu-panel" onCloseAutoFocus={event=>{event.preventDefault();menuTrigger.current?.focus()}}>
          <SheetHeader><SheetTitle>전체 메뉴</SheetTitle><SheetDescription>필요한 기능으로 바로 이동하세요.</SheetDescription></SheetHeader>
          <nav className="all-menu-groups" aria-label="전체 기능">
            {primaryNavigation.map(group=><section key={group.id}><h2>{group.label}</h2><div>{group.children.map(id=>{const item=navigation.find(n=>n.id===id)!;const Icon=item.icon;return <button key={id} onClick={()=>navigate(id)} aria-current={view===id?'page':undefined}><Icon size={19}/><span>{id==='agent'?'대화':id==='wiki'?'전체 기록':item.label}</span></button>})}</div></section>)}
            <section><h2>설정</h2><button onClick={()=>{setAllMenuOpen(false);openSettings()}}><Settings2 size={19}/><span>연결·환경 설정</span></button></section>
          </nav>
        </SheetContent>
      </Sheet>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button ref={menuTrigger} className="all-menu-trigger" aria-haspopup="dialog" aria-expanded={allMenuOpen} onClick={()=>setAllMenuOpen(true)}><Menu size={21}/><span>전체 메뉴</span></button>
            <span className="breadcrumb-brand">ORBIT</span>
            <ChevronRight size={13} />
            <strong>{primaryNavigation.some(n=>n.id===view)?primaryView(view).label:navigation.find((n) => n.id === view)?.label}</strong>
          </div>
          <div className="top-actions"><AppearanceShortcut/>
            <button className="icon-button" onClick={openSettings} aria-label="설정 열기"><Settings2 size={20}/></button>

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
            예시 체험 · 변경은 저장되지 않습니다. <a href="/">내 워크스페이스로 이동 →</a>
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
          <div className={`page-heading ${view === 'agent' || view === 'sound' ? 'agent-page-heading' : ''}`}>
            <div>
              <div className="eyebrow">
                {view === 'today'
                  ? koreanDate(TODAY)
                  : view === 'proposal'
                    ? koreanDate(proposalDate)
                    : pageInfo[view].eyebrow}
              </div>
              <h1>{view==='today'?'오늘':view==='projects'?'업무':view==='wiki'||view==='knowledge'?'기록':pageInfo[view].title}</h1>
              {!['today','projects','wiki','knowledge'].includes(view)&&<p>{pageInfo[view].subtitle}</p>}
            </div>
            {view === 'projects' ? <div className="heading-actions"><button className="primary-button" disabled={busy||!loaded} onClick={()=>openCreate('project')}><Plus size={16}/>프로젝트 추가</button><DropdownMenu><DropdownMenuTrigger asChild><button className="secondary-button">보기·정리</button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={()=>setProjectsMode(projectsMode==='cards'?'graph':'cards')}>{projectsMode==='cards'?'관계 그래프':'프로젝트 목록'}</DropdownMenuItem><DropdownMenuItem onSelect={()=>setAssignOpen(true)}>프로젝트 자동 분류</DropdownMenuItem><DropdownMenuItem onSelect={()=>setBrainyOpen(true)}>목표 관리</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div> : view==='wiki'||view==='knowledge'?<DropdownMenu><DropdownMenuTrigger asChild><button className="primary-button"><Plus size={16}/>기록 추가</button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={()=>openCreate('wiki')}>문서</DropdownMenuItem><DropdownMenuItem onSelect={()=>openCreate('meeting')}>회의록</DropdownMenuItem><DropdownMenuItem onSelect={()=>openCreate('knowledge')}>참고 자료</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : view === 'calendar' ? (
              <button className="secondary-button" onClick={() => openCreate('event')}>
                <Plus size={16} />
                일정 추가
              </button>
            ) : null}
          </div>
          <WorkspaceSections view={view} navigate={navigate}/>
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
            <div hidden={view !== 'agent'}>
              <AgentWorkspace
                visible={view==='agent'}
                onPendingCount={setPendingAI}
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
            </div>
          )}
          {loaded && <AsidePanel visible={view==='aside'} snapshot={snapshot} perform={perform} busy={busy||hasPending} demo={demo} onAsk={text=>{navigate('agent');window.dispatchEvent(new CustomEvent('orbit:compose',{detail:{text}}))}}/>}
          {loaded && <AutomationPanel visible={view==='automation'} snapshot={snapshot} perform={perform} busy={busy||hasPending} demo={demo} onAsk={text=>{navigate('agent');window.dispatchEvent(new CustomEvent('orbit:compose',{detail:{text}}))}}/>}
          <SoundStation visible={view === 'sound'} demo={demo} onOpen={() => {setDetail(null);navigate('sound')}} />
          {loaded && ['experiments','contacts','monthly'].includes(view)&&(()=>{const Panel=view==='experiments'?ExperimentsPanel:view==='contacts'?ContactsPanel:MonthlyPanel;return <Panel data={data} today={TODAY} busy={busy||hasPending} perform={perform} onOpen={(kind,id,revision)=>setDetail({kind,id,revision})} onAsk={text=>{navigate('agent');window.dispatchEvent(new CustomEvent('orbit:compose',{detail:{text}}))}}/>})()}
          {loaded&&view==='voice'&&<VoicePanel data={data} today={TODAY} onAsk={text=>{navigate('agent');window.dispatchEvent(new CustomEvent('orbit:compose',{detail:{text}}))}}/>}
          {loaded && view==='followup'&&<FollowupPanel data={data} today={TODAY} busy={busy||hasPending} perform={perform} onOpen={(kind,id,revision)=>setDetail({kind,id,revision})}/>}
          {loaded && view==='learning'&&<LearningPanel data={data} today={TODAY} busy={busy||hasPending} perform={perform} onOpen={id=>setDetail({kind:'task',id})}/>}
          {loaded && view==='backup'&&<BackupPanel snapshot={snapshot} demo={demo} busy={busy||hasPending} onRefresh={refresh}/>}
          {loaded && view==='data'&&<DataManager initialTab={dataInitialTab} snapshot={snapshot} demo={demo} demoTrash={demoDataTrash} setDemoTrash={setDemoDataTrash} busy={busy||hasPending} today={TODAY} onRefresh={refresh} onSnapshot={acceptSnapshot} onEditing={setDataEditing} onCreate={openCreate} onEdit={openEdit} onNavigate={navigate} onConnections={()=>{navigate('agent');window.dispatchEvent(new Event('orbit:connections'))}} perform={perform}/>}
          {loaded && (view==='portfolio'||view==='signals'||view==='meetings')&&(()=>{const Panel=view==='portfolio'?PortfolioPanel:view==='signals'?SignalsPanel:MeetingsPanel;return <Panel data={data} today={TODAY} now={demo?new Date('2026-09-06T03:00:00Z'):clock} demo={demo} busy={busy||hasPending} perform={perform} onOpen={(kind,id,revision)=>setDetail({kind,id,revision})} onAsk={text=>{navigate('agent');window.dispatchEvent(new CustomEvent('orbit:compose',{detail:{text}}))}} onNavigate={navigate}/>})()}
          {loaded && view === 'dashboard' && <WorkspaceDashboard data={data} now={demo?new Date('2026-09-06T03:00:00Z'):clock} busy={busy||hasPending} demo={demo} perform={perform} navigate={navigate} onOpen={setDetail} onGoals={()=>setBrainyOpen(true)} onCreate={()=>openCreate('task')} onAsk={text=>{navigate('agent');window.dispatchEvent(new CustomEvent('orbit:compose',{detail:{text}}))}} onCalendar={date=>{setCalendarDate(date);navigate('calendar')}} onProposal={date=>{setProposalDate(date);navigate('proposal')}} onCoachSettings={()=>{navigate('agent');window.dispatchEvent(new Event('orbit:coach-settings'))}}/>}
          {loaded && view === 'goals' && <GoalDashboard data={data} today={TODAY} busy={busy||hasPending} demo={demo} perform={perform} onManage={()=>setBrainyOpen(true)} onOpen={setDetail} onAsk={text=>{navigate('agent');window.dispatchEvent(new CustomEvent('orbit:compose',{detail:{text}}))}}/>}
          {loaded && view === 'understanding' && <Understanding data={data} today={TODAY} busy={busy||hasPending} demo={demo} perform={perform} onOpen={setDetail} navigate={navigate} onAsk={text=>{navigate('agent');window.dispatchEvent(new CustomEvent('orbit:compose',{detail:{text}}))}} onConnect={()=>{navigate('agent');window.dispatchEvent(new Event('orbit:connections'))}}/>}
          {loaded&&view==='today'&&<TodayHome data={data} now={demo?new Date('2026-09-06T03:00:00Z'):clock} busy={busy||hasPending} demo={demo} pendingAI={pendingAI} perform={perform} onOpen={setDetail} navigate={navigate} onCreate={()=>openCreate(projects.length?'task':'project')} onAsk={text=>{navigate('agent');window.dispatchEvent(new CustomEvent('orbit:compose',{detail:{text}}))}} onCalendar={date=>{setCalendarDate(date);navigate('calendar')}} onProposal={date=>{setProposalDate(date);navigate('proposal')}} onReview={()=>{navigate('agent');window.dispatchEvent(new Event('orbit:review'))}}/>}
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
                    <div className={`task-list-row ${t.status === 'done' ? 'task-done' : ''}`} key={t.id}>
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
                          <span>{t.due.slice(5).replace('-', '/')} 마감</span>
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
          {loaded && view === 'projects' && projectsMode === 'cards' && <ProjectHub data={data} today={TODAY} busy={busy||hasPending||!loaded} onOpen={openProject} onOpenTask={id=>setDetail({kind:'task',id})} onCreateTask={id=>openCreate('task',id)} onCreateProject={()=>openCreate('project')} onManage={id=>setProjectAction({id,mode:'menu'})} onTrash={openProjectTrash}/>}

          {loaded&&(view==='wiki'||view==='knowledge')&&<><WikiLibrary key={view} initialKind={view==='knowledge'?'knowledge':''} onAsk={text=>{navigate('agent');window.dispatchEvent(new CustomEvent('orbit:compose',{detail:{text}}))}} data={data} revision={snapshot.revision} perform={perform} demo={demo} busy={busy||hasPending} onRefresh={refresh} onOpen={(kind,id)=>setDetail({kind,id})}/><details className="workspace-more"><summary>기록 관리</summary><div className="workspace-links"><button onClick={()=>navigate('understanding')}>나를 이해하는 기록</button><button onClick={()=>navigate('data')}>전체 데이터 관리</button><button onClick={()=>navigate('backup')}>백업·복구</button></div></details></>}
          <CalendarSyncStatus active={view==='calendar'} demo={demo} loaded={loaded} date={calendarDate} timeZone={preferences.timeZone} paused={calendarInteracting||!!create||settingsOpen||!!deleteTarget||hasPending} workspaceBusy={busy} onSynced={refresh}/>
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
                <div className="calendar-days">
                  {currentWeek.map((date) => (
                    <button
                      key={date}
                      onClick={() => setCalendarDate(date)}
                      className={calendarDate === date ? 'active' : ''}
                      aria-pressed={calendarDate === date}
                    >
                      <span>{['일', '월', '화', '수', '목', '금', '토'][weekday(date)]}</span>
                      <strong>{Number(date.slice(-2))}</strong>
                      <span className={`calendar-day-dot ${events.some(e=>e.date===date)?'has-events':''}`} aria-hidden="true" />
                    </button>
                  ))}
                </div>
                <div className="section-title">
                  <h2>{Number(calendarDate.slice(-2))}일 일정</h2>
                  <span className="muted">{selectedEvents.length}개</span>
                </div>
                {hasPending&&unconfirmedCalendarMove&&<div className="calendar-move-pending" role="status"><strong>시간 변경 결과를 확인하고 있어요</strong><p>{unconfirmedCalendarMove.title} · {formatTime(unconfirmedCalendarMove.start)}–{formatTime(unconfirmedCalendarMove.end)}로 변경 요청</p><p>현재는 마지막으로 확인한 시간을 표시합니다. 연결되면 저장 결과를 다시 확인합니다.</p><button className="text-button" disabled={busy} onClick={()=>void retry()}>저장 결과 확인</button></div>}
                <div className="calendar-full-events"><CalendarAgenda key={calendarDate} events={selectedEvents} projects={projects} disabled={busy||hasPending} onInteractionChange={setCalendarInteracting} onMove={moveCalendarEvent} onEdit={id=>openEdit('event',id)} onDelete={event=>setDeleteTarget({kind:'event',id:event.id,title:event.title})} onOpen={e=>e.id.startsWith('protected:')?navigate('portfolio'):e.taskId?setDetail({kind:'task',id:e.taskId}):setDetail({kind:'event',id:e.id})}/></div>
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
              </aside>
            </div>
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
          if (!open) {if(projectDetail&&dataEditing){toast('작성 중인 설정이나 단계를 먼저 저장하거나 취소해 주세요.');return;}setDetail(null);}
        }}
      >
        <SheetContent className={`w-full sm:max-w-[520px] p-0 flex flex-col ${projectDetail ? 'project-detail-sheet' : ''}`} side="right">
          <SheetHeader className="px-7 pt-9 pb-5 border-b">
            <SheetTitle className="text-xl leading-relaxed">
              {taskDetail?.title ??
                noteDetail?.title ??
                projectDetail?.name ??
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
          </SheetHeader>
          <div className="sheet-body">
            {taskDetail && (
              <>
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
                <FocusSession
                  task={taskDetail}
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
                    factor: calibrationFactor(tasks, taskDetail, TODAY),
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
                  <button className="secondary-button" onClick={() => openEdit('task', taskDetail.id)}>
                    <Pencil size={14} />
                    수정
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
                      Google Calendar에서 수정 <ArrowUpRight size={15} />
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
                      <button className="primary-button" onClick={() => openEdit('event', eventDetail.id)}>
                        <Pencil size={15} />
                        일정 수정
                      </button>
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
      <Dialog
        open={!!create}
        onOpenChange={(open) => {
          if (!open) setCreate(null);
        }}
      >
        <DialogContent className={`orbit-create-dialog ${create === 'event' ? 'event-create-dialog' : ''}`}>
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? '내용 수정'
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
            <input
              className="form-field"
              id="new-title"
              required
              maxLength={160}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={create === 'task' ? '예: 가맹 제안서 초안 완성' : '제목을 입력하세요'}
            />
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
            {create === 'event' && (
              <>
                <label className="form-label" htmlFor="event-date">날짜</label>
                <input id="event-date" type="date" className="form-field" value={newDate} required onChange={e=>setNewDate(e.target.value)}/>
                <div className="field-grid event-time-fields">
                  <div><label className="form-label" htmlFor="new-time">시작</label><input type="time" id="new-time" required className="form-field" value={newTime} onChange={e=>setNewTime(e.target.value)}/></div>
                  <div><label className="form-label">소요 시간</label><Choice value={newDuration} onChange={setNewDuration} label="소요 시간" items={[...new Set([15,30,45,60,90,120,180,240,Number(newDuration)||45])].sort((a,b)=>a-b).map(v=>({value:String(v),label:durationText(v)}))}/></div>
                </div>
                <p className="event-end-summary"><Clock3 size={15}/>{(()=>{const [h,m]=newTime.split(':').map(Number);const end=h*60+m+Number(newDuration);return Number.isFinite(end)?end<=1440?`${formatTime(end)}에 끝나요`:'종료 시간이 다음 날을 넘어요. 시간을 조정해 주세요.':''})()}</p>
                <label className="form-label">프로젝트 <span className="optional-label">선택</span></label>
                <Choice value={newProject} onChange={v=>{setProjectTouched(true);setNewProject(v)}} label="연결 프로젝트" items={[{value:'none',label:'개인 일정'},...projects.map(p=>({value:p.id,label:p.name}))]}/>
              </>
            )}
            {create === 'task' && (
              <>
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
              </>
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
    </SidebarProvider>
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
