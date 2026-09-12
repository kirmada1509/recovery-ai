import {
  baseServiceEnvSchema,
  loadServiceConfig,
  type BaseServiceConfig,
} from '@recoveryai/config-ts';

/**
 * User profiles and KYC cases.
 * Configuration is validated at startup; an invalid environment stops the process
 * before it can serve a request (plan Section 4.6).
 */
export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): BaseServiceConfig {
  return loadServiceConfig('identity-service', baseServiceEnvSchema, {
    SERVICE_NAME: 'identity-service',
    PORT: source.PORT ?? '3002',
    ...source,
    ...(source.SERVICE_NAME ? {} : { SERVICE_NAME: 'identity-service' }),
  });
}
