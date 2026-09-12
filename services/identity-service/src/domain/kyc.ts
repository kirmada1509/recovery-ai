export interface MockKycOutcome {
  status: 'verified' | 'failed';
  verifiedName?: string;
  failureReason?: string;
}

/**
 * Deterministic mock KYC decision (plan Section 2.6 / §18 P1-T6): the mock
 * provider must support `verified`, `pending`, `failed` outcomes for tests
 * without depending on randomness. An identifier ending in `0000` is the
 * fixture convention for "this synthetic record fails verification".
 */
export function decideMockKycOutcome(fullName: string, identifierLast4: string): MockKycOutcome {
  if (identifierLast4 === '0000') {
    return { status: 'failed', failureReason: 'MOCK_PROVIDER_SEED_FAILURE' };
  }
  return { status: 'verified', verifiedName: fullName };
}

export function maskIdentifier(identifierLast4: string): string {
  return `XXXX-XXXX-${identifierLast4}`;
}
