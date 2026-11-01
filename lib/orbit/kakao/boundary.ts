import type {Database} from '../../../db/repository.ts';
import {AgentError} from '../agent/errors.ts';

const sourceSql="CASE WHEN json_valid(input) THEN json_extract(input,'$.source') ELSE NULL END='kakao-read-review'";
export async function isKakaoTurn(db:Database,owner:string,turnId:string){
 return !!await db.prepare(`SELECT id FROM orbit_agent_turns WHERE owner_id=? AND id=? AND ${sourceSql}`).bind(owner,turnId).first();
}
/** Captured third-party statements must never become an ordinary chat's user instructions. */
export async function assertKakaoConversationReadOnly(db:Database,owner:string,conversationId:string){
 if(await db.prepare(`SELECT id FROM orbit_agent_turns WHERE owner_id=? AND conversation_id=? AND ${sourceSql} LIMIT 1`).bind(owner,conversationId).first())throw new AgentError('카카오톡 검토 기록은 분석 전용입니다. 새 대화에서 질문하거나 카카오톡 비서실장에서 다시 수집해 주세요.','KAKAO_ANALYSIS_ONLY',409);
}
