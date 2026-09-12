import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { createLogger } from '@recoveryai/observability-ts';
import { createServiceApp } from '@recoveryai/service-runtime';
import { SignJWT } from 'jose';
import { INTERNAL_SERVICE_HEADERS, signInternalServiceRequest } from '@recoveryai/internal-auth-ts';
import { loadConfig } from '../src/config.ts';
import { createDatabase } from '../src/db/client.ts';
import { documents } from '../src/db/schema.ts';
import { documentsRoutes } from '../src/routes/documents.routes.ts';

const env = {
  PORT: '3004',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgres://recoveryai:recoveryai@localhost:5432/recoveryai_evidence',
  LOG_LEVEL: 'fatal',
  JWT_SECRET: 'integration-test-secret-at-least-32-characters',
  MINIO_ENDPOINT: 'http://localhost:9000',
  MINIO_ROOT_USER: 'recoveryai',
  MINIO_ROOT_PASSWORD: 'recoveryai-dev-secret',
  MINIO_EVIDENCE_BUCKET: 'recoveryai-evidence',
  RATE_LIMIT_MAX_ATTEMPTS: '1000',
  INTERNAL_SERVICE_SECRET: 'integration-test-internal-secret-20',
  INTERNAL_ALLOWED_CALLERS: 'agent-service',
};

function internalHeaders(service: string): Record<string, string> {
  const token = signInternalServiceRequest(env.INTERNAL_SERVICE_SECRET, service);
  return {
    [INTERNAL_SERVICE_HEADERS.service]: token.service,
    [INTERNAL_SERVICE_HEADERS.timestamp]: token.timestamp,
    [INTERNAL_SERVICE_HEADERS.signature]: token.signature,
  };
}

const config = loadConfig(env);
const db = createDatabase(config.DATABASE_URL);
const logger = createLogger({
  service: 'evidence-service',
  environment: 'test',
  level: 'fatal',
  pretty: false,
});

function buildApp() {
  return createServiceApp({
    config,
    logger,
    readiness: { run: async () => ({ ready: true, checks: [] }) } as never,
    plugins: [documentsRoutes({ db, config })],
  });
}

async function accessTokenFor(
  userId: string,
  role: 'victim' | 'admin' = 'victim',
): Promise<string> {
  const secretKey = new TextEncoder().encode(config.JWT_SECRET);
  return new SignJWT({ role, session_id: crypto.randomUUID(), token_version: 1 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setExpirationTime('15m')
    .sign(secretKey);
}

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const ADMIN = '99999999-9999-9999-9999-999999999999';

beforeEach(async () => {
  await db.delete(documents);
});

afterAll(async () => {
  await db.delete(documents);
});

describe('evidence-service documents (direct upload)', () => {
  it('uploads, reads, downloads, and deletes a document — owner only', async () => {
    const app = buildApp();
    const tokenA = await accessTokenFor(USER_A);

    const pdfBytes = new TextEncoder().encode('%PDF-1.4 fake policy content');
    const form = new FormData();
    form.set('documentType', 'policy');
    form.set('file', new File([pdfBytes], 'policy.pdf', { type: 'application/pdf' }));

    const uploaded = await app.handle(
      new Request('http://localhost/v1/documents/upload', {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenA}` },
        body: form,
      }),
    );
    expect(uploaded.status).toBe(201);
    const uploadedBody = (await uploaded.json()) as {
      document: { id: string; uploadStatus: string };
    };
    expect(uploadedBody.document.uploadStatus).toBe('ready');
    const documentId = uploadedBody.document.id;

    const read = await app.handle(
      new Request(`http://localhost/v1/documents/${documentId}`, {
        headers: { authorization: `Bearer ${tokenA}` },
      }),
    );
    expect(read.status).toBe(200);

    const downloadUrl = await app.handle(
      new Request(`http://localhost/v1/documents/${documentId}/download-url`, {
        headers: { authorization: `Bearer ${tokenA}` },
      }),
    );
    expect(downloadUrl.status).toBe(200);
    const downloadBody = (await downloadUrl.json()) as { downloadUrl: string };
    expect(downloadBody.downloadUrl).toContain('recoveryai-evidence');

    // The signed URL actually resolves against MinIO.
    const fetched = await fetch(downloadBody.downloadUrl);
    expect(fetched.status).toBe(200);
    expect(await fetched.text()).toContain('fake policy content');

    const deleted = await app.handle(
      new Request(`http://localhost/v1/documents/${documentId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${tokenA}` },
      }),
    );
    expect(deleted.status).toBe(200);
  });

  it('rejects a disallowed content type', async () => {
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const form = new FormData();
    form.set('documentType', 'policy');
    form.set(
      'file',
      new File(['#!/bin/sh\necho pwned'], 'script.sh', { type: 'application/x-sh' }),
    );

    const response = await app.handle(
      new Request('http://localhost/v1/documents/upload', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      }),
    );
    expect(response.status).toBe(415);
  });

  it('rejects a file over the configured size limit', async () => {
    const smallLimitConfig = { ...config, MAX_UPLOAD_SIZE_BYTES: 10 };
    const app = createServiceApp({
      config: smallLimitConfig,
      logger,
      readiness: { run: async () => ({ ready: true, checks: [] }) } as never,
      plugins: [documentsRoutes({ db, config: smallLimitConfig })],
    });
    const token = await accessTokenFor(USER_A);
    const form = new FormData();
    form.set('documentType', 'policy');
    form.set(
      'file',
      new File(['this file is definitely over ten bytes'], 'policy.pdf', {
        type: 'application/pdf',
      }),
    );

    const response = await app.handle(
      new Request('http://localhost/v1/documents/upload', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      }),
    );
    expect(response.status).toBe(413);
  });
});

describe('evidence-service documents (presigned two-step upload)', () => {
  it('initiates, completes, then serves the object', async () => {
    const app = buildApp();
    const token = await accessTokenFor(USER_A);

    const initiate = await app.handle(
      new Request('http://localhost/v1/documents/initiate-upload', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          documentType: 'damage_photo',
          filename: 'roof-damage.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 12,
        }),
      }),
    );
    expect(initiate.status).toBe(201);
    const initiateBody = (await initiate.json()) as {
      document: { id: string };
      uploadUrl: string;
    };

    const putResponse = await fetch(initiateBody.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: 'fake-jpeg!!',
    });
    expect(putResponse.status).toBeLessThan(300);

    const complete = await app.handle(
      new Request(`http://localhost/v1/documents/${initiateBody.document.id}/complete-upload`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sha256: 'deadbeef' }),
      }),
    );
    expect(complete.status).toBe(200);
    const completeBody = (await complete.json()) as { document: { uploadStatus: string } };
    expect(completeBody.document.uploadStatus).toBe('ready');
  });

  it('rejects completing an upload that never happened', async () => {
    const app = buildApp();
    const token = await accessTokenFor(USER_A);
    const initiate = await app.handle(
      new Request('http://localhost/v1/documents/initiate-upload', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          documentType: 'damage_photo',
          filename: 'never-uploaded.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 12,
        }),
      }),
    );
    const initiateBody = (await initiate.json()) as { document: { id: string } };

    const complete = await app.handle(
      new Request(`http://localhost/v1/documents/${initiateBody.document.id}/complete-upload`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(complete.status).toBe(409);
  });
});

describe('evidence-service documents — IDOR', () => {
  async function uploadDocumentAs(
    app: ReturnType<typeof buildApp>,
    token: string,
  ): Promise<string> {
    const form = new FormData();
    form.set('documentType', 'policy');
    form.set('file', new File(['owner-only content'], 'policy.pdf', { type: 'application/pdf' }));
    const response = await app.handle(
      new Request('http://localhost/v1/documents/upload', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      }),
    );
    const body = (await response.json()) as { document: { id: string } };
    return body.document.id;
  }

  it('a different victim cannot read, download, or delete the document', async () => {
    const app = buildApp();
    const tokenA = await accessTokenFor(USER_A);
    const tokenB = await accessTokenFor(USER_B);
    const documentId = await uploadDocumentAs(app, tokenA);

    const read = await app.handle(
      new Request(`http://localhost/v1/documents/${documentId}`, {
        headers: { authorization: `Bearer ${tokenB}` },
      }),
    );
    expect(read.status).toBe(404);

    const download = await app.handle(
      new Request(`http://localhost/v1/documents/${documentId}/download-url`, {
        headers: { authorization: `Bearer ${tokenB}` },
      }),
    );
    expect(download.status).toBe(404);

    const remove = await app.handle(
      new Request(`http://localhost/v1/documents/${documentId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${tokenB}` },
      }),
    );
    expect(remove.status).toBe(404);
  });

  it('agent-service can fetch a download URL via internal-service auth without an end-user token', async () => {
    const app = buildApp();
    const tokenA = await accessTokenFor(USER_A);
    const documentId = await uploadDocumentAs(app, tokenA);

    const response = await app.handle(
      new Request(`http://localhost/v1/documents/${documentId}/download-url`, {
        headers: internalHeaders('agent-service'),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { downloadUrl: string };
    expect(body.downloadUrl).toContain('recoveryai-evidence');
  });

  it('rejects a download-url internal-service caller not on the allowlist', async () => {
    const app = buildApp();
    const tokenA = await accessTokenFor(USER_A);
    const documentId = await uploadDocumentAs(app, tokenA);

    const response = await app.handle(
      new Request(`http://localhost/v1/documents/${documentId}/download-url`, {
        headers: internalHeaders('some-other-service'),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('an admin can read a document that is not theirs', async () => {
    const app = buildApp();
    const tokenA = await accessTokenFor(USER_A);
    const adminToken = await accessTokenFor(ADMIN, 'admin');
    const documentId = await uploadDocumentAs(app, tokenA);

    const read = await app.handle(
      new Request(`http://localhost/v1/documents/${documentId}`, {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );
    expect(read.status).toBe(200);
  });

  it('requires authentication', async () => {
    const app = buildApp();
    const response = await app.handle(
      new Request('http://localhost/v1/documents/00000000-0000-0000-0000-000000000000'),
    );
    expect(response.status).toBe(401);
  });
});
