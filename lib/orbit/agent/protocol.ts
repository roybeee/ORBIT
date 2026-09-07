import { z } from 'zod';
import { fileIds } from '../attachments/storage.ts';
import { conversationIdSchema } from './conversations.ts';
import { actionSchema, dateSchema } from '../validation.ts';
import { AgentError } from './errors.ts';
import type { GoogleEventAction } from './types.ts';
export const googleActionSchema = z
  .object({
    type: z.literal('google.event.create'),
    event: z
      .object({
        title: z.string().min(1).max(160),
        date: dateSchema,
        start: z.number().int().min(0).max(1439),
        end: z.number().int().min(1).max(1440),
        timeZone: z.string().refine((value) => {
          try {
            new Intl.DateTimeFormat('ko', { timeZone: value });
            return true;
          } catch {
            return false;
          }
        }),
        description: z.string().max(4000),
      })
      .strict()
      .refine((e) => e.end > e.start),
  })
  .strict();
export const agentInput = z
  .object({
    attachmentIds: fileIds.optional(),
    conversationId: conversationIdSchema.optional(),
    id: z.string().uuid(),
    message: z.string().trim().min(1).max(8000),
  })
  .strict();
const allowed = new Set([
  'project.upsert',
  'task.upsert',
  'task.status',
  'task.focus',
  'note.upsert',
  'event.upsert',
  'review.saveGenerate',
  'proposal.generate',
  'proposal.approve',
  'proposal.defer',
  'proposal.reconsider',
  'proposal.revoke',
  'preferences.update',
  'project.domino',
  'goal.upsert',
  'task.laser',
  'task.record',
  'improvement.add',
  'improvement.retire',
  'habit.upsert',
  'habit.check',
  'risk.upsert',
  'risk.close',
]);
export function parseAction(value: unknown) {
  const google = googleActionSchema.safeParse(value);
  if (google.success) return google.data as GoogleEventAction;
  const parsed = actionSchema.safeParse(value);
  if (!parsed.success || !allowed.has(parsed.data.type))
    throw new AgentError('지원하는 변경 형식이 아닙니다. 더 구체적인 제안을 요청해 주세요.');
  return parsed.data;
}
export const contract = `Supported action JSON examples (use actual user values and IDs):
{"type":"project.upsert","project":{"id":"new-id","name":"name","color":"#5558e8","symbol":"O","goal":"result","due":"YYYY-MM-DD","priority":3}}
{"type":"task.upsert","task":{"id":"new-id","title":"title","projectId":"actual-project-id","status":"todo","duration":45,"due":"YYYY-MM-DD","impact":3,"focus":false,"definition":"observable done criteria"}}
{"type":"task.status","id":"actual-task-id","status":"done"}
{"type":"task.focus","id":"actual-task-id","focus":true}
{"type":"note.upsert","note":{"id":"new-id","title":"title","kind":"meeting or wiki or knowledge","projectId":"actual-project-id","summary":"summary up to 500 chars","body":"full content with source IDs, dates and quotes when available","tags":[],"updated":"YYYY-MM-DD"}}
{"type":"event.upsert","event":{"id":"new-id","title":"title","date":"YYYY-MM-DD","start":540,"end":585,"kind":"meeting"}}
{"type":"review.saveGenerate","review":{"date":"YYYY-MM-DD","win":"actual reported result","block":"actual reported blocker","energy":"normal"}}
{"type":"proposal.generate","date":"YYYY-MM-DD","energy":"normal"}
{"type":"proposal.approve","date":"YYYY-MM-DD","itemId":"existing item ID"}
{"type":"proposal.defer","date":"YYYY-MM-DD","itemId":"existing item ID","reason":"reason","revisitDate":"YYYY-MM-DD"}
{"type":"google.event.create","event":{"title":"title","date":"YYYY-MM-DD","start":540,"end":585,"timeZone":"Asia/Seoul","description":"purpose"}}
{"type":"goal.upsert","goal":{"id":"new-id","kind":"life or mid or short or concept","sentence":"one big measurable sentence with a deadline","metric":"number to reach","deadline":"YYYY-MM-DD"}}
{"type":"project.domino","id":"actual-project-id"}
{"type":"task.laser","id":"actual-task-id","date":"YYYY-MM-DD","laser":true}
{"type":"task.record","id":"actual-task-id","outcome":"done or partial or skipped","actualMinutes":40,"reason":"time|waiting|priority|scope|energy|other (only for partial/skipped)","rule":"optional rule the user stated in their own words","ruleKind":"buffer|placement|estimate|habit|decline|other"}
{"type":"improvement.add","improvement":{"id":"new-id","rule":"user's own rule sentence","kind":"buffer|placement|estimate|habit|decline|other","createdOn":"YYYY-MM-DD","active":true}}
{"type":"habit.upsert","habit":{"id":"new-id","title":"10-minute habit","mode":"keep or quit","startedOn":"YYYY-MM-DD","log":[]}}
{"type":"habit.check","id":"actual-habit-id","date":"YYYY-MM-DD","checked":true}
{"type":"risk.upsert","risk":{"id":"new-id","title":"standing structural risk","checkDate":"YYYY-MM-DD","condition":"what resolves it"}}
{"type":"risk.close","id":"actual-risk-id"}
Task fields quadrant (A important+urgent, B important, C urgent, D neither), cognition (high, mid, low, external), must (true = 반드시 종결 today) are optional and only set from what the user says. proposal.generate and review.saveGenerate start a resumable Hermes analysis that produces a one-page strategic brief. Approval of that card starts analysis only; tell the user to review the result in 내일 제안. Its priorities are individually approved before tasks or focus blocks are applied. Times are integer minutes after midnight. Task duration is 5..480, impact/priority 1..5. Notes/tasks require a project: ask or propose the project first. Updates must preserve omitted original facts by reading the full existing record and submitting the full changed record. Never change an existing note without first reading its body. Do not invent completion, review outcomes, deadlines, business facts, source quotes or project mappings. Ask a focused question when missing information affects correctness. A tentative duration or plan is a suggestion and must say so. Energy low/normal/high only. Google writes are primary-calendar events without guests, invitations or notifications. Internal event approval does not by itself write Google. Do not propose duplicate internal and Google blocks for the same time. Never edit google: or approved: event IDs.`;
