import { AppError } from '@recoveryai/observability-ts';
import type { AccessTokenClaims, VerifyAccessTokenConfig } from '../domain/tokens.ts';
import { verifyAccessToken } from '../domain/tokens.ts';

export async function resolveAuthUser(
  authorizationHeader: string | undefined,
  config: VerifyAccessTokenConfig,
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
