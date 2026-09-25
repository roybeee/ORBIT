import type {Database} from '../../../db/repository.ts';
import {decide} from '../agent/decisions.ts';
import type {Runtime} from '../agent/integrations.ts';
import {mergeMeetingProposals,type MergeTarget} from './merge.ts';

// Folding a card into a task or event that already exists is the owner's decision about that card,
// so it is applied at once and the card closes. Combining two proposals still leaves one card to
// review. When the apply is refused (e.g. an overlap), the merged card stays pending with the reason.
export async function mergeAndApply(db:Database,owner:string,noteId:string,actionId:string,target:MergeTarget,env:Runtime){
 await mergeMeetingProposals(db,owner,noteId,actionId,target);
 if(target.kind==='proposal')return {applied:false};
 try{await decide(db,owner,{id:actionId,decision:'approve'},env);return {applied:true}}
 catch(error){return {applied:false,error:error instanceof Error?error.message:'통합한 내용을 반영하지 못했습니다.'}}
}
