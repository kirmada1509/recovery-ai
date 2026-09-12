import { jwtVerify, type JWTPayload } from 'jose';

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  role: 'victim' | 'admin';
  session_id: string;
  token_version: number;
}

export interface VerifyAccessTokenConfig {
  secret: string;
  issuer: string;
  audience: string;
}

/**
 * Verifies an access token issued by auth-service. Both services hold the
 * same `JWT_SECRET` so identity-service can authenticate a request without a
 * synchronous call back to auth-service (plan Section 2.5) — the tradeoff,
 * documented there, is that `logout-all` only takes effect here once the
 * short-lived (~15 min) token expires.
 */
export async function verifyAccessToken(
  token: string,
  config: VerifyAccessTokenConfig,
): Promise<AccessTokenClaims> {
  const secretKey = new TextEncoder().encode(config.secret);
  const { payload } = await jwtVerify(token, secretKey, {
    issuer: config.issuer,
    audience: config.audience,
  });
  return payload as AccessTokenClaims;
}
