import {
  baseServiceEnvSchema,
  loadServiceConfig,
  type BaseServiceConfig,
} from '@recoveryai/config-ts';

/**
 * Fictional insurer sandbox.
 * Configuration is validated at startup; an invalid environment stops the process
 * before it can serve a request (plan Section 4.6).
 */
export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): BaseServiceConfig {
  return loadServiceConfig('insurer-sandbox-service', baseServiceEnvSchema, {
    SERVICE_NAME: 'insurer-sandbox-service',
    PORT: source.PORT ?? '3007',
    ...source,
    ...(source.SERVICE_NAME ? {} : { SERVICE_NAME: 'insurer-sandbox-service' }),
  });
}
