import { AppError } from '@recoveryai/observability-ts';
import { desc, eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { IdentityServiceConfig } from '../config.ts';
import type { Database } from '../db/client.ts';
import { kycCases } from '../db/schema.ts';
import { decideMockKycOutcome, maskIdentifier } from '../domain/kyc.ts';
import { resolveAuthUser, requireUser } from '../lib/auth-context.ts';
import { requireInternalService } from '../lib/internal-guard.ts';

export interface KycRoutesOptions {
  db: Database;
  config: IdentityServiceConfig;
}

/**
 * Plan Section 5.4: a case's `pending -> verified | failed` transition is the
 * only state change; `UNVERIFIED` is reported by the route layer when no case
 * exists at all, never stored.
 */
const kycStatusFor = (kase: typeof kycCases.$inferSelect | undefined) =>
  kase ? kase.status.toUpperCase() : 'UNVERIFIED';

const publicCase = (kase: typeof kycCases.$inferSelect) => ({
  id: kase.id,
  provider: kase.provider,
  status: kase.status,
  maskedIdentifier: kase.maskedIdentifier,
  verifiedName: kase.verifiedName,
  failureReason: kase.failureReason,
  submittedAt: kase.submittedAt,
  verifiedAt: kase.verifiedAt,
});

function extractLast4(maskedIdentifier: string): string {
  const parts = maskedIdentifier.split('-');
  return parts[parts.length - 1] ?? '';
}

export function kycRoutes(options: KycRoutesOptions) {
  const { db, config } = options;
  const verifyConfig = {
    secret: config.JWT_SECRET,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  };

  return new Elysia({ name: 'kyc-routes' })
    .derive(async ({ headers }) => ({
      authUser: await resolveAuthUser(headers.authorization, verifyConfig),
    }))
    .post(
      '/v1/kyc/cases',
      async ({ authUser, body, set }) => {
        const user = requireUser(authUser);
        const [kase] = await db
          .insert(kycCases)
          .values({
            userId: user.sub,
            provider: 'mock',
            providerReference: crypto.randomUUID(),
            status: 'pending',
            // Stored ahead of verification so the mock completion step can
            // decide an outcome without re-collecting input; cleared on
            // failure so a rejected submission never lingers as the record.
            verifiedName: body.fullName,
            maskedIdentifier: maskIdentifier(body.identifierLast4),
          })
          .returning();
        if (!kase) throw new Error('kyc case insert returned no row');

        set.status = 201;
        return { case: publicCase(kase) };
      },
      {
        body: t.Object({
          fullName: t.String({ minLength: 1, maxLength: 200 }),
          identifierLast4: t.String({ pattern: '^[0-9]{4}$' }),
        }),
      },
    )
    .get('/v1/kyc/cases/latest', async ({ authUser }) => {
      const user = requireUser(authUser);
      const [kase] = await db
        .select()
        .from(kycCases)
        .where(eq(kycCases.userId, user.sub))
        .orderBy(desc(kycCases.submittedAt))
        .limit(1);
      return { case: kase ? publicCase(kase) : null, kycStatus: kycStatusFor(kase) };
    })
    .post(
      '/v1/kyc/mock/:caseId/complete',
      async ({ authUser, params }) => {
        if (!config.ENABLE_KYC_MOCK_CONTROLS) {
          throw new AppError('NOT_FOUND', 'Resource not found', 404);
        }
        const user = requireUser(authUser);
        const [kase] = await db
          .select()
          .from(kycCases)
          .where(eq(kycCases.id, params.caseId))
          .limit(1);
        if (!kase || kase.userId !== user.sub) {
          throw new AppError('NOT_FOUND', 'KYC case not found', 404);
        }
        if (kase.status !== 'pending') {
          throw new AppError('KYC_CASE_NOT_PENDING', 'KYC case is not pending', 409);
        }

        const outcome = decideMockKycOutcome(
          kase.verifiedName ?? '',
          extractLast4(kase.maskedIdentifier ?? ''),
        );
        const [updated] = await db
          .update(kycCases)
          .set({
            status: outcome.status,
            verifiedName: outcome.status === 'verified' ? outcome.verifiedName : null,
            failureReason: outcome.failureReason ?? null,
            verifiedAt: outcome.status === 'verified' ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(kycCases.id, kase.id))
          .returning();
        if (!updated) throw new Error('kyc case update returned no row');

        return { case: publicCase(updated) };
      },
      { params: t.Object({ caseId: t.String({ format: 'uuid' }) }) },
    )
    .post(
      '/v1/kyc/provider/webhook',
      async ({ headers, body }) => {
        requireInternalService(
          headers,
          config.INTERNAL_SERVICE_SECRET,
          config.INTERNAL_ALLOWED_CALLERS,
        );

        const [kase] = await db
          .select()
          .from(kycCases)
          .where(eq(kycCases.id, body.caseId))
          .limit(1);
        if (!kase) throw new AppError('NOT_FOUND', 'KYC case not found', 404);
        if (kase.status !== 'pending') {
          throw new AppError('KYC_CASE_NOT_PENDING', 'KYC case is not pending', 409);
        }

        const [updated] = await db
          .update(kycCases)
          .set({
            status: body.outcome,
            verifiedName:
              body.outcome === 'verified' ? (body.verifiedName ?? kase.verifiedName) : null,
            failureReason:
              body.outcome === 'failed' ? (body.failureReason ?? 'PROVIDER_REJECTED') : null,
            verifiedAt: body.outcome === 'verified' ? new Date() : null,
            providerReference: body.providerReference ?? kase.providerReference,
            updatedAt: new Date(),
          })
          .where(eq(kycCases.id, kase.id))
          .returning();
        if (!updated) throw new Error('kyc case update returned no row');

        return { case: publicCase(updated) };
      },
      {
        body: t.Object({
          caseId: t.String({ format: 'uuid' }),
          outcome: t.Union([t.Literal('verified'), t.Literal('failed')]),
          verifiedName: t.Optional(t.String()),
          failureReason: t.Optional(t.String()),
          providerReference: t.Optional(t.String()),
        }),
      },
    );
}
