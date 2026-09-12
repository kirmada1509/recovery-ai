'use client';

import { useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';

export type DocumentType = 'policy' | 'damage_photo' | 'receipt' | 'ownership_proof' | 'other';

export interface UploadedDocument {
  id: string;
  documentType: DocumentType;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadStatus: string;
}

interface UploadFieldProps {
  label: string;
  documentType: DocumentType;
  accept?: string;
  onUploaded: (document: UploadedDocument) => void;
}

type Status = 'idle' | 'uploading' | 'done' | 'error';

/**
 * Reusable evidence/policy upload control (plan §18 P2-T5): progress, error,
 * and retry, used for policy PDFs here and reused for claim evidence in the
 * Phase 3 wizard. Uploads through evidence-service's server-proxied
 * `/v1/documents/upload` rather than a presigned MinIO URL — presigned PUTs
 * would require MinIO to accept cross-origin browser requests, which is not
 * configured, and a same-origin proxy hop is one fewer moving part for an
 * upload this small.
 */
export function UploadField({ label, documentType, accept, onUploaded }: UploadFieldProps) {
  const { authFetch } = useAuth();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const fileRef = useRef<File | null>(null);

  async function upload(file: File) {
    fileRef.current = file;
    setFilename(file.name);
    setStatus('uploading');
    setError(null);
    try {
      const form = new FormData();
      form.set('documentType', documentType);
      form.set('file', file);
      const result = await authFetch<{ document: UploadedDocument }>(
        'evidence',
        'documents/upload',
        {
          method: 'POST',
          body: form,
        },
      );
      setStatus('done');
      onUploaded(result.document);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '0.375rem' }}>
      <label>{label}</label>
      <input
        type="file"
        accept={accept}
        disabled={status === 'uploading'}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {status === 'uploading' && (
        <p style={{ color: 'var(--muted)', margin: 0 }}>Uploading {filename}…</p>
      )}
      {status === 'done' && (
        <p style={{ color: 'var(--muted)', margin: 0 }}>Uploaded {filename}.</p>
      )}
      {status === 'error' && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>
          <button type="button" onClick={() => fileRef.current && void upload(fileRef.current)}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
