import { S3Client, HeadBucketCommand, HeadObjectCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.js';

export function createStorage(config: Config) {
  const options = {
    region: config.s3.region, forcePathStyle: true, maxAttempts: 2,
    credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
    requestHandler: { connectionTimeout: 3000, requestTimeout: 5000 },
  };
  const client = new S3Client({ ...options, endpoint: config.s3.endpoint });
  const publicClient = new S3Client({ ...options, endpoint: config.s3.publicEndpoint });
  const Bucket = config.s3.bucket;
  // Bounded streaming read; the returned iterable must be consumed (or returned) to release the connection.
  async function openRead(key: string, maxBytes: number): Promise<AsyncIterable<Uint8Array>> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid object size limit');
    const response = await client.send(new GetObjectCommand({ Bucket, Key: key }));
    if (!response.Body) throw new Error('Object body unavailable');
    const reader = response.Body.transformToWebStream().getReader();
    const release = async () => {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    };
    if (response.ContentLength !== undefined && response.ContentLength > maxBytes) {
      await release();
      throw new Error('Object exceeds size limit');
    }
    return (async function* () {
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          size += value.byteLength;
          if (size > maxBytes) throw new Error('Object exceeds size limit');
          yield value;
        }
      } finally {
        await release();
      }
    })();
  }
  return {
    async check() { await client.send(new HeadBucketCommand({ Bucket })); },
    async ensureBucket() {
      try { await client.send(new HeadBucketCommand({ Bucket })); }
      catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
        try {
          await client.send(new CreateBucketCommand({ Bucket, ...(config.s3.region === 'us-east-1' ? {} : { CreateBucketConfiguration: { LocationConstraint: config.s3.region as 'eu-west-1' } }) }));
        } catch (createError) {
          if ((createError as { name?: string }).name !== 'BucketAlreadyOwnedByYou') throw createError;
        }
      }
    },
    async put(key: string, body: string, contentType = 'text/plain') {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async putBuffer(key: string, body: Buffer | Uint8Array, contentType: string) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key: string) {
      const response = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return response.Body?.transformToString();
    },
    async getBuffer(key: string, maxBytes: number): Promise<Buffer> {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of await openRead(key, maxBytes)) {
        chunks.push(chunk);
        size += chunk.byteLength;
      }
      return Buffer.concat(chunks, size);
    },
    openRead,
    async objectSize(key: string): Promise<number> {
      const response = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
      if (response.ContentLength === undefined) throw new Error('Object size unavailable');
      return response.ContentLength;
    },
    async delete(key: string) { await client.send(new DeleteObjectCommand({ Bucket, Key: key })); },
    async deleteObject(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    // Call only after the business layer has checked ownership and download permission.
    async signDownload(key: string, expiresIn = 300) {
      if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 900) throw new Error('Invalid signed URL lifetime');
      return getSignedUrl(publicClient, new GetObjectCommand({ Bucket, Key: key }), { expiresIn });
    },
    async signDownloadWithName(key: string, filename: string, expiresIn = 300) {
      if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 900) throw new Error('Invalid signed URL lifetime');
      const encoded = encodeURIComponent(filename);
      const disposition = `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`;
      return getSignedUrl(publicClient, new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: disposition }), { expiresIn });
    },
    close() { client.destroy(); publicClient.destroy(); },
  };
}
