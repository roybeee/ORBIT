import {z} from 'zod';

// Sent only by an authenticated user's decision, never by an agent proposal.
export const overlapDetailsSchema=z.object({
 overlapConfirmation:z.string().regex(/^[a-f0-9]{64}$/),
 conflicts:z.array(z.object({title:z.string(),date:z.string(),start:z.number(),end:z.number()})).max(20),
 total:z.number().int().positive(),
});
export type OverlapDetails=z.infer<typeof overlapDetailsSchema>;
export class AgentRequestError extends Error {
 code:string;details?:OverlapDetails;
 constructor(message:string,code='UNAVAILABLE',details?:unknown){
  super(message);this.code=code;
  const parsed=overlapDetailsSchema.safeParse(details);if(parsed.success)this.details=parsed.data;
 }
}
