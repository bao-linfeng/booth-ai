import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { createStorage } from '../../../infra/storage.js';
import { storedZipStream } from '../../../infra/zip.js';
import { projectError } from '../../projects/domain.js';
import { artworkFiles, ownedArtworkJob, readyArtworkFiles, type ArtworkFile } from './queries.js';

async function* verifiedArtwork(source: AsyncIterable<Uint8Array>, file: ArtworkFile) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of source) {
    hash.update(chunk);
    size += chunk.byteLength;
    yield chunk;
  }
  if (size !== file.byteSize || hash.digest('hex') !== file.checksum) throw new Error('Artwork integrity mismatch');
}
// Streams the archive instead of buffering up to 4 × 30MB per request. Missing or resized objects are rejected with 503
// before any byte is sent; a checksum mismatch found mid-stream aborts the response, so the client never gets a valid ZIP.
export async function artworkArchive(pool: pg.Pool, storage: Pick<ReturnType<typeof createStorage>, 'objectSize' | 'openRead'>, userId: string, jobId: string) {
  const job = await ownedArtworkJob(pool, userId, jobId);
  const files = await readyArtworkFiles(pool, userId, jobId, job);
  try {
    const sizes = await Promise.all(files.map(file => storage.objectSize(file.objectKey)));
    if (sizes.some((size, index) => size !== files[index]!.byteSize)) throw new Error('Artwork integrity mismatch');
  } catch { throw projectError('ARTWORK_STORAGE_UNAVAILABLE', 503); }
  return {
    stream: storedZipStream(files.map(file => ({
      name: `${file.direction}.png`,
      open: async () => verifiedArtwork(await storage.openRead(file.objectKey, file.byteSize), file),
    }))),
    filename: `${job.schemeCode.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}@四面素材-${jobId.slice(0, 8)}.zip`,
  };
}

export async function downloadArtworkAsset(pool: pg.Pool, storage: Pick<ReturnType<typeof createStorage>, 'getBuffer'>,
  userId: string, jobId: string, assetId: string) {
  await ownedArtworkJob(pool, userId, jobId);
  const file = (await artworkFiles(pool, jobId)).find(f => f.assetId === assetId);
  if (!file) throw projectError('ARTWORK_NOT_FOUND', 404);
  let bytes: Buffer;
  try {
    bytes = await storage.getBuffer(file.objectKey, file.byteSize);
    if (bytes.length !== file.byteSize || createHash('sha256').update(bytes).digest('hex') !== file.checksum) throw new Error('Artwork integrity mismatch');
  } catch { throw projectError('ARTWORK_STORAGE_UNAVAILABLE', 503); }
  return { bytes, filename: `${file.direction}.png` };
}
