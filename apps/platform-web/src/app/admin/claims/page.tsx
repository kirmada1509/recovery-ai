'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { useAuth } from '@/lib/auth-context';

interface AdminClaim {
  id: string;
  userId: string;
  incidentType: string;
  status: string;
  claimedAmountPaise: number | null;
}

function AdminClaimsList() {
  const { authFetch } = useAuth();
  const [claims, setClaims] = useState<AdminClaim[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch<{ claims: AdminClaim[] }>('claims', 'admin/claims')
      .then((result) => setClaims(result.claims))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load claims'));
  }, [authFetch]);

  if (error) return <p style={{ color: 'var(--danger)' }}>{error}</p>;
  if (!claims) return <p>Loading…</p>;
  if (claims.length === 0) return <p style={{ color: 'var(--muted)' }}>No claims yet.</p>;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
          <th style={{ padding: '0.5rem 0' }}>Incident</th>
          <th>Status</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        {claims.map((claim) => (
          <tr key={claim.id} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ padding: '0.5rem 0' }}>
              <Link href={`/admin/claims/${claim.id}`}>{claim.incidentType}</Link>
            </td>
            <td>{claim.status}</td>
            <td>
              {claim.claimedAmountPaise !== null
                ? `₹${(claim.claimedAmountPaise / 100).toLocaleString('en-IN')}`
                : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AdminClaimsPage() {
  return (
    <ProtectedRoute requireRole="admin">
      <main style={{ maxWidth: '40rem', margin: '0 auto', padding: '3rem 1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>All claims</h1>
        <AdminClaimsList />
      </main>
    </ProtectedRoute>
  );
}
