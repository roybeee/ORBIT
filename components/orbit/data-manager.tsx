'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Database, Search, Plus, Trash2, RotateCcw, RefreshCw, Network, List, FolderKanban, FileText, CheckCheck, CalendarDays, Target, BookOpen, Heart, ArrowUpRight, ChevronLeft, ChevronRight, Link2, ShieldCheck, Pencil, X, AlertCircle } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { agentRequest } from './agent/connections';
import { dataCategories, dataLabels, categoryDescriptions, recordsOf, recordTitle, recordSource, relatedRecords, editableRecord, planDataTrash, planDataRestore, type DataCategory, type DataRecord, type DataSelection, type TrashRecord } from '@/lib/orbit/data-manager';
import type { WorkspaceSnapshot, Note, View } from '@/lib/orbit/model';
import type { WorkspaceAction } from '@/lib/orbit/validation';
import { actionSchema } from '@/lib/orbit/validation';

type TrashSummary = Omit<TrashRecord, 'record'>;
type Overview = { trash: { items: TrashSummary[]; total: number; hasMore: boolean }; storage: { table: string; name: string; description: string; count: number; view: View }[]; checkedAt: string };
type Row = DataSelection & { record: DataRecord; title: string };
type Confirm = { action: 'trash' | 'restore' | 'purge'; rows: (Row | TrashSummary)[]; revision: number };
const icons = { projects: FolderKanban, tasks: CheckCheck, notes: FileText, events: CalendarDays, goals: Target, memories: BookOpen, habits: Heart, decisions: Network, delegations: Link2 };
const keyOf = (r: DataSelection) => r.category + ':' + r.id;
const labels: Record<string, string> = { todo: '예정', doing: '진행 중', waiting: '대기', done: '완료', active: '진행', paused: '보류', achieved: '달성', meeting: '회의록', wiki: '개인 위키', knowledge: '지식', requested: '요청', accepted: '수락', working: '진행 중', blocked: '대기', delivered: '결과 수신', verified: '확인 완료', cancelled: '취소', revised: '수정', closed: '검토 완료' };
const fmt = (s?: string | null) => s ? new Date(s).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }) : '아직 없음';

export function DataManager({ initialTab='records', snapshot, demo, demoTrash, setDemoTrash, busy, today, onRefresh, onSnapshot, onEditing, onCreate, onEdit, onNavigate, onConnections, perform }: {
  initialTab?:'records'|'trash'; snapshot: WorkspaceSnapshot; demo: boolean; busy: boolean; today: string;
  demoTrash: TrashRecord[]; setDemoTrash: React.Dispatch<React.SetStateAction<TrashRecord[]>>;
  onRefresh: () => Promise<void>; onSnapshot: (s: WorkspaceSnapshot) => void; onEditing: (v: boolean) => void;
  onCreate: (kind: 'project' | 'task' | 'meeting' | 'wiki' | 'knowledge' | 'event') => void;
  onEdit: (kind: 'project' | 'task' | 'note' | 'event', id: string, note?: Note) => void;
  onNavigate: (v: View) => void; onConnections: () => void;
  perform: (a: WorkspaceAction, message?: string) => Promise<boolean>;
}) {
  const { data } = snapshot;
  const [tab, setTab] = useState<string>(initialTab), [category, setCategory] = useState<DataCategory | 'all'>('all'), [query, setQuery] = useState(''), [project, setProject] = useState('all'), [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]), [detail, setDetail] = useState<DataSelection | null>(null), [overview, setOverview] = useState<Overview | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(false), [working, setWorking] = useState(false), [confirm, setConfirm] = useState<Confirm | null>(null), [newCategory, setNewCategory] = useState<DataCategory>('projects'), [adding, setAdding] = useState(false);
  const [editor, setEditor] = useState<{ category: 'goals' | 'memories' | 'habits'; record?: DataRecord; revision: number } | null>(null);
  const [trashOffset, setTrashOffset] = useState(0);
  const pending = useRef<Record<string, unknown> | null>(null), locked = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { onEditing(!!confirm || !!editor || adding || working); return () => onEditing(false); }, [confirm, editor, adding, working, onEditing]);
  const loadOverview = useCallback(async (silent = false) => {
    if (demo) return;
    if (!silent) setLoading(true);
    try { const result = await agentRequest('/api/data?offset=' + trashOffset); if (active.current) { setOverview(result); setError(''); } }
    catch (e) { if (active.current) setError((e as Error).message); }
    finally { if (active.current && !silent) setLoading(false); }
  }, [demo, trashOffset]);
  useEffect(() => { void loadOverview(); }, [loadOverview, snapshot.revision]);
  useEffect(() => { const timer = setInterval(() => { if (document.visibilityState === 'visible' && !locked.current && !confirm) void loadOverview(true); }, 30000); return () => clearInterval(timer); }, [loadOverview, confirm]);
  const rows = useMemo(() => dataCategories.flatMap(category => recordsOf(data, category).map(record => ({ category, id: record.id, record, title: recordTitle(record) }))), [data]);
  const filtered = useMemo(() => rows.filter(r => (category === 'all' || r.category === category) && (project === 'all' || r.record.projectId === project || r.category === 'projects' && r.id === project) && [r.title, r.record.summary, r.record.definition, r.record.choice, r.record.assignee, ...(Array.isArray(r.record.tags) ? r.record.tags : [])].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [rows, category, project, query]);
  const pageRows = filtered.slice(page * 20, page * 20 + 20), pageCount = Math.max(1, Math.ceil(filtered.length / 20));
  const trash = demo ? { items: demoTrash as TrashSummary[], total: demoTrash.length, hasMore: false } : overview?.trash;
  const detailRow = rows.find(r => detail && keyOf(r) === keyOf(detail));
  const related = detailRow ? relatedRecords(data, detailRow) : [];
  useEffect(() => { setPage(0); setSelected([]); }, [category, project, query, tab]);
  useEffect(() => { setPage(p => Math.min(p, pageCount - 1)); setSelected(s => s.filter(key => rows.some(r => keyOf(r) === key))); }, [rows, pageCount]);
  const pickCategory = (c: DataCategory) => { setCategory(c); setTab('records'); setProject('all'); setQuery(''); };
  const pickRow = (r: DataSelection) => { setDetail(r); };
  const toggle = (key: string, checked: boolean) => setSelected(s => checked ? Array.from(new Set([...s, key])).slice(0, 100) : s.filter(k => k !== key));
  const refresh = async () => { await onRefresh(); await loadOverview(); };
  function createRecord(c: DataCategory) {
    setAdding(false);
    if (c === 'decisions' || c === 'delegations') { onNavigate('followup'); return; }
    if (c === 'goals' || c === 'memories' || c === 'habits') { setEditor({ category: c, revision: snapshot.revision }); return; }
    onCreate(c === 'projects' ? 'project' : c === 'tasks' ? 'task' : c === 'notes' ? 'meeting' : 'event');
  }
  async function editRow(row: Row) {
    if (!editableRecord(row.category, row.record)) { onNavigate(row.id.startsWith('google:') ? 'calendar' : 'proposal'); return; }
    if (row.category === 'decisions' || row.category === 'delegations') { onNavigate('followup'); return; }
    if (row.category === 'goals' || row.category === 'memories' || row.category === 'habits') { setDetail(null); setEditor({ category: row.category, record: row.record, revision: snapshot.revision }); return; }
    setWorking(true); setError('');
    try {
      const note = row.category === 'notes' ? demo ? row.record as unknown as Note : await agentRequest('/api/notes?id=' + encodeURIComponent(row.id)) : undefined;
      setDetail(null);
      onEdit(row.category === 'projects' ? 'project' : row.category === 'tasks' ? 'task' : row.category === 'notes' ? 'note' : 'event', row.id, note);
    } catch (e) { setError((e as Error).message); } finally { setWorking(false); }
  }
  async function executeConfirmation() {
    if (!confirm || locked.current || busy) return;
    locked.current = true; setWorking(true); setError('');
    const request = pending.current ?? { operationId: crypto.randomUUID(), expectedRevision: confirm.revision, action: confirm.action, ...(confirm.action === 'trash' ? { selection: confirm.rows.map(r => ({ category: r.category, id: r.id })) } : { trashIds: confirm.rows.map(r => r.id) }) };
    pending.current = request;
    try {
      if (demo) {
        if (confirm.action === 'trash') {
          const plan = planDataTrash(data, confirm.rows.map(r => ({ category: r.category, id: r.id })));
          const entries = plan.records.map((r, i) => ({ id: String(request.operationId) + ':' + i, category: r.category, recordId: r.record.id, title: recordTitle(r.record), record: r.record, deletedAt: new Date().toISOString() }));
          setDemoTrash(t => [...entries, ...t]); onSnapshot({ data: plan.next, revision: snapshot.revision + 1, updatedAt: new Date().toISOString() });
        } else {
          const ids = new Set(confirm.rows.map(r => r.id));
          if (confirm.action === 'restore') onSnapshot({ data: planDataRestore(data, demoTrash.filter(r => ids.has(r.id))), revision: snapshot.revision + 1, updatedAt: new Date().toISOString() });
          setDemoTrash(t => t.filter(r => !ids.has(r.id)));
        }
      } else {
        const result = await agentRequest('/api/data', 'POST', request); onSnapshot(result.snapshot); await loadOverview();
      }
      toast.success(confirm.action === 'trash' ? `${confirm.rows.length}개 항목을 휴지통으로 옮겼습니다.` : confirm.action === 'restore' ? '기록을 복원했습니다.' : '선택한 항목을 영구 삭제했습니다.');
      pending.current = null; setConfirm(null); setSelected([]); setDetail(null);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (demo || code === 'INPUT' || code === 'CONFLICT' || code === 'AUTH' || code === 'SESSION_CHANGED' || code === 'ORIGIN') pending.current = null;
      setError((e as Error).message);
    } finally { locked.current = false; setWorking(false); }
  }
  const askDelete = (selectedRows: Row[]) => { setError(''); pending.current = null; setConfirm({ action: 'trash', rows: selectedRows, revision: snapshot.revision }); };
  const counts = dataCategories.map(c => ({ category: c, count: recordsOf(data, c).length }));
  return <section className="data-manager" aria-label="데이터 관리">
    <div className="dm-summary">
      <div><span className="dm-overline">MY DATA</span><strong>{rows.length.toLocaleString()}<small>개의 기록</small></strong><p>{data.projects.length}개 프로젝트에 연결된 나의 데이터</p></div>
      <div className="dm-summary-meta"><span><ShieldCheck size={16} /> 내 계정의 데이터</span><span>마지막 저장 {fmt(snapshot.updatedAt)}</span><button className="text-button" disabled={loading || working || busy || !!confirm} onClick={() => void refresh()}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> 새로고침</button></div>
    </div>
    <div className="dm-top-actions"><Tabs value={tab} onValueChange={v => { setTab(v); setDetail(null); }}><TabsList><TabsTrigger value="records"><List size={16} />데이터 목록</TabsTrigger><TabsTrigger value="structure"><Network size={16} />구조 보기</TabsTrigger><TabsTrigger value="trash"><Trash2 size={16} />휴지통{trash?.total ? ` ${trash.total}` : ''}</TabsTrigger></TabsList></Tabs><button className="primary-button" disabled={busy || working || !!pending.current} onClick={() => { setNewCategory(category === 'all' ? 'projects' : category); setAdding(true); }}><Plus size={17} /> 데이터 추가</button></div>
    {error && !confirm && <div className="dm-error" role="alert"><AlertCircle size={18} /><span>{error}</span><button className="text-button" onClick={() => void refresh()}>다시 확인</button></div>}
    {tab === 'records' && <>
      <div className="dm-categories">{counts.map(({ category: c, count }) => { const Icon = icons[c]; return <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(category === c ? 'all' : c)} aria-pressed={category === c}><Icon size={17} /><span>{dataLabels[c]}</span><strong>{count.toLocaleString()}</strong></button>; })}</div>
      <div className="dm-toolbar"><label className="dm-search"><Search size={18} /><input aria-label="데이터 검색" value={query} onChange={e => setQuery(e.target.value)} placeholder="제목, 요약, 태그 검색" />{query && <button aria-label="검색어 지우기" onClick={() => setQuery('')}><X size={16} /></button>}</label><Select value={project} onValueChange={setProject}><SelectTrigger aria-label="프로젝트 필터"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">모든 프로젝트</SelectItem>{data.projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select><span className="dm-result-count">{filtered.length}개</span></div>
      {selected.length > 0 && <div className="dm-selection"><span>{selected.length}개 선택</span><button className="text-button" onClick={() => setSelected([])}>선택 해제</button><button className="secondary-button" disabled={busy || working} onClick={() => askDelete(rows.filter(r => selected.includes(keyOf(r))))}><Trash2 size={16} /> 선택 삭제</button></div>}
      <div className="dm-table"><Table><TableHeader><TableRow><TableHead className="dm-check"><Checkbox aria-label="현재 페이지 선택" checked={pageRows.filter(r => editableRecord(r.category, r.record)).length > 0 && pageRows.filter(r => editableRecord(r.category, r.record)).every(r => selected.includes(keyOf(r)))} onCheckedChange={v => setSelected(s => v === true ? Array.from(new Set([...s, ...pageRows.filter(r => editableRecord(r.category, r.record)).map(keyOf)])).slice(0, 100) : s.filter(k => !pageRows.some(r => keyOf(r) === k)))} /></TableHead><TableHead>이름</TableHead><TableHead>종류</TableHead><TableHead>연결 프로젝트</TableHead><TableHead>출처 / 상태</TableHead><TableHead><span className="sr-only">관리</span></TableHead></TableRow></TableHeader><TableBody>{pageRows.map(row => <TableRow key={keyOf(row)}><TableCell><Checkbox aria-label={`${row.title} 선택`} disabled={!editableRecord(row.category, row.record) || working} checked={selected.includes(keyOf(row))} onCheckedChange={v => toggle(keyOf(row), v === true)} /></TableCell><TableCell><button className="dm-record-name" onClick={() => pickRow(row)}>{row.title}</button><small>{String(row.record.due ?? row.record.updated ?? row.record.date ?? row.record.deadline ?? '')}</small></TableCell><TableCell><span className={'dm-kind dm-kind-' + row.category}>{row.category === 'notes' ? labels[String(row.record.kind)] : dataLabels[row.category]}</span></TableCell><TableCell>{data.projects.find(p => p.id === row.record.projectId)?.name ?? (row.category === 'projects' ? '프로젝트 자체' : '—')}</TableCell><TableCell><span>{recordSource(row.category, row.record)}</span><small>{labels[String(row.record.status)] ?? ''}</small></TableCell><TableCell><div className="dm-row-actions"><button className="icon-button" disabled={busy || working} aria-label={`${row.title} 수정`} title="수정" onClick={() => void editRow(row)}><Pencil size={16} /></button><button className="icon-button" disabled={busy || working || !editableRecord(row.category, row.record)} aria-label={`${row.title} 삭제`} title={editableRecord(row.category, row.record) ? '휴지통으로 이동' : '원본 화면에서 관리'} onClick={() => askDelete([row])}><Trash2 size={16} /></button></div></TableCell></TableRow>)}</TableBody></Table></div>
      {!filtered.length && <div className="dm-empty"><Database size={30} /><h3>{query || project !== 'all' ? '조건에 맞는 기록이 없습니다' : '첫 데이터를 추가해 보세요'}</h3><p>{category === 'all' ? '프로젝트부터 만들면 할 일과 문서를 연결할 수 있습니다.' : categoryDescriptions[category]}</p><button className="secondary-button" onClick={() => query || project !== 'all' ? (setQuery(''), setProject('all')) : createRecord(category === 'all' ? 'projects' : category)}>{query || project !== 'all' ? '필터 초기화' : '추가하기'}</button></div>}
      <div className="dm-pagination"><span>제목을 누르면 상세 내용과 연결을 볼 수 있습니다.</span><button className="icon-button" aria-label="이전 페이지" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={18} /></button><b>{page + 1} / {pageCount}</b><button className="icon-button" aria-label="다음 페이지" disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}><ChevronRight size={18} /></button></div>
    </>}
    {tab === 'structure' && <div className="dm-structure">
      <article className="dm-structure-intro"><Network size={25} /><div><h2>프로젝트를 중심으로 연결됩니다</h2><p>목표 아래 프로젝트가 있고, 할 일·문서·일정과 결정이 연결됩니다. 숫자를 누르면 실제 목록으로 이동합니다.</p></div></article>
      <div className="dm-project-map">{data.projects.map(p => { const goal = data.goals?.find(g => g.id === p.goalId); return <article key={p.id}><div className="dm-map-goal"><Target size={14} />{goal?.sentence ?? '상위 목표 미연결'}</div><button className="dm-map-project" onClick={() => pickRow({ category: 'projects', id: p.id })}><span style={{ background: p.color }}>{p.symbol}</span><strong>{p.name}</strong><ArrowUpRight size={17} /></button><div className="dm-map-children">{(['tasks', 'notes', 'events', 'decisions', 'delegations'] as DataCategory[]).map(c => <button key={c} onClick={() => { pickCategory(c); setProject(p.id); }}><span>{dataLabels[c]}</span><b>{recordsOf(data, c).filter(r => r.projectId === p.id).length}</b></button>)}</div></article>; })}{!data.projects.length && <div className="dm-empty"><p>프로젝트를 만들면 연결 구조가 여기에 표시됩니다.</p><button className="secondary-button" onClick={() => createRecord('projects')}>프로젝트 추가</button></div>}</div>
      <div className="dm-section-heading"><h2>저장되는 데이터</h2><button className="text-button" onClick={onConnections}><Link2 size={16} /> 연결 추가·해제</button></div>
      <div className="dm-storage">{(overview?.storage ?? (demo ? [{ table: 'orbit_workspaces', name: '업무 데이터', description: '프로젝트·할 일·일정·목표를 함께 관리합니다.', count: 1, view: 'data' as View }, { table: 'orbit_note_revisions', name: '문서 본문과 변경 이력', description: '문서 원문은 목록과 별도로 보관합니다.', count: data.notes.length, view: 'wiki' as View }] : [])).map(item => <article key={item.table}><Database size={18} /><div><h3>{item.name}<span>{item.count.toLocaleString()}건</span></h3><p>{item.description}</p><details><summary>저장 위치 보기</summary><code>{item.table}</code></details></div><button className="icon-button" aria-label={`${item.name} 관리 열기`} onClick={() => item.table === 'orbit_data_trash' ? setTab('trash') : item.table === 'orbit_integrations' ? onConnections() : item.view === 'data' ? setTab('records') : onNavigate(item.view)}><ArrowUpRight size={18} /></button></article>)}</div>
      <p className="dm-footnote">업무 데이터는 하나의 계정별 묶음에 저장됩니다. 문서 본문·변경 이력·실행 기록은 별도 보관되며, 위 건수는 각 저장소의 기록 수입니다.</p>
    </div>}
    {tab === 'trash' && <>
      <div className="dm-trash-intro"><RotateCcw size={22} /><div><h2>삭제한 기록을 다시 가져올 수 있습니다</h2><p>휴지통 이동은 외부 서비스의 원본을 삭제하지 않습니다. 문서 본문과 변경 이력은 복원을 위해 보관합니다.</p></div></div>
      {loading && !trash && <p role="status">휴지통을 불러오는 중입니다…</p>}
      {trash?.items.length ? <><div className="dm-trash-actions"><span>총 {trash.total}개</span><button className="secondary-button" disabled={working || busy} onClick={() => { setError(''); setConfirm({ action: 'restore', rows: trash.items, revision: snapshot.revision }); }}>이 페이지 모두 복원</button><button className="text-button dm-danger" disabled={working || busy} onClick={() => { setError(''); setConfirm({ action: 'purge', rows: trash.items, revision: snapshot.revision }); }}>이 페이지 영구 삭제</button></div><div className="dm-trash-list">{trash.items.map(item => <article key={item.id}><Trash2 size={18} /><div><strong>{item.title}</strong><small>{dataLabels[item.category]} · {fmt(item.deletedAt)} 삭제</small></div><button className="secondary-button" disabled={working || busy} onClick={() => { setError(''); setConfirm({ action: 'restore', rows: [item], revision: snapshot.revision }); }}><RotateCcw size={15} /> 복원</button><button className="text-button dm-danger" disabled={working || busy} onClick={() => { setError(''); setConfirm({ action: 'purge', rows: [item], revision: snapshot.revision }); }}>영구 삭제</button></article>)}</div><div className="dm-pagination"><button className="secondary-button" disabled={!trashOffset || working} onClick={() => setTrashOffset(v => Math.max(0, v - 100))}>이전</button><button className="secondary-button" disabled={!trash.hasMore || working} onClick={() => setTrashOffset(v => v + 100)}>다음</button></div></> : trash && <div className="dm-empty"><Trash2 size={30} /><h3>휴지통이 비어 있습니다</h3><p>데이터 관리에서 삭제한 항목이 여기에 보관됩니다.</p></div>}
    </>}
    <Sheet open={!!detailRow} onOpenChange={v => !v && setDetail(null)}><SheetContent className="dm-detail"><SheetHeader><SheetTitle>{detailRow?.title}</SheetTitle><SheetDescription>{detailRow && dataLabels[detailRow.category]}</SheetDescription></SheetHeader>{detailRow && <div className="dm-detail-body"><dl><dt>출처</dt><dd>{recordSource(detailRow.category, detailRow.record)}</dd><dt>프로젝트</dt><dd>{data.projects.find(p => p.id === detailRow.record.projectId)?.name ?? '해당 없음'}</dd><dt>상태</dt><dd>{labels[String(detailRow.record.status)] ?? '등록된 기록'}</dd></dl><p className="dm-detail-text">{String(detailRow.record.summary ?? detailRow.record.definition ?? detailRow.record.goal ?? detailRow.record.choice ?? detailRow.record.statement ?? detailRow.record.sentence ?? '') || '추가 설명이 없습니다.'}</p><div className="dm-detail-actions"><button className="primary-button" disabled={working || busy} onClick={() => void editRow(detailRow)}><Pencil size={16} />{editableRecord(detailRow.category, detailRow.record) ? '수정하기' : '원본 화면 열기'}</button><button className="secondary-button" disabled={working || busy || !editableRecord(detailRow.category, detailRow.record)} onClick={() => askDelete([detailRow])}><Trash2 size={16} /> 삭제</button></div><h3>이 항목에 연결된 기록 <span>{related.length}</span></h3>{related.length ? related.map(r => <button key={keyOf(r)} className="dm-related" onClick={() => pickRow(r)}><span>{dataLabels[r.category]}</span><strong>{r.title}</strong><ArrowUpRight size={15} /></button>) : <p className="dm-footnote">다른 데이터에서 연결한 항목이 없습니다.</p>}<details className="dm-record-id"><summary>데이터 식별 정보</summary><code>{detailRow.id}</code><p>저장 위치: orbit_workspaces · {detailRow.category}{detailRow.category === 'notes' ? ' / 본문: orbit_note_revisions' : ''}</p></details></div>}</SheetContent></Sheet>
    <Dialog open={adding} onOpenChange={setAdding}><DialogContent><DialogHeader><DialogTitle>어떤 데이터를 추가할까요?</DialogTitle><DialogDescription>종류를 고르면 필요한 항목만 입력할 수 있습니다.</DialogDescription></DialogHeader><Select value={newCategory} onValueChange={v => setNewCategory(v as DataCategory)}><SelectTrigger aria-label="추가할 데이터 종류"><SelectValue /></SelectTrigger><SelectContent>{dataCategories.map(c => <SelectItem key={c} value={c}>{dataLabels[c]}</SelectItem>)}</SelectContent></Select><p className="dm-footnote">{categoryDescriptions[newCategory]}</p><button className="primary-button" onClick={() => createRecord(newCategory)}>계속 <ArrowUpRight size={16} /></button></DialogContent></Dialog>
    {editor && <SmallEditor key={editor.category + (editor.record?.id ?? 'new')} {...editor} today={today} snapshot={snapshot} busy={busy} onClose={() => setEditor(null)} perform={perform} />}
    <AlertDialog open={!!confirm} onOpenChange={v => { if (!v && !working && !pending.current) { setConfirm(null); setError(''); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm?.action === 'trash' ? `${confirm.rows.length}개 항목을 삭제할까요?` : confirm?.action === 'restore' ? '선택한 기록을 복원할까요?' : '휴지통에서 영구 삭제할까요?'}</AlertDialogTitle><AlertDialogDescription>{confirm?.action === 'trash' ? '휴지통에서 복원할 수 있습니다. 연결된 기록이 남아 있으면 삭제를 중단하고 정리할 항목을 알려드립니다. 할 일을 복원해도 이전 시간 배정과 실행 승인은 재개하지 않습니다.' : confirm?.action === 'restore' ? '기존 데이터를 덮어쓰지 않습니다. 필요한 프로젝트나 근거 문서도 휴지통에 있다면 함께 복원해 주세요.' : '이 항목과 문서 변경 이력을 되돌릴 수 없게 삭제합니다. 별도 첨부파일·외부 원본·기존 백업은 포함하지 않습니다.'}</AlertDialogDescription></AlertDialogHeader><ul className="dm-confirm-list">{confirm?.rows.slice(0, 8).map(r => <li key={r.id}>{r.title}</li>)}{confirm && confirm.rows.length > 8 && <li>외 {confirm.rows.length - 8}개</li>}</ul>{error && <p className="dm-error" role="alert">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={working || !!pending.current}>취소</AlertDialogCancel><AlertDialogAction disabled={working || busy} onClick={e => { e.preventDefault(); void executeConfirmation(); }}>{working ? '처리 중…' : pending.current ? '같은 요청으로 결과 확인' : confirm?.action === 'trash' ? '휴지통으로 이동' : confirm?.action === 'restore' ? '복원' : '영구 삭제'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}

function SmallEditor({ category, record, revision, today, snapshot, busy, onClose, perform }: { category: 'goals' | 'memories' | 'habits'; record?: DataRecord; revision: number; today: string; snapshot: WorkspaceSnapshot; busy: boolean; onClose: () => void; perform: (a: WorkspaceAction, message?: string) => Promise<boolean> }) {
  const [title, setTitle] = useState(String(record?.sentence ?? record?.statement ?? record?.title ?? ''));
  const [kind, setKind] = useState(String(record?.kind ?? (category === 'goals' ? 'short' : 'preference')));
  const [deadline, setDeadline] = useState(String(record?.deadline ?? ''));
  const [mode, setMode] = useState(String(record?.mode ?? 'keep'));
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const itemId = useRef(record?.id ?? crypto.randomUUID());
  async function save() {
    if (saving || busy) return;
    setError('');
    if (snapshot.revision !== revision) { setError('작성 중 데이터가 변경되었습니다. 내용을 복사한 뒤 다시 열어 주세요.'); return; }
    let action: unknown;
    if (category === 'goals') action = { type: 'goal.upsert', goal: { ...record, id: itemId.current, sentence: title, kind, ...(deadline ? { deadline } : { deadline: undefined }) }, ...(deadline ? {} : { clearFields: ['deadline'] }) };
    else if (category === 'habits') action = { type: 'habit.upsert', habit: { id: itemId.current, title, mode, startedOn: record?.startedOn ?? today, log: record?.log ?? [] } };
    else action = { type: 'memory.upsert', memory: { id: itemId.current, statement: title, kind, origin: record?.origin ?? 'user', sources: ((record?.sources ?? []) as { kind: string; id: string; revision?: number }[]).map(s => ({ kind: s.kind, id: s.id, ...(s.revision === undefined ? {} : { revision: s.revision }) })) } };
    const parsed = actionSchema.safeParse(action);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '입력 내용을 확인해 주세요.'); return; }
    setSaving(true); try { if (await perform(parsed.data, '기록을 저장했습니다.')) onClose(); } finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={v => !v && !saving && onClose()}><DialogContent><DialogHeader><DialogTitle>{dataLabels[category]} {record ? '수정' : '추가'}</DialogTitle><DialogDescription>{categoryDescriptions[category]}</DialogDescription></DialogHeader><form className="dm-editor" onSubmit={e => { e.preventDefault(); void save(); }}><label>내용<textarea className="form-field" required maxLength={category === 'memories' ? 600 : category === 'goals' ? 160 : 80} value={title} onChange={e => setTitle(e.target.value)} rows={3} /></label>{category === 'habits' ? <label>종류<Select value={mode} onValueChange={setMode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="keep">지킬 습관</SelectItem><SelectItem value="quit">바꿀 습관</SelectItem></SelectContent></Select></label> : <label>종류<Select value={kind} onValueChange={setKind}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(category === 'goals' ? [['life', '삶의 목표'], ['mid', '중기 목표'], ['short', '단기 목표'], ['concept', '방향·원칙']] : [['preference', '선호'], ['constraint', '제약'], ['strategy', '운영 원칙'], ['reflection', '자기 탐색']]).map(([v, name]) => <SelectItem key={v} value={v}>{name}</SelectItem>)}</SelectContent></Select></label>}{category === 'goals' && <label>목표일<input type="date" className="form-field" value={deadline} onChange={e => setDeadline(e.target.value)} /></label>}{error && <p className="dm-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy || saving} type="submit">{saving ? '저장 중…' : '저장'}</button></form></DialogContent></Dialog>;
}
