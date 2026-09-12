import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-signed service-to-service credentials (plan Section 2.5): "internal
 * service JWT or HMAC-signed credentials with explicit service audience;
 * never forward end-user refresh tokens across services." A signature is only
 * valid for `toleranceMs` around its timestamp, so a captured header cannot be
 * replayed indefinitely.
 */
export interface InternalServiceToken {
  service: string;
  timestamp: string;
  signature: string;
}

const DEFAULT_TOLERANCE_MS = 30_000;

function computeSignature(secret: string, service: string, timestamp: string): string {
  return createHmac('sha256', secret).update(`${service}.${timestamp}`).digest('hex');
}

export function signInternalServiceRequest(secret: string, service: string): InternalServiceToken {
  const timestamp = Date.now().toString();
  return { service, timestamp, signature: computeSignature(secret, service, timestamp) };
}

export interface VerifyInternalServiceRequestOptions {
  secret: string;
  allowedServices: readonly string[];
  toleranceMs?: number;
}

export function verifyInternalServiceRequest(
  token: Partial<InternalServiceToken> | undefined,
  options: VerifyInternalServiceRequestOptions,
): boolean {
  if (!token?.service || !token.timestamp || !token.signature) return false;
  if (!options.allowedServices.includes(token.service)) return false;

  const age = Date.now() - Number(token.timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > (options.toleranceMs ?? DEFAULT_TOLERANCE_MS))
    return false;

  const expected = computeSignature(options.secret, token.service, token.timestamp);
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(token.signature, 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

/** Header names both sides use to carry the token. */
export const INTERNAL_SERVICE_HEADERS = {
  service: 'x-internal-service',
  timestamp: 'x-internal-timestamp',
  signature: 'x-internal-signature',
} as const;
