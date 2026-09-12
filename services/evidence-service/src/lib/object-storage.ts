import { S3Client } from 'bun';

export interface ObjectStorageConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export interface ObjectStat {
  size: number;
  type: string;
}

/**
 * Thin wrapper over Bun's native S3-compatible client (plan Section 14.4:
 * signed URLs are short-lived, storage keys are random, never a filename).
 * The bucket itself is private (`mc anonymous set none`, see
 * infra/minio/create-buckets.sh) — every read goes through a signed URL.
 */
export class ObjectStorage {
  private readonly client: S3Client;

  constructor(config: ObjectStorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      bucket: config.bucket,
    });
  }

  presignUpload(key: string, contentType: string, expiresInSeconds: number): string {
    return this.client.presign(key, {
      method: 'PUT',
      expiresIn: expiresInSeconds,
      type: contentType,
    });
  }

  presignDownload(key: string, expiresInSeconds: number): string {
    return this.client.presign(key, { method: 'GET', expiresIn: expiresInSeconds });
  }

  async write(key: string, data: Blob | ArrayBuffer, contentType: string): Promise<void> {
    await this.client.write(key, data, { type: contentType });
  }

  async stat(key: string): Promise<ObjectStat | null> {
    try {
      const result = await this.client.stat(key);
      return { size: result.size, type: result.type };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.delete(key);
  }
}
