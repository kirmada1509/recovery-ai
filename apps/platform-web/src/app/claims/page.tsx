'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { useAuth } from '@/lib/auth-context';

interface ClaimSummary {
  id: string;
  incidentType: string;
  status: string;
  claimedAmountPaise: number | null;
  createdAt: string;
}

function formatPaise(paise: number | null): string {
  if (paise === null) return '—';
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

function ClaimsList() {
  const { authFetch } = useAuth();
  const [claims, setClaims] = useState<ClaimSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch<{ claims: ClaimSummary[] }>('claims', 'claims')
      .then((result) => setClaims(result.claims))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load claims'));
  }, [authFetch]);

  if (error) return <p style={{ color: 'var(--danger)' }}>{error}</p>;
  if (!claims) return <p>Loading…</p>;
  if (claims.length === 0) {
    return <p style={{ color: 'var(--muted)' }}>No claims yet. Start one below.</p>;
  }

  return (
    <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
      {claims.map((claim) => (
        <li key={claim.id}>
          <Link
            href={`/claims/${claim.id}`}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
              border: '1px solid var(--border)',
              borderRadius: '0.5rem',
            }}
          >
            <span>{claim.incidentType}</span>
            <span style={{ color: 'var(--muted)' }}>{claim.status}</span>
            <span>{formatPaise(claim.claimedAmountPaise)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function ClaimsPage() {
  return (
    <ProtectedRoute>
      <main style={{ maxWidth: '32rem', margin: '0 auto', padding: '3rem 1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem',
          }}
        >
          <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Your claims</h1>
          <Link href="/claims/new">New claim</Link>
        </div>
        <ClaimsList />
      </main>
    </ProtectedRoute>
  );
}
