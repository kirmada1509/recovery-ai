import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * `userId` on both tables below is an external reference to auth-service's
 * `users.id` — never a foreign key, since cross-service DB reads (and shared
 * databases) are forbidden (CLAUDE.md invariant 2). Ownership is enforced in
 * the route layer against the caller's access-token subject instead.
 */

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey(),
  phoneE164: text('phone_e164'),
  preferredLocale: text('preferred_locale').notNull().default('en-IN'),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  state: text('state'),
  postalCode: text('postal_code'),
  country: text('country').notNull().default('IN'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

/**
 * A case only exists once KYC has been started, so its status vocabulary is
 * `pending | verified | failed` (plan Section 5.4's `UNVERIFIED` state is the
 * absence of any case, reported by the route layer rather than stored).
 */
export const kycStatusEnum = pgEnum('kyc_status', ['pending', 'verified', 'failed']);
export const kycProviderEnum = pgEnum('kyc_provider', ['mock']);

export const kycCases = pgTable(
  'kyc_cases',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull(),
    provider: kycProviderEnum('provider').notNull(),
    providerReference: text('provider_reference'),
    status: kycStatusEnum('status').notNull().default('pending'),
    verifiedName: text('verified_name'),
    maskedIdentifier: text('masked_identifier'),
    failureReason: text('failure_reason'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('kyc_cases_user_id_idx').on(table.userId)],
);

export type KycCase = typeof kycCases.$inferSelect;
export type NewKycCase = typeof kycCases.$inferInsert;
