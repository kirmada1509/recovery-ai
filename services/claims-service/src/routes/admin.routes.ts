import { AppError } from '@recoveryai/observability-ts';
import { INTERNAL_SERVICE_HEADERS, signInternalServiceRequest } from '@recoveryai/internal-auth-ts';
import { desc, eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { ClaimsServiceConfig } from '../config.ts';
import type { Database } from '../db/client.ts';
import { claims, manualReviewTasks } from '../db/schema.ts';
import { assertTransition } from '../domain/claim-state-machine.ts';
import { recordClaimEvent } from '../domain/claim-events.ts';
import { resolveAuthUser, requireRole } from '../lib/auth-context.ts';

export interface AdminRoutesOptions {
  db: Database;
  config: ClaimsServiceConfig;
}

const SERVICE_NAME = 'claims-service';

/**
 * Claim list/detail (plan §18 P3-T6) plus the real manual-review resolution
 * (P4-T7): approving moves a `MANUAL_REVIEW` claim to `VERIFIED`; rejecting
 * moves it to `REJECTED`. Both are ordinary state-machine transitions, so an
 * already-resolved claim (task no longer `open`) fails the same way an
 * illegal transition anywhere else does.
 */
export function adminRoutes(options: AdminRoutesOptions) {
  const { db, config } = options;
  const verifyConfig = {
    secret: config.JWT_SECRET,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  };

  return new Elysia({ name: 'claims-admin-routes' })
    .derive(async ({ headers }) => ({
      authUser: await resolveAuthUser(headers.authorization, verifyConfig),
    }))
    .get('/v1/admin/claims', async ({ authUser }) => {
      requireRole(authUser, 'admin');
      const rows = await db.select().from(claims).orderBy(desc(claims.createdAt));
      return { claims: rows };
    })
    .get('/v1/admin/claims/:id', async ({ authUser, params }) => {
      requireRole(authUser, 'admin');
      const [claim] = await db.select().from(claims).where(eq(claims.id, params.id)).limit(1);
      if (!claim) throw new AppError('NOT_FOUND', 'Claim not found', 404);
      return { claim };
    })
    .get('/v1/admin/claims/:id/verification', async ({ authUser, params }) => {
      requireRole(authUser, 'admin');
      const token = signInternalServiceRequest(config.INTERNAL_SERVICE_SECRET, SERVICE_NAME);
      const response = await fetch(
        new URL(`/v1/claims/${params.id}/latest-verification`, config.VERIFICATION_SERVICE_URL),
        {
          headers: {
            [INTERNAL_SERVICE_HEADERS.service]: token.service,
            [INTERNAL_SERVICE_HEADERS.timestamp]: token.timestamp,
            [INTERNAL_SERVICE_HEADERS.signature]: token.signature,
          },
        },
      );
      if (!response.ok) {
        throw new AppError('VERIFICATION_UNAVAILABLE', 'Could not reach verification-service', 502);
      }
      return response.json();
    })
    .get('/v1/admin/manual-reviews', async ({ authUser }) => {
      requireRole(authUser, 'admin');
      const rows = await db
        .select()
        .from(manualReviewTasks)
        .where(eq(manualReviewTasks.status, 'open'))
        .orderBy(desc(manualReviewTasks.createdAt));
      return { manualReviews: rows };
    })
    .post(
      '/v1/admin/manual-reviews/:id/resolve',
      async ({ authUser, params, body }) => {
        const admin = requireRole(authUser, 'admin');
        const [task] = await db
          .select()
          .from(manualReviewTasks)
          .where(eq(manualReviewTasks.id, params.id))
          .limit(1);
        if (!task) throw new AppError('NOT_FOUND', 'Manual review task not found', 404);
        if (task.status !== 'open') {
          throw new AppError(
            'MANUAL_REVIEW_NOT_OPEN',
            'Manual review task is already resolved',
            409,
          );
        }

        const [claim] = await db.select().from(claims).where(eq(claims.id, task.claimId)).limit(1);
        if (!claim) throw new AppError('NOT_FOUND', 'Claim not found', 404);

        const nextClaimStatus = body.decision === 'approve' ? 'VERIFIED' : 'REJECTED';
        assertTransition(claim.status, nextClaimStatus);

        await db.transaction(async (tx) => {
          await tx
            .update(manualReviewTasks)
            .set({
              status: body.decision === 'approve' ? 'approved' : 'rejected',
              assignedAdminId: admin.sub,
              resolutionNote: body.note ?? null,
              updatedAt: new Date(),
            })
            .where(eq(manualReviewTasks.id, task.id));

          await tx
            .update(claims)
            .set({ status: nextClaimStatus, version: claim.version + 1, updatedAt: new Date() })
            .where(eq(claims.id, claim.id));

          await recordClaimEvent(tx, {
            claimId: task.claimId,
            type: 'MANUAL_REVIEW_RESOLVED',
            actorType: 'admin',
            actorId: admin.sub,
            payload: { decision: body.decision, note: body.note ?? null, taskId: task.id },
          });
        });

        return {
          task: { id: task.id, status: body.decision === 'approve' ? 'approved' : 'rejected' },
          claim: { id: claim.id, status: nextClaimStatus },
        };
      },
      {
        body: t.Object({
          decision: t.Union([t.Literal('approve'), t.Literal('reject')]),
          note: t.Optional(t.String({ maxLength: 2000 })),
        }),
      },
    );
}
