import { sql } from 'drizzle-orm';
import {
  bigint,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Bun's native Postgres client expects a raw JS value for a `jsonb` bind
 * parameter, not a pre-serialized string — drizzle's built-in `jsonb()`
 * always calls `JSON.stringify` before handing the value to the driver,
 * which then stores it as a jsonb *string* scalar instead of an object
 * (confirmed via `jsonb_typeof`, which is why `payload->>'key'` queries
 * silently returned nothing). Passing the value through unchanged is the
 * correct behavior for this driver.
 */
function jsonb<T = unknown>(name: string) {
  return customType<{ data: T; driverData: T }>({ dataType: () => 'jsonb' })(name);
}

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

/**
 * Claim lifecycle (plan Section 5.1). The full state vocabulary is declared
 * now even though Phase 3 only drives `DRAFT -> SUBMITTED -> VERIFYING` —
 * later phases extend which transitions are *driven*, not the table of which
 * are *legal* (see `src/domain/claim-state-machine.ts`).
 */
export const claimStatusEnum = pgEnum('claim_status', [
  'DRAFT',
  'SUBMITTED',
  'VERIFYING',
  'NEEDS_USER_INPUT',
  'MANUAL_REVIEW',
  'VERIFIED',
  'READY_FOR_INSURER',
  'INSURER_SUBMITTED',
  'INSURER_REVIEW',
  'DOCUMENTS_REQUESTED',
  'OFFER_RECEIVED',
  'NEGOTIATING',
  'CHALLENGE_PENDING_USER_APPROVAL',
  'CHALLENGED',
  'ESCALATION_PENDING_APPROVAL',
  'ESCALATION_FILED',
  'ESCALATION_IN_PROGRESS',
  'ESCALATION_RESOLVED',
  'SETTLED',
  'REJECTED',
  'CLOSED',
]);

export const incidentTypeEnum = pgEnum('incident_type', [
  'flood',
  'cyclone',
  'fire',
  'earthquake',
  'other',
]);

export const claims = pgTable(
  'claims',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull(),
    policyId: uuid('policy_id').notNull(),
    incidentType: incidentTypeEnum('incident_type').notNull(),
    incidentAt: timestamp('incident_at', { withTimezone: true }),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    country: text('country').notNull().default('IN'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    description: text('description'),
    status: claimStatusEnum('status').notNull().default('DRAFT'),
    // Money is integer paise everywhere, never a float or NUMERIC
    // (CLAUDE.md invariant 1).
    claimedAmountPaise: bigint('claimed_amount_paise', { mode: 'number' }),
    estimatedEntitlementPaise: bigint('estimated_entitlement_paise', { mode: 'number' }),
    // Negotiation fields (Phase 6/7) — created with the table since the
    // table is being defined now, left unused until negotiation lands.
    settlementOfferedPaise: bigint('settlement_offered_paise', { mode: 'number' }),
    firstOfferPaise: bigint('first_offer_paise', { mode: 'number' }),
    bestOfferPaise: bigint('best_offer_paise', { mode: 'number' }),
    settlementFinalPaise: bigint('settlement_final_paise', { mode: 'number' }),
    negotiationRoundsUsed: integer('negotiation_rounds_used').notNull().default(0),
    currency: text('currency').notNull().default('INR'),
    // Optimistic locking for concurrent updates to the same claim.
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('claims_user_id_idx').on(table.userId),
    index('claims_status_idx').on(table.status),
  ],
);

export type Claim = typeof claims.$inferSelect;
export type NewClaim = typeof claims.$inferInsert;

export const coverageStatusEnum = pgEnum('coverage_status', [
  'unknown',
  'covered',
  'excluded',
  'partial',
]);

export const claimItems = pgTable(
  'claim_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    claimId: uuid('claim_id').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    quantity: integer('quantity').notNull().default(1),
    claimedValuePaise: bigint('claimed_value_paise', { mode: 'number' }).notNull(),
    estimatedValuePaise: bigint('estimated_value_paise', { mode: 'number' }),
    coverageStatus: coverageStatusEnum('coverage_status').notNull().default('unknown'),
    coverageReason: text('coverage_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('claim_items_claim_id_idx').on(table.claimId)],
);

export type ClaimItem = typeof claimItems.$inferSelect;
export type NewClaimItem = typeof claimItems.$inferInsert;

/** Links an evidence-service document to a claim (external reference, no FK). */
export const claimEvidenceLinks = pgTable(
  'claim_evidence_links',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    claimId: uuid('claim_id').notNull(),
    evidenceDocumentId: uuid('evidence_document_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('claim_evidence_links_claim_id_idx').on(table.claimId),
    unique('claim_evidence_links_claim_document_unique').on(
      table.claimId,
      table.evidenceDocumentId,
    ),
  ],
);

export type ClaimEvidenceLink = typeof claimEvidenceLinks.$inferSelect;
export type NewClaimEvidenceLink = typeof claimEvidenceLinks.$inferInsert;

export const claimActorTypeEnum = pgEnum('claim_actor_type', [
  'user',
  'admin',
  'system',
  'agent',
  'insurer',
]);

/**
 * Append-only audit log — every state transition and admin/system decision
 * writes a row here, and nothing ever updates or deletes one (plan Section
 * 5, "every transition creates an immutable event").
 */
export const claimEvents = pgTable(
  'claim_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    claimId: uuid('claim_id').notNull(),
    type: text('type').notNull(),
    actorType: claimActorTypeEnum('actor_type').notNull(),
    actorId: uuid('actor_id'),
    payload: jsonb('payload').notNull().default({}),
    traceId: text('trace_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('claim_events_claim_id_idx').on(table.claimId)],
);

export type ClaimEvent = typeof claimEvents.$inferSelect;
export type NewClaimEvent = typeof claimEvents.$inferInsert;

export const manualReviewStatusEnum = pgEnum('manual_review_status', [
  'open',
  'approved',
  'rejected',
  'resolved',
]);

export const manualReviewTasks = pgTable(
  'manual_review_tasks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    claimId: uuid('claim_id').notNull(),
    reasonCode: text('reason_code').notNull(),
    reasonText: text('reason_text'),
    status: manualReviewStatusEnum('status').notNull().default('open'),
    assignedAdminId: uuid('assigned_admin_id'),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('manual_review_tasks_claim_id_idx').on(table.claimId),
    index('manual_review_tasks_status_idx').on(table.status),
  ],
);

export type ManualReviewTask = typeof manualReviewTasks.$inferSelect;
export type NewManualReviewTask = typeof manualReviewTasks.$inferInsert;

export const outboxStatusEnum = pgEnum('outbox_status', ['pending', 'sent', 'failed']);

/**
 * Transactional outbox for dispatching verification requests (plan Section
 * 2.4 / ADR-0005: no message broker — a background poller uses
 * `FOR UPDATE SKIP LOCKED` against this table instead). The row is inserted
 * in the same transaction as the claim's `SUBMITTED`/`VERIFYING` transition,
 * so a claim can never end up `VERIFYING` with no dispatch queued.
 */
export const verificationDispatchOutbox = pgTable(
  'verification_dispatch_outbox',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    claimId: uuid('claim_id').notNull(),
    payload: jsonb('payload').notNull(),
    status: outboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('verification_dispatch_outbox_status_idx').on(table.status, table.nextAttemptAt),
  ],
);

export type VerificationDispatchOutboxRow = typeof verificationDispatchOutbox.$inferSelect;
export type NewVerificationDispatchOutboxRow = typeof verificationDispatchOutbox.$inferInsert;

/**
 * Transactional outbox for dispatching agent-service runs (plan Section 18
 * P5, completing Phase 4's deliberately-deferred hook) — identical shape
 * and dispatch discipline to `verificationDispatchOutbox`. Inserted in the
 * same transaction as the `MANUAL_REVIEW -> VERIFIED` transition, so a
 * claim can never reach `VERIFIED` without an agent run queued.
 */
export const agentDispatchOutbox = pgTable(
  'agent_dispatch_outbox',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    claimId: uuid('claim_id').notNull(),
    payload: jsonb('payload').notNull(),
    status: outboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('agent_dispatch_outbox_status_idx').on(table.status, table.nextAttemptAt)],
);

export type AgentDispatchOutboxRow = typeof agentDispatchOutbox.$inferSelect;
export type NewAgentDispatchOutboxRow = typeof agentDispatchOutbox.$inferInsert;

/**
 * Idempotency ledger for mutating endpoints that take an `Idempotency-Key`
 * header (plan conventions, Section 4). The literal Phase 3 gate — a
 * duplicate submit with the same key does no new work — is enforced here.
 */
export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),
  claimId: uuid('claim_id').notNull(),
  responseBody: jsonb('response_body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKeyRow = typeof idempotencyKeys.$inferInsert;
