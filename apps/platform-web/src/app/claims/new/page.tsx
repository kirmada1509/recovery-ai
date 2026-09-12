'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { UploadField, type UploadedDocument } from '@/components/upload-field';
import { useAuth } from '@/lib/auth-context';
import { inputStyle } from '@/lib/form-styles';

interface PolicySummary {
  id: string;
  insurerName: string;
  policyNumberMasked: string;
}

interface ClaimItem {
  id: string;
  description: string;
  category: string;
  claimedValuePaise: number;
}

type Step = 'incident' | 'items' | 'evidence' | 'review';

/**
 * Claim wizard (plan §18 P3-T5): incident details -> items -> link evidence
 * -> review. The claim is created as soon as a policy and incident type are
 * picked, then every later step autosaves against that claim rather than
 * holding the whole form in memory until a final submit.
 */
function Wizard() {
  const { authFetch } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>('incident');
  const [policies, setPolicies] = useState<PolicySummary[] | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [policyId, setPolicyId] = useState('');
  const [incidentType, setIncidentType] = useState('flood');
  const [incidentAt, setIncidentAt] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');

  const [items, setItems] = useState<ClaimItem[]>([]);
  const [itemDescription, setItemDescription] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [itemValue, setItemValue] = useState('');

  const [evidenceCount, setEvidenceCount] = useState(0);

  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    authFetch<{ policies: PolicySummary[] }>('claims', 'policies')
      .then((result) => setPolicies(result.policies))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load policies'));
  }, [authFetch]);

  async function createClaim(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await authFetch<{ claim: { id: string } }>('claims', 'claims', {
        method: 'POST',
        body: JSON.stringify({ policyId, incidentType }),
      });
      await authFetch('claims', `claims/${created.claim.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          incidentAt: new Date(incidentAt).toISOString(),
          addressLine1,
          city,
        }),
      });
      setClaimId(created.claim.id);
      setStep('items');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create claim');
    }
  }

  async function addItem(event: FormEvent) {
    event.preventDefault();
    if (!claimId) return;
    setError(null);
    try {
      const result = await authFetch<{ item: ClaimItem }>('claims', `claims/${claimId}/items`, {
        method: 'POST',
        body: JSON.stringify({
          description: itemDescription,
          category: itemCategory,
          claimedValuePaise: Math.round(Number(itemValue) * 100),
        }),
      });
      setItems([...items, result.item]);
      setItemDescription('');
      setItemCategory('');
      setItemValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item');
    }
  }

  async function linkEvidence(document: UploadedDocument) {
    if (!claimId) return;
    setError(null);
    try {
      await authFetch('claims', `claims/${claimId}/evidence-links`, {
        method: 'POST',
        body: JSON.stringify({ evidenceDocumentId: document.id }),
      });
      setEvidenceCount((count) => count + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link evidence');
    }
  }

  async function submitClaim() {
    if (!claimId) return;
    setError(null);
    setSubmitting(true);
    try {
      await authFetch('claims', `claims/${claimId}/submit`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey.current },
      });
      router.push(`/claims/${claimId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit claim');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <ol
        style={{
          display: 'flex',
          gap: '1rem',
          padding: 0,
          listStyle: 'none',
          color: 'var(--muted)',
        }}
      >
        {(['incident', 'items', 'evidence', 'review'] as Step[]).map((s) => (
          <li
            key={s}
            style={{
              fontWeight: step === s ? 700 : 400,
              color: step === s ? 'var(--foreground)' : undefined,
            }}
          >
            {s}
          </li>
        ))}
      </ol>

      {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}

      {step === 'incident' && (
        <form onSubmit={createClaim} style={{ display: 'grid', gap: '0.75rem' }}>
          <label>
            Policy
            <select
              required
              value={policyId}
              onChange={(e) => setPolicyId(e.target.value)}
              style={inputStyle}
            >
              <option value="" disabled>
                Select a policy
              </option>
              {policies?.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.insurerName} — {policy.policyNumberMasked}
                </option>
              ))}
            </select>
          </label>
          <label>
            Incident type
            <select
              value={incidentType}
              onChange={(e) => setIncidentType(e.target.value)}
              style={inputStyle}
            >
              <option value="flood">Flood</option>
              <option value="cyclone">Cyclone</option>
              <option value="fire">Fire</option>
              <option value="earthquake">Earthquake</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Date of incident
            <input
              type="date"
              required
              value={incidentAt}
              onChange={(e) => setIncidentAt(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label>
            Address
            <input
              type="text"
              required
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label>
            City
            <input
              type="text"
              required
              value={city}
              onChange={(e) => setCity(e.target.value)}
              style={inputStyle}
            />
          </label>
          <button type="submit" disabled={!policyId}>
            Continue
          </button>
        </form>
      )}

      {step === 'items' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <ul style={{ padding: 0, listStyle: 'none', display: 'grid', gap: '0.5rem' }}>
            {items.map((item) => (
              <li key={item.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>
                  {item.description} ({item.category})
                </span>
                <span>₹{(item.claimedValuePaise / 100).toLocaleString('en-IN')}</span>
              </li>
            ))}
          </ul>
          <form onSubmit={addItem} style={{ display: 'grid', gap: '0.75rem' }}>
            <label>
              Description
              <input
                type="text"
                required
                value={itemDescription}
                onChange={(e) => setItemDescription(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              Category
              <input
                type="text"
                required
                value={itemCategory}
                onChange={(e) => setItemCategory(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              Claimed value (₹)
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={itemValue}
                onChange={(e) => setItemValue(e.target.value)}
                style={inputStyle}
              />
            </label>
            <button type="submit">Add item</button>
          </form>
          <button type="button" disabled={items.length === 0} onClick={() => setStep('evidence')}>
            Continue
          </button>
        </div>
      )}

      {step === 'evidence' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <UploadField
            label="Damage photo"
            documentType="damage_photo"
            accept="image/*"
            onUploaded={linkEvidence}
          />
          <p style={{ color: 'var(--muted)', margin: 0 }}>{evidenceCount} document(s) linked.</p>
          <button type="button" disabled={evidenceCount === 0} onClick={() => setStep('review')}>
            Continue
          </button>
        </div>
      )}

      {step === 'review' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            {items.length} item(s), {evidenceCount} document(s) linked. Submitting will send this
            claim for verification.
          </p>
          <button type="button" disabled={submitting} onClick={submitClaim}>
            {submitting ? 'Submitting…' : 'Submit claim'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function NewClaimPage() {
  return (
    <ProtectedRoute>
      <main style={{ maxWidth: '32rem', margin: '0 auto', padding: '3rem 1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>File a new claim</h1>
        <Wizard />
      </main>
    </ProtectedRoute>
  );
}
