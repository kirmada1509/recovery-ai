import { AppError } from '@recoveryai/observability-ts';
import { Elysia, t } from 'elysia';
import type { AuthServiceConfig } from '../config.ts';
import type { Database } from '../db/client.ts';
import { sessions, users } from '../db/schema.ts';
import { hashPassword, normalizeEmail, verifyPassword } from '../domain/password.ts';
import { hashRefreshToken, signAccessToken } from '../domain/tokens.ts';
import {
  createSession,
  revokeAllSessionsForUser,
  revokeSession,
  rotateSession,
  type SessionContext,
} from '../domain/sessions.ts';
import { resolveAuthUser, requireUser } from '../lib/auth-context.ts';
import { RateLimiter } from '../lib/rate-limit.ts';
import { eq } from 'drizzle-orm';

export interface AuthRoutesOptions {
  db: Database;
  config: AuthServiceConfig;
}

async function hashUserAgent(request: Request): Promise<string | null> {
  const ua = request.headers.get('user-agent');
  if (!ua) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ua));
  return Buffer.from(digest).toString('hex');
}

const publicUser = (user: typeof users.$inferSelect) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  status: user.status,
});

export function authRoutes(options: AuthRoutesOptions) {
  const { db, config } = options;
  const loginLimiter = new RateLimiter(config.RATE_LIMIT_WINDOW_MS, config.RATE_LIMIT_MAX_ATTEMPTS);
  const refreshCookieOptions = {
    httpOnly: true,
    secure: config.REFRESH_COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/v1/auth',
    domain: config.REFRESH_COOKIE_DOMAIN,
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  };

  async function issueTokens(
    userId: string,
    role: 'victim' | 'admin',
    tokenVersion: number,
    ctx: SessionContext,
  ) {
    const { session, refreshToken } = await createSession(
      db,
      userId,
      ctx,
      config.REFRESH_TOKEN_TTL_DAYS,
    );
    const accessToken = await signAccessToken(
      { userId, role, sessionId: session.id, tokenVersion },
      {
        secret: config.JWT_SECRET,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
        ttlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
      },
    );
    return { accessToken, refreshToken };
  }

  return new Elysia({ name: 'auth-routes' })
    .derive(async ({ headers }) => ({
      authUser: await resolveAuthUser(headers.authorization, {
        secret: config.JWT_SECRET,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      }),
    }))
    .post(
      '/v1/auth/signup',
      async ({ body, request, cookie, set }) => {
        loginLimiter.consume(`signup:${request.headers.get('x-request-id') ?? 'anon'}`);
        const email = normalizeEmail(body.email);

        const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (existing)
          throw new AppError('EMAIL_TAKEN', 'An account with this email already exists', 409);

        const passwordHash = await hashPassword(body.password);
        const [user] = await db
          .insert(users)
          .values({ email, name: body.name, passwordHash, role: 'victim' })
          .returning();
        if (!user) throw new Error('user insert returned no row');

        const { accessToken, refreshToken } = await issueTokens(
          user.id,
          user.role,
          user.tokenVersion,
          {
            userAgentHash: await hashUserAgent(request),
            ipHash: null,
          },
        );
        cookie[config.REFRESH_COOKIE_NAME]?.set({ value: refreshToken, ...refreshCookieOptions });

        set.status = 201;
        return { user: publicUser(user), accessToken };
      },
      {
        body: t.Object({
          email: t.String({ format: 'email' }),
          name: t.String({ minLength: 1, maxLength: 200 }),
          password: t.String({ minLength: 8, maxLength: 200 }),
        }),
      },
    )
    .post(
      '/v1/auth/login',
      async ({ body, request, cookie }) => {
        loginLimiter.consume(`login:${normalizeEmail(body.email)}`);
        const email = normalizeEmail(body.email);

        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;
        if (!user || !valid) {
          throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
        }
        if (user.status !== 'active') {
          throw new AppError('ACCOUNT_DISABLED', 'Account is disabled', 401);
        }

        const { accessToken, refreshToken } = await issueTokens(
          user.id,
          user.role,
          user.tokenVersion,
          {
            userAgentHash: await hashUserAgent(request),
            ipHash: null,
          },
        );
        cookie[config.REFRESH_COOKIE_NAME]?.set({ value: refreshToken, ...refreshCookieOptions });

        return { user: publicUser(user), accessToken };
      },
      {
        body: t.Object({
          email: t.String({ format: 'email' }),
          password: t.String({ minLength: 1, maxLength: 200 }),
        }),
      },
    )
    .post('/v1/auth/refresh', async ({ cookie, request }) => {
      const cookieJar = cookie[config.REFRESH_COOKIE_NAME];
      const rawToken = cookieJar?.value as string | undefined;
      if (!rawToken) throw new AppError('INVALID_REFRESH_TOKEN', 'Refresh token is missing', 401);

      loginLimiter.consume(`refresh:${rawToken.slice(0, 16)}`);

      const rotated = await rotateSession(
        db,
        rawToken,
        { userAgentHash: await hashUserAgent(request), ipHash: null },
        config.REFRESH_TOKEN_TTL_DAYS,
      );
      const accessToken = await signAccessToken(
        {
          userId: rotated.userId,
          role: rotated.role,
          sessionId: rotated.session.id,
          tokenVersion: rotated.tokenVersion,
        },
        {
          secret: config.JWT_SECRET,
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          ttlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
        },
      );
      cookieJar?.set({ value: rotated.refreshToken, ...refreshCookieOptions });

      return { accessToken };
    })
    .post('/v1/auth/logout', async ({ cookie }) => {
      const cookieJar = cookie[config.REFRESH_COOKIE_NAME];
      const rawToken = cookieJar?.value as string | undefined;
      if (rawToken) {
        const hash = await hashRefreshToken(rawToken);
        const [session] = await db
          .select()
          .from(sessions)
          .where(eq(sessions.refreshTokenHash, hash))
          .limit(1);
        if (session) await revokeSession(db, session.id);
      }
      cookieJar?.remove();
      return { ok: true };
    })
    .post('/v1/auth/logout-all', async ({ authUser, cookie }) => {
      const user = requireUser(authUser);
      await revokeAllSessionsForUser(db, user.sub);
      await db
        .update(users)
        .set({ tokenVersion: user.token_version + 1, updatedAt: new Date() })
        .where(eq(users.id, user.sub));
      cookie[config.REFRESH_COOKIE_NAME]?.remove();
      return { ok: true };
    })
    .get('/v1/auth/me', async ({ authUser }) => {
      const claims = requireUser(authUser);
      const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
      if (!user) throw new AppError('NOT_FOUND', 'User not found', 404);
      return { user: publicUser(user) };
    });
}
