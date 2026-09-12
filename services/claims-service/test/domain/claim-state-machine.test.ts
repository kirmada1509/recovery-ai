import { describe, expect, it } from 'bun:test';
import {
  assertTransition,
  canTransition,
  type ClaimStatus,
} from '../../src/domain/claim-state-machine.ts';

const ALL_LEGAL: Array<[ClaimStatus, ClaimStatus]> = [
  ['DRAFT', 'SUBMITTED'],
  ['SUBMITTED', 'VERIFYING'],
  ['VERIFYING', 'NEEDS_USER_INPUT'],
  ['VERIFYING', 'MANUAL_REVIEW'],
  ['VERIFYING', 'VERIFIED'],
  ['NEEDS_USER_INPUT', 'VERIFYING'],
  ['MANUAL_REVIEW', 'VERIFIED'],
  ['MANUAL_REVIEW', 'REJECTED'],
  ['VERIFIED', 'READY_FOR_INSURER'],
  ['READY_FOR_INSURER', 'INSURER_SUBMITTED'],
  ['INSURER_SUBMITTED', 'INSURER_REVIEW'],
  ['INSURER_REVIEW', 'DOCUMENTS_REQUESTED'],
  ['INSURER_REVIEW', 'OFFER_RECEIVED'],
  ['INSURER_REVIEW', 'REJECTED'],
  ['DOCUMENTS_REQUESTED', 'INSURER_REVIEW'],
  ['OFFER_RECEIVED', 'NEGOTIATING'],
  ['OFFER_RECEIVED', 'SETTLED'],
  ['OFFER_RECEIVED', 'REJECTED'],
  ['NEGOTIATING', 'CHALLENGE_PENDING_USER_APPROVAL'],
  ['NEGOTIATING', 'SETTLED'],
  ['NEGOTIATING', 'ESCALATION_PENDING_APPROVAL'],
  ['CHALLENGE_PENDING_USER_APPROVAL', 'CHALLENGED'],
  ['CHALLENGED', 'OFFER_RECEIVED'],
  ['ESCALATION_PENDING_APPROVAL', 'ESCALATION_FILED'],
  ['ESCALATION_FILED', 'ESCALATION_IN_PROGRESS'],
  ['ESCALATION_IN_PROGRESS', 'ESCALATION_RESOLVED'],
  ['ESCALATION_RESOLVED', 'SETTLED'],
  ['ESCALATION_RESOLVED', 'CLOSED'],
  ['SETTLED', 'CLOSED'],
  ['REJECTED', 'CLOSED'],
];

const ILLEGAL: Array<[ClaimStatus, ClaimStatus]> = [
  ['DRAFT', 'SETTLED'],
  ['DRAFT', 'VERIFYING'],
  ['SUBMITTED', 'DRAFT'],
  ['VERIFYING', 'SUBMITTED'],
  ['VERIFIED', 'DRAFT'],
  ['CLOSED', 'DRAFT'],
  ['CLOSED', 'SETTLED'],
  ['SETTLED', 'NEGOTIATING'],
  ['OFFER_RECEIVED', 'VERIFYING'],
];

describe('claim state machine', () => {
  it.each(ALL_LEGAL)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(assertTransition(from, to)).toBe(to);
  });

  it.each(ILLEGAL)('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow();
  });

  it('CLOSED is terminal', () => {
    expect(canTransition('CLOSED', 'CLOSED')).toBe(false);
  });
});
