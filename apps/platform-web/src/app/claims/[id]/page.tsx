'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { useAuth } from '@/lib/auth-context';

interface Claim {
  id: string;
  incidentType: string;
  status: string;
  claimedAmountPaise: number | null;
  city: string | null;
}

interface ClaimEvent {
  id: string;
  type: string;
  actorType: string;
  createdAt: string;
}

function Timeline({ claimId }: { claimId: string }) {
  const { authFetch } = useAuth();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [events, setEvents] = useState<ClaimEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      authFetch<{ claim: Claim }>('claims', `claims/${claimId}`),
      authFetch<{ events: ClaimEvent[] }>('claims', `claims/${claimId}/events`),
    ])
      .then(([claimResult, eventsResult]) => {
        setClaim(claimResult.claim);
        setEvents(eventsResult.events);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load claim'));
  }, [authFetch, claimId]);

  if (error) return <p style={{ color: 'var(--danger)' }}>{error}</p>;
  if (!claim || !events) return <p>Loading…</p>;

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <div>
        <p style={{ margin: 0 }}>
          <strong>{claim.incidentType}</strong> — {claim.city}
        </p>
        <p style={{ color: 'var(--muted)', margin: 0 }}>Status: {claim.status}</p>
      </div>
      <div>
        <h2 style={{ fontSize: '1.1rem' }}>Timeline</h2>
        <ol style={{ display: 'grid', gap: '0.5rem', padding: 0, listStyle: 'none' }}>
          {events.map((event) => (
            <li
              key={event.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderLeft: '2px solid var(--border)',
                paddingLeft: '0.75rem',
              }}
            >
              <span>{event.type}</span>
              <span style={{ color: 'var(--muted)' }}>
                {new Date(event.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default function ClaimDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <ProtectedRoute>
      <main style={{ maxWidth: '32rem', margin: '0 auto', padding: '3rem 1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Claim detail</h1>
        <Timeline claimId={params.id} />
      </main>
    </ProtectedRoute>
  );
}
