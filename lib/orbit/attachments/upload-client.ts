import type {PreparedFile} from './prepare-client.ts';
import type {StoredAttachment} from './types.ts';

type UploadSteps = {
 original: () => Promise<StoredAttachment>;
 prepare: () => Promise<PreparedFile>;
 preview: (blob: Blob) => Promise<StoredAttachment>;
 finalize: (prepared: PreparedFile) => Promise<StoredAttachment>;
 processing: () => void;
};

export async function completeAttachmentUpload(stored: StoredAttachment, steps: UploadSteps): Promise<StoredAttachment> {
 if (stored.prepared) {
  if (stored.state !== 'ready') throw new Error('원본 파일 준비를 확인하지 못했습니다. 다시 시도해 주세요.');
  return stored;
 }
 // Observe both branches immediately and finish both before allowing a retry.
 // Otherwise a failed preparation could leave the original PUT racing the retry.
 const original = Promise.resolve().then(() => stored.state === 'ready' ? stored : steps.original()).then(value => {
  if (value.state !== 'ready') throw new Error('원본 파일 준비를 확인하지 못했습니다. 다시 시도해 주세요.');
  steps.processing();
  return value;
 });
 const preparation = Promise.resolve().then(steps.prepare);
 const [uploaded, prepared] = await Promise.allSettled([original, preparation]);
 if (uploaded.status === 'rejected') throw uploaded.reason;
 if (prepared.status === 'rejected') throw prepared.reason;
 if (prepared.value.preview) await steps.preview(prepared.value.preview);
 const result = await steps.finalize(prepared.value);
 if (result.state !== 'ready' || !result.prepared) throw new Error('파일 준비를 완료하지 못했습니다. 다시 시도해 주세요.');
 return result;
}
