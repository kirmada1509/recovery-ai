import { SQL } from 'bun';

export interface ReadinessResult {
  name: string;
  ok: boolean;
  detail?: string;
  durationMs: number;
}

export interface ReadinessCheck {
  name: string;
  /** Optional checks report status but never make the service unready (plan Section 4.5). */
  optional?: boolean;
  run: () => Promise<void>;
}

/**
 * Readiness checks (plan Section 4.5). A service is ready when every required
 * dependency answers. An optional provider being disabled must not fail readiness.
 */
export class ReadinessRegistry {
  private readonly checks: ReadinessCheck[] = [];

  register(check: ReadinessCheck): this {
    this.checks.push(check);
    return this;
  }

  async run(): Promise<{ ready: boolean; checks: ReadinessResult[] }> {
    const results = await Promise.all(
      this.checks.map(async (check): Promise<ReadinessResult> => {
        const started = performance.now();
        try {
          await check.run();
          return {
            name: check.name,
            ok: true,
            durationMs: Math.round(performance.now() - started),
          };
        } catch (error) {
          return {
            name: check.name,
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
            durationMs: Math.round(performance.now() - started),
          };
        }
      }),
    );

    const required = results.filter((r) => !this.checks.find((c) => c.name === r.name)?.optional);
    return { ready: required.every((r) => r.ok), checks: results };
  }
}

/**
 * Real Postgres connectivity check. Deliberately a genuine round-trip: a readiness
 * endpoint that always returns ok is worse than no readiness endpoint.
 */
export function postgresReadinessCheck(databaseUrl: string): ReadinessCheck {
  return {
    name: 'postgres',
    run: async () => {
      const sql = new SQL(databaseUrl, { max: 1, idleTimeout: 5 });
      try {
        await sql`select 1`;
      } finally {
        await sql.end();
      }
    },
  };
}
