import { signInternalServiceRequest, INTERNAL_SERVICE_HEADERS } from '@recoveryai/internal-auth-ts';
import type { Logger } from '@recoveryai/observability-ts';
import { and, eq, lte } from 'drizzle-orm';
import type { ClaimsServiceConfig } from '../config.ts';
import type { Database } from '../db/client.ts';
import { agentDispatchOutbox } from '../db/schema.ts';

const SERVICE_NAME = 'claims-service';
const MAX_ATTEMPTS = 5;

/**
 * Polls the transactional outbox and calls agent-service (plan Section 18
 * P5, completing Phase 4's deliberately-deferred hook) — same
 * `FOR UPDATE SKIP LOCKED` outbox pattern as `verification-dispatcher.ts`
 * (ADR-0005: no message broker).
 */
export function startAgentDispatcher(
  db: Database,
  config: ClaimsServiceConfig,
  logger: Logger,
): () => void {
  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped) return;

    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(agentDispatchOutbox)
        .where(
          and(
            eq(agentDispatchOutbox.status, 'pending'),
            lte(agentDispatchOutbox.nextAttemptAt, new Date()),
          ),
        )
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return;

      try {
        const internalToken = signInternalServiceRequest(
          config.INTERNAL_SERVICE_SECRET,
          SERVICE_NAME,
        );
        const response = await fetch(
          new URL(`/v1/agent/claims/${row.claimId}/start`, config.AGENT_SERVICE_URL),
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              [INTERNAL_SERVICE_HEADERS.service]: internalToken.service,
              [INTERNAL_SERVICE_HEADERS.timestamp]: internalToken.timestamp,
              [INTERNAL_SERVICE_HEADERS.signature]: internalToken.signature,
            },
            body: JSON.stringify({
              claimId: row.claimId,
              ...(row.payload as Record<string, unknown>),
            }),
          },
        );

        if (response.ok) {
          await tx
            .update(agentDispatchOutbox)
            .set({ status: 'sent', updatedAt: new Date() })
            .where(eq(agentDispatchOutbox.id, row.id));
        } else {
          throw new Error(`agent-service responded ${response.status}`);
        }
      } catch (error) {
        const attempts = row.attempts + 1;
        const backoffMs = Math.min(30_000, 1_000 * 2 ** attempts);
        await tx
          .update(agentDispatchOutbox)
          .set({
            attempts,
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            nextAttemptAt: new Date(Date.now() + backoffMs),
            updatedAt: new Date(),
          })
          .where(eq(agentDispatchOutbox.id, row.id));
        logger.warn(
          {
            claim_id: row.claimId,
            attempts,
            err: error instanceof Error ? error.message : String(error),
          },
          'agent dispatch failed',
        );
      }
    });
  }

  const interval = setInterval(() => {
    tick().catch((error) => logger.error({ err: String(error) }, 'agent dispatcher tick failed'));
  }, config.OUTBOX_POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}
