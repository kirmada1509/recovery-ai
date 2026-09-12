'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

export default function Home() {
  const { user, isLoading } = useAuth();

  return (
    <main style={{ maxWidth: '42rem', margin: '0 auto', padding: '4rem 1.5rem' }}>
      <h1 style={{ fontSize: '1.75rem', margin: '0 0 0.5rem' }}>RecoveryAI</h1>
      <p style={{ color: 'var(--muted)', margin: '0 0 2rem' }}>
        We file your disaster-recovery insurance claim and negotiate your settlement for you.
      </p>
      {!isLoading && !user && (
        <p>
          <Link href="/signup" style={{ fontWeight: 600 }}>
            Get started
          </Link>{' '}
          or <Link href="/login">log in</Link>.
        </p>
      )}
      {!isLoading && user && (
        <p>
          Welcome back. Continue to your <Link href="/profile">profile</Link> or check your{' '}
          <Link href="/kyc">KYC status</Link>.
        </p>
      )}
    </main>
  );
}
