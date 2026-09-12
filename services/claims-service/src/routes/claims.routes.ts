import { AppError } from '@recoveryai/observability-ts';
import { and, eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { ClaimsServiceConfig } from '../config.ts';
import type { Database } from '../db/client.ts';
import {
  claimEvents,
  claimEvidenceLinks,
  claimItems,
  claims,
  idempotencyKeys,
  policies,
  verificationDispatchOutbox,
  type Claim,
} from '../db/schema.ts';
import { assertTransition } from '../domain/claim-state-machine.ts';
import { recordClaimEvent } from '../domain/claim-events.ts';
import { fetchOwnedReadyDocument } from '../lib/evidence-client.ts';
import { isKycVerified } from '../lib/identity-client.ts';
import { resolveAuthUser, requireUser } from '../lib/auth-context.ts';

export interface ClaimsRoutesOptions {
  db: Database;
  config: ClaimsServiceConfig;
}

const publicClaim = (claim: Claim) => ({
  id: claim.id,
  policyId: claim.policyId,
  incidentType: claim.incidentType,
  incidentAt: claim.incidentAt,
  addressLine1: claim.addressLine1,
  addressLine2: claim.addressLine2,
  city: claim.city,
  state: claim.state,
  postalCode: claim.postalCode,
  country: claim.country,
  latitude: claim.latitude,
  longitude: claim.longitude,
  description: claim.description,
  status: claim.status,
  claimedAmountPaise: claim.claimedAmountPaise,
  currency: claim.currency,
  createdAt: claim.createdAt,
  updatedAt: claim.updatedAt,
});

const incidentTypes = [
  t.Literal('flood'),
  t.Literal('cyclone'),
  t.Literal('fire'),
  t.Literal('earthquake'),
  t.Literal('other'),
] as const;

export function claimsRoutes(options: ClaimsRoutesOptions) {
  const { db, config } = options;
  const verifyConfig = {
    secret: config.JWT_SECRET,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  };

  async function loadOwnedClaim(claimId: string, userId: string): Promise<Claim> {
    const [claim] = await db
      .select()
      .from(claims)
      .where(and(eq(claims.id, claimId), eq(claims.userId, userId)))
      .limit(1);
    if (!claim) throw new AppError('NOT_FOUND', 'Claim not found', 404);
    return claim;
  }

  return new Elysia({ name: 'claims-routes' })
    .derive(async ({ headers }) => ({
      authUser: await resolveAuthUser(headers.authorization, verifyConfig),
      authorizationHeader: headers.authorization,
    }))
    .post(
      '/v1/claims',
      async ({ authUser, body, set }) => {
        const user = requireUser(authUser);
        const [policy] = await db
          .select()
          .from(policies)
          .where(and(eq(policies.id, body.policyId), eq(policies.userId, user.sub)))
          .limit(1);
        if (!policy) throw new AppError('POLICY_NOT_FOUND', 'Policy not found', 422);

        const [claim] = await db
          .insert(claims)
          .values({
            userId: user.sub,
            policyId: body.policyId,
            incidentType: body.incidentType,
            claimedAmountPaise: 0,
          })
          .returning();
        if (!claim) throw new Error('claim insert returned no row');

        await recordClaimEvent(db, {
          claimId: claim.id,
          type: 'CLAIM_CREATED',
          actorType: 'user',
          actorId: user.sub,
          payload: { policyId: body.policyId },
        });

        set.status = 201;
        return { claim: publicClaim(claim) };
      },
      {
        body: t.Object({
          policyId: t.String({ format: 'uuid' }),
          incidentType: t.Union([...incidentTypes]),
        }),
      },
    )
    .get('/v1/claims', async ({ authUser }) => {
      const user = requireUser(authUser);
      const rows = await db.select().from(claims).where(eq(claims.userId, user.sub));
      return { claims: rows.map(publicClaim) };
    })
    .get('/v1/claims/:id', async ({ authUser, params }) => {
      const user = requireUser(authUser);
      const claim = await loadOwnedClaim(params.id, user.sub);
      return { claim: publicClaim(claim) };
    })
    .put(
      '/v1/claims/:id',
      async ({ authUser, params, body }) => {
        const user = requireUser(authUser);
        const claim = await loadOwnedClaim(params.id, user.sub);
        if (claim.status !== 'DRAFT') {
          throw new AppError('CLAIM_NOT_EDITABLE', 'Only a draft claim can be edited', 409);
        }

        const [updated] = await db
          .update(claims)
          .set({
            incidentType: body.incidentType ?? claim.incidentType,
            incidentAt: body.incidentAt ? new Date(body.incidentAt) : claim.incidentAt,
            addressLine1: body.addressLine1 ?? claim.addressLine1,
            addressLine2: body.addressLine2 ?? claim.addressLine2,
            city: body.city ?? claim.city,
            state: body.state ?? claim.state,
            postalCode: body.postalCode ?? claim.postalCode,
            latitude: body.latitude ?? claim.latitude,
            longitude: body.longitude ?? claim.longitude,
            description: body.description ?? claim.description,
            version: claim.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(claims.id, claim.id))
          .returning();
        if (!updated) throw new Error('claim update returned no row');

        return { claim: publicClaim(updated) };
      },
      {
        body: t.Object({
          incidentType: t.Optional(t.Union([...incidentTypes])),
          incidentAt: t.Optional(t.String()),
          addressLine1: t.Optional(t.String()),
          addressLine2: t.Optional(t.String()),
          city: t.Optional(t.String()),
          state: t.Optional(t.String()),
          postalCode: t.Optional(t.String()),
          latitude: t.Optional(t.Number()),
          longitude: t.Optional(t.Number()),
          description: t.Optional(t.String()),
        }),
      },
    )
    .post(
      '/v1/claims/:id/items',
      async ({ authUser, params, body, set }) => {
        const user = requireUser(authUser);
        const claim = await loadOwnedClaim(params.id, user.sub);
        if (claim.status !== 'DRAFT') {
          throw new AppError('CLAIM_NOT_EDITABLE', 'Only a draft claim can be edited', 409);
        }

        const [item] = await db
          .insert(claimItems)
          .values({
            claimId: claim.id,
            description: body.description,
            category: body.category,
            quantity: body.quantity ?? 1,
            claimedValuePaise: body.claimedValuePaise,
          })
          .returning();
        if (!item) throw new Error('claim item insert returned no row');

        const totalRows = await db
          .select()
          .from(claimItems)
          .where(eq(claimItems.claimId, claim.id));
        const total = totalRows.reduce((sum, row) => sum + row.claimedValuePaise, 0);
        await db
          .update(claims)
          .set({ claimedAmountPaise: total, updatedAt: new Date() })
          .where(eq(claims.id, claim.id));

        set.status = 201;
        return { item };
      },
      {
        body: t.Object({
          description: t.String({ minLength: 1, maxLength: 500 }),
          category: t.String({ minLength: 1, maxLength: 100 }),
          quantity: t.Optional(t.Integer({ minimum: 1 })),
          claimedValuePaise: t.Integer({ minimum: 0 }),
        }),
      },
    )
    .put(
      '/v1/claims/:id/items/:itemId',
      async ({ authUser, params, body }) => {
        const user = requireUser(authUser);
        const claim = await loadOwnedClaim(params.id, user.sub);
        if (claim.status !== 'DRAFT') {
          throw new AppError('CLAIM_NOT_EDITABLE', 'Only a draft claim can be edited', 409);
        }

        const [existing] = await db
          .select()
          .from(claimItems)
          .where(and(eq(claimItems.id, params.itemId), eq(claimItems.claimId, claim.id)))
          .limit(1);
        if (!existing) throw new AppError('NOT_FOUND', 'Claim item not found', 404);

        const [item] = await db
          .update(claimItems)
          .set({
            description: body.description ?? existing.description,
            category: body.category ?? existing.category,
            quantity: body.quantity ?? existing.quantity,
            claimedValuePaise: body.claimedValuePaise ?? existing.claimedValuePaise,
            updatedAt: new Date(),
          })
          .where(eq(claimItems.id, existing.id))
          .returning();
        if (!item) throw new Error('claim item update returned no row');

        const totalRows = await db
          .select()
          .from(claimItems)
          .where(eq(claimItems.claimId, claim.id));
        const total = totalRows.reduce((sum, row) => sum + row.claimedValuePaise, 0);
        await db
          .update(claims)
          .set({ claimedAmountPaise: total, updatedAt: new Date() })
          .where(eq(claims.id, claim.id));

        return { item };
      },
      {
        body: t.Object({
          description: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
          category: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
          quantity: t.Optional(t.Integer({ minimum: 1 })),
          claimedValuePaise: t.Optional(t.Integer({ minimum: 0 })),
        }),
      },
    )
    .delete('/v1/claims/:id/items/:itemId', async ({ authUser, params }) => {
      const user = requireUser(authUser);
      const claim = await loadOwnedClaim(params.id, user.sub);
      if (claim.status !== 'DRAFT') {
        throw new AppError('CLAIM_NOT_EDITABLE', 'Only a draft claim can be edited', 409);
      }

      const [existing] = await db
        .select()
        .from(claimItems)
        .where(and(eq(claimItems.id, params.itemId), eq(claimItems.claimId, claim.id)))
        .limit(1);
      if (!existing) throw new AppError('NOT_FOUND', 'Claim item not found', 404);

      await db.delete(claimItems).where(eq(claimItems.id, existing.id));

      const totalRows = await db.select().from(claimItems).where(eq(claimItems.claimId, claim.id));
      const total = totalRows.reduce((sum, row) => sum + row.claimedValuePaise, 0);
      await db
        .update(claims)
        .set({ claimedAmountPaise: total, updatedAt: new Date() })
        .where(eq(claims.id, claim.id));

      return { ok: true };
    })
    .post(
      '/v1/claims/:id/evidence-links',
      async ({ authUser, authorizationHeader, params, body }) => {
        const user = requireUser(authUser);
        const claim = await loadOwnedClaim(params.id, user.sub);

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

        const [link] = await db
          .insert(claimEvidenceLinks)
          .values({ claimId: claim.id, evidenceDocumentId: body.evidenceDocumentId })
          .onConflictDoNothing()
          .returning();

        return { link: link ?? { claimId: claim.id, evidenceDocumentId: body.evidenceDocumentId } };
      },
      { body: t.Object({ evidenceDocumentId: t.String({ format: 'uuid' }) }) },
    )
    .get('/v1/claims/:id/events', async ({ authUser, params }) => {
      const user = requireUser(authUser);
      await loadOwnedClaim(params.id, user.sub);
      const rows = await db
        .select()
        .from(claimEvents)
        .where(eq(claimEvents.claimId, params.id))
        .orderBy(claimEvents.createdAt);
      return { events: rows };
    })
    .post(
      '/v1/claims/:id/submit',
      async ({ authUser, authorizationHeader, params, headers, set }) => {
        const user = requireUser(authUser);
        const idempotencyKey = headers['idempotency-key'];
        if (!idempotencyKey) {
          throw new AppError(
            'IDEMPOTENCY_KEY_REQUIRED',
            'An Idempotency-Key header is required',
            400,
          );
        }

        const [existing] = await db
          .select()
          .from(idempotencyKeys)
          .where(eq(idempotencyKeys.key, idempotencyKey))
          .limit(1);
        if (existing) {
          set.status = 200;
          return existing.responseBody as Record<string, unknown>;
        }

        const claim = await loadOwnedClaim(params.id, user.sub);
        assertTransition(claim.status, 'SUBMITTED');

        const kycOk = await isKycVerified(config.IDENTITY_SERVICE_URL, authorizationHeader ?? '');
        if (!kycOk)
          throw new AppError(
            'KYC_NOT_VERIFIED',
            'Identity verification must be completed first',
            422,
          );

        const [policy] = await db
          .select()
          .from(policies)
          .where(eq(policies.id, claim.policyId))
          .limit(1);
        if (!policy || policy.userId !== user.sub) {
          throw new AppError('POLICY_NOT_FOUND', 'Policy not found', 422);
        }

        const items = await db.select().from(claimItems).where(eq(claimItems.claimId, claim.id));
        if (items.length === 0)
          throw new AppError('NO_ITEMS', 'A claim needs at least one item', 422);

        if (!claim.incidentAt || !claim.addressLine1 || !claim.city) {
          throw new AppError(
            'INCIDENT_DETAILS_INCOMPLETE',
            'Incident date and location are required',
            422,
          );
        }

        const evidenceLinks = await db
          .select()
          .from(claimEvidenceLinks)
          .where(eq(claimEvidenceLinks.claimId, claim.id));
        if (evidenceLinks.length === 0) {
          throw new AppError('NO_EVIDENCE', 'At least one evidence document must be linked', 422);
        }

        const snapshot = {
          claimId: claim.id,
          userId: claim.userId,
          incidentType: claim.incidentType,
          incidentAt: claim.incidentAt,
          location: {
            addressLine1: claim.addressLine1,
            city: claim.city,
            state: claim.state,
            postalCode: claim.postalCode,
            country: claim.country,
            latitude: claim.latitude,
            longitude: claim.longitude,
          },
          claimedAmountPaise: claim.claimedAmountPaise,
          items: items.map((item) => ({
            description: item.description,
            category: item.category,
            claimedValuePaise: item.claimedValuePaise,
          })),
          evidenceDocumentIds: evidenceLinks.map((link) => link.evidenceDocumentId),
        };

        const responseBody = await db.transaction(async (tx) => {
          assertTransition(claim.status, 'SUBMITTED');
          await tx
            .update(claims)
            .set({ status: 'SUBMITTED', version: claim.version + 1, updatedAt: new Date() })
            .where(eq(claims.id, claim.id));
          await recordClaimEvent(tx, {
            claimId: claim.id,
            type: 'CLAIM_SUBMITTED',
            actorType: 'user',
            actorId: user.sub,
            payload: {},
          });

          assertTransition('SUBMITTED', 'VERIFYING');
          await tx
            .update(claims)
            .set({ status: 'VERIFYING', updatedAt: new Date() })
            .where(eq(claims.id, claim.id));
          await recordClaimEvent(tx, {
            claimId: claim.id,
            type: 'VERIFICATION_DISPATCHED',
            actorType: 'system',
            payload: {},
          });

          await tx.insert(verificationDispatchOutbox).values({
            claimId: claim.id,
            payload: snapshot,
            idempotencyKey,
          });

          const body = { claim: publicClaim({ ...claim, status: 'VERIFYING' as const }) };
          await tx
            .insert(idempotencyKeys)
            .values({ key: idempotencyKey, claimId: claim.id, responseBody: body });
          return body;
        });

        set.status = 200;
        return responseBody;
      },
    );
}
