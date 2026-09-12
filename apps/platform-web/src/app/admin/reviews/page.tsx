'use client';

import { useEffect, useState } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { useAuth } from '@/lib/auth-context';

interface ManualReview {
  id: string;
  claimId: string;
  reasonCode: string;
  reasonText: string | null;
  status: string;
}

interface VerificationSignal {
  type: string;
  provider: string;
  score: number;
  weight: number;
  result: Record<string, unknown>;
}

interface VerificationRun {
  decision: string;
  overallScore: number;
  reasons: string[];
  signals: VerificationSignal[];
}

function ReviewDetail({ review, onResolved }: { review: ManualReview; onResolved: () => void }) {
  const { authFetch } = useAuth();
  const [verification, setVerification] = useState<VerificationRun | null | undefined>(undefined);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setVerification(undefined);
    authFetch<{ run: VerificationRun | null }>(
      'claims',
      `admin/claims/${review.claimId}/verification`,
    )
      .then((result) => setVerification(result.run))
      .catch(() => setVerification(null));
  }, [authFetch, review.claimId]);

  async function resolve(decision: 'approve' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      await authFetch('claims', `admin/manual-reviews/${review.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ decision, note: note || undefined }),
      });
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve review');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        padding: '1rem',
        display: 'grid',
        gap: '0.75rem',
      }}
    >
      <p style={{ margin: 0 }}>
        <strong>{review.reasonCode}</strong> — {review.reasonText}
      </p>
      {verification === undefined && (
        <p style={{ color: 'var(--muted)', margin: 0 }}>Loading signals…</p>
      )}
      {verification === null && (
        <p style={{ color: 'var(--muted)', margin: 0 }}>No verification run found.</p>
      )}
      {verification && (
        <div style={{ display: 'grid', gap: '0.25rem' }}>
          <p style={{ margin: 0 }}>
            Decision: <strong>{verification.decision}</strong> (score{' '}
            {verification.overallScore.toFixed(2)})
          </p>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {verification.signals.map((signal) => (
              <li key={signal.type}>
                {signal.type}: {signal.score.toFixed(2)} (weight {signal.weight})
              </li>
            ))}
          </ul>
        </div>
      )}
      <label>
        Note
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.5rem' }}
        />
      </label>
      {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" disabled={busy} onClick={() => resolve('approve')}>
          Approve
        </button>
        <button type="button" disabled={busy} onClick={() => resolve('reject')}>
          Reject
        </button>
      </div>
    </div>
  );
}

function ReviewQueue() {
  const { authFetch } = useAuth();
  const [reviews, setReviews] = useState<ManualReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    authFetch<{ manualReviews: ManualReview[] }>('claims', 'admin/manual-reviews')
      .then((result) => setReviews(result.manualReviews))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load reviews'));
  };

  useEffect(load, [authFetch]);

  if (error) return <p style={{ color: 'var(--danger)' }}>{error}</p>;
  if (!reviews) return <p>Loading…</p>;
  if (reviews.length === 0) return <p style={{ color: 'var(--muted)' }}>No open reviews.</p>;

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {reviews.map((review) => (
        <ReviewDetail key={review.id} review={review} onResolved={load} />
      ))}
    </div>
  );
}

export default function AdminReviewsPage() {
  return (
    <ProtectedRoute requireRole="admin">
      <main style={{ maxWidth: '32rem', margin: '0 auto', padding: '3rem 1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Manual reviews</h1>
        <ReviewQueue />
      </main>
    </ProtectedRoute>
  );
}
