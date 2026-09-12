import { z } from 'zod';

/**
 * Startup configuration validation (plan Section 4.6).
 *
 * Every service validates its environment before it accepts a request, and fails
 * fast with an actionable message rather than surfacing an undefined value later.
 */
export class ConfigurationError extends Error {
  public readonly issues: string[];

  constructor(serviceName: string, issues: string[]) {
    super(`Invalid configuration for ${serviceName}:\n` + issues.map((i) => `  - ${i}`).join('\n'));
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}

const portSchema = z.coerce.number().int().min(1).max(65535);

/** Environment every service shares. Service-specific keys extend this. */
export const baseServiceEnvSchema = z.object({
  SERVICE_NAME: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ENVIRONMENT: z.string().default('local'),
  PORT: portSchema,
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_TRACES_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  DATABASE_URL: z.string().min(1),
  ENABLE_DIAGNOSTICS_ROUTES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type BaseServiceConfig = z.infer<typeof baseServiceEnvSchema>;

/**
 * Validate `source` (defaults to process.env) against `schema`.
 * Throws ConfigurationError listing every problem, not just the first.
 */
export function loadServiceConfig<T extends z.ZodTypeAny>(
  serviceName: string,
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `${path}: ${issue.message}`;
    });
    throw new ConfigurationError(serviceName, issues);
  }
  return result.data;
}
