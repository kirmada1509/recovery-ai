import { AppError } from '@recoveryai/observability-ts';
import type { claimStatusEnum } from '../db/schema.ts';

export type ClaimStatus = (typeof claimStatusEnum.enumValues)[number];

/**
 * The full claim lifecycle (plan Section 5.1). Centralizing every legal
 * transition here — even the ones no phase drives yet — means later phases
 * extend which transitions are *taken*, never the table of which are
 * *legal*, and an illegal move fails the same way everywhere it's attempted.
 */
const TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['VERIFYING'],
  VERIFYING: ['NEEDS_USER_INPUT', 'MANUAL_REVIEW', 'VERIFIED'],
  NEEDS_USER_INPUT: ['VERIFYING'],
  MANUAL_REVIEW: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['READY_FOR_INSURER'],
  READY_FOR_INSURER: ['INSURER_SUBMITTED'],
  INSURER_SUBMITTED: ['INSURER_REVIEW'],
  INSURER_REVIEW: ['DOCUMENTS_REQUESTED', 'OFFER_RECEIVED', 'REJECTED'],
  DOCUMENTS_REQUESTED: ['INSURER_REVIEW'],
  OFFER_RECEIVED: ['NEGOTIATING', 'SETTLED', 'REJECTED'],
  NEGOTIATING: ['CHALLENGE_PENDING_USER_APPROVAL', 'SETTLED', 'ESCALATION_PENDING_APPROVAL'],
  CHALLENGE_PENDING_USER_APPROVAL: ['CHALLENGED'],
  CHALLENGED: ['OFFER_RECEIVED'],
  ESCALATION_PENDING_APPROVAL: ['ESCALATION_FILED'],
  ESCALATION_FILED: ['ESCALATION_IN_PROGRESS'],
  ESCALATION_IN_PROGRESS: ['ESCALATION_RESOLVED'],
  ESCALATION_RESOLVED: ['SETTLED', 'CLOSED'],
  SETTLED: ['CLOSED'],
  REJECTED: ['CLOSED'],
  CLOSED: [],
};

export function canTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Throws if `from -> to` is not a legal transition; otherwise returns `to`. */
export function assertTransition(from: ClaimStatus, to: ClaimStatus): ClaimStatus {
  if (!canTransition(from, to)) {
    throw new AppError('ILLEGAL_TRANSITION', `Cannot move a claim from ${from} to ${to}`, 409, {
      from,
      to,
    });
  }
  return to;
}
