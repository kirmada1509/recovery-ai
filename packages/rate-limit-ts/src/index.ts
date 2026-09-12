import { AppError } from '@recoveryai/observability-ts';

/**
 * Fixed-window in-memory rate limiter (plan Section 14.5). Signup, login,
 * and refresh must be rate-limited even with no Redis in local/dev mode; a
 * distributed backend can implement the same interface later without callers
 * changing.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly maxAttempts: number,
  ) {}

  /** Throws AppError(429) when `key` has exceeded its attempt budget. */
  consume(key: string): void {
    const now = Date.now();
    const entry = this.windows.get(key);

    if (!entry || entry.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }

    if (entry.count >= this.maxAttempts) {
      throw new AppError('RATE_LIMITED', 'Too many attempts, try again later', 429, {
        retryAfterMs: entry.resetAt - now,
      });
    }

    entry.count += 1;
  }
}
