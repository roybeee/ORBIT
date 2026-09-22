import {sql} from 'drizzle-orm';
import {sqliteTable,text,integer,primaryKey,index,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const slackCredentials=sqliteTable('orbit_slack_credentials',{
 tokenHash:text('token_hash').primaryKey(),ownerId:text('owner_id').notNull(),workspaceId:text('workspace_id').notNull(),requesterId:text('requester_id').notNull(),scope:text('scope').notNull(),expiresAt:integer('expires_at').notNull(),revoked:integer('revoked').notNull().default(0),
});
export const slackDirectives=sqliteTable('orbit_slack_directives',{
 ownerId:text('owner_id').notNull(),workspaceId:text('workspace_id').notNull(),requesterId:text('requester_id').notNull(),operationKey:text('operation_key').notNull(),id:text('id').notNull(),payloadHash:text('payload_hash').notNull(),payloadJson:text('payload_json').notNull(),status:text('status').notNull(),targetId:text('target_id'),candidatesJson:text('candidates_json').notNull(),createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.workspaceId,t.requesterId,t.operationKey]}),uniqueIndex('idx_slack_receipt_id').on(t.id)]);
export const plaudSync=sqliteTable('orbit_plaud_sync',{
 ownerId:text('owner_id').primaryKey(),stateJson:text('state_json').notNull(),leaseUntil:integer('lease_until').notNull().default(0),
});
export const plaudImports=sqliteTable('orbit_plaud_imports',{
 ownerId:text('owner_id').notNull(),externalId:text('external_id').notNull(),hash:text('hash').notNull(),stateJson:text('state_json').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.externalId]})]);
export const answerFeedback=sqliteTable('orbit_answer_feedback',{
 ownerId:text('owner_id').notNull(),turnId:text('turn_id').notNull(),kind:text('kind').notNull(),text:text('text').notNull(),question:text('question').notNull(),projectId:text('project_id'),sourcesJson:text('sources_json').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.turnId]}),index('idx_orbit_feedback_recent').on(t.ownerId,t.updatedAt)]);
// Discord is a transport for the same owner, never an independent workspace.
export const discordState=sqliteTable('orbit_discord_state',{
 ownerId:text('owner_id').primaryKey(),stateJson:text('state_json').notNull(),leaseUntil:integer('lease_until').notNull().default(0),
});
export const discordCommands=sqliteTable('orbit_discord_commands',{
 ownerId:text('owner_id').notNull(),messageId:text('message_id').notNull(),commandJson:text('command_json').notNull(),status:text('status').notNull(),response:text('response').notNull().default(''),createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.messageId]})]);
export const discordOutbox=sqliteTable('orbit_discord_outbox',{
 ownerId:text('owner_id').notNull(),id:text('id').notNull(),channelId:text('channel_id').notNull(),content:text('content').notNull(),status:text('status').notNull().default('pending'),messageId:text('message_id'),attempts:integer('attempts').notNull().default(0),nextAt:integer('next_at').notNull().default(0),createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.id]}),index('idx_orbit_discord_pending').on(t.ownerId,t.status,t.nextAt)]);
// Deleted user records remain owner-scoped and recoverable without exposing credentials.
export const dataTrash=sqliteTable('orbit_data_trash',{
 ownerId:text('owner_id').notNull(),id:text('id').notNull(),category:text('category').notNull(),recordId:text('record_id').notNull(),title:text('title').notNull(),payloadJson:text('payload_json').notNull(),deletedAt:text('deleted_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.id]}),uniqueIndex('idx_orbit_trash_record').on(t.ownerId,t.category,t.recordId),index('idx_orbit_trash_recent').on(t.ownerId,t.deletedAt,t.id)]);
// Bind legacy SIWC email claims only after observing the same verified stable ID.
// A conflicting stable identity permanently disables email-only recovery.
export const identityLinks=sqliteTable('orbit_identity_links',{
 emailHash:text('email_hash').primaryKey(),
 ownerId:text('owner_id').notNull(),
 conflicted:integer('conflicted').notNull().default(0),
});
// Revision header and bounded content chunks commit in the same transaction.
// Schema-only migrations; no user records or demo data are seeded here.
export const workspaces=sqliteTable('orbit_workspaces',{
 ownerId:text('owner_id').primaryKey(),
 revision:integer('revision').notNull(),
 stateJson:text('state_json').notNull(),
 mutationId:text('mutation_id').notNull(),
 updatedAt:text('updated_at').notNull(),
});
export const workspaceChunks=sqliteTable('orbit_workspace_chunks',{
 ownerId:text('owner_id').notNull(),generation:text('generation').notNull(),part:integer('part').notNull(),content:text('content').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.part]})]);
export const workspaceProjects=sqliteTable('orbit_workspace_projects',{
 ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.projectId]})]);
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
 attachmentIds:text('attachment_ids').notNull().default('[]'),
 status:text('status').notNull(),responseJson:text('response_json').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.id]}),index('idx_orbit_turn_owner_created').on(table.ownerId,table.createdAt),index('idx_orbit_turn_conversation_created').on(table.ownerId,table.conversationId,table.createdAt,table.id),uniqueIndex('idx_orbit_one_running_turn_per_conversation').on(table.ownerId,table.conversationId).where(sql`${table.status} = 'running'`)]);
export const agentActions=sqliteTable('orbit_agent_actions',{
 guardJson:text('guard_json').notNull().default('{}'),
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


export const attachments=sqliteTable('orbit_attachments',{
 ownerId:text('owner_id').notNull(),id:text('id').notNull(),name:text('name').notNull(),mime:text('mime').notNull(),size:integer('size').notNull(),
 prepared:integer('prepared').notNull().default(0),state:text('state').notNull().default('pending'),objectKey:text('object_key'),lease:text('lease'),leaseUntil:integer('lease_until').notNull().default(0),
 previewKey:text('preview_key'),contextText:text('context_text').notNull().default(''),contextLabel:text('context_label').notNull().default('원본 파일'),
 targetType:text('target_type'),targetId:text('target_id'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.id]}),index('idx_orbit_attachment_target').on(table.ownerId,table.targetType,table.targetId),index('idx_orbit_attachment_recent').on(table.ownerId,table.createdAt,table.id)]);
// Evening PAFI review details (items, feedback, energy, small wins) live outside the aggregate.
export const reviews=sqliteTable('orbit_reviews',{
 ownerId:text('owner_id').notNull(),date:text('date').notNull(),reviewJson:text('review_json').notNull(),updatedAt:text('updated_at').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.date]})]);
// Owner-scoped lease and receipt for external Hermes schedules (not the chat run queue).
export const chiefJobs=sqliteTable('orbit_chief_jobs',{
 ownerId:text('owner_id').primaryKey(),
 leaseUntil:integer('lease_until').notNull().default(0),
 configJson:text('config_json').notNull().default('{}'),
});

// Orders are independent of chat turns; owner/connection/run identities never come from a model.
export const agentOrders=sqliteTable('orbit_agent_orders',{
 ownerId:text('owner_id').notNull(),id:text('id').notNull(),
 connectionId:text('connection_id').notNull(),requestJson:text('request_json').notNull(),
 stateJson:text('state_json').notNull(),leaseUntil:integer('lease_until').notNull().default(0),
 stopRequested:integer('stop_requested').notNull().default(0),
 createdAt:text('created_at').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.id]}),index('idx_orbit_orders_recent').on(table.ownerId,table.createdAt,table.id)]);

// Raw read responses stay in private R2; D1 tracks delivery and source receipts.
export const orderReads=sqliteTable('orbit_order_reads',{
 ownerId:text('owner_id').notNull(),orderId:text('order_id').notNull(),id:text('id').notNull(),
 tool:text('tool').notNull(),argsJson:text('args_json').notNull(),objectKey:text('object_key').notNull(),
 chars:integer('chars').notNull(),readUntil:integer('read_until').notNull().default(0),
 error:text('error').notNull().default(''),createdAt:text('created_at').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.orderId,table.id]})]);

// Sound sessions and routines are separate from task completion and workspace revisions.
export const soundState=sqliteTable('orbit_sound_state',{
 ownerId:text('owner_id').primaryKey(),revision:integer('revision').notNull(),
 stateJson:text('state_json').notNull(),updatedAt:text('updated_at').notNull(),
});

// A claimed job stays bound to its original PC/run; disconnects never requeue it.
export const asideJobs=sqliteTable('orbit_aside_jobs',{
 ownerId:text('owner_id').notNull(),id:text('id').notNull(),status:text('status').notNull(),
 jobJson:text('job_json').notNull(),version:integer('version').notNull().default(0),createdAt:text('created_at').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.id]}),index('idx_orbit_aside_recent').on(table.ownerId,table.createdAt),uniqueIndex('idx_orbit_aside_active').on(table.ownerId).where(sql`${table.status} IN ('running','stop_requested','needs_attention')`)]);

export const automationConnections=sqliteTable('orbit_automation_connections',{
 ownerId:text('owner_id').primaryKey(),secretJson:text('secret_json').notNull(),updatedAt:text('updated_at').notNull(),
});

// Collection receipts survive OAuth refreshes; connection credentials are not freshness proof.
export const sourceStatus=sqliteTable('orbit_source_status',{
 ownerId:text('owner_id').notNull(),provider:text('provider').notNull(),stateJson:text('state_json').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.provider]})]);
export const calendarSettings=sqliteTable('orbit_calendar_settings',{
 ownerId:text('owner_id').primaryKey(),selectedJson:text('selected_json').notNull(),updatedAt:text('updated_at').notNull(),
});
export const calendarExports=sqliteTable('orbit_calendar_exports',{
 ownerId:text('owner_id').notNull(),eventId:text('event_id').notNull(),stateJson:text('state_json').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.eventId]})]);
export const dailyRuntime=sqliteTable('orbit_daily_runtime',{
 ownerId:text('owner_id').primaryKey(),configJson:text('config_json').notNull(),leaseUntil:integer('lease_until').notNull().default(0),lastTick:text('last_tick'),
});
export const dailyRuns=sqliteTable('orbit_daily_runs',{
 ownerId:text('owner_id').notNull(),date:text('date').notNull(),stateJson:text('state_json').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.date]})]);
export const orderReviews=sqliteTable('orbit_order_reviews',{
 ownerId:text('owner_id').notNull(),orderId:text('order_id').notNull(),reviewJson:text('review_json').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.orderId]})]);

export const activitySync=sqliteTable('orbit_activity_sync',{
 ownerId:text('owner_id').primaryKey(),stateJson:text('state_json').notNull(),leaseUntil:integer('lease_until').notNull().default(0),
});
export const activitySessions=sqliteTable('orbit_activity_sessions',{
 ownerId:text('owner_id').notNull(),id:text('id').notNull(),connectionId:text('connection_id').notNull(),sessionId:text('session_id').notNull(),source:text('source').notNull(),title:text('title').notNull(),projectId:text('project_id'),category:text('category').notNull(),manual:integer('manual').notNull().default(0),summary:text('summary').notNull(),metadataJson:text('metadata_json').notNull(),messageOffset:integer('message_offset').notNull().default(0),signature:text('signature').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.id]}),index('idx_orbit_activity_recent').on(t.ownerId,t.updatedAt,t.id),index('idx_orbit_activity_project').on(t.ownerId,t.projectId,t.updatedAt)]);
export const activityMessages=sqliteTable('orbit_activity_messages',{
 ownerId:text('owner_id').notNull(),connectionId:text('connection_id').notNull(),sessionId:text('session_id').notNull(),id:text('id').notNull(),recordId:text('record_id').notNull(),role:text('role').notNull(),content:text('content').notNull(),toolName:text('tool_name').notNull(),toolCalls:text('tool_calls').notNull(),timestamp:text('timestamp').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.connectionId,t.sessionId,t.id]}),index('idx_orbit_activity_messages_record').on(t.ownerId,t.recordId,t.timestamp)]);

// Bounded durable analysis parts; total input is not stored in one job row.
export const briefParts=sqliteTable('orbit_brief_parts',{
 ownerId:text('owner_id').notNull(),turnId:text('turn_id').notNull(),generation:text('generation').notNull(),
 stage:integer('stage').notNull(),part:integer('part').notNull(),content:text('content').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.turnId,table.generation,table.stage,table.part]})]);

export const calendarEdits=sqliteTable('orbit_calendar_edits',{
 ownerId:text('owner_id').notNull(),operationId:text('operation_id').notNull(),payloadJson:text('payload_json').notNull(),sourceCalendarId:text('source_calendar_id').notNull(),resultJson:text('result_json').notNull().default('{}'),leaseUntil:integer('lease_until').notNull().default(0),
},t=>[primaryKey({columns:[t.ownerId,t.operationId]})]);

export const meetingReviews=sqliteTable('orbit_meeting_reviews',{
 summary:text('summary').notNull().default(''),engineVersion:integer('engine_version').notNull().default(1),attempts:integer('attempts').notNull().default(0),
 ownerId:text('owner_id').notNull(),noteId:text('note_id').notNull(),revision:integer('revision').notNull(),turnId:text('turn_id').notNull(),conversationId:text('conversation_id').notNull(),status:text('status').notNull(),error:text('error').notNull().default(''),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.noteId,t.revision]}),index('idx_orbit_meeting_review_queue').on(t.ownerId,t.status,t.createdAt),uniqueIndex('idx_orbit_meeting_review_turn').on(t.ownerId,t.turnId)]);

export const notifications=sqliteTable('orbit_notifications',{
 ownerId:text('owner_id').notNull(),id:text('id').notNull(),kind:text('kind').notNull(),title:text('title').notNull(),body:text('body').notNull(),href:text('href').notNull(),createdAt:text('created_at').notNull(),readAt:text('read_at'),dismissedAt:text('dismissed_at'),
},t=>[primaryKey({columns:[t.ownerId,t.id]}),index('idx_orbit_notifications_recent').on(t.ownerId,t.createdAt),index('idx_orbit_notifications_unread').on(t.ownerId,t.readAt)]);
export const notificationState=sqliteTable('orbit_notification_state',{
 ownerId:text('owner_id').primaryKey(),startedAt:text('started_at').notNull(),publicKey:text('public_key').notNull().default(''),privateKey:text('private_key').notNull().default(''),
});
export const pushSubscriptions=sqliteTable('orbit_push_subscriptions',{
 ownerId:text('owner_id').notNull(),id:text('id').notNull(),subscriptionJson:text('subscription_json').notNull(),createdAt:text('created_at').notNull(),lastError:text('last_error').notNull().default(''),
},t=>[primaryKey({columns:[t.ownerId,t.id]})]);
export const pushDeliveries=sqliteTable('orbit_push_deliveries',{
 ownerId:text('owner_id').notNull(),notificationId:text('notification_id').notNull(),subscriptionId:text('subscription_id').notNull(),status:text('status').notNull().default('queued'),attempts:integer('attempts').notNull().default(0),nextAt:integer('next_at').notNull().default(0),leaseUntil:integer('lease_until').notNull().default(0),error:text('error').notNull().default(''),
},t=>[primaryKey({columns:[t.ownerId,t.notificationId,t.subscriptionId]}),index('idx_orbit_push_queue').on(t.ownerId,t.status,t.nextAt)]);
// Cross-run analysis reuse: content-addressed per owner. Derived data; regenerable, never backed up.
export const analysisCache=sqliteTable('orbit_analysis_cache',{
 ownerId:text('owner_id').notNull(),cacheKey:text('cache_key').notNull(),version:text('version').notNull(),stage:text('stage').notNull(),unit:text('unit').notNull(),content:text('content').notNull(),createdAt:text('created_at').notNull(),lastUsedAt:text('last_used_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.cacheKey]}),index('idx_orbit_analysis_cache_used').on(t.ownerId,t.lastUsedAt)]);
// One row per planning turn: when records were read (basis), when the plan became ready, reuse counts, leaf manifest.
export const briefRuns=sqliteTable('orbit_brief_runs',{
 ownerId:text('owner_id').notNull(),turnId:text('turn_id').notNull(),date:text('date').notNull(),startedAt:text('started_at').notNull(),basisAt:text('basis_at').notNull(),readyAt:text('ready_at'),sourceRevision:integer('source_revision').notNull().default(0),metricsJson:text('metrics_json').notNull().default('{}'),manifestJson:text('manifest_json').notNull().default(''),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.turnId]}),index('idx_orbit_brief_runs_date').on(t.ownerId,t.date,t.startedAt)]);
