import { z } from 'zod';
import {
  baseServiceEnvSchema,
  loadServiceConfig,
  providerEnvSchema,
  type BaseServiceConfig,
  type ProviderConfig,
} from '@recoveryai/config-ts';

const identityEnvSchema = baseServiceEnvSchema.merge(providerEnvSchema).extend({
  // Shared with auth-service: verifies the end-user access token presented on
  // every request (plan Section 2.5) without a synchronous call back to
  // auth-service for every profile/KYC read.
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('recoveryai-auth'),
  JWT_AUDIENCE: z.string().default('recoveryai-platform'),

  // Shared with any caller of internal-service endpoints, e.g. the KYC
  // provider webhook (plan Section 2.5).
  INTERNAL_SERVICE_SECRET: z.string().min(20),
  INTERNAL_ALLOWED_CALLERS: z
    .string()
    .default('kyc-provider-mock')
    .transform((v) => v.split(',').map((s) => s.trim())),

  // The mock-completion trigger is a demo/test control, not a production
  // path (plan Section 18 P1-T6) — mirrors ENABLE_DIAGNOSTICS_ROUTES.
  ENABLE_KYC_MOCK_CONTROLS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type IdentityServiceConfig = BaseServiceConfig &
  ProviderConfig &
  z.infer<typeof identityEnvSchema>;

export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): IdentityServiceConfig {
  return loadServiceConfig('identity-service', identityEnvSchema, {
    SERVICE_NAME: 'identity-service',
    PORT: source.PORT ?? '3002',
    ...source,
    ...(source.SERVICE_NAME ? {} : { SERVICE_NAME: 'identity-service' }),
  });
}
