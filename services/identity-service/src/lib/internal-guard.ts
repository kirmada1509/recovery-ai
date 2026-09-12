import { AppError } from '@recoveryai/observability-ts';
import {
  INTERNAL_SERVICE_HEADERS,
  verifyInternalServiceRequest,
} from '@recoveryai/internal-auth-ts';

/**
 * Guards an endpoint a real KYC provider would call as a webhook, not an
 * end user (plan Section 2.5's internal-service auth primitive; §18 P1-T4).
 */
export function requireInternalService(
  headers: Record<string, string | undefined>,
  secret: string,
  allowedServices: readonly string[],
): void {
  const ok = verifyInternalServiceRequest(
    {
      service: headers[INTERNAL_SERVICE_HEADERS.service],
      timestamp: headers[INTERNAL_SERVICE_HEADERS.timestamp],
      signature: headers[INTERNAL_SERVICE_HEADERS.signature],
    },
    { secret, allowedServices },
  );
  if (!ok) throw new AppError('FORBIDDEN', 'Internal service authentication failed', 403);
}
