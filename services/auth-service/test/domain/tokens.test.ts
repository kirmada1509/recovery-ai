import { describe, expect, it } from 'bun:test';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../../src/domain/tokens.ts';

const config = {
  secret: 'unit-test-secret-at-least-32-characters-long',
  issuer: 'recoveryai-auth-test',
  audience: 'recoveryai-platform-test',
  ttlSeconds: 900,
};

describe('access tokens', () => {
  it('round-trips the expected claims', async () => {
    const token = await signAccessToken(
      { userId: 'user-1', role: 'victim', sessionId: 'session-1', tokenVersion: 3 },
      config,
    );
    const claims = await verifyAccessToken(token, config);

    expect(claims.sub).toBe('user-1');
    expect(claims.role).toBe('victim');
    expect(claims.session_id).toBe('session-1');
    expect(claims.token_version).toBe(3);
    expect(claims.iss).toBe(config.issuer);
    expect(claims.aud).toBe(config.audience);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signAccessToken(
      { userId: 'user-1', role: 'victim', sessionId: 'session-1', tokenVersion: 1 },
      config,
    );
    await expect(
      verifyAccessToken(token, { ...config, secret: 'a-completely-different-secret!!' }),
    ).rejects.toThrow();
  });

  it('rejects a token issued for a different audience', async () => {
    const token = await signAccessToken(
      { userId: 'user-1', role: 'victim', sessionId: 'session-1', tokenVersion: 1 },
      config,
    );
    await expect(
      verifyAccessToken(token, { ...config, audience: 'someone-else' }),
    ).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await signAccessToken(
      { userId: 'user-1', role: 'victim', sessionId: 'session-1', tokenVersion: 1 },
      { ...config, ttlSeconds: -1 },
    );
    await expect(verifyAccessToken(token, config)).rejects.toThrow();
  });
});

describe('refresh tokens', () => {
  it('generates high-entropy, distinct tokens', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(32);
  });

  it('hashes deterministically so a lookup by hash is possible', async () => {
    const token = generateRefreshToken();
    const hash1 = await hashRefreshToken(token);
    const hash2 = await hashRefreshToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(token);
  });
});
