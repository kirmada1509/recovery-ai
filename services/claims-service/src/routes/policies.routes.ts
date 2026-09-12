import { AppError } from '@recoveryai/observability-ts';
import { and, eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { ClaimsServiceConfig } from '../config.ts';
import type { Database } from '../db/client.ts';
import { policies } from '../db/schema.ts';
import { fetchOwnedReadyDocument } from '../lib/evidence-client.ts';
import { resolveAuthUser, requireUser } from '../lib/auth-context.ts';

export interface PoliciesRoutesOptions {
  db: Database;
  config: ClaimsServiceConfig;
}

const publicPolicy = (policy: typeof policies.$inferSelect) => ({
  id: policy.id,
  evidenceDocumentId: policy.evidenceDocumentId,
  insurerName: policy.insurerName,
  policyNumberMasked: policy.policyNumberMasked,
  policyType: policy.policyType,
  coverageStart: policy.coverageStart,
  coverageEnd: policy.coverageEnd,
  currency: policy.currency,
  status: policy.status,
  createdAt: policy.createdAt,
});

export function policiesRoutes(options: PoliciesRoutesOptions) {
  const { db, config } = options;
  const verifyConfig = {
    secret: config.JWT_SECRET,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  };

  return new Elysia({ name: 'policies-routes' })
    .derive(async ({ headers }) => ({
      authUser: await resolveAuthUser(headers.authorization, verifyConfig),
      authorizationHeader: headers.authorization,
    }))
    .post(
      '/v1/policies',
      async ({ authUser, authorizationHeader, body, set }) => {
        const user = requireUser(authUser);

        const document = await fetchOwnedReadyDocument(
          config.EVIDENCE_SERVICE_URL,
          body.evidenceDocumentId,
          authorizationHeader ?? '',
        );
        if (!document) {
          throw new AppError(
            'EVIDENCE_DOCUMENT_NOT_READY',
            'The referenced document does not exist, is not yours, or is not ready',
            422,
          );
        }

        const [policy] = await db
          .insert(policies)
          .values({
            userId: user.sub,
            evidenceDocumentId: body.evidenceDocumentId,
            insurerName: body.insurerName,
            policyNumberMasked: body.policyNumberMasked,
            policyType: body.policyType,
            coverageStart: body.coverageStart,
            coverageEnd: body.coverageEnd,
            currency: body.currency ?? 'INR',
          })
          .returning();
        if (!policy) throw new Error('policy insert returned no row');

        set.status = 201;
        return { policy: publicPolicy(policy) };
      },
      {
        body: t.Object({
          evidenceDocumentId: t.String({ format: 'uuid' }),
          insurerName: t.String({ minLength: 1, maxLength: 200 }),
          policyNumberMasked: t.String({ minLength: 1, maxLength: 100 }),
          policyType: t.String({ minLength: 1, maxLength: 100 }),
          coverageStart: t.Optional(t.String()),
          coverageEnd: t.Optional(t.String()),
          currency: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
        }),
      },
    )
    .get('/v1/policies', async ({ authUser }) => {
      const user = requireUser(authUser);
      const rows = await db.select().from(policies).where(eq(policies.userId, user.sub));
      return { policies: rows.map(publicPolicy) };
    })
    .get('/v1/policies/:id', async ({ authUser, params }) => {
      const user = requireUser(authUser);
      const [policy] = await db
        .select()
        .from(policies)
        .where(and(eq(policies.id, params.id), eq(policies.userId, user.sub)))
        .limit(1);
      if (!policy) throw new AppError('NOT_FOUND', 'Policy not found', 404);
      return { policy: publicPolicy(policy) };
    });
}
