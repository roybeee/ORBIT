import type {WorkspaceAction} from '../../../lib/orbit/validation.ts';

type Delivery = {
 after: (work: () => Promise<void>) => void;
 flush: (eventId?: string, force?: boolean) => Promise<unknown>;
 hasWork: () => Promise<boolean>;
};

// Schedule after the committed workspace response, including event-only workspaces.
export function scheduleCalendarDelivery(action: WorkspaceAction, taskCount: number, delivery: Delivery) {
 if (!taskCount && !['proposal.approve','event.upsert','event.delete','task.delete','preferences.update'].includes(action.type)) return;
 delivery.after(async () => {
  if (action.type === 'preferences.update') {
   const deadline = Date.now() + 20000;
   for (let n = 0; n < 6 && Date.now() < deadline && await delivery.hasWork(); n++) await delivery.flush(undefined, true);
   return;
  }
  const eventId = action.type === 'task.schedule' ? action.eventId
   : action.type === 'event.upsert' ? action.event.id
   : action.type === 'event.delete' ? action.id
   : action.type === 'proposal.approve' ? 'approved:' + action.itemId
   : action.type === 'task.upsert' ? 'task-due:' + action.task.id
   : undefined;
  await delivery.flush(eventId);
 });
}
