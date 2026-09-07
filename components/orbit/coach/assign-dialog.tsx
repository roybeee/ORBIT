'use client';
import { useMemo, useState } from 'react';
import { Wand2, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { assignmentPlan } from '@/lib/orbit/classify';
import type { WorkspaceData } from '@/lib/orbit/model';
import type { WorkspaceAction } from '@/lib/orbit/validation';
// Review before anything moves: every proposed reassignment shows the keyword that justified it.
export function AssignDialog({
  data,
  busy,
  demo,
  onClose,
  perform,
}: {
  data: WorkspaceData;
  busy: boolean;
  demo: boolean;
  onClose: () => void;
  perform: (action: WorkspaceAction, message?: string) => Promise<boolean>;
}) {
  const plan = useMemo(() => assignmentPlan(data.tasks, data.projects, data.notes), [data]);
  const proposals = plan.assignments;
  const [names, setNames] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const name = (id: string) => names[id] ?? [...data.projects, ...plan.projects].find((p) => p.id === id)?.name ?? id;
  const selected = proposals.filter((a) => !excluded.has(a.taskId));
  const newProjects = plan.projects.filter((p) => selected.some((a) => a.projectId === p.id));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle>프로젝트 자동 안분</DialogTitle>
          <DialogDescription>
            할 일에서 사업명과 업무 키워드를 찾았습니다. 필요한 프로젝트를 만들고 체크한 할 일을 함께 연결합니다. 이름은 수정할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-form assign-list">
          {newProjects.length > 0 && <div className="assign-drafts">
            <strong>새 프로젝트 {newProjects.length}개</strong>
            <p className="form-hint">할 일 제목에서 추출한 후보입니다. 목표일은 연결할 첫 할 일의 마감일을 임시로 사용합니다. 같은 이름의 프로젝트는 하나로 연결합니다.</p>
            {newProjects.map((p) => <label key={p.id} className="form-label">
              새 프로젝트 · 키워드 {p.keywords?.join(', ')}
              <input className="form-field" maxLength={160} value={name(p.id)}
                aria-label={`${p.name} 프로젝트 이름`} disabled={busy}
                onChange={(e) => setNames((prev) => ({ ...prev, [p.id]: e.target.value }))} />
            </label>)}
          </div>}
          {proposals.length === 0 && (
            <p className="muted">
              옮길 후보가 없습니다. 프로젝트 이름에 없는 표현을 쓰는 할 일이 있다면 프로젝트 편집에서 키워드를
              등록해 주세요.
            </p>
          )}
          {proposals.map((a) => {
            const task = data.tasks.find((t) => t.id === a.taskId)!;
            const on = !excluded.has(a.taskId);
            return (
              <label key={a.taskId} className={`assign-row ${on ? '' : 'is-off'}`}>
                <Checkbox
                  checked={on}
                  disabled={busy}
                  onCheckedChange={(v) =>
                    setExcluded((prev) => {
                      const next = new Set(prev);
                      if (v) next.delete(a.taskId);
                      else next.add(a.taskId);
                      return next;
                    })
                  }
                  aria-label={`${task.title} 옮기기`}
                />
                <span className="assign-body">
                  <strong>{task.title}</strong>
                  <small>
                    {name(a.from)} <ArrowRight size={12} /> <b>{name(a.projectId)}</b>{plan.projects.some((p) => p.id === a.projectId) ? ' (새 프로젝트)' : ''} · 키워드 ‘
                    {a.matched.join('’, ‘')}’
                  </small>
                </span>
              </label>
            );
          })}
          <button
            className="primary-button full-width"
            style={{ marginTop: 18 }}
            disabled={busy || demo || selected.length === 0 || newProjects.some((p) => !name(p.id).trim())}
            onClick={async () => {
              const ok = await perform(
                {
                  type: 'task.assign',
                  projects: newProjects.map((p) => ({ ...p, name: name(p.id).trim() })),
                  assignments: selected.map((a) => ({ id: a.taskId, projectId: a.projectId })),
                },
                `할 일 ${selected.length}개를 키워드에 맞는 프로젝트로 옮겼습니다.`,
              );
              if (ok) onClose();
            }}
          >
            <Wand2 size={15} />
            {selected.length ? `${newProjects.length ? `프로젝트 ${newProjects.length}개 생성 · ` : ''}할 일 ${selected.length}개 연결` : '옮길 항목 없음'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
