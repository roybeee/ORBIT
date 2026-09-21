import {prepareWorkspace} from './workspace-storage.ts';
import { z } from 'zod';
import { readWorkspace, RevisionConflict, type Database, type Statement } from './repository.ts';
import { DomainError } from '../lib/orbit/reducer.ts';
import { dataCategories, planDataTrash, planDataRestore, recordTitle, type DataCategory, type TrashRecord } from '../lib/orbit/data-manager.ts';
const id = z.string().min(1).max(100);
export const dataCommandSchema = z.object({
  operationId: z.string().uuid(), expectedRevision: z.number().int().min(0),
  action: z.enum(['trash', 'restore', 'purge']),
  selection: z.array(z.object({ category: z.enum(dataCategories), id }).strict()).max(100).optional(),
  trashIds: z.array(id).max(100).optional(),
}).strict().superRefine((v, c) => {
  if (v.action === 'trash' ? !v.selection?.length || v.trashIds !== undefined : !v.trashIds?.length || v.selection !== undefined) c.addIssue({ code: 'custom', message: '처리할 항목을 선택해 주세요.' });
});
type TrashRow = { id: string; category: DataCategory; record_id: string; title: string; payload_json: string; deleted_at: string };
const fromRow = (r: TrashRow): TrashRecord => ({ id: r.id, category: r.category, recordId: r.record_id, title: r.title, deletedAt: r.deleted_at, record: JSON.parse(r.payload_json) });
export async function listDataTrash(db: Database, owner: string, offset = 0) {
  const rows = await db.prepare('SELECT id,category,record_id,title,deleted_at FROM orbit_data_trash WHERE owner_id=? ORDER BY deleted_at DESC,id DESC LIMIT 101 OFFSET ?').bind(owner, offset).all<Omit<TrashRow, 'payload_json'>>();
  const count = await db.prepare('SELECT COUNT(*) AS count FROM orbit_data_trash WHERE owner_id=?').bind(owner).first<{ count: number }>();
  return { items: rows.results.slice(0, 100).map(r => ({ id: r.id, category: r.category, recordId: r.record_id, title: r.title, deletedAt: r.deleted_at })), total: count?.count ?? 0, hasMore: rows.results.length > 100 };
}
const storageTables = [
  { table: 'orbit_workspaces', name: '업무 데이터', description: '프로젝트·할 일·일정·목표·기록 목록', view: 'data' },
  { table: 'orbit_note_revisions', name: '문서 본문과 변경 이력', description: '문서별 본문과 이전 버전', view: 'wiki' },
  { table: 'orbit_attachments', name: '첨부파일', description: '파일 정보 · 원본은 비공개 파일 저장소', view: 'agent' },
  { table: 'orbit_conversations', name: 'AI 대화방', description: '프로젝트에 연결된 대화', view: 'agent' },
  { table: 'orbit_agent_orders', name: 'HERMES 업무 실행', description: '지시와 실행 상태·결과', view: 'agent' },
  { table: 'orbit_aside_jobs', name: 'ASIDE 웹 실행', description: '웹 작업과 결과·승인 상태', view: 'aside' },
  { table: 'orbit_activity_sessions', name: '외부 채널 활동', description: 'HERMES가 수집한 채널별 업무 기록', view: 'agent' },
  { table: 'orbit_integrations', name: '연결 서비스', description: '서비스별 연결 설정 · 인증 정보는 표시하지 않음', view: 'agent' },
  { table: 'orbit_data_trash', name: '휴지통', description: '복원할 수 있는 삭제 항목', view: 'data' },
] as const;
export async function dataStorageOverview(db: Database, owner: string) {
  // Identifiers are a fixed allowlist; never accept table names or SQL from clients.
  return Promise.all(storageTables.map(async item => {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${item.table} WHERE owner_id=?`).bind(owner).first<{ count: number }>();
    return { ...item, count: row?.count ?? 0 };
  }));
}
export async function changeData(db: Database, owner: string, command: z.infer<typeof dataCommandSchema>, now = new Date()) {
  const parsed = dataCommandSchema.parse(command);
  const { expectedRevision, operationId, ...payload } = parsed;
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ namespace: 'data-manager', ...payload }))))].map(n => n.toString(16).padStart(2, '0')).join('');
  const prior = await db.prepare('SELECT action_hash FROM orbit_mutations WHERE owner_id=? AND operation_id=?').bind(owner, operationId).first<{ action_hash: string }>();
  if (prior) {
    if (prior.action_hash !== hash) throw new RevisionConflict('같은 요청 번호에 다른 내용이 있습니다. 새로고침해 주세요.');
    return { snapshot: await readWorkspace(db, owner), replayed: true, trashIds: parsed.action === 'trash' ? parsed.selection!.map((_,i)=>operationId+':'+i) : [] };
  }
  const current = await readWorkspace(db, owner);
  if (current.revision !== expectedRevision) throw new RevisionConflict('데이터가 변경되었습니다. 최신 목록에서 다시 확인해 주세요.');
  let next = structuredClone(current.data);
  const at = now.toISOString(), nextRevision = current.revision + 1;
  let trash: TrashRecord[] = [];
  if (parsed.action === 'trash') {
    const plan = planDataTrash(current.data, parsed.selection!); next = plan.next;
    trash = plan.records.map((r, i) => ({ id: `${operationId}:${i}`, category: r.category, recordId: r.record.id, title: recordTitle(r.record), record: r.record, deletedAt: at }));
  } else {
    if (new Set(parsed.trashIds).size !== parsed.trashIds!.length) throw new DomainError('같은 항목을 중복 선택할 수 없습니다.');
    const rows = await db.prepare('SELECT id,category,record_id,title,payload_json,deleted_at FROM orbit_data_trash WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))').bind(owner, JSON.stringify(parsed.trashIds)).all<TrashRow>();
    if (rows.results.length !== parsed.trashIds!.length) throw new DomainError('휴지통이 변경되었습니다. 목록을 새로고침해 주세요.');
    trash = rows.results.map(fromRow);
    if (parsed.action === 'restore') next = planDataRestore(current.data, trash);
    else {
      for (const item of trash) if ((current.data[item.category] ?? []).some(r => r.id === item.recordId)) throw new DomainError('같은 번호의 현재 항목이 있어 영구 삭제를 중단했습니다.');
      // A retained trash item must not lose the parent or evidence it needs to restore.
      const dependent = await db.prepare(`SELECT title FROM orbit_data_trash AS kept WHERE owner_id=? AND id NOT IN (SELECT value FROM json_each(?)) AND EXISTS (
        SELECT 1 FROM json_each(?) AS target WHERE
        (json_extract(target.value,'$.category')='projects' AND json_extract(kept.payload_json,'$.projectId')=json_extract(target.value,'$.recordId')) OR
        (json_extract(target.value,'$.category')='goals' AND (json_extract(kept.payload_json,'$.goalId')=json_extract(target.value,'$.recordId') OR (kept.category='goals' AND json_extract(kept.payload_json,'$.parentId')=json_extract(target.value,'$.recordId')))) OR
        (json_extract(target.value,'$.category')='tasks' AND (json_extract(kept.payload_json,'$.taskId')=json_extract(target.value,'$.recordId') OR EXISTS(SELECT 1 FROM json_each(kept.payload_json,'$.dependsOn') WHERE value=json_extract(target.value,'$.recordId')))) OR
        (json_extract(target.value,'$.category')='notes' AND (json_extract(kept.payload_json,'$.noteId')=json_extract(target.value,'$.recordId') OR json_extract(kept.payload_json,'$.wiki.parentId')=json_extract(target.value,'$.recordId') OR EXISTS(SELECT 1 FROM json_each(kept.payload_json,'$.wiki.links') WHERE value=json_extract(target.value,'$.recordId')))) OR
        EXISTS(SELECT 1 FROM json_each(kept.payload_json,'$.sources') AS source WHERE json_extract(source.value,'$.id')=json_extract(target.value,'$.recordId') AND json_extract(source.value,'$.kind')=CASE json_extract(target.value,'$.category') WHEN 'notes' THEN 'note' WHEN 'tasks' THEN 'task' ELSE '' END)
      ) LIMIT 1`).bind(owner, JSON.stringify(parsed.trashIds), JSON.stringify(trash.map(({category,recordId})=>({category,recordId})))).first<{title:string}>();
      if (dependent) throw new DomainError(`휴지통의 “${dependent.title}” 기록이 연결되어 있습니다. 함께 복원하거나 연결된 항목을 먼저 영구 삭제해 주세요.`);
    }
  }
  next.events = next.events.filter(e => !e.id.startsWith('google:'));
  const storage=prepareWorkspace(next);
  const activeGate = `NOT EXISTS(SELECT 1 FROM orbit_agent_actions WHERE owner_id=? AND state='applying') AND NOT EXISTS(SELECT 1 FROM orbit_calendar_exports WHERE owner_id=? AND json_extract(state_json,'$.status')='publishing' AND COALESCE(json_extract(state_json,'$.leaseUntil'),0)>?)`;
  const update = db.prepare(`INSERT INTO orbit_workspaces(owner_id,revision,state_json,mutation_id,updated_at) SELECT ?,?,?,?,? WHERE ${activeGate} ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json,mutation_id=excluded.mutation_id,updated_at=excluded.updated_at WHERE orbit_workspaces.revision=? AND ${activeGate}`).bind(owner, nextRevision, storage.stateJson, operationId, at, owner, owner, Date.now(), expectedRevision, owner, owner, Date.now());
  const gate = 'EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND revision=? AND mutation_id=?) AND NOT EXISTS(SELECT 1 FROM orbit_mutations WHERE owner_id=? AND operation_id=?)';
  const gateValues = [owner, nextRevision, operationId, owner, operationId] as const;
  const statements: Statement[] = [update,...storage.statements(db,owner,gate,gateValues)];
  for (const item of trash) {
    if (parsed.action === 'trash') statements.push(db.prepare(`INSERT INTO orbit_data_trash(owner_id,id,category,record_id,title,payload_json,deleted_at) SELECT ?,?,?,?,?,?,? WHERE ${gate}`).bind(owner, item.id, item.category, item.recordId, item.title, JSON.stringify(item.record), at, ...gateValues));
    else {
      statements.push(db.prepare(`DELETE FROM orbit_data_trash WHERE owner_id=? AND id=? AND ${gate}`).bind(owner, item.id, ...gateValues));
      if (parsed.action === 'purge') {
        if (item.category === 'notes') statements.push(db.prepare(`DELETE FROM orbit_note_revisions WHERE owner_id=? AND note_id=? AND ${gate}`).bind(owner, item.recordId, ...gateValues));
        if (item.category === 'events' || item.category === 'notes') statements.push(db.prepare(`UPDATE orbit_attachments SET target_type=NULL,target_id=NULL WHERE owner_id=? AND target_type=? AND target_id=? AND ${gate}`).bind(owner, item.category === 'events' ? 'event' : 'note', item.recordId, ...gateValues));
        if (item.category === 'projects') {
          statements.push(db.prepare(`UPDATE orbit_conversations SET project_id=NULL,revision=revision+1,updated_at=? WHERE owner_id=? AND project_id=? AND ${gate}`).bind(at, owner, item.recordId, ...gateValues));
          statements.push(db.prepare(`UPDATE orbit_activity_sessions SET project_id=NULL WHERE owner_id=? AND project_id=? AND ${gate}`).bind(owner, item.recordId, ...gateValues));
        }
      }
    }
  }
  statements.push(db.prepare(`INSERT INTO orbit_mutations(owner_id,operation_id,action_hash,revision,created_at) SELECT ?,?,?,?,? WHERE ${gate}`).bind(owner, operationId, hash, nextRevision, at, ...gateValues));
  const result = await db.batch(statements);
  if (result[0]?.meta?.changes !== 1) {
    const replay = await db.prepare('SELECT action_hash FROM orbit_mutations WHERE owner_id=? AND operation_id=?').bind(owner, operationId).first<{ action_hash: string }>();
    if (!replay || replay.action_hash !== hash) throw new RevisionConflict('다른 저장이나 실행이 진행 중입니다. 최신 목록을 불러와 주세요.');
    return { snapshot: await readWorkspace(db, owner), replayed: true, trashIds: parsed.action === 'trash' ? parsed.selection!.map((_,i)=>operationId+':'+i) : [] };
  }
  return { snapshot: await readWorkspace(db, owner), replayed: false, trashIds: parsed.action === 'trash' ? trash.map(r=>r.id) : [] };
}
