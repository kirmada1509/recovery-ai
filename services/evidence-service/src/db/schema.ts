import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  bigint,
  doublePrecision,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Bun's native Postgres client expects a raw JS value for a `jsonb` bind
 * parameter, not a pre-serialized string — drizzle's built-in `jsonb()`
 * always calls `JSON.stringify` before handing the value to the driver,
 * which then stores it as a jsonb *string* scalar instead of an object.
 * Passing the value through unchanged is correct for this driver. See the
 * identical note in claims-service/src/db/schema.ts.
 */
function jsonb<T = unknown>(name: string) {
  return customType<{ data: T; driverData: T }>({ dataType: () => 'jsonb' })(name);
}

export const documentTypeEnum = pgEnum('document_type', [
  'policy',
  'damage_photo',
  'receipt',
  'ownership_proof',
  'other',
]);
export const uploadStatusEnum = pgEnum('upload_status', [
  'pending',
  'uploaded',
  'quarantined',
  'ready',
  'deleted',
]);
export const documentSourceEnum = pgEnum('document_source', ['user', 'admin', 'insurer', 'system']);

/**
 * Storage keys are random UUIDs, never the original filename — a filename
 * never becomes a path (plan Section 14.4). `storageBucket`/`storageKey` are
 * never returned to a browser client directly; only short-lived signed URLs
 * are (plan Section 6.4).
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerUserId: uuid('owner_user_id').notNull(),
    claimId: uuid('claim_id'),
    policyId: uuid('policy_id'),
    documentType: documentTypeEnum('document_type').notNull(),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    sha256: text('sha256'),
    storageBucket: text('storage_bucket').notNull(),
    storageKey: text('storage_key').notNull(),
    uploadStatus: uploadStatusEnum('upload_status').notNull().default('pending'),
    source: documentSourceEnum('source').notNull().default('user'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('documents_owner_user_id_idx').on(table.ownerUserId),
    index('documents_claim_id_idx').on(table.claimId),
  ],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

export const documentMetadata = pgTable('document_metadata', {
  documentId: uuid('document_id').primaryKey(),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  gpsLat: doublePrecision('gps_lat'),
  gpsLng: doublePrecision('gps_lng'),
  pageCount: integer('page_count'),
  metadata: jsonb('metadata').notNull().default({}),
});

export type DocumentMetadataRow = typeof documentMetadata.$inferSelect;
export type NewDocumentMetadataRow = typeof documentMetadata.$inferInsert;
