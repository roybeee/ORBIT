import { z } from 'zod';
import type { DailyBrief } from './brief/schema';
import { validDate } from './dates.ts';
const attachmentIds = z
  .array(z.string().uuid())
  .max(8)
  .refine((ids) => new Set(ids).size === ids.length);
const id = z.string().min(1).max(100);
export const dateSchema = z.string().refine(validDate, '유효한 날짜를 입력해 주세요.');
const title = z.string().trim().min(1, '제목을 입력해 주세요.').max(160);
const minute = z.number().int().min(0).max(1439);
const quadrant = z.enum(['A', 'B', 'C', 'D']);
const cognition = z.enum(['high', 'mid', 'low', 'external']);
const outcome = z.enum(['done', 'partial', 'skipped']);
const outcomeReason = z.enum(['time', 'waiting', 'priority', 'scope', 'energy', 'other']);
const improvementKind = z.enum(['buffer', 'placement', 'estimate', 'habit', 'decline', 'other']);
export const projectSchema = z
  .object({
    id,
    name: title,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    symbol: z.string().min(1).max(3),
    goal: z.string().max(4000),
    due: dateSchema,
    priority: z.number().int().min(1).max(5),
    goalId: id.optional(),
  })
  .strict();
export const taskSchema = z
  .object({
    id,
    title,
    projectId: id,
    status: z.enum(['todo', 'doing', 'waiting', 'done']),
    duration: z.number().int().min(5).max(480),
    due: dateSchema,
    impact: z.number().int().min(1).max(5),
    focus: z.boolean(),
    focusDate: dateSchema.optional(),
    definition: z.string().max(4000),
    noteId: id.optional(),
    noteCitation: z
      .object({
        revision: z.number().int().positive(),
        line: z.number().int().positive(),
        quote: z.string().max(2000),
      })
      .strict()
      .optional(),
    blocker: z.string().max(2000).optional(),
    checkDate: dateSchema.optional(),
    completedOn: dateSchema.optional(),
    dependsOn: z.array(id).max(30).optional(),
    result: z.string().max(4000).optional(),
    planHoldUntil: dateSchema.optional(),
    planHoldReason: z.string().max(2000).optional(),
    planHoldProposalId: id.optional(),
    quadrant: quadrant.optional(),
    cognition: cognition.optional(),
    must: z.boolean().optional(),
    unplanned: z.boolean().optional(),
    actualMinutes: z.number().int().min(0).max(1440).optional(),
    outcome: outcome.optional(),
    outcomeReason: outcomeReason.optional(),
    startedAt: z.string().datetime().optional(),
    laserDate: dateSchema.optional(),
  })
  .strict();
export const goalSchema = z
  .object({
    id,
    kind: z.enum(['life', 'mid', 'short', 'concept']),
    sentence: z.string().trim().min(1, '목표 문장을 입력해 주세요.').max(160),
    metric: z.string().max(120).optional(),
    deadline: dateSchema.optional(),
    parentId: id.optional(),
  })
  .strict();
export const improvementSchema = z
  .object({
    id,
    rule: z.string().trim().min(1, '규칙을 입력해 주세요.').max(200),
    kind: improvementKind,
    createdOn: dateSchema,
    active: z.boolean(),
    source: z.string().max(60).optional(),
  })
  .strict();
export const habitSchema = z
  .object({
    id,
    title: z.string().trim().min(1, '습관을 입력해 주세요.').max(80),
    mode: z.enum(['keep', 'quit']),
    startedOn: dateSchema,
    log: z.array(dateSchema).max(400),
  })
  .strict();
export const riskSchema = z
  .object({
    id,
    title: z.string().trim().min(1, '리스크를 입력해 주세요.').max(160),
    checkDate: dateSchema,
    condition: z.string().max(300),
    projectId: id.optional(),
  })
  .strict();
export const noteSchema = z
  .object({
    id,
    title,
    kind: z.enum(['meeting', 'wiki', 'knowledge']),
    projectId: id,
    summary: z.string().max(500),
    body: z.string().max(100000),
    tags: z.array(z.string().max(40)).max(20),
    updated: dateSchema,
  })
  .strict();
export const eventSchema = z
  .object({
    id,
    title,
    date: dateSchema,
    start: minute,
    end: z.number().int().min(1).max(1440),
    kind: z.enum(['meeting', 'focus', 'break']),
    projectId: id.optional(),
    taskId: id.optional(),
  })
  .strict()
  .refine((e) => e.end > e.start, '종료 시간은 시작 시간보다 늦어야 합니다.');
const rhythmSchema = z
  .object({ peakStart: minute, peakEnd: minute, lunchStart: minute, lunchEnd: minute })
  .strict()
  .refine((r) => r.peakEnd > r.peakStart && r.lunchEnd >= r.lunchStart, '리듬 구간을 확인해 주세요.');
export const preferencesSchema = z
  .object({
    timeZone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat('ko', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, '시간대를 확인해 주세요.'),
    workStart: minute,
    workEnd: z.number().int().min(1).max(1440),
    workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    focusLimit: z.number().int().min(1).max(5),
    breakMinutes: z.number().int().min(0).max(60),
    bufferFraction: z.number().min(0.1).max(0.5),
    rhythm: rhythmSchema.optional(),
    laserMinutes: z.number().int().min(60).max(360).optional(),
    travelMinutes: z.number().int().min(0).max(120).optional(),
    colorBy: z.enum(['project', 'cognition']).optional(),
  })
  .strict()
  .refine((p) => p.workEnd > p.workStart, '업무 종료 시간은 시작 시간 이후여야 합니다.');
const energy = z.enum(['low', 'normal', 'high']);
const review = z
  .object({ date: dateSchema, win: z.string().max(6000), block: z.string().max(6000), energy })
  .strict();
export const reviewDetailSchema = z
  .object({
    date: dateSchema,
    items: z
      .array(
        z
          .object({
            taskId: id,
            title: z.string().max(160),
            outcome,
            estimateMinutes: z.number().int().min(0).max(1440),
            actualMinutes: z.number().int().min(0).max(1440).optional(),
            reason: outcomeReason.optional(),
          })
          .strict(),
      )
      .max(12),
    feedback: z
      .array(
        z
          .object({
            taskId: id.optional(),
            cause: z.string().max(200),
            alternative: z.string().max(200),
            rule: z.string().max(200),
            kind: improvementKind.optional(),
          })
          .strict(),
      )
      .max(5),
    energy: z
      .object({
        sleepMinutes: z.number().int().min(0).max(1440).optional(),
        exercise: z.string().max(120).optional(),
        meals: z.string().max(200).optional(),
        mood: z.string().max(200).optional(),
      })
      .strict(),
    smallWins: z.array(z.string().max(60)).max(5),
    gratitude: z.array(z.string().max(60)).max(3),
    habitChecks: z.array(id).max(3),
  })
  .strict();
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project.upsert'), project: projectSchema }).strict(),
  z.object({ type: z.literal('project.delete'), id }).strict(),
  z.object({ type: z.literal('project.domino'), id: id.nullable() }).strict(),
  z.object({ type: z.literal('goal.upsert'), goal: goalSchema }).strict(),
  z.object({ type: z.literal('goal.delete'), id }).strict(),
  z.object({ type: z.literal('task.upsert'), task: taskSchema }).strict(),
  z
    .object({ type: z.literal('task.status'), id, status: z.enum(['todo', 'doing', 'waiting', 'done']) })
    .strict(),
  z.object({ type: z.literal('task.focus'), id, focus: z.boolean() }).strict(),
  z.object({ type: z.literal('task.laser'), id, date: dateSchema, laser: z.boolean() }).strict(),
  z.object({ type: z.literal('task.start'), id }).strict(),
  z.object({ type: z.literal('task.stop'), id }).strict(),
  z
    .object({
      type: z.literal('task.record'),
      id,
      outcome,
      actualMinutes: z.number().int().min(0).max(1440).optional(),
      reason: outcomeReason.optional(),
      rule: z.string().trim().max(200).optional(),
      ruleKind: improvementKind.optional(),
    })
    .strict(),
  z.object({ type: z.literal('task.delete'), id }).strict(),
  z
    .object({
      type: z.literal('note.upsert'),
      note: noteSchema,
      expectedNoteRevision: z.number().int().positive().optional(),
    })
    .strict(),
  z.object({ type: z.literal('note.delete'), id }).strict(),
  z
    .object({
      type: z.literal('note.restore'),
      id,
      revision: z.number().int().positive(),
      expectedNoteRevision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('meeting.acceptActions'),
      noteId: id,
      expectedNoteRevision: z.number().int().positive(),
      items: z
        .array(
          z
            .object({
              id,
              line: z.number().int().positive(),
              title,
              definition: z.string().max(4000),
              due: dateSchema,
              duration: z.number().int().min(5).max(480),
            })
            .strict(),
        )
        .min(1)
        .max(20),
    })
    .strict(),
  z
    .object({ type: z.literal('event.upsert'), event: eventSchema, attachmentIds: attachmentIds.optional() })
    .strict(),
  z.object({ type: z.literal('event.delete'), id }).strict(),
  z.object({ type: z.literal('event.attach'), id, attachmentIds }).strict(),
  z.object({ type: z.literal('review.save'), review, detail: reviewDetailSchema.optional() }).strict(),
  z
    .object({ type: z.literal('review.saveGenerate'), review, detail: reviewDetailSchema.optional() })
    .strict(),
  z.object({ type: z.literal('proposal.generate'), date: dateSchema, energy }).strict(),
  z.object({ type: z.literal('proposal.approve'), date: dateSchema, itemId: id }).strict(),
  z
    .object({
      type: z.literal('proposal.defer'),
      date: dateSchema,
      itemId: id,
      reason: z.string().trim().min(1).max(2000),
      revisitDate: dateSchema,
    })
    .strict(),
  z.object({ type: z.literal('proposal.reconsider'), date: dateSchema, itemId: id }).strict(),
  z.object({ type: z.literal('proposal.revoke'), date: dateSchema, itemId: id }).strict(),
  z.object({ type: z.literal('preferences.update'), preferences: preferencesSchema }).strict(),
  z.object({ type: z.literal('improvement.add'), improvement: improvementSchema }).strict(),
  z.object({ type: z.literal('improvement.retire'), id }).strict(),
  z.object({ type: z.literal('habit.upsert'), habit: habitSchema }).strict(),
  z.object({ type: z.literal('habit.delete'), id }).strict(),
  z.object({ type: z.literal('habit.check'), id, date: dateSchema, checked: z.boolean() }).strict(),
  z.object({ type: z.literal('risk.upsert'), risk: riskSchema }).strict(),
  z.object({ type: z.literal('risk.close'), id }).strict(),
]);
export type WorkspaceAction =
  | z.infer<typeof actionSchema>
  | { type: 'proposal.brief'; brief: DailyBrief; energy: 'low' | 'normal' | 'high' };
export const commandSchema = z
  .object({
    operationId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    action: actionSchema,
  })
  .strict();
