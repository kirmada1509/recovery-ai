'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';

interface ProtectedRouteProps {
  children: ReactNode;
  /** When set, only a signed-in user with this role sees the children. */
  requireRole?: 'admin' | 'victim';
}

/** Plan Section 2.5: nothing behind this ever renders for a signed-out visitor. */
export function ProtectedRoute({ children, requireRole }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const forbidden = !!user && !!requireRole && user.role !== requireRole;

  useEffect(() => {
    if (isLoading) return;
    if (!user) router.replace('/login');
    else if (forbidden) router.replace('/');
  }, [isLoading, user, forbidden, router]);

  if (isLoading) return <p style={{ padding: '2rem' }}>Loading…</p>;
  if (!user || forbidden) return null;
  return <>{children}</>;
}
