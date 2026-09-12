import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import {
  agentDispatchOutbox,
  claimEvidenceLinks,
  claimItems,
  policies,
  type Claim,
} from '../db/schema.ts';

export interface VerificationResultSummary {
  decision: string;
  overallScore: number;
  reasons: string[];
}

/** Works for both a plain `Database` and a transaction (same convention as
 * `EventWriter` in `domain/claim-events.ts`). */
type DbOrTx = Pick<Database, 'select' | 'insert'>;

/**
 * Builds the normalized snapshot agent-service's `/v1/agent/claims/:id/start`
 * expects and queues one outbox row — called in the same transaction as the
 * claim's transition to `VERIFIED` (plan Section 18 P5, completing Phase 4's
 * deliberately-deferred hook), so a claim can never reach `VERIFIED` without
 * an agent run queued, same invariant as the verification dispatch.
 */
export async function queueAgentDispatch(
  tx: DbOrTx,
  claim: Claim,
  verification: VerificationResultSummary,
  idempotencyKey: string,
): Promise<void> {
  const [items, [policy], evidenceLinks] = await Promise.all([
    tx.select().from(claimItems).where(eq(claimItems.claimId, claim.id)),
    tx.select().from(policies).where(eq(policies.id, claim.policyId)).limit(1),
    tx.select().from(claimEvidenceLinks).where(eq(claimEvidenceLinks.claimId, claim.id)),
  ]);

  const payload = {
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
      id: item.id,
      description: item.description,
      category: item.category,
      claimedValuePaise: item.claimedValuePaise,
    })),
    evidenceDocumentIds: evidenceLinks.map((link) => link.evidenceDocumentId),
    policyId: claim.policyId,
    policyEvidenceDocumentId: policy?.evidenceDocumentId,
    verificationDecision: verification.decision,
    verificationOverallScore: verification.overallScore,
    verificationReasons: verification.reasons,
  };

  await tx.insert(agentDispatchOutbox).values({
    claimId: claim.id,
    payload,
    idempotencyKey,
  });
}
