import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  role: 'victim' | 'admin';
  session_id: string;
  token_version: number;
}

export interface AccessTokenConfig {
  secret: string;
  issuer: string;
  audience: string;
  ttlSeconds: number;
}

/**
 * Short-lived (~15 min) access JWT (plan Section 2.5). Verified independently by
 * every service that holds the shared secret, so a request never has to call
 * back into auth-service to authenticate — the tradeoff is that `logout-all`
 * (which bumps `token_version`) only takes effect once the token expires for
 * services other than auth-service itself, which checks `token_version` against
 * the database on every request.
 */
export async function signAccessToken(
  claims: { userId: string; role: 'victim' | 'admin'; sessionId: string; tokenVersion: number },
  config: AccessTokenConfig,
): Promise<string> {
  const secretKey = new TextEncoder().encode(config.secret);
  return new SignJWT({
    role: claims.role,
    session_id: claims.sessionId,
    token_version: claims.tokenVersion,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setExpirationTime(`${config.ttlSeconds}s`)
    .sign(secretKey);
}

export async function verifyAccessToken(
  token: string,
  config: Pick<AccessTokenConfig, 'secret' | 'issuer' | 'audience'>,
): Promise<AccessTokenClaims> {
  const secretKey = new TextEncoder().encode(config.secret);
  const { payload } = await jwtVerify(token, secretKey, {
    issuer: config.issuer,
    audience: config.audience,
  });
  return payload as AccessTokenClaims;
}

/** Opaque, high-entropy refresh token. Only its hash is ever persisted. */
export function generateRefreshToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

export async function hashRefreshToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Buffer.from(digest).toString('hex');
}
