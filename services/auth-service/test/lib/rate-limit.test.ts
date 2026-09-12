import { describe, expect, it } from 'bun:test';
import { RateLimiter } from '../../src/lib/rate-limit.ts';

describe('RateLimiter', () => {
  it('allows attempts under the limit', () => {
    const limiter = new RateLimiter(60_000, 3);
    limiter.consume('key');
    limiter.consume('key');
    limiter.consume('key');
  });

  it('blocks once the limit is exceeded within the window', () => {
    const limiter = new RateLimiter(60_000, 2);
    limiter.consume('key');
    limiter.consume('key');
    expect(() => limiter.consume('key')).toThrow();
  });

  it('tracks separate keys independently', () => {
    const limiter = new RateLimiter(60_000, 1);
    limiter.consume('a');
    limiter.consume('b');
  });

  it('resets after the window elapses', async () => {
    const limiter = new RateLimiter(10, 1);
    limiter.consume('key');
    expect(() => limiter.consume('key')).toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    limiter.consume('key');
  });
});
