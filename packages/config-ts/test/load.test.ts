import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { ConfigurationError, baseServiceEnvSchema, loadServiceConfig } from '../src/index.ts';

const validEnv = {
  SERVICE_NAME: 'test-service',
  PORT: '3001',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
};

describe('loadServiceConfig', () => {
  it('accepts a valid environment and applies defaults', () => {
    const config = loadServiceConfig('test-service', baseServiceEnvSchema, validEnv);
    expect(config.SERVICE_NAME).toBe('test-service');
    expect(config.PORT).toBe(3001);
    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.OTEL_TRACES_ENABLED).toBe(true);
    expect(config.ENABLE_DIAGNOSTICS_ROUTES).toBe(false);
  });

  it('coerces PORT to a number', () => {
    const config = loadServiceConfig('test-service', baseServiceEnvSchema, validEnv);
    expect(typeof config.PORT).toBe('number');
  });

  it('fails fast when a required variable is missing', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = validEnv;
    expect(() => loadServiceConfig('test-service', baseServiceEnvSchema, withoutDb)).toThrow(
      ConfigurationError,
    );
  });

  it('reports every problem, not just the first', () => {
    try {
      loadServiceConfig('test-service', baseServiceEnvSchema, { PORT: 'not-a-port' });
      throw new Error('expected ConfigurationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const issues = (error as ConfigurationError).issues;
      expect(issues.length).toBeGreaterThanOrEqual(3);
      expect(issues.some((i) => i.startsWith('SERVICE_NAME'))).toBe(true);
      expect(issues.some((i) => i.startsWith('PORT'))).toBe(true);
      expect(issues.some((i) => i.startsWith('DATABASE_URL'))).toBe(true);
    }
  });

  it('rejects an out-of-range port', () => {
    expect(() =>
      loadServiceConfig('test-service', baseServiceEnvSchema, { ...validEnv, PORT: '99999' }),
    ).toThrow(ConfigurationError);
  });

  it('supports service-specific extensions', () => {
    const schema = baseServiceEnvSchema.extend({ JWT_ISSUER: z.string().min(1) });
    const config = loadServiceConfig('auth-service', schema, {
      ...validEnv,
      JWT_ISSUER: 'recoveryai',
    });
    expect(config.JWT_ISSUER).toBe('recoveryai');
  });
});
