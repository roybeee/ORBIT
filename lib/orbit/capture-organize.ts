import {AgentError} from './agent/errors.ts';
import {chatModel, directChatConfigured, directModelReply} from './agent/direct-model.ts';
import type {Runtime} from './agent/integrations.ts';
import {ORGANIZE_INSTRUCTIONS} from './capture-batch.ts';

// Server side of 빠른 기록's "정리": the model splits what was said into items with short
// titles. It only reads; the sheet still shows every item for review before anything is saved,
// and the browser falls back to its local reading whenever this is unavailable.
export const ORGANIZE_MAX = 4000;
export async function organizeCapture(env: Runtime, input: { text?: unknown; today?: unknown }) {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text || text.length > ORGANIZE_MAX) throw new AgentError(`정리할 내용을 ${ORGANIZE_MAX.toLocaleString()}자 이내로 보내 주세요.`, 'INPUT', 400);
  const today = typeof input.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.today) ? input.today : undefined;
  if (!directChatConfigured(env)) throw new AgentError('AI 정리를 사용할 수 없어 기기에서 정리했습니다.', 'AI_OFF', 503);
  const reply = await directModelReply(env, {
    instructions: ORGANIZE_INSTRUCTIONS + (today ? `\n오늘은 ${today}이다.` : ''),
    input: text,
    conversation_history: [],
    outputTokens: 1500,
  }, chatModel(env), 12000);
  try { return { answer: JSON.parse(reply) as unknown }; }
  catch { throw new AgentError('AI 정리 결과를 읽지 못해 기기에서 정리했습니다.', 'OPENAI_FORMAT', 422); }
}
