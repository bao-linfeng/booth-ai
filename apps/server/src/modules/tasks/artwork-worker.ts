import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import sharp from 'sharp';
import type { Config } from '../../config.js';
import { activeAiModels, type ActiveAiModel } from '../../infra/ai-models.js';
import { transaction } from '../../infra/database.js';
import type { createStorage } from '../../infra/storage.js';
import { ARTWORK_QUALITY, DIRECTIONS, DIRECTION_LABELS, artworkFiles, completeArtworkFiles, type ArtworkSnapshot, type Direction } from '../client/artwork-jobs/service.js';

type ArtworkConfig = Pick<Config, 'aiModelEncryptionKey' | 's3'>;
type ArtworkJob = {
  schemeCode: string;
  unitCredits: number | null;
  userId: string;
  status: string;
  snapshot: ArtworkSnapshot | null;
};

async function generatedImage(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(url);
  const mimeType = match?.[1];
  const encoded = match?.[2];
  if (mimeType && encoded) {
    if (encoded.length > Math.ceil(ARTWORK_QUALITY.maxBytes * 4 / 3) + 4) throw new Error('Generated image too large');
    return { bytes: Buffer.from(encoded, 'base64'), mimeType };
  }
  const parsed = new URL(url);
  const hosts = ['blob.core.windows.net', 'aliyuncs.com', 'googleusercontent.com', 'openai.com'];
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443') ||
    !hosts.some(host => parsed.hostname.endsWith(`.${host}`))) throw new Error('Untrusted generated image URL');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('Unable to read generated artwork image');
  if (!response.body) throw new Error('Generated image body missing');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ARTWORK_QUALITY.maxBytes) throw new Error('Generated image too large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return { bytes: Buffer.concat(chunks, size), mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'image/png' };
}

export async function normalizeArtworkImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > ARTWORK_QUALITY.maxBytes) throw new Error('ARTWORK_SIZE_INVALID');
  const image = sharp(bytes, { failOn: 'warning', limitInputPixels: ARTWORK_QUALITY.maxPixels });
  const metadata = await image.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) throw new Error('ARTWORK_FORMAT_INVALID');
  const { data, info } = await image.rotate().toColourspace('srgb').png().toBuffer({ resolveWithObject: true });
  if (Math.max(info.width, info.height) < ARTWORK_QUALITY.minLongEdge || Math.min(info.width, info.height) < ARTWORK_QUALITY.minShortEdge) throw new Error('ARTWORK_RESOLUTION_TOO_LOW');
  if (data.length > ARTWORK_QUALITY.maxBytes) throw new Error('ARTWORK_SIZE_INVALID');
  return { bytes: data, width: info.width, height: info.height };
}

async function generateWithOpenAI(model: ActiveAiModel, reference: Buffer, prompt: string, count: number): Promise<string[]> {
  const metadata = await sharp(reference).metadata();
  const mimeType = metadata.format === 'jpeg' ? 'image/jpeg' : metadata.format === 'webp' ? 'image/webp' : 'image/png';
  const form = new FormData();
  form.set('model', model.model);
  form.set('image', new Blob([new Uint8Array(reference)], { type: mimeType }), 'source.png');
  form.set('prompt', prompt);
  form.set('n', String(count));
  form.set('size', '1536x1024');
  form.set('quality', 'high');
  form.set('output_format', 'png');
  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${model.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    throw new Error(`OpenAI image edit failed (${response.status})`);
  }
  const body = await response.json() as { data?: { b64_json?: string; url?: string }[] };
  return body.data?.flatMap(item => {
    if (item.b64_json) return [`data:image/png;base64,${item.b64_json}`];
    return item.url ? [item.url] : [];
  }) ?? [];
}

export async function processArtworkJob(
  database: pg.Pool,
  jobId: string,
  config: ArtworkConfig,
  storage?: ReturnType<typeof createStorage>,
  publish: (jobId: string, event: unknown) => Promise<void> = async () => {},
): Promise<void> {
  if (!storage) throw new Error('Artwork storage required');
  const lease = randomUUID();
  const job = (await database.query<ArtworkJob>(`UPDATE artwork_jobs SET lease_token=$2,lease_until=now()+interval '15 minutes',
    status='running',updated_at=now() WHERE id=$1 AND status IN ('pending','queued','running','settling')
    AND (lease_until IS NULL OR lease_until<now())
    RETURNING scheme_code AS "schemeCode",user_id AS "userId",unit_credits AS "unitCredits",generation_snapshot AS snapshot,status`, [jobId, lease])).rows[0];
  if (!job) {
    const state = (await database.query<{ status: string }>('SELECT status FROM artwork_jobs WHERE id=$1', [jobId])).rows[0];
    if (state && !['succeeded', 'partially_succeeded', 'failed'].includes(state.status)) throw new Error('Artwork lease busy');
    return;
  }
  try {
    if (!job.snapshot) {
      await database.query(`UPDATE artwork_job_directions SET status='failed',reason='LEGACY_CONTEXT_UNAVAILABLE' WHERE job_id=$1 AND status<>'succeeded'`, [jobId]);
    } else {
      const snapshot = job.snapshot;
      const model = (await activeAiModels(database, 'artwork', config.aiModelEncryptionKey)).find(m =>
        m.provider === 'openai' && m.provider === snapshot.model.provider && m.model === snapshot.model.model && m.revision === snapshot.model.revision);
      const reference = await storage.getBuffer(snapshot.source.objectKey, ARTWORK_QUALITY.maxBytes);
      if (createHash('sha256').update(reference).digest('hex') !== snapshot.source.checksum) throw new Error('Artwork reference integrity mismatch');
      for (const [index, direction] of DIRECTIONS.entries()) {
        const refreshed = await database.query(`UPDATE artwork_jobs SET lease_until=now()+interval '15 minutes',phase=$3,updated_at=now()
          WHERE id=$1 AND lease_token=$2 RETURNING id`, [jobId, lease, `generating_${direction}`]);
        if (!refreshed.rowCount) throw new Error('Artwork lease lost');
        await publish(jobId, { status: 'running', phase: `generating_${direction}` }).catch(() => {});
        const state = (await database.query<{ status: string; url: string | null }>('SELECT status,generated_url AS url FROM artwork_job_directions WHERE job_id=$1 AND direction=$2', [jobId, direction])).rows[0];
        if (!state || state.status === 'succeeded' || state.status === 'failed') continue;
        if (state.status === 'submitting') {
          await failDirection(database, jobId, direction, 'PROVIDER_OUTCOME_UNKNOWN');
          continue;
        }
        let url = state.url;
        if (!url) {
          if (!model) { await failDirection(database, jobId, direction, 'MODEL_UNAVAILABLE'); continue; }
          await database.query("UPDATE artwork_job_directions SET status='submitting',updated_at=now() WHERE job_id=$1 AND direction=$2 AND status='pending'", [jobId, direction]);
          try {
            const prompt = snapshot.prompt.replaceAll('{{directionLabel}}', DIRECTION_LABELS[direction]);
            const generated = await generateWithOpenAI(model, reference, prompt, 1);
            url = generated[0] ?? null;
            if (!url) throw new Error('No generated image');
            await database.query("UPDATE artwork_job_directions SET status='generated',generated_url=$3,updated_at=now() WHERE job_id=$1 AND direction=$2", [jobId, direction, url]);
          } catch {
            await failDirection(database, jobId, direction, 'PROVIDER_OUTCOME_UNKNOWN');
            continue;
          }
        }
        let image: Awaited<ReturnType<typeof normalizeArtworkImage>>;
        try { image = await normalizeArtworkImage((await generatedImage(url)).bytes); }
        catch (error) {
          const reason = error instanceof Error && error.message.startsWith('ARTWORK_') ? error.message : 'ARTWORK_IMAGE_INVALID';
          await failDirection(database, jobId, direction, reason);
          continue;
        }
        const assetId = randomUUID(); const versionId = randomUUID();
        const objectKey = `artwork-results/${jobId}/${versionId}.png`;
        const checksum = createHash('sha256').update(image.bytes).digest('hex');
        await storage.putBuffer(objectKey, image.bytes, 'image/png');
        await transaction(database, async client => {
          const current = (await client.query('SELECT id FROM artwork_jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE', [jobId, lease])).rows[0];
          if (!current) throw new Error('Artwork lease lost');
          await client.query(`INSERT INTO scheme_assets(id,scheme_id,type,name,sort_order,metadata)
            SELECT $1,id,'artwork',$2,$3,$4 FROM schemes WHERE code=$5`, [assetId, `${DIRECTION_LABELS[direction]}方向底图`, index,
              JSON.stringify({ artworkJobId: jobId, direction, mappingStatus: 'unresolved', physicalDimensions: 'unverified' }), job.schemeCode]);
          await client.query(`INSERT INTO asset_versions(id,asset_id,object_key,original_filename,mime_type,byte_size,checksum,width_px,height_px)
            VALUES($1,$2,$3,$4,'image/png',$5,$6,$7,$8)`, [versionId, assetId, objectKey, `${direction}.png`, image.bytes.length, checksum, image.width, image.height]);
          await client.query(`INSERT INTO artwork_job_results(job_id,ordinal,asset_id,asset_version_id,direction,width,height) VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [jobId, index + 1, assetId, versionId, direction, image.width, image.height]);
          await client.query("UPDATE artwork_job_directions SET status='succeeded',generated_url=NULL,reason=NULL,updated_at=now() WHERE job_id=$1 AND direction=$2", [jobId, direction]);
        });
      }
    }
    await settleArtworkJob(database, jobId, lease);
    await publish(jobId, { status: 'settled' }).catch(() => {});
  } finally {
    await database.query('UPDATE artwork_jobs SET lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2', [jobId, lease]);
  }
}

async function failDirection(database: pg.Pool, jobId: string, direction: Direction, reason: string) {
  await database.query("UPDATE artwork_job_directions SET status='failed',reason=$3,generated_url=NULL,updated_at=now() WHERE job_id=$1 AND direction=$2", [jobId, direction, reason]);
}

export async function settleArtworkJob(database: pg.Pool, jobId: string, lease?: string) {
  return transaction(database, async client => {
    const job = (await client.query<ArtworkJob & { leaseToken: string | null; leaseUntil: Date | null }>(`SELECT user_id AS "userId",unit_credits AS "unitCredits",status,
      lease_token AS "leaseToken",lease_until AS "leaseUntil" FROM artwork_jobs WHERE id=$1 FOR UPDATE`, [jobId])).rows[0];
    if (!job || ['succeeded', 'partially_succeeded', 'failed'].includes(job.status)) return;
    if (lease ? job.leaseToken !== lease : job.leaseUntil && new Date(job.leaseUntil).getTime() > Date.now()) throw new Error('Artwork lease busy');
    const files = await artworkFiles(client, jobId);
    const usable = files.length;
    if (usable && job.unitCredits === null) throw new Error('Artwork price missing');
    if (usable) await client.query(`INSERT INTO credit_transactions(user_id,kind,amount,note,artwork_job_id)
      VALUES($1,'artwork_consume',$2,$3,$4) ON CONFLICT DO NOTHING`, [job.userId, -usable * job.unitCredits!, `artwork_job:${jobId}`, jobId]);
    await client.query("UPDATE credit_reservations SET status=$2,updated_at=now() WHERE artwork_job_id=$1 AND status='reserved'", [jobId, usable ? 'settled' : 'released']);
    await client.query("UPDATE artwork_job_directions SET status='failed',reason=COALESCE(reason,'PROCESSING_FAILED'),generated_url=NULL WHERE job_id=$1 AND status<>'succeeded'", [jobId]);
    await client.query(`UPDATE artwork_jobs SET status=$2,delivery_status=$3,usable_count=$4,phase=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`,
      [jobId, usable === 4 ? 'succeeded' : usable ? 'partially_succeeded' : 'failed', completeArtworkFiles(files) ? 'ready' : 'incomplete', usable]);
  });
}
