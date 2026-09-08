import { z } from 'zod';
import {orderActionSchema} from './orders-schema.ts';
import { fileIds } from '../attachments/storage.ts';
import { conversationIdSchema } from './conversations.ts';
import { actionSchema, dateSchema } from '../validation.ts';
import { AgentError } from './errors.ts';
import type { GoogleEventAction } from './types.ts';
export const googleDeleteSchema=z.object({type:z.literal('google.event.deleteSeries'),eventId:z.string().regex(/^[a-zA-Z0-9_-]{1,1024}$/),expectedTitle:z.string().trim().min(1).max(160),scope:z.literal('all'),verified:z.object({calendarId:z.string().min(1).max(1024),seriesId:z.string().regex(/^[a-zA-Z0-9_-]{1,1024}$/),etag:z.string().min(1).max(500),iCalUID:z.string().min(1).max(1024),title:z.string().min(1).max(160)}).strict().optional()}).strict();
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
  'memory.upsert',
  'quest.plan',
  'chief.checkin',
  'care.upsert',
  'care.check',
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
  'task.assign',
  'improvement.add',
  'improvement.retire',
  'habit.upsert',
  'habit.check',
  'risk.upsert',
  'risk.close',
]);
export function parseAction(value: unknown) {
  const deletion=googleDeleteSchema.safeParse(value);if(deletion.success)return deletion.data;
  const dispatch=orderActionSchema.safeParse(value);
  if(dispatch.success)return dispatch.data;
  const google = googleActionSchema.safeParse(value);
  if (google.success) return google.data as GoogleEventAction;
  const parsed = actionSchema.safeParse(value);
  if (!parsed.success || !allowed.has(parsed.data.type))
    throw new AgentError('지원하는 변경 형식이 아닙니다. 더 구체적인 제안을 요청해 주세요.');
  if (parsed.data.type === 'task.assign' && parsed.data.assignments.length > 20)
    throw new AgentError('한 카드에서 옮길 수 있는 할 일은 20개까지입니다.');
  return parsed.data;
}
export const contract = `Supported action JSON examples (use actual user values and IDs):
{"type":"google.event.deleteSeries","eventId":"exact-native-google-id","expectedTitle":"exact event title","scope":"all"}
Calendar recurring-series deletion uses google.event.deleteSeries through Orbit's own Google OAuth, NEVER agent.dispatch to a Hermes run without Google tools. Only propose this for explicit ENTIRE series deletion, never single occurrence or this-and-following requests. Use the user-provided native ID or read google_calendar_read to obtain it (remove only the google: prefix and final :YYYY-MM-DD from Orbit cache IDs). No inferred IDs. Omit verified: the server resolves and validates the actual title, series, calendar and version before staging; approval revalidates and deletes only that series. No tasks are created, edited or completed by this action. If the user says keep an existing todo unchanged, propose only this deletion card. After an earlier Hermes permission failure, offer this direct action instead of repeating the same dispatch. Existing Google connection can be used without Hermes reauthentication; request Orbit → 연결 → Google Calendar only when that connection fails. A prior completed execution is not proof of deletion.
{"type":"agent.dispatch","title":"Concrete execution order","instruction":"The exact approved scope, intended recipient if any, observable outcome and authorization limits","projectId":"actual-project-id or null","taskIds":["actual-task-id"],"eventIds":["actual-calendar-event-id"]}
agent.dispatch is a REAL native Hermes execution order, not a task placeholder. One card approval submits an independent run with configured native tools and delegation. Use it when the user asks to execute work or direct the development team. Preserve the user's requested recipients and scope; never expand to publishing, purchases or messaging without explicit user authorization. Separate independent work into separate orders when helpful. References are optional context, not new records: taskIds must be raw IDs of already saved Orbit tasks only, never calendar IDs, evidence IDs, a task title or a task that will be created later. eventIds holds exact existing calendar record IDs. For a calendar operation without existing Orbit tasks, use projectId:null, taskIds:[], and the matching eventIds. Include only actual saved records; never invent an ID to fill these fields. Tasks from different projects require projectId:null; keep their original project membership. A linked project must own all linked tasks. Orbit Google OAuth and internal task-write access are not inherited by the native executor; do not promise calendar deletion or an end-to-end conversion without actual tool receipts. Recurring-event scope and the intended task creation are explicit work-order requirements and must not change while correcting references. Do not pair dispatch with fabricated task.status doing/done. Receipt/status/results are visible in 실행실. The user can also use 실행실 → 새 업무 지시 to directly execute without a proposal card. Unknown agent names must be verified at execution; no self-granted access. agent_orders reads actual order receipts and results. A completed run still needs result review before a linked task is marked complete.
{"type":"memory.upsert","memory":{"id":"new-id","statement":"user-confirmed preference or useful strategy","kind":"preference or constraint or strategy or reflection","origin":"user or records or saju","sources":[]}}
For origin records include 1..6 sources {kind:note|task|review,id:actual-record-id,revision?:note-version}. Reference only server evidence you actually read. Origin saju must always be kind reflection. Never use old AI guesses as facts. User card approval is the confirmation; memory.upsert never silently changes personal settings.
{"type":"quest.plan","goalId":"actual-goal-id","project":{"id":"new-project-id","name":"Goal execution","goal":"observable result","goalId":"actual-goal-id","due":"YYYY-MM-DD","color":"#5558e8","symbol":"O","priority":3},"tasks":[{"id":"quest-a","projectId":"new-project-id","title":"first concrete step","definition":"observable result","duration":20,"due":"YYYY-MM-DD","impact":3},{"id":"quest-b","projectId":"new-project-id","title":"next step","definition":"observable result","duration":30,"due":"YYYY-MM-DD","impact":3,"dependsOn":["quest-a"]}]}
quest.plan accepts 1..12 new tasks, no existing ID overwrite, all projects must belong to the selected goal. Omit project when using an existing project. No scheduling, completion or focus fields. One approval saves the project and dependency chain; cycles/unknown predecessors reject the whole plan.
{"type":"chief.checkin","energy":"low or normal or high","strain":"light or normal or heavy","note":"user-reported needs only"}
{"type":"care.upsert","routine":{"id":"new-id","title":"a small personally chosen practice","domain":"health or mind or learning","minutes":10,"days":[1,2,3,4,5],"start":750,"active":true}}
{"type":"care.check","id":"actual-routine-id","checked":true}
Goal optional fields: domain work/health/mind/learning/life; status active/paused/achieved; progress {baseline:number,current:number,target:number,unit:string,startedOn:YYYY-MM-DD,updatedOn:YYYY-MM-DD}. Set only reported values. target must differ from baseline. achieved requires the user confirming an actual result. care.upsert preserves completion history; its time is reserved in internal proposal planning. No external calendar write occurs.
{"type":"project.upsert","project":{"id":"new-id","name":"name","color":"#5558e8","symbol":"O","goal":"result","due":"YYYY-MM-DD","priority":3}}
{"type":"task.upsert","task":{"id":"new-id","title":"title","projectId":"actual-project-id","status":"todo","duration":45,"due":"YYYY-MM-DD","impact":3,"focus":false,"definition":"observable done criteria"}}
{"type":"task.status","id":"actual-task-id","status":"done"}
{"type":"task.focus","id":"actual-task-id","focus":true}
{"type":"task.assign","assignments":[{"id":"actual-task-id","projectId":"actual-project-id"}]}
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
Task fields quadrant (A important+urgent, B important, C urgent, D neither), cognition (high, mid, low, external), must (true = 반드시 종결 today) are optional and only set from what the user says. proposal.generate and review.saveGenerate start a resumable Hermes analysis that produces a one-page strategic brief. Approval of that card starts analysis only; tell the user to review the result in 내일 제안. Its priorities are individually approved before tasks or focus blocks are applied. task.assign {assignments:[{id,projectId}],projects?:[full project records]} moves existing tasks to projects (max 20 per card). Analyze task titles for named businesses and match existing project names/keywords; never put unrelated businesses into a date-based daily bucket. If no matching project exists, propose a new project named after the explicit subject (e.g. 올드페리도넛 영업자료 → 올드페리도넛). Include the full proposed project record in task.upsert's optional project field (task.projectId must equal project.id), or task.assign's projects array. One approval creates the project and links tasks atomically. Reuse matching existing names. Explain the project name, keywords and provisional due date in the approval card; do not infer business relationships from unrelated keywords. New task.upsert may set autoAssign:true for a clear keyword match, but use false when the user explicitly chooses the project; existing task edits are not automatically reassigned. Times are integer minutes after midnight. Task duration is 5..480, impact/priority 1..5. Notes require an existing project; tasks may include the proposed project in the same approval card. Updates must preserve omitted original facts by reading the full existing record and submitting the full changed record. Never change an existing note without first reading its body. Do not invent completion, review outcomes, deadlines, business facts, source quotes or project mappings. Ask a focused question when missing information affects correctness. A tentative duration or plan is a suggestion and must say so. Energy low/normal/high only. Google writes are primary-calendar events without guests, invitations or notifications. Internal event approval does not by itself write Google. Do not propose duplicate internal and Google blocks for the same time. Never edit google: or approved: event IDs.`;
