import { AppError } from '@recoveryai/observability-ts';
import { desc, eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { ClaimsServiceConfig } from '../config.ts';
import type { Database } from '../db/client.ts';
import { claims, manualReviewTasks } from '../db/schema.ts';
import { recordClaimEvent } from '../domain/claim-events.ts';
import { resolveAuthUser, requireRole } from '../lib/auth-context.ts';

export interface AdminRoutesOptions {
  db: Database;
  config: ClaimsServiceConfig;
}

/**
 * Read-only claim list/detail for Phase 3 (plan §18 P3-T6). Real resolution
 * logic for `/v1/admin/manual-reviews/:id/resolve` — the part that resumes
 * verification — is Phase 4's P4-T7; this records the decision as an
 * immutable event without an automatic resume.
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

        await db
          .update(manualReviewTasks)
          .set({
            status: body.decision === 'approve' ? 'approved' : 'rejected',
            assignedAdminId: admin.sub,
            resolutionNote: body.note ?? null,
            updatedAt: new Date(),
          })
          .where(eq(manualReviewTasks.id, task.id));

        await recordClaimEvent(db, {
          claimId: task.claimId,
          type: 'MANUAL_REVIEW_RESOLVED',
          actorType: 'admin',
          actorId: admin.sub,
          payload: { decision: body.decision, note: body.note ?? null, taskId: task.id },
        });

        return {
          task: { id: task.id, status: body.decision === 'approve' ? 'approved' : 'rejected' },
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
