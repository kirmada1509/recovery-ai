import { z } from 'zod';
import {
  baseServiceEnvSchema,
  loadServiceConfig,
  type BaseServiceConfig,
} from '@recoveryai/config-ts';

const evidenceEnvSchema = baseServiceEnvSchema.extend({
  // Shared with every service that verifies an end-user access token
  // (plan Section 2.5) — see auth-service/identity-service.
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('recoveryai-auth'),
  JWT_AUDIENCE: z.string().default('recoveryai-platform'),

  MINIO_ENDPOINT: z.string().default('http://localhost:9000'),
  MINIO_ROOT_USER: z.string().default('recoveryai'),
  MINIO_ROOT_PASSWORD: z.string().default('recoveryai-dev-secret'),
  MINIO_EVIDENCE_BUCKET: z.string().default('recoveryai-evidence'),

  MAX_UPLOAD_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),
  ALLOWED_MIME_TYPES: z
    .string()
    .default('application/pdf,image/jpeg,image/png,image/webp')
    .transform((v) => v.split(',').map((s) => s.trim())),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(20),
});

export type EvidenceServiceConfig = BaseServiceConfig & z.infer<typeof evidenceEnvSchema>;

export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): EvidenceServiceConfig {
  return loadServiceConfig('evidence-service', evidenceEnvSchema, {
    SERVICE_NAME: 'evidence-service',
    PORT: source.PORT ?? '3004',
    ...source,
    ...(source.SERVICE_NAME ? {} : { SERVICE_NAME: 'evidence-service' }),
  });
}
