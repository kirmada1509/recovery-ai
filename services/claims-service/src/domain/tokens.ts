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

/** Verifies an access token issued by auth-service (plan Section 2.5). */
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
