'use client';
import { useMemo, useState } from 'react';
import { Wand2, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { autoAssignments } from '@/lib/orbit/classify';
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
  const proposals = useMemo(() => autoAssignments(data.tasks, data.projects, data.notes), [data]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const name = (id: string) => data.projects.find((p) => p.id === id)?.name ?? id;
  const selected = proposals.filter((a) => !excluded.has(a.taskId));
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
            제목과 완료 기준의 키워드가 다른 프로젝트를 분명히 가리키는 할 일입니다. 체크한 항목만 옮깁니다.
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-form assign-list">
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
                    {name(a.from)} <ArrowRight size={12} /> <b>{name(a.projectId)}</b> · 키워드 ‘
                    {a.matched.join('’, ‘')}’
                  </small>
                </span>
              </label>
            );
          })}
          <button
            className="primary-button full-width"
            style={{ marginTop: 18 }}
            disabled={busy || demo || selected.length === 0}
            onClick={async () => {
              const ok = await perform(
                {
                  type: 'task.assign',
                  assignments: selected.map((a) => ({ id: a.taskId, projectId: a.projectId })),
                },
                `할 일 ${selected.length}개를 키워드에 맞는 프로젝트로 옮겼습니다.`,
              );
              if (ok) onClose();
            }}
          >
            <Wand2 size={15} />
            {selected.length ? `${selected.length}개 옮기기` : '옮길 항목 없음'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
