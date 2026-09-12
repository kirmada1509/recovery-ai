'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { useAuth } from '@/lib/auth-context';
import { inputStyle } from '@/lib/form-styles';

interface KycCase {
  id: string;
  status: 'pending' | 'verified' | 'failed';
  maskedIdentifier: string | null;
  verifiedName: string | null;
  failureReason: string | null;
}

type KycStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'FAILED';

function KycPanel() {
  const { authFetch } = useAuth();
  const [kase, setKase] = useState<KycCase | null>(null);
  const [status, setStatus] = useState<KycStatus>('UNVERIFIED');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [identifierLast4, setIdentifierLast4] = useState('');

  const load = useCallback(async () => {
    const result = await authFetch<{ case: KycCase | null; kycStatus: KycStatus }>(
      'kyc/cases/latest',
    );
    setKase(result.case);
    setStatus(result.kycStatus);
  }, [authFetch]);

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load KYC status'))
      .finally(() => setLoading(false));
  }, [load]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await authFetch('kyc/cases', {
        method: 'POST',
        body: JSON.stringify({ fullName, identifierLast4 }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start verification');
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete() {
    if (!kase) return;
    setError(null);
    setBusy(true);
    try {
      await authFetch(`kyc/mock/${kase.id}/complete`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete verification');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p>Loading…</p>;

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <p>
        Status: <strong>{status}</strong>
      </p>

      {(status === 'UNVERIFIED' || status === 'FAILED') && (
        <form onSubmit={handleCreate} style={{ display: 'grid', gap: '0.75rem' }}>
          {status === 'FAILED' && kase?.failureReason && (
            <p style={{ color: 'var(--danger)', margin: 0 }}>
              Previous attempt failed: {kase.failureReason}. You can try again below.
            </p>
          )}
          <label>
            Full legal name
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label>
            Last 4 digits of your ID
            <input
              type="text"
              required
              pattern="[0-9]{4}"
              maxLength={4}
              value={identifierLast4}
              onChange={(e) => setIdentifierLast4(e.target.value)}
              style={inputStyle}
            />
          </label>
          {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? 'Submitting…' : 'Start verification'}
          </button>
        </form>
      )}

      {status === 'PENDING' && (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            Masked identifier on file: {kase?.maskedIdentifier}
          </p>
          {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
          <button type="button" onClick={handleComplete} disabled={busy}>
            {busy ? 'Completing…' : 'Complete verification (demo)'}
          </button>
        </div>
      )}

      {status === 'VERIFIED' && (
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          Verified as {kase?.verifiedName} ({kase?.maskedIdentifier}).
        </p>
      )}
    </div>
  );
}

export default function KycPage() {
  return (
    <ProtectedRoute>
      <main style={{ maxWidth: '24rem', margin: '0 auto', padding: '3rem 1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Identity verification</h1>
        <KycPanel />
      </main>
    </ProtectedRoute>
  );
}
