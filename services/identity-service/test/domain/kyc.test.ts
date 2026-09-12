import { describe, expect, it } from 'bun:test';
import { decideMockKycOutcome, maskIdentifier } from '../../src/domain/kyc.ts';

describe('decideMockKycOutcome', () => {
  it('verifies deterministically for a normal identifier', () => {
    expect(decideMockKycOutcome('Jane Doe', '1234')).toEqual({
      status: 'verified',
      verifiedName: 'Jane Doe',
    });
  });

  it('fails deterministically for the reserved 0000 seed', () => {
    expect(decideMockKycOutcome('Jane Doe', '0000')).toEqual({
      status: 'failed',
      failureReason: 'MOCK_PROVIDER_SEED_FAILURE',
    });
  });

  it('is deterministic across repeated calls', () => {
    const a = decideMockKycOutcome('Jane Doe', '9999');
    const b = decideMockKycOutcome('Jane Doe', '9999');
    expect(a).toEqual(b);
  });
});

describe('maskIdentifier', () => {
  it('never includes more than the last 4 digits', () => {
    expect(maskIdentifier('1234')).toBe('XXXX-XXXX-1234');
  });
});
