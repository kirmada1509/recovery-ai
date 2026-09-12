/**
 * Fictional insurer staff console.
 *
 * Phase 0 ships the app shell only: the real routes land in their own phases
 * (plan Section 13). This page states what the app is and where it stands so it
 * is never mistaken for a finished screen.
 */
export default function Home() {
  return (
    <main style={{ maxWidth: '42rem', margin: '0 auto', padding: '4rem 1.5rem' }}>
      <h1 style={{ fontSize: '1.75rem', margin: '0 0 0.5rem' }}>AegisSure Sandbox</h1>
      <p style={{ color: 'var(--muted)', margin: '0 0 2rem' }}>Fictional insurer staff console</p>
      <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
        Application shell. Routes are implemented in later phases.
      </p>
    </main>
  );
}
