import { AppError } from '@recoveryai/observability-ts';
import type { AccessTokenClaims } from '../domain/tokens.ts';
import { verifyAccessToken } from '../domain/tokens.ts';

export interface AuthContextConfig {
  secret: string;
  issuer: string;
  audience: string;
}

/**
 * Resolves the caller's access token from the `Authorization: Bearer` header.
 * Returns `null` rather than throwing so public and protected routes can share
 * one derive step; protected routes call `requireUser`/`requireRole`.
 */
export async function resolveAuthUser(
  authorizationHeader: string | undefined,
  config: AuthContextConfig,
): Promise<AccessTokenClaims | null> {
  if (!authorizationHeader?.startsWith('Bearer ')) return null;
  const token = authorizationHeader.slice('Bearer '.length);
  try {
    return await verifyAccessToken(token, config);
  } catch {
    return null;
  }
}

export function requireUser(user: AccessTokenClaims | null): AccessTokenClaims {
  if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required', 401);
  return user;
}

export function requireRole(
  user: AccessTokenClaims | null,
  role: 'victim' | 'admin',
): AccessTokenClaims {
  const authed = requireUser(user);
  if (authed.role !== role) throw new AppError('FORBIDDEN', 'Insufficient role', 403);
  return authed;
}
