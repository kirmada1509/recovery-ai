import {
  baseServiceEnvSchema,
  loadServiceConfig,
  type BaseServiceConfig,
} from '@recoveryai/config-ts';

/**
 * Outbound filing to insurers and authorities.
 * Configuration is validated at startup; an invalid environment stops the process
 * before it can serve a request (plan Section 4.6).
 */
export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): BaseServiceConfig {
  return loadServiceConfig('filing-gateway', baseServiceEnvSchema, {
    SERVICE_NAME: 'filing-gateway',
    PORT: source.PORT ?? '3006',
    ...source,
    ...(source.SERVICE_NAME ? {} : { SERVICE_NAME: 'filing-gateway' }),
  });
}
