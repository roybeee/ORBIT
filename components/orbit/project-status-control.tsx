'use client';

import type { ProjectStatus } from '@/lib/orbit/model';

export const PROJECT_REOPEN_CONFIRMATION =
  '프로젝트를 진행 중으로 전환합니다. 완료된 할 일, 최종 결과, 완료일과 상태 이력은 삭제하거나 초기화하지 않습니다.';

interface Props {
  status: ProjectStatus;
  busy: boolean;
  onChange: (status: ProjectStatus) => void | Promise<void>;
}

export function ProjectStatusControl({ status, busy, onChange }: Props) {
  const completed = status === 'completed';
  const change = () => {
    if (completed && !window.confirm(PROJECT_REOPEN_CONFIRMATION)) return;
    void onChange(completed ? 'active' : 'completed');
  };
  return (
    <section aria-label="프로젝트 상태 관리">
      <div className="detail-keyvalue">
        <span>프로젝트 상태</span>
        <strong>{completed ? '완료' : '진행 중'}</strong>
      </div>
      {completed && (
        <p className="form-hint">
          새 미완료 할 일을 추가하거나 연결하면 자동으로 진행 중으로 전환됩니다. 완료된 할 일과 최종 결과,
          완료일, 상태 이력은 그대로 보존됩니다.
        </p>
      )}
      <button className="secondary-button" type="button" disabled={busy} onClick={change}>
        {completed ? '진행 중으로 전환' : '프로젝트 완료 처리'}
      </button>
    </section>
  );
}
