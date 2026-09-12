'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export function Nav() {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();

  return (
    <nav
      style={{
        display: 'flex',
        gap: '1rem',
        alignItems: 'center',
        padding: '1rem 1.5rem',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <Link href="/" style={{ fontWeight: 600 }}>
        RecoveryAI
      </Link>
      {!isLoading && user && (
        <>
          <Link href="/profile">Profile</Link>
          <Link href="/kyc">KYC status</Link>
          <Link href="/policy">Policy</Link>
          <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{user.email}</span>
          <button
            type="button"
            onClick={async () => {
              await logout();
              router.push('/');
            }}
          >
            Log out
          </button>
        </>
      )}
      {!isLoading && !user && (
        <>
          <Link href="/login" style={{ marginLeft: 'auto' }}>
            Log in
          </Link>
          <Link href="/signup">Sign up</Link>
        </>
      )}
    </nav>
  );
}
