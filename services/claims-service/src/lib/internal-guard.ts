import { AppError } from '@recoveryai/observability-ts';
import {
  INTERNAL_SERVICE_HEADERS,
  verifyInternalServiceRequest,
} from '@recoveryai/internal-auth-ts';

/** Guards an endpoint only verification-service should call, never an end user. */
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
