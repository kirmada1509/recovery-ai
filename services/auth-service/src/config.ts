import { z } from 'zod';
import {
  baseServiceEnvSchema,
  loadServiceConfig,
  type BaseServiceConfig,
} from '@recoveryai/config-ts';

const authEnvSchema = baseServiceEnvSchema.extend({
  // Symmetric secret shared with every service that verifies end-user access
  // tokens (plan Section 2.5). Rotate by adding a JWKS-backed key set later;
  // out of scope for the MVP mock realm.
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('recoveryai-auth'),
  JWT_AUDIENCE: z.string().default('recoveryai-platform'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  REFRESH_COOKIE_NAME: z.string().default('rai_refresh'),
  REFRESH_COOKIE_DOMAIN: z.string().optional(),
  // Secure cookies cannot be sent over plain HTTP, which is how the local
  // Compose stack runs — any non-local deployment must set this true.
  REFRESH_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Shared secret for verifying HMAC-signed internal service calls
  // (plan Section 2.5), e.g. identity-service's KYC provider webhook.
  INTERNAL_SERVICE_SECRET: z.string().min(20),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
});

export type AuthServiceConfig = BaseServiceConfig & z.infer<typeof authEnvSchema>;

export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): AuthServiceConfig {
  return loadServiceConfig('auth-service', authEnvSchema, {
    SERVICE_NAME: 'auth-service',
    PORT: source.PORT ?? '3001',
    ...source,
    ...(source.SERVICE_NAME ? {} : { SERVICE_NAME: 'auth-service' }),
  });
}
