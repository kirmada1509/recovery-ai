import {
  INTERNAL_SERVICE_HEADERS,
  verifyInternalServiceRequest,
} from '@recoveryai/internal-auth-ts';
import { AppError } from '@recoveryai/observability-ts';
import { RateLimiter } from '@recoveryai/rate-limit-ts';
import { eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import type { EvidenceServiceConfig } from '../config.ts';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema.ts';
import { resolveAuthUser, requireUser } from '../lib/auth-context.ts';
import { ObjectStorage } from '../lib/object-storage.ts';

export interface DocumentsRoutesOptions {
  db: Database;
  config: EvidenceServiceConfig;
}

const publicDocument = (doc: typeof documents.$inferSelect) => ({
  id: doc.id,
  documentType: doc.documentType,
  originalFilename: doc.originalFilename,
  contentType: doc.contentType,
  sizeBytes: doc.sizeBytes,
  uploadStatus: doc.uploadStatus,
  createdAt: doc.createdAt,
});

function canAccess(
  doc: typeof documents.$inferSelect,
  user: { sub: string; role: string },
): boolean {
  return doc.ownerUserId === user.sub || user.role === 'admin';
}

export function documentsRoutes(options: DocumentsRoutesOptions) {
  const { db, config } = options;
  const verifyConfig = {
    secret: config.JWT_SECRET,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  };
  const storage = new ObjectStorage({
    endpoint: config.MINIO_ENDPOINT,
    accessKeyId: config.MINIO_ROOT_USER,
    secretAccessKey: config.MINIO_ROOT_PASSWORD,
    bucket: config.MINIO_EVIDENCE_BUCKET,
  });
  const uploadLimiter = new RateLimiter(
    config.RATE_LIMIT_WINDOW_MS,
    config.RATE_LIMIT_MAX_ATTEMPTS,
  );

  function assertUploadAllowed(contentType: string, sizeBytes: number): void {
    if (!config.ALLOWED_MIME_TYPES.includes(contentType)) {
      throw new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        `${contentType} is not an accepted document type`,
        415,
      );
    }
    if (sizeBytes > config.MAX_UPLOAD_SIZE_BYTES) {
      throw new AppError('PAYLOAD_TOO_LARGE', 'File exceeds the maximum upload size', 413);
    }
  }

  return new Elysia({ name: 'documents-routes' })
    .derive(async ({ headers }) => ({
      authUser: await resolveAuthUser(headers.authorization, verifyConfig),
    }))
    .post(
      '/v1/documents/initiate-upload',
      async ({ authUser, body, set }) => {
        const user = requireUser(authUser);
        uploadLimiter.consume(user.sub);
        assertUploadAllowed(body.contentType, body.sizeBytes);

        const storageKey = crypto.randomUUID();
        const [doc] = await db
          .insert(documents)
          .values({
            ownerUserId: user.sub,
            documentType: body.documentType,
            originalFilename: body.filename,
            contentType: body.contentType,
            sizeBytes: body.sizeBytes,
            storageBucket: config.MINIO_EVIDENCE_BUCKET,
            storageKey,
            uploadStatus: 'pending',
            source: 'user',
          })
          .returning();
        if (!doc) throw new Error('document insert returned no row');

        const uploadUrl = storage.presignUpload(
          storageKey,
          body.contentType,
          config.UPLOAD_URL_TTL_SECONDS,
        );

        set.status = 201;
        return {
          document: publicDocument(doc),
          uploadUrl,
          expiresInSeconds: config.UPLOAD_URL_TTL_SECONDS,
        };
      },
      {
        body: t.Object({
          documentType: t.Union([
            t.Literal('policy'),
            t.Literal('damage_photo'),
            t.Literal('receipt'),
            t.Literal('ownership_proof'),
            t.Literal('other'),
          ]),
          filename: t.String({ minLength: 1, maxLength: 300 }),
          contentType: t.String({ minLength: 1, maxLength: 200 }),
          sizeBytes: t.Integer({ minimum: 1 }),
        }),
      },
    )
    .post(
      '/v1/documents/:id/complete-upload',
      async ({ authUser, params, body }) => {
        const user = requireUser(authUser);
        const [doc] = await db.select().from(documents).where(eq(documents.id, params.id)).limit(1);
        if (!doc || doc.ownerUserId !== user.sub) {
          throw new AppError('NOT_FOUND', 'Document not found', 404);
        }
        if (doc.uploadStatus !== 'pending') {
          throw new AppError('DOCUMENT_NOT_PENDING', 'Document is not awaiting upload', 409);
        }

        const stat = await storage.stat(doc.storageKey);
        if (!stat) {
          throw new AppError(
            'UPLOAD_NOT_FOUND',
            'No object was found at the uploaded location',
            409,
          );
        }
        // The presigned URL constrained content-type; re-validate size against
        // what was actually written, not just what the client declared upfront.
        assertUploadAllowed(doc.contentType, stat.size);

        const [updated] = await db
          .update(documents)
          .set({
            uploadStatus: 'ready',
            sizeBytes: stat.size,
            sha256: body.sha256 ?? null,
            updatedAt: new Date(),
          })
          .where(eq(documents.id, doc.id))
          .returning();
        if (!updated) throw new Error('document update returned no row');

        return { document: publicDocument(updated) };
      },
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: t.Object({ sha256: t.Optional(t.String()) }),
      },
    )
    .post(
      '/v1/documents/upload',
      async ({ authUser, body, set }) => {
        const user = requireUser(authUser);
        uploadLimiter.consume(user.sub);

        const file = body.file;
        const contentType = file.type || 'application/octet-stream';
        assertUploadAllowed(contentType, file.size);

        const storageKey = crypto.randomUUID();
        const bytes = await file.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const sha256 = Buffer.from(digest).toString('hex');

        await storage.write(storageKey, bytes, contentType);

        const [doc] = await db
          .insert(documents)
          .values({
            ownerUserId: user.sub,
            documentType: body.documentType,
            originalFilename: file.name,
            contentType,
            sizeBytes: file.size,
            sha256,
            storageBucket: config.MINIO_EVIDENCE_BUCKET,
            storageKey,
            uploadStatus: 'ready',
            source: 'user',
          })
          .returning();
        if (!doc) throw new Error('document insert returned no row');

        set.status = 201;
        return { document: publicDocument(doc) };
      },
      {
        body: t.Object({
          documentType: t.Union([
            t.Literal('policy'),
            t.Literal('damage_photo'),
            t.Literal('receipt'),
            t.Literal('ownership_proof'),
            t.Literal('other'),
          ]),
          file: t.File(),
        }),
      },
    )
    .get('/v1/documents/:id', async ({ authUser, params }) => {
      const user = requireUser(authUser);
      const [doc] = await db.select().from(documents).where(eq(documents.id, params.id)).limit(1);
      if (!doc || !canAccess(doc, user)) throw new AppError('NOT_FOUND', 'Document not found', 404);
      return { document: publicDocument(doc) };
    })
    .get('/v1/documents/:id/download-url', async ({ authUser, headers, params }) => {
      // agent-service needs policy PDF bytes to index for RAG (plan Section
      // 18 P5-T2), triggered from a background outbox tick with no
      // end-user token in hand — an internal-service-signed request is
      // accepted as an alternative to the ownership-checked end-user path,
      // never a replacement for it (canAccess below is skipped only here).
      const isInternalCaller = verifyInternalServiceRequest(
        {
          service: headers[INTERNAL_SERVICE_HEADERS.service],
          timestamp: headers[INTERNAL_SERVICE_HEADERS.timestamp],
          signature: headers[INTERNAL_SERVICE_HEADERS.signature],
        },
        {
          secret: config.INTERNAL_SERVICE_SECRET,
          allowedServices: config.INTERNAL_ALLOWED_CALLERS,
        },
      );

      const [doc] = await db.select().from(documents).where(eq(documents.id, params.id)).limit(1);
      if (!doc) throw new AppError('NOT_FOUND', 'Document not found', 404);
      if (!isInternalCaller) {
        const user = requireUser(authUser);
        if (!canAccess(doc, user)) throw new AppError('NOT_FOUND', 'Document not found', 404);
      }
      if (doc.uploadStatus !== 'ready') {
        throw new AppError('DOCUMENT_NOT_READY', 'Document is not available for download', 409);
      }
      const downloadUrl = storage.presignDownload(doc.storageKey, config.UPLOAD_URL_TTL_SECONDS);
      return { downloadUrl, expiresInSeconds: config.UPLOAD_URL_TTL_SECONDS };
    })
    .delete('/v1/documents/:id', async ({ authUser, params }) => {
      const user = requireUser(authUser);
      const [doc] = await db.select().from(documents).where(eq(documents.id, params.id)).limit(1);
      if (!doc || !canAccess(doc, user)) throw new AppError('NOT_FOUND', 'Document not found', 404);

      await db
        .update(documents)
        .set({ uploadStatus: 'deleted', updatedAt: new Date() })
        .where(eq(documents.id, doc.id));
      await storage.delete(doc.storageKey).catch(() => undefined);

      return { ok: true };
    });
}
