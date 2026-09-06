import {sqliteTable,text,integer,primaryKey} from 'drizzle-orm/sqlite-core';
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
