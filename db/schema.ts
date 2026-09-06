import {sql} from 'drizzle-orm';
import {sqliteTable,text,integer,primaryKey,index,uniqueIndex} from 'drizzle-orm/sqlite-core';
// Bind legacy SIWC email claims only after observing the same verified stable ID.
// A conflicting stable identity permanently disables email-only recovery.
export const identityLinks=sqliteTable('orbit_identity_links',{
 emailHash:text('email_hash').primaryKey(),
 ownerId:text('owner_id').notNull(),
 conflicted:integer('conflicted').notNull().default(0),
});
// One owner-scoped aggregate keeps task/proposal/calendar transitions atomic.
// Schema-only migrations; no user records or demo data are seeded here.
export const workspaces=sqliteTable('orbit_workspaces',{
 ownerId:text('owner_id').primaryKey(),
 revision:integer('revision').notNull(),
 stateJson:text('state_json').notNull(),
 mutationId:text('mutation_id').notNull(),
 updatedAt:text('updated_at').notNull(),
});
export const mutations=sqliteTable('orbit_mutations',{
 ownerId:text('owner_id').notNull(),
 operationId:text('operation_id').notNull(),
 actionHash:text('action_hash').notNull(),
 revision:integer('revision').notNull(),
 createdAt:text('created_at').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.operationId]})]);
// Immutable document versions; the workspace keeps only their metadata/pointers.
export const noteRevisions=sqliteTable('orbit_note_revisions',{
 ownerId:text('owner_id').notNull(),
 noteId:text('note_id').notNull(),
 revision:integer('revision').notNull(),
 title:text('title').notNull(),
 noteJson:text('note_json').notNull(),
 updatedAt:text('updated_at').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.noteId,table.revision]})]);
// Conversations, reviewable actions and encrypted connector credentials are owner-scoped.
export const agentTurns=sqliteTable('orbit_agent_turns',{
 conversationId:text('conversation_id').notNull().default('legacy'),
 ownerId:text('owner_id').notNull(),id:text('id').notNull(),input:text('input').notNull(),
 status:text('status').notNull(),responseJson:text('response_json').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.id]}),index('idx_orbit_turn_owner_created').on(table.ownerId,table.createdAt),index('idx_orbit_turn_conversation_created').on(table.ownerId,table.conversationId,table.createdAt,table.id),uniqueIndex('idx_orbit_one_running_turn').on(table.ownerId).where(sql`${table.status} = 'running'`)]);
export const agentActions=sqliteTable('orbit_agent_actions',{
 ownerId:text('owner_id').notNull(),id:text('id').notNull(),turnId:text('turn_id').notNull(),
 title:text('title').notNull(),reason:text('reason').notNull(),actionJson:text('action_json').notNull(),expectedRevision:integer('expected_revision').notNull(),
 state:text('state').notNull(),note:text('note').notNull(),revisitDate:text('revisit_date'),resultJson:text('result_json').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.id]}),index('idx_orbit_action_owner_state').on(table.ownerId,table.state),uniqueIndex('idx_orbit_one_applying_action').on(table.ownerId).where(sql`${table.state} = 'applying'`)]);
export const integrations=sqliteTable('orbit_integrations',{
 refreshUntil:integer('refresh_until').notNull().default(0),
 ownerId:text('owner_id').notNull(),provider:text('provider').notNull(),secretJson:text('secret_json').notNull(),publicJson:text('public_json').notNull(),updatedAt:text('updated_at').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.provider]})]);
export const oauthStates=sqliteTable('orbit_oauth_states',{
 state:text('state').primaryKey(),ownerId:text('owner_id').notNull(),provider:text('provider').notNull(),secretJson:text('secret_json').notNull(),expiresAt:text('expires_at').notNull(),
});
export const calendarCache=sqliteTable('orbit_calendar_cache',{
 ownerId:text('owner_id').primaryKey(),eventsJson:text('events_json').notNull(),timeZone:text('time_zone').notNull(),rangeStart:text('range_start').notNull(),rangeEnd:text('range_end').notNull(),updatedAt:text('updated_at').notNull(),
});
// Durable native Hermes runs: reconnecting a phone resumes the same run.
export const hermesJobs=sqliteTable('orbit_hermes_jobs',{
 ownerId:text('owner_id').notNull(),turnId:text('turn_id').notNull(),turnLease:text('turn_lease').notNull(),
 jobJson:text('job_json').notNull(),leaseUntil:integer('lease_until').notNull().default(0),cancelRequested:integer('cancel_requested').notNull().default(0),
},table=>[primaryKey({columns:[table.ownerId,table.turnId]})]);

export const conversations=sqliteTable('orbit_conversations',{
 ownerId:text('owner_id').notNull(),id:text('id').notNull(),title:text('title').notNull(),
 projectId:text('project_id'),revision:integer('revision').notNull().default(0),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.id]}),index('idx_orbit_conversation_recent').on(table.ownerId,table.updatedAt,table.id),index('idx_orbit_conversation_project').on(table.ownerId,table.projectId,table.updatedAt,table.id)]);
