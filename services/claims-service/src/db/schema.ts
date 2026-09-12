import { sql } from 'drizzle-orm';
import { date, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const policyStatusEnum = pgEnum('policy_status', ['active', 'expired', 'unknown']);

/**
 * `evidenceDocumentId` is an external reference to evidence-service's
 * `documents.id` — never a foreign key, since services never share a
 * database (CLAUDE.md invariant 2). Ownership of the referenced document is
 * checked once, at creation time, by calling evidence-service's own API.
 */
export const policies = pgTable(
  'policies',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull(),
    evidenceDocumentId: uuid('evidence_document_id').notNull(),
    insurerName: text('insurer_name').notNull(),
    policyNumberMasked: text('policy_number_masked').notNull(),
    policyType: text('policy_type').notNull(),
    coverageStart: date('coverage_start'),
    coverageEnd: date('coverage_end'),
    currency: text('currency').notNull().default('INR'),
    status: policyStatusEnum('status').notNull().default('unknown'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('policies_user_id_idx').on(table.userId)],
);

export type Policy = typeof policies.$inferSelect;
export type NewPolicy = typeof policies.$inferInsert;
