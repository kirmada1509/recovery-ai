import { z } from 'zod';
import {
  baseServiceEnvSchema,
  loadServiceConfig,
  type BaseServiceConfig,
} from '@recoveryai/config-ts';

const claimsEnvSchema = baseServiceEnvSchema.extend({
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('recoveryai-auth'),
  JWT_AUDIENCE: z.string().default('recoveryai-platform'),

  EVIDENCE_SERVICE_URL: z.string().url().default('http://localhost:3004'),
  IDENTITY_SERVICE_URL: z.string().url().default('http://localhost:3002'),
  VERIFICATION_SERVICE_URL: z.string().url().default('http://localhost:8001'),
  AGENT_SERVICE_URL: z.string().url().default('http://localhost:8002'),

  // Shared with verification-service and agent-service for the
  // internal-service-authenticated dispatch/callback pairs (plan Section 2.5).
  INTERNAL_SERVICE_SECRET: z.string().min(20),
  INTERNAL_ALLOWED_CALLERS: z
    .string()
    .default('verification-service,agent-service')
    .transform((v) => v.split(',').map((s) => s.trim())),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(20),

  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
});

export type ClaimsServiceConfig = BaseServiceConfig & z.infer<typeof claimsEnvSchema>;

export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): ClaimsServiceConfig {
  return loadServiceConfig('claims-service', claimsEnvSchema, {
    SERVICE_NAME: 'claims-service',
    PORT: source.PORT ?? '3003',
    ...source,
    ...(source.SERVICE_NAME ? {} : { SERVICE_NAME: 'claims-service' }),
  });
}
