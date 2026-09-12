import { AppError } from '@recoveryai/observability-ts';
import { eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { AuthServiceConfig } from '../config.ts';
import type { Database } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { revokeAllSessionsForUser } from '../domain/sessions.ts';
import { resolveAuthUser, requireRole } from '../lib/auth-context.ts';

export interface AdminRoutesOptions {
  db: Database;
  config: AuthServiceConfig;
}

export function adminRoutes(options: AdminRoutesOptions) {
  const { db, config } = options;

  return new Elysia({ name: 'admin-routes' })
    .derive(async ({ headers }) => ({
      authUser: await resolveAuthUser(headers.authorization, {
        secret: config.JWT_SECRET,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      }),
    }))
    .post(
      '/v1/admin/users/:id/disable',
      async ({ authUser, params }) => {
        requireRole(authUser, 'admin');
        const [user] = await db
          .update(users)
          .set({ status: 'disabled', updatedAt: new Date() })
          .where(eq(users.id, params.id))
          .returning();
        if (!user) throw new AppError('NOT_FOUND', 'User not found', 404);
        // Disabling revokes access immediately rather than waiting for the
        // access JWT to expire.
        await revokeAllSessionsForUser(db, user.id);
        await db
          .update(users)
          .set({ tokenVersion: user.tokenVersion + 1 })
          .where(eq(users.id, user.id));
        return { user: { id: user.id, status: user.status } };
      },
      { params: t.Object({ id: t.String({ format: 'uuid' }) }) },
    )
    .post(
      '/v1/admin/users/:id/enable',
      async ({ authUser, params }) => {
        requireRole(authUser, 'admin');
        const [user] = await db
          .update(users)
          .set({ status: 'active', updatedAt: new Date() })
          .where(eq(users.id, params.id))
          .returning();
        if (!user) throw new AppError('NOT_FOUND', 'User not found', 404);
        return { user: { id: user.id, status: user.status } };
      },
      { params: t.Object({ id: t.String({ format: 'uuid' }) }) },
    );
}
