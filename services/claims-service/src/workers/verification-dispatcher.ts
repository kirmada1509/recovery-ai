import { signInternalServiceRequest, INTERNAL_SERVICE_HEADERS } from '@recoveryai/internal-auth-ts';
import type { Logger } from '@recoveryai/observability-ts';
import { and, eq, lte } from 'drizzle-orm';
import type { ClaimsServiceConfig } from '../config.ts';
import type { Database } from '../db/client.ts';
import { verificationDispatchOutbox } from '../db/schema.ts';

const SERVICE_NAME = 'claims-service';
const MAX_ATTEMPTS = 5;

/**
 * Polls the transactional outbox and calls verification-service (plan
 * Section 2.4 / ADR-0005: no message broker — `FOR UPDATE SKIP LOCKED`
 * instead). A row is claimed by one worker at a time even if this process
 * runs multiple instances, and a failure reschedules with backoff rather
 * than being dropped.
 */
export function startVerificationDispatcher(
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
        .from(verificationDispatchOutbox)
        .where(
          and(
            eq(verificationDispatchOutbox.status, 'pending'),
            lte(verificationDispatchOutbox.nextAttemptAt, new Date()),
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
          new URL('/v1/verifications', config.VERIFICATION_SERVICE_URL),
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
            .update(verificationDispatchOutbox)
            .set({ status: 'sent', updatedAt: new Date() })
            .where(eq(verificationDispatchOutbox.id, row.id));
        } else {
          throw new Error(`verification-service responded ${response.status}`);
        }
      } catch (error) {
        const attempts = row.attempts + 1;
        const backoffMs = Math.min(30_000, 1_000 * 2 ** attempts);
        await tx
          .update(verificationDispatchOutbox)
          .set({
            attempts,
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            nextAttemptAt: new Date(Date.now() + backoffMs),
            updatedAt: new Date(),
          })
          .where(eq(verificationDispatchOutbox.id, row.id));
        logger.warn(
          {
            claim_id: row.claimId,
            attempts,
            err: error instanceof Error ? error.message : String(error),
          },
          'verification dispatch failed',
        );
      }
    });
  }

  const interval = setInterval(() => {
    tick().catch((error) =>
      logger.error({ err: String(error) }, 'verification dispatcher tick failed'),
    );
  }, config.OUTBOX_POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}
