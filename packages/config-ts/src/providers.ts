import { z } from 'zod';

/**
 * Provider selection (plan Section 2.10). Every external dependency is an adapter
 * with a deterministic local implementation, and `mock`/`sandbox`/`console`/`local`
 * are the defaults so a fresh clone runs with no credentials.
 */
export const providerEnvSchema = z.object({
  KYC_PROVIDER: z.enum(['mock']).default('mock'),
  DISASTER_PROVIDER: z.enum(['mock']).default('mock'),
  GEOCODER_PROVIDER: z.enum(['mock']).default('mock'),
  IMAGE_ANALYSIS_PROVIDER: z.enum(['mock']).default('mock'),
  LLM_PROVIDER: z.enum(['mock', 'openai-compatible']).default('mock'),
  EMAIL_PROVIDER: z.enum(['console']).default('console'),
  OBJECT_STORAGE_PROVIDER: z.enum(['minio', 's3']).default('minio'),
  INSURER_ADAPTER: z.enum(['sandbox']).default('sandbox'),
  FILING_MODE: z.enum(['agent_files', 'user_assisted']).default('agent_files'),
  FILING_ADAPTER_INSURER: z.enum(['sandbox']).default('sandbox'),
  FILING_ADAPTER_AUTHORITY: z.enum(['sandbox']).default('sandbox'),
  ESIGN_PROVIDER: z.enum(['local']).default('local'),
});

export type ProviderConfig = z.infer<typeof providerEnvSchema>;
