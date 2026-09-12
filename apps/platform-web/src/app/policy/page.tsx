'use client';

import { useState, type FormEvent } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { UploadField, type UploadedDocument } from '@/components/upload-field';
import { useAuth } from '@/lib/auth-context';
import { inputStyle } from '@/lib/form-styles';

function PolicyForm() {
  const { authFetch } = useAuth();
  const [document, setDocument] = useState<UploadedDocument | null>(null);
  const [insurerName, setInsurerName] = useState('');
  const [policyNumberMasked, setPolicyNumberMasked] = useState('');
  const [policyType, setPolicyType] = useState('home');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!document) {
      setError('Upload your policy document first.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await authFetch('claims', 'policies', {
        method: 'POST',
        body: JSON.stringify({
          evidenceDocumentId: document.id,
          insurerName,
          policyNumberMasked,
          policyType,
        }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save policy');
    } finally {
      setSubmitting(false);
    }
  }

  if (saved) {
    return <p style={{ color: 'var(--muted)' }}>Policy saved. You can add another below.</p>;
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
      <UploadField
        label="Policy document (PDF)"
        documentType="policy"
        accept="application/pdf"
        onUploaded={setDocument}
      />
      <label>
        Insurer name
        <input
          type="text"
          required
          value={insurerName}
          onChange={(e) => setInsurerName(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label>
        Policy number (masked, e.g. POL-****1234)
        <input
          type="text"
          required
          value={policyNumberMasked}
          onChange={(e) => setPolicyNumberMasked(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label>
        Policy type
        <select
          value={policyType}
          onChange={(e) => setPolicyType(e.target.value)}
          style={inputStyle}
        >
          <option value="home">Home</option>
          <option value="renters">Renters</option>
          <option value="commercial">Commercial</option>
        </select>
      </label>
      {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
      <button type="submit" disabled={submitting || !document}>
        {submitting ? 'Saving…' : 'Save policy'}
      </button>
    </form>
  );
}

export default function PolicyPage() {
  return (
    <ProtectedRoute>
      <main style={{ maxWidth: '28rem', margin: '0 auto', padding: '3rem 1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Add your policy</h1>
        <PolicyForm />
      </main>
    </ProtectedRoute>
  );
}
