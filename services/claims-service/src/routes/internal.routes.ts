import { AppError } from '@recoveryai/observability-ts';
import { and, eq, sql } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { ClaimsServiceConfig } from '../config.ts';
import type { Database } from '../db/client.ts';
import { claimEvents, claims, manualReviewTasks } from '../db/schema.ts';
import { recordClaimEvent } from '../domain/claim-events.ts';
import { queueAgentDispatch } from '../lib/agent-dispatch.ts';
import { requireInternalService } from '../lib/internal-guard.ts';

export interface InternalRoutesOptions {
  db: Database;
  config: ClaimsServiceConfig;
}

/**
 * The claims-side half of the verification contract Phase 4 is written
 * against (plan Section 7.5): a normalized result comes back, never a
 * database read into verification-service's tables (CLAUDE.md invariant 2).
 */
export function internalRoutes(options: InternalRoutesOptions) {
  const { db, config } = options;

  return new Elysia({ name: 'internal-routes' })
    .post(
      '/v1/internal/claims/:id/verification-result',
      async ({ headers, params, body }) => {
        requireInternalService(
          headers,
          config.INTERNAL_SERVICE_SECRET,
          config.INTERNAL_ALLOWED_CALLERS,
        );

        const [claim] = await db.select().from(claims).where(eq(claims.id, params.id)).limit(1);
        if (!claim) throw new AppError('NOT_FOUND', 'Claim not found', 404);

        // Idempotent: a retried callback for a verification run already
        // recorded is a no-op, not a re-transition (plan Section 18 P4-T5).
        const [alreadyProcessed] = await db
          .select()
          .from(claimEvents)
          .where(
            and(
              eq(claimEvents.claimId, claim.id),
              eq(claimEvents.type, 'VERIFICATION_RESULT_RECEIVED'),
              sql`${claimEvents.payload}->>'verificationRunId' = ${body.verificationRunId}`,
            ),
          )
          .limit(1);
        if (alreadyProcessed) {
          return { claim: { id: claim.id, status: claim.status } };
        }

        if (claim.status !== 'VERIFYING') {
          throw new AppError('CLAIM_NOT_VERIFYING', 'Claim is not awaiting verification', 409);
        }

        await recordClaimEvent(db, {
          claimId: claim.id,
          type: 'VERIFICATION_RESULT_RECEIVED',
          actorType: 'system',
          payload: {
            verificationRunId: body.verificationRunId,
            decision: body.decision,
            overallScore: body.overallScore,
            reasons: body.reasons,
          },
        });

        // A `fail` decision still routes to manual review, not a terminal
        // state — a human sees every failure before it becomes final.
        const nextStatus = body.decision === 'pass' ? 'VERIFIED' : 'MANUAL_REVIEW';

        // The status change and the agent-dispatch outbox insert happen in
        // one transaction — a claim can never reach `VERIFIED` without an
        // agent run queued (plan Section 18 P5), same invariant the
        // verification dispatch already enforces at submit time.
        await db.transaction(async (tx) => {
          await tx
            .update(claims)
            .set({ status: nextStatus, version: claim.version + 1, updatedAt: new Date() })
            .where(eq(claims.id, claim.id));
          await recordClaimEvent(tx, {
            claimId: claim.id,
            type: nextStatus === 'VERIFIED' ? 'CLAIM_VERIFIED' : 'CLAIM_SENT_TO_MANUAL_REVIEW',
            actorType: 'system',
            payload: { verificationRunId: body.verificationRunId },
          });

          if (nextStatus === 'MANUAL_REVIEW') {
            await tx.insert(manualReviewTasks).values({
              claimId: claim.id,
              reasonCode:
                body.decision === 'fail' ? 'VERIFICATION_FAILED' : 'VERIFICATION_NEEDS_REVIEW',
              reasonText: body.reasons.join('; ') || null,
            });
          } else {
            await queueAgentDispatch(
              tx,
              claim,
              { decision: body.decision, overallScore: body.overallScore, reasons: body.reasons },
              `agent-dispatch:${body.verificationRunId}`,
            );
          }
        });

        return { claim: { id: claim.id, status: nextStatus } };
      },
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: t.Object({
          verificationRunId: t.String({ format: 'uuid' }),
          decision: t.Union([t.Literal('pass'), t.Literal('fail'), t.Literal('review')]),
          overallScore: t.Number(),
          reasons: t.Array(t.String()),
        }),
      },
    )
    .post(
      '/v1/internal/claims/:id/agent-update',
      async ({ headers, params, body }) => {
        requireInternalService(
          headers,
          config.INTERNAL_SERVICE_SECRET,
          config.INTERNAL_ALLOWED_CALLERS,
        );

        const [claim] = await db.select().from(claims).where(eq(claims.id, params.id)).limit(1);
        if (!claim) throw new AppError('NOT_FOUND', 'Claim not found', 404);

        // Idempotent on the agent run id, same convention as
        // `verification-result`'s dedup on `verificationRunId`.
        const [alreadyProcessed] = await db
          .select()
          .from(claimEvents)
          .where(
            and(
              eq(claimEvents.claimId, claim.id),
              eq(claimEvents.type, 'AGENT_DOSSIER_READY'),
              sql`${claimEvents.payload}->>'agentRunId' = ${body.agentRunId}`,
            ),
          )
          .limit(1);
        if (alreadyProcessed) {
          return { claim: { id: claim.id, status: claim.status } };
        }

        // No claim status transition here — `READY_FOR_INSURER` onward is
        // Phase 6/7 driving logic (the state machine already declares the
        // transition; nothing yet decides to take it).
        await recordClaimEvent(db, {
          claimId: claim.id,
          type: 'AGENT_DOSSIER_READY',
          actorType: 'agent',
          payload: { agentRunId: body.agentRunId, status: body.status },
        });

        return { claim: { id: claim.id, status: claim.status } };
      },
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: t.Object({
          agentRunId: t.String({ format: 'uuid' }),
          status: t.String(),
          dossier: t.Optional(t.Unknown()),
        }),
      },
    );
}
