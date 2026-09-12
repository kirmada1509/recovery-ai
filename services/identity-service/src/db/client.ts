import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema.ts';

export type Database = ReturnType<typeof createDatabase>;

/** One Drizzle client per process, backed by Bun's native Postgres driver. */
export function createDatabase(databaseUrl: string) {
  return drizzle(databaseUrl, { schema });
}
