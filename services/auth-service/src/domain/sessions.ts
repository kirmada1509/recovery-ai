import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { AppError } from '@recoveryai/observability-ts';
import type { Database } from '../db/client.ts';
import { sessions, users, type Session } from '../db/schema.ts';
import { generateRefreshToken, hashRefreshToken } from './tokens.ts';

export interface SessionContext {
  userAgentHash: string | null;
  ipHash: string | null;
}

export interface IssuedSession {
  session: Session;
  refreshToken: string;
}

function expiryFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** Starts a brand-new session family — signup and login only. */
export async function createSession(
  db: Database,
  userId: string,
  context: SessionContext,
  refreshTokenTtlDays: number,
): Promise<IssuedSession> {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = await hashRefreshToken(refreshToken);
  const familyId = randomUUID();

  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      refreshTokenHash,
      familyId,
      parentSessionId: null,
      expiresAt: expiryFromNow(refreshTokenTtlDays),
      userAgentHash: context.userAgentHash,
      ipHash: context.ipHash,
    })
    .returning();

  if (!session) throw new Error('session insert returned no row');
  return { session, refreshToken };
}

/**
 * Rotates a refresh token (plan Section 2.5 / §18 P1-T3). Reuse of an
 * already-rotated token revokes the entire family — it is the strongest signal
 * available that a refresh token has been stolen, so the guardrail must fail
 * closed rather than silently issuing a new token.
 */
export async function rotateSession(
  db: Database,
  rawRefreshToken: string,
  context: SessionContext,
  refreshTokenTtlDays: number,
): Promise<IssuedSession & { userId: string; tokenVersion: number; role: 'victim' | 'admin' }> {
  const refreshTokenHash = await hashRefreshToken(rawRefreshToken);

  const [current] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.refreshTokenHash, refreshTokenHash))
    .limit(1);

  if (!current) {
    throw new AppError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid', 401);
  }

  if (current.revokedAt) {
    // The token was already rotated (or logged out) and is being replayed —
    // treat the whole family as compromised.
    await revokeSessionFamily(db, current.familyId);
    throw new AppError(
      'REFRESH_TOKEN_REUSED',
      'Refresh token reuse detected; session revoked',
      401,
    );
  }

  if (current.expiresAt.getTime() <= Date.now()) {
    throw new AppError('REFRESH_TOKEN_EXPIRED', 'Refresh token has expired', 401);
  }

  const [user] = await db.select().from(users).where(eq(users.id, current.userId)).limit(1);
  if (!user || user.status !== 'active') {
    throw new AppError('ACCOUNT_DISABLED', 'Account is disabled', 401);
  }

  const refreshToken = generateRefreshToken();
  const nextRefreshTokenHash = await hashRefreshToken(refreshToken);

  const [next] = await db
    .insert(sessions)
    .values({
      userId: current.userId,
      refreshTokenHash: nextRefreshTokenHash,
      familyId: current.familyId,
      parentSessionId: current.id,
      expiresAt: expiryFromNow(refreshTokenTtlDays),
      userAgentHash: context.userAgentHash,
      ipHash: context.ipHash,
    })
    .returning();

  if (!next) throw new Error('session insert returned no row');

  await db
    .update(sessions)
    .set({ revokedAt: new Date(), replacedBySessionId: next.id, updatedAt: new Date() })
    .where(eq(sessions.id, current.id));

  return {
    session: next,
    refreshToken,
    userId: user.id,
    tokenVersion: user.tokenVersion,
    role: user.role,
  };
}

export async function revokeSessionFamily(db: Database, familyId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function revokeAllSessionsForUser(db: Database, userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function findSessionById(
  db: Database,
  sessionId: string,
): Promise<Session | undefined> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  return session;
}
