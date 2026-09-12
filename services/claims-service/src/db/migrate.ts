import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SQL } from 'bun';

/**
 * Applies the SQL files `drizzle-kit generate` produces, in filename order,
 * tracked in a `_drizzle_migrations` table so re-running is a no-op. Runs on
 * Bun's native Postgres client (`bun-sql`) rather than drizzle-kit's own
 * `migrate` command, which requires a `pg`/`postgres` driver package this
 * service doesn't otherwise need.
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const migrationsDir = join(import.meta.dir, '..', '..', 'drizzle');
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

  const sql = new SQL(databaseUrl, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _drizzle_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    for (const file of files) {
      const [existing] = await sql`SELECT 1 FROM _drizzle_migrations WHERE name = ${file}`;
      if (existing) {
        process.stdout.write(`skip  ${file} (already applied)\n`);
        continue;
      }

      const content = await readFile(join(migrationsDir, file), 'utf8');
      const statements = content
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);

      await sql.begin(async (tx) => {
        for (const statement of statements) {
          await tx.unsafe(statement);
        }
        await tx`INSERT INTO _drizzle_migrations (name) VALUES (${file})`;
      });
      process.stdout.write(`apply ${file}\n`);
    }
  } finally {
    await sql.end();
  }
}

await main();
