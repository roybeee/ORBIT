import {z} from 'zod';
import type {Database} from '../../../db/repository.ts';
import {rehomeOrphanCards} from '../meetings/orphan-cards.ts';

// 결재함 can close whole meetings at once. One request and one UPDATE instead of a PATCH per card.
export const BULK_REJECT_LIMIT=500;
export const bulkRejectSchema=z.object({ids:z.array(z.string().uuid()).min(1).max(BULK_REJECT_LIMIT)}).strict();

// Rejects the cards that are still open (pending or deferred); applied, applying or already
// closed cards and other owners' ids are skipped. Same effect as rejecting each one: a meeting
// whose proposed project was rejected gets its remaining cards moved to the note's project.
export async function rejectActions(db:Database,owner:string,ids:readonly string[]){
 const unique=[...new Set(ids)];
 const {results}=await db.prepare("UPDATE orbit_agent_actions SET state='rejected',note='',revisit_date=NULL,updated_at=? WHERE owner_id=? AND id IN (SELECT value FROM json_each(?)) AND state IN ('pending','deferred') RETURNING json_extract(guard_json,'$.meeting.noteId') AS note_id")
  .bind(new Date().toISOString(),owner,JSON.stringify(unique)).all<{note_id:string|null}>();
 const notes=[...new Set(results.flatMap(r=>r.note_id?[r.note_id]:[]))];
 for(const noteId of notes)await rehomeOrphanCards(db,owner,noteId);
 return {rejected:results.length,skipped:unique.length-results.length};
}
