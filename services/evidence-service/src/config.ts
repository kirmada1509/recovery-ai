import {
  baseServiceEnvSchema,
  loadServiceConfig,
  type BaseServiceConfig,
} from '@recoveryai/config-ts';

/**
 * Document metadata and object storage.
 * Configuration is validated at startup; an invalid environment stops the process
 * before it can serve a request (plan Section 4.6).
 */
export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): BaseServiceConfig {
  return loadServiceConfig('evidence-service', baseServiceEnvSchema, {
    SERVICE_NAME: 'evidence-service',
    PORT: source.PORT ?? '3004',
    ...source,
    ...(source.SERVICE_NAME ? {} : { SERVICE_NAME: 'evidence-service' }),
  });
}
