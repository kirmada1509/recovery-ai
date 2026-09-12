'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { useAuth } from '@/lib/auth-context';
import { inputStyle } from '@/lib/form-styles';

interface Profile {
  phoneE164: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
}

const emptyProfile: Profile = {
  phoneE164: '',
  addressLine1: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'IN',
};

function ProfileForm() {
  const { authFetch } = useAuth();
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const result = await authFetch<{ profile: Profile | null }>('identity', 'profile');
        if (result.profile) setProfile({ ...emptyProfile, ...result.profile });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await authFetch('identity', 'profile', { method: 'PUT', body: JSON.stringify(profile) });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading…</p>;

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
      <label>
        Phone
        <input
          type="tel"
          value={profile.phoneE164 ?? ''}
          onChange={(e) => setProfile({ ...profile, phoneE164: e.target.value })}
          style={inputStyle}
        />
      </label>
      <label>
        Address
        <input
          type="text"
          value={profile.addressLine1 ?? ''}
          onChange={(e) => setProfile({ ...profile, addressLine1: e.target.value })}
          style={inputStyle}
        />
      </label>
      <label>
        City
        <input
          type="text"
          value={profile.city ?? ''}
          onChange={(e) => setProfile({ ...profile, city: e.target.value })}
          style={inputStyle}
        />
      </label>
      <label>
        State
        <input
          type="text"
          value={profile.state ?? ''}
          onChange={(e) => setProfile({ ...profile, state: e.target.value })}
          style={inputStyle}
        />
      </label>
      <label>
        Postal code
        <input
          type="text"
          value={profile.postalCode ?? ''}
          onChange={(e) => setProfile({ ...profile, postalCode: e.target.value })}
          style={inputStyle}
        />
      </label>
      {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
      {saved && <p style={{ color: 'var(--muted)', margin: 0 }}>Saved.</p>}
      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}

export default function ProfilePage() {
  return (
    <ProtectedRoute>
      <main style={{ maxWidth: '24rem', margin: '0 auto', padding: '3rem 1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Your profile</h1>
        <ProfileForm />
      </main>
    </ProtectedRoute>
  );
}
