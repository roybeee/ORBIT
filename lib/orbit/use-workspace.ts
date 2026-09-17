'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {readDraft,saveDraft,clearDraft} from './device-drafts';
import {requestOwnerHeaders} from './request-owner';
import { toast } from 'sonner';
import { emptyWorkspace, type WorkspaceSnapshot } from './model';
import {commandSchema} from './validation';
import type { WorkspaceAction } from './validation';
import { applyAction, DomainError } from './reducer';
import {
  initialProjects,
  initialTasks,
  initialNotes,
  initialEvents,
  initialGoals,
  initialDominoProjectId,
  initialHabits,
  initialRisks,
  initialImprovements,
  initialReviews,
} from './seed';
import { generateProposal, calibrationFactor } from './planner';
const initial = (demo: boolean): WorkspaceSnapshot => {
  const empty = emptyWorkspace();
  return {
    revision: 0,
    updatedAt: null,
    data: demo
      ? {
          ...empty,
          projects: initialProjects,
          tasks: initialTasks.map((t) => ({ ...t, focusDate: t.focus ? '2026-09-06' : undefined })),
          notes: initialNotes,
          events: initialEvents,
          goals: initialGoals,
          dominoProjectId: initialDominoProjectId,
          habits: initialHabits,
          risks: initialRisks,
          improvements: initialImprovements,
          reviews: initialReviews,
          proposals: [
            generateProposal(
              initialTasks,
              initialEvents,
              '2026-09-07',
              'normal',
              undefined,
              empty.preferences,
              {
                dominoProjectId: initialDominoProjectId,
                calibration: (t) => calibrationFactor(initialTasks, t, '2026-09-07'),
              },
            ),
          ],
        }
      : empty,
  };
};
interface Failure {
  message: string;
  code: string;
}
export function useWorkspace(demo: boolean, ownerId = '') {
  const [snapshot, setSnapshot] = useState(() => initial(demo));
  const snapshotRef = useRef(snapshot);
  const [loaded, setLoaded] = useState(demo),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<Failure | null>(null);
  const [online, setOnline] = useState(true);
  const busyRef = useRef(false);
  const pauseRef = useRef(false);
  const mounted = useRef(true);
  const pending = useRef<{ operationId: string; expectedRevision: number; action: WorkspaceAction } | null>(
    null,
  );
  const publish = useCallback((value: WorkspaceSnapshot) => {
    snapshotRef.current = value;
    if (mounted.current) setSnapshot(value);
  }, []);
  const load = useCallback(
    async (automatic = false) => {
      if (demo || busyRef.current || (automatic && pauseRef.current)) return;
      if (!navigator.onLine) {
        setOnline(false);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const r = await fetch('/api/workspace', { headers:requestOwnerHeaders(), cache: 'no-store', signal: controller.signal });
        const body = await r.json();
        if (!r.ok) throw { message: body.error, code: body.code };
        if (automatic && pauseRef.current) return;
        publish(body);
        setLoaded(true);
        if(!pending.current)setFailure(null);
      } catch (e) {
        const err = e as Failure;
        setFailure({
          message: err.message || '연결 상태를 확인하고 다시 시도해 주세요.',
          code: err.code || 'NETWORK',
        });
      } finally {
        clearTimeout(timeout);
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [demo, publish, ownerId],
  );
  useEffect(() => {
    mounted.current = true;
    if (!demo && ownerId) {
      const restored=commandSchema.safeParse(readDraft(ownerId,'command'));pending.current=restored.success?restored.data:null;
      if(pending.current)setFailure({code:'PENDING',message:'서버 저장이 확인되지 않은 입력이 있습니다. 같은 요청으로 저장 결과를 확인해 주세요.'});
    }
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  const send = useCallback(
    async (command: NonNullable<typeof pending.current>): Promise<boolean> => {
      if(busyRef.current){toast('저장 중입니다. 잠시 기다려 주세요.');return false;}
      if(!demo && ownerId){try{saveDraft(ownerId,'command','',command);pending.current=command;}catch{setFailure({code:'DRAFT',message:'기기 임시 저장 공간을 사용할 수 없습니다. 입력을 복사한 뒤 다시 시도해 주세요.'});return false;}}
      if (!demo && !navigator.onLine) {
        setOnline(false);
        setFailure({code:'OFFLINE',message:'입력을 이 기기에 임시 보관했습니다. 인터넷 연결 후 저장 결과 확인을 눌러 주세요.'});toast('이 기기에 임시 보관했습니다. 서버에는 아직 저장되지 않았습니다.');
        return false;
      }
      if (busyRef.current) {
        toast('저장 중입니다. 잠시 기다려 주세요.');
        return false;
      }
      busyRef.current = true;
      setBusy(true);
      pending.current = command;
      const before = snapshotRef.current;
      let optimistic = false;
      if (!demo && ['task.status', 'task.focus'].includes(command.action.type)) {
        try {
          publish({ ...before, data: applyAction(before.data, command.action) });
          optimistic = true;
        } catch {}
      }
      try {
        if (demo) {
          const data = applyAction(
            snapshotRef.current.data,
            command.action,
            new Date('2026-09-06T09:00:00Z'),
          );
          publish({ data, revision: snapshotRef.current.revision + 1, updatedAt: new Date().toISOString() });
        } else {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 20000);
          try {
            const r = await fetch('/api/workspace', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...requestOwnerHeaders() },
              body: JSON.stringify(command),
              signal: controller.signal,
            });
            const body = await r.json();
            if (!r.ok) throw { message: body.error, code: body.code };
            publish(body);
          } finally {
            clearTimeout(timeout);
          }
        }
        pending.current = null;
        if(!demo)clearDraft(ownerId,'command');
        setFailure(null);
        return true;
      } catch (e) {
        if (optimistic) publish(before);
        const err = e as Failure;
        const failure = {
          message: err.message || '저장을 확인하지 못했습니다. 다시 저장해 주세요.',
          code: err.code || (e instanceof DomainError ? 'INPUT' : 'NETWORK'),
        };
        if (failure.code === 'INPUT') {pending.current = null;clearDraft(ownerId,'command');}
        setFailure(failure);
        toast.error(failure.message);
        return false;
      } finally {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [demo, publish, ownerId],
  );
  const mutate = useCallback(
    async (action: WorkspaceAction) => {
      if (!loaded) {
        toast.error('먼저 저장된 내용을 불러와 주세요.');
        return false;
      }
      if (pending.current && !busyRef.current) {
        toast.error('이전 저장 결과를 먼저 확인해 주세요.');
        return false;
      }
      return send({
        operationId: crypto.randomUUID(),
        expectedRevision: snapshotRef.current.revision,
        action,
      });
    },
    [loaded, send],
  );
  const retry = useCallback(async () => {
    if (pending.current) return send(pending.current);
    await load();
    return false;
  }, [send, load]);
  const discardRequestAndRefresh = useCallback(async () => {
    if(pending.current){try{saveDraft(ownerId,'recovered-command','',pending.current);}catch{toast.error('임시 요청 보관에 실패했습니다. 저장 결과 확인으로 다시 시도해 주세요.');return;}}
    pending.current = null;
    clearDraft(ownerId,'command');
    await load();
  }, [load,ownerId]);
  useEffect(() => {
    if (demo) return;
    setOnline(navigator.onLine);
    const resume = () => {
      if (
        document.visibilityState === 'visible' &&
        navigator.onLine &&
        !pending.current &&
        !busyRef.current &&
        !pauseRef.current
      )
        void load(true);
    };
    const connection = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) resume();
    };
    const timer = setInterval(resume, 60000);
    window.addEventListener('focus', resume);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    document.addEventListener('visibilitychange', resume);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [demo, load, ownerId]);
  const pauseRefresh = useCallback((value: boolean) => {
    pauseRef.current = value;
  }, []);
  const acceptSnapshot = useCallback((value: WorkspaceSnapshot) => {
    if (value.revision >= snapshotRef.current.revision && !pending.current) publish(value);
  }, [publish]);
  return {
    snapshot,
    loaded,
    busy,
    failure,
    online,
    mutate,
    retry,
    pauseRefresh,
    acceptSnapshot,
    refresh: load,
    discardRequestAndRefresh,
    hasPending: !!pending.current,
  };
}
