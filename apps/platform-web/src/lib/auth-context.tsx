'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'victim' | 'admin';
  status: 'active' | 'disabled';
}

interface ErrorEnvelope {
  error: { code: string; message: string; requestId: string; details: Record<string, unknown> };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseOrThrow<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    const envelope = body as ErrorEnvelope;
    throw new ApiError(
      envelope.error?.code ?? 'UNKNOWN_ERROR',
      envelope.error?.message ?? 'Request failed',
    );
  }
  return body as T;
}

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  /** True until the initial silent-refresh attempt on page load resolves. */
  isLoading: boolean;
  signup: (email: string, name: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Fetches a same-origin backend-proxy path (e.g. service "identity", path
   * "profile") with the current access token attached. The access token is
   * held only in memory — never in localStorage (plan Section 14.1) — so it
   * does not survive a full page reload; callers see a signed-out state
   * until the silent refresh above completes.
   */
  authFetch: <T>(
    service: 'identity' | 'evidence' | 'claims',
    path: string,
    init?: RequestInit,
  ) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const refreshed = await parseOrThrow<{ accessToken: string }>(
          await fetch('/api/auth/refresh', { method: 'POST' }),
        );
        const me = await parseOrThrow<{ user: AuthUser }>(
          await fetch('/api/auth/me', {
            headers: { authorization: `Bearer ${refreshed.accessToken}` },
          }),
        );
        setAccessToken(refreshed.accessToken);
        setUser(me.user);
      } catch {
        setAccessToken(null);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const signup = useCallback(async (email: string, name: string, password: string) => {
    const result = await parseOrThrow<{ user: AuthUser; accessToken: string }>(
      await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name, password }),
      }),
    );
    setUser(result.user);
    setAccessToken(result.accessToken);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await parseOrThrow<{ user: AuthUser; accessToken: string }>(
      await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );
    setUser(result.user);
    setAccessToken(result.accessToken);
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setAccessToken(null);
  }, []);

  const authFetch = useCallback(
    async <T,>(
      service: 'identity' | 'evidence' | 'claims',
      path: string,
      init: RequestInit = {},
    ): Promise<T> => {
      const headers = new Headers(init.headers);
      if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
      // Never set content-type for a FormData body — fetch must generate its
      // own multipart boundary, and an explicit header here would break it.
      if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      return parseOrThrow<T>(await fetch(`/api/${service}/${path}`, { ...init, headers }));
    },
    [accessToken],
  );

  const value = useMemo(
    () => ({ user, accessToken, isLoading, signup, login, logout, authFetch }),
    [user, accessToken, isLoading, signup, login, logout, authFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
