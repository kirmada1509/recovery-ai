import { eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { IdentityServiceConfig } from '../config.ts';
import type { Database } from '../db/client.ts';
import { profiles } from '../db/schema.ts';
import { resolveAuthUser, requireUser } from '../lib/auth-context.ts';

export interface ProfileRoutesOptions {
  db: Database;
  config: IdentityServiceConfig;
}

const publicProfile = (profile: typeof profiles.$inferSelect) => ({
  userId: profile.userId,
  phoneE164: profile.phoneE164,
  preferredLocale: profile.preferredLocale,
  addressLine1: profile.addressLine1,
  addressLine2: profile.addressLine2,
  city: profile.city,
  state: profile.state,
  postalCode: profile.postalCode,
  country: profile.country,
  latitude: profile.latitude,
  longitude: profile.longitude,
});

export function profileRoutes(options: ProfileRoutesOptions) {
  const { db, config } = options;
  const verifyConfig = {
    secret: config.JWT_SECRET,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  };

  return new Elysia({ name: 'profile-routes' })
    .derive(async ({ headers }) => ({
      authUser: await resolveAuthUser(headers.authorization, verifyConfig),
    }))
    .get('/v1/profile', async ({ authUser }) => {
      const user = requireUser(authUser);
      const [profile] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, user.sub))
        .limit(1);
      return { profile: profile ? publicProfile(profile) : null };
    })
    .put(
      '/v1/profile',
      async ({ authUser, body }) => {
        const user = requireUser(authUser);
        const [profile] = await db
          .insert(profiles)
          .values({ userId: user.sub, ...body })
          .onConflictDoUpdate({
            target: profiles.userId,
            set: { ...body, updatedAt: new Date() },
          })
          .returning();
        if (!profile) throw new Error('profile upsert returned no row');
        return { profile: publicProfile(profile) };
      },
      {
        body: t.Object({
          phoneE164: t.Optional(t.String({ maxLength: 20 })),
          preferredLocale: t.Optional(t.String({ maxLength: 20 })),
          addressLine1: t.Optional(t.String({ maxLength: 300 })),
          addressLine2: t.Optional(t.String({ maxLength: 300 })),
          city: t.Optional(t.String({ maxLength: 200 })),
          state: t.Optional(t.String({ maxLength: 200 })),
          postalCode: t.Optional(t.String({ maxLength: 20 })),
          country: t.Optional(t.String({ maxLength: 2 })),
          latitude: t.Optional(t.Number()),
          longitude: t.Optional(t.Number()),
        }),
      },
    );
}
