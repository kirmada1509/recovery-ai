'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';

/** Plan Section 2.5: nothing behind this ever renders for a signed-out visitor. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, user, router]);

  if (isLoading) return <p style={{ padding: '2rem' }}>Loading…</p>;
  if (!user) return null;
  return <>{children}</>;
}
