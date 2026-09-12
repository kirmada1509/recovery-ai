'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { useAuth } from '@/lib/auth-context';

interface AdminClaim {
  id: string;
  userId: string;
  incidentType: string;
  status: string;
  claimedAmountPaise: number | null;
  addressLine1: string | null;
  city: string | null;
}

function AdminClaimDetail({ claimId }: { claimId: string }) {
  const { authFetch } = useAuth();
  const [claim, setClaim] = useState<AdminClaim | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch<{ claim: AdminClaim }>('claims', `admin/claims/${claimId}`)
      .then((result) => setClaim(result.claim))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load claim'));
  }, [authFetch, claimId]);

  if (error) return <p style={{ color: 'var(--danger)' }}>{error}</p>;
  if (!claim) return <p>Loading…</p>;

  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.5rem 1rem' }}>
      <dt style={{ color: 'var(--muted)' }}>Status</dt>
      <dd>{claim.status}</dd>
      <dt style={{ color: 'var(--muted)' }}>Incident</dt>
      <dd>{claim.incidentType}</dd>
      <dt style={{ color: 'var(--muted)' }}>Location</dt>
      <dd>
        {claim.addressLine1}, {claim.city}
      </dd>
      <dt style={{ color: 'var(--muted)' }}>Claimed amount</dt>
      <dd>
        {claim.claimedAmountPaise !== null
          ? `₹${(claim.claimedAmountPaise / 100).toLocaleString('en-IN')}`
          : '—'}
      </dd>
      <dt style={{ color: 'var(--muted)' }}>User ID</dt>
      <dd>{claim.userId}</dd>
    </dl>
  );
}

export default function AdminClaimDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <ProtectedRoute requireRole="admin">
      <main style={{ maxWidth: '32rem', margin: '0 auto', padding: '3rem 1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Claim detail</h1>
        <AdminClaimDetail claimId={params.id} />
      </main>
    </ProtectedRoute>
  );
}
