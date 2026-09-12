import {
  baseServiceEnvSchema,
  loadServiceConfig,
  type BaseServiceConfig,
} from '@recoveryai/config-ts';

/**
 * Fictional grievance and ombudsman sandbox.
 * Configuration is validated at startup; an invalid environment stops the process
 * before it can serve a request (plan Section 4.6).
 */
export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): BaseServiceConfig {
  return loadServiceConfig('regulator-sandbox-service', baseServiceEnvSchema, {
    SERVICE_NAME: 'regulator-sandbox-service',
    PORT: source.PORT ?? '3008',
    ...source,
    ...(source.SERVICE_NAME ? {} : { SERVICE_NAME: 'regulator-sandbox-service' }),
  });
}
