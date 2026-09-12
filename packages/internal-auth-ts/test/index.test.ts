import { describe, expect, it } from 'bun:test';
import { signInternalServiceRequest, verifyInternalServiceRequest } from '../src/index.ts';

const secret = 'test-shared-secret';

describe('internal-auth-ts', () => {
  it('accepts a freshly signed token from an allowed service', () => {
    const token = signInternalServiceRequest(secret, 'identity-service');
    expect(
      verifyInternalServiceRequest(token, { secret, allowedServices: ['identity-service'] }),
    ).toBe(true);
  });

  it('rejects a service not in the allowlist', () => {
    const token = signInternalServiceRequest(secret, 'evidence-service');
    expect(
      verifyInternalServiceRequest(token, { secret, allowedServices: ['identity-service'] }),
    ).toBe(false);
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = signInternalServiceRequest('wrong-secret', 'identity-service');
    expect(
      verifyInternalServiceRequest(token, { secret, allowedServices: ['identity-service'] }),
    ).toBe(false);
  });

  it('rejects an expired timestamp', () => {
    const token = signInternalServiceRequest(secret, 'identity-service');
    const stale = { ...token, timestamp: (Date.now() - 60_000).toString() };
    expect(
      verifyInternalServiceRequest(stale, {
        secret,
        allowedServices: ['identity-service'],
        toleranceMs: 30_000,
      }),
    ).toBe(false);
  });

  it('rejects a missing token', () => {
    expect(
      verifyInternalServiceRequest(undefined, { secret, allowedServices: ['identity-service'] }),
    ).toBe(false);
  });
});
