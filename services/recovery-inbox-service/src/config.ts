import {
  baseServiceEnvSchema,
  loadServiceConfig,
  type BaseServiceConfig,
} from '@recoveryai/config-ts';

/**
 * Victim inbox messages and actions.
 * Configuration is validated at startup; an invalid environment stops the process
 * before it can serve a request (plan Section 4.6).
 */
export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): BaseServiceConfig {
  return loadServiceConfig('recovery-inbox-service', baseServiceEnvSchema, {
    SERVICE_NAME: 'recovery-inbox-service',
    PORT: source.PORT ?? '3005',
    ...source,
    ...(source.SERVICE_NAME ? {} : { SERVICE_NAME: 'recovery-inbox-service' }),
  });
}
