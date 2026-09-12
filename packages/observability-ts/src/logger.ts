import { trace } from '@opentelemetry/api';
import pino, { type Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

/**
 * Never log a secret or raw PII (plan Section 4.2 / 14.3). Pino redacts these paths
 * wherever they appear in a log object, so an accidental `log.info({ user })` cannot
 * leak a token or an identity document.
 */
export const REDACTED_PATHS = [
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'refresh_token',
  'authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'cookie',
  'apiKey',
  'api_key',
  'secret',
  'signedUrl',
  'downloadUrl',
  'presignedUrl',
  'aadhaar',
  'aadhaarNumber',
  'policyText',
  'kycPayload',
  '*.password',
  '*.token',
  '*.refreshToken',
  '*.authorization',
] as const;

export interface LoggerOptions {
  service: string;
  environment: string;
  level: string;
  pretty: boolean;
}

/**
 * Structured JSON logger carrying the fields required by plan Section 4.2.
 * `trace_id` / `span_id` are attached automatically from the active span, so a log
 * line can always be joined to its trace.
 */
export function createLogger(options: LoggerOptions): Logger {
  return pino({
    level: options.level,
    base: { service: options.service, environment: options.environment },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: { paths: [...REDACTED_PATHS], censor: '[REDACTED]' },
    mixin() {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const ctx = span.spanContext();
      return { trace_id: ctx.traceId, span_id: ctx.spanId };
    },
    ...(options.pretty
      ? {
          transport: {
            target: 'pino/file',
            options: { destination: 1 },
          },
        }
      : {}),
  });
}
