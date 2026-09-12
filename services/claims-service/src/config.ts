import {
  baseServiceEnvSchema,
  loadServiceConfig,
  type BaseServiceConfig,
} from '@recoveryai/config-ts';

/**
 * Policies, claims, mandates, authorizations and filings.
 * Configuration is validated at startup; an invalid environment stops the process
 * before it can serve a request (plan Section 4.6).
 */
export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): BaseServiceConfig {
  return loadServiceConfig('claims-service', baseServiceEnvSchema, {
    SERVICE_NAME: 'claims-service',
    PORT: source.PORT ?? '3003',
    ...source,
    ...(source.SERVICE_NAME ? {} : { SERVICE_NAME: 'claims-service' }),
  });
}
