import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type pg from 'pg';
import sharp from 'sharp';
import type { Config } from '../../config.js';
import { activeAiModels, type ActiveAiModel } from '../../infra/ai-models.js';
import { transaction } from '../../infra/database.js';
import { getActivePromptTemplate } from '../admin/prompt-templates/service.js';
import type { createStorage } from '../../infra/storage.js';
import { normalizeThemeInput, type GenerationSnapshot, type ThemeInput } from '../client/theme-jobs/service.js';
import { buildThemePrompt } from '../client/theme-jobs/prompt.js';
import { lockCreditJob, releaseJobCredits, settleJobCredits, terminalCreditJob } from '../credits/service.js';

type ThemeConfig = Pick<Config, 'aiModelEncryptionKey' | 's3'>;
type ThemeJob = { requestedCount: number; sourceAssetId: string; schemeCode: string; input: ThemeInput; unitCredits: number | null; userId: string; status: string; snapshot: GenerationSnapshot | null };
type UploadedResult = {
  resultId: string;
  assetId: string;
  versionId: string;
  objectKey: string;
  checksum: string;
  byteSize: number;
  mimeType: string;
  ordinal: number;
  previewUrl: string;
};

async function fetchSourceImageUrls(database: pg.Pool, sourceAssetId: string, config: ThemeConfig, objectKey?: string): Promise<{ internal: string; public: string }> {
  const result = objectKey ? { rows: [{ objectKey }] } : await database.query<{ objectKey: string }>(
    `SELECT v.object_key AS "objectKey" FROM scheme_assets a
     JOIN LATERAL (SELECT object_key FROM asset_versions WHERE asset_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
     WHERE a.id = $1 AND a.is_active = true`, [sourceAssetId]
  );
  const key = result.rows[0]?.objectKey;
  if (!key) throw new Error('Theme source image not found');
  const options = {
    region: config.s3.region, forcePathStyle: true,
    credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
  };
  const internalClient = new S3Client({ ...options, endpoint: config.s3.endpoint });
  const publicClient = new S3Client({ ...options, endpoint: config.s3.publicEndpoint });
  try {
    const command = new GetObjectCommand({ Bucket: config.s3.bucket, Key: key });
    const [internal, publicUrl] = await Promise.all([
      getSignedUrl(internalClient, command, { expiresIn: 900 }),
      getSignedUrl(publicClient, command, { expiresIn: 900 }),
    ]);
    return { internal, public: publicUrl };
  } finally {
    internalClient.destroy();
    publicClient.destroy();
  }
}

async function sourceImage(url: string): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Unable to read theme source image');
  return { bytes: await response.arrayBuffer(), mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'image/png' };
}

async function generatedImage(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(url);
  const mimeType = match?.[1];
  const encoded = match?.[2];
  if (mimeType && encoded) return { bytes: Buffer.from(encoded, 'base64'), mimeType };
  const response = await fetch(url);
  if (!response.ok) throw new Error('Unable to read generated theme image');
  return { bytes: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'image/png' };
}

async function fetchMaskBuffer(database: pg.Pool, sourceAssetId: string, config: ThemeConfig, objectKey?: string): Promise<Buffer | null> {
  const result = objectKey ? { rows: [{ objectKey }] } : await database.query<{ objectKey: string }>(
    `SELECT v.object_key AS "objectKey"
     FROM scheme_assets a
     JOIN LATERAL (SELECT object_key FROM asset_versions WHERE asset_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
     WHERE a.related_asset_id = $1 AND a.type = 'mask' AND a.is_active = true
     LIMIT 1`,
    [sourceAssetId]
  );
  const key = result.rows[0]?.objectKey;
  if (!key) return null;

  const options = {
    region: config.s3.region, forcePathStyle: true,
    credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
  };
  const internalClient = new S3Client({ ...options, endpoint: config.s3.endpoint });
  try {
    const command = new GetObjectCommand({ Bucket: config.s3.bucket, Key: key });
    const signedUrl = await getSignedUrl(internalClient, command, { expiresIn: 900 });
    const resp = await fetch(signedUrl);
    if (!resp.ok) return null;
    const bytes = Buffer.from(await resp.arrayBuffer());
    const converted = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { data, info } = converted;
    for (let i = 0; i < info.width * info.height; i++) {
      const r = data[i * 4]!;
      const g = data[i * 4 + 1]!;
      const b = data[i * 4 + 2]!;
      const isMagenta = r > 200 && g < 60 && b > 200;
      data[i * 4 + 3] = isMagenta ? 0 : 255;
    }
    return await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png()
      .toBuffer();
  } catch {
    return null;
  } finally {
    internalClient.destroy();
  }
}

async function generateWithOpenAI(model: ActiveAiModel, sourceImageUrl: string, prompt: string, count: number, maskBuffer?: Buffer): Promise<string[]> {
  const image = await sourceImage(sourceImageUrl);
  const form = new FormData();
  form.set('model', model.model);
  form.set('image', new Blob([image.bytes], { type: image.mimeType }), 'source.png');
  form.set('prompt', prompt);
  form.set('n', String(count));
  if (maskBuffer) {
    const maskBytes = new Uint8Array(maskBuffer);
    form.set('mask', new Blob([maskBytes], { type: 'image/png' }), 'mask.png');
  }
  form.set('size', '1792x1024');
  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { Authorization: `Bearer ${model.apiKey}` }, body: form,
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`OpenAI image edit failed (${response.status}): ${detail}`);
  }
  const body = await response.json() as { data?: { b64_json?: string; url?: string }[] };
  return body.data?.flatMap(item => {
    if (item.b64_json) return [`data:image/png;base64,${item.b64_json}`];
    return item.url ? [item.url] : [];
  }) ?? [];
}

async function generateWithGemini(model: ActiveAiModel, sourceImageUrl: string, prompt: string, count: number): Promise<string[]> {
  const image = await sourceImage(sourceImageUrl);
  const base64 = Buffer.from(image.bytes).toString('base64');
  const urls: string[] = [];
  for (let i = 0; i < count; i++) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': model.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: image.mimeType, data: base64 } }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
    });
    if (!response.ok) {
      if (urls.length > 0) break;
      throw new Error(`Gemini image edit failed (${response.status})`);
    }
    const body = await response.json() as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };
    const images = body.candidates?.flatMap(candidate => candidate.content?.parts?.flatMap(part =>
      part.inlineData?.data ? [`data:${part.inlineData.mimeType ?? 'image/png'};base64,${part.inlineData.data}`] : []) ?? []) ?? [];
    if (images.length === 0) {
      if (urls.length > 0) break;
      throw new Error('Gemini returned no image');
    }
    urls.push(...images.slice(0, count - urls.length));
  }
  return urls;
}

async function generateWithWanx(model: ActiveAiModel, sourceImageUrl: string, prompt: string, count: number): Promise<string[]> {
  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis', {
    method: 'POST',
    headers: { Authorization: `Bearer ${model.apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({ model: model.model, input: { function: 'description_edit', prompt, base_image_url: sourceImageUrl }, parameters: { n: count } }),
  });
  if (!response.ok) throw new Error(`Wanx image edit submission failed (${response.status})`);
  const submitted = await response.json() as { output?: { task_id?: string } };
  const taskId = submitted.output?.task_id;
  if (!taskId) throw new Error('Wanx returned no task ID');
  for (let i = 0; i < 60; i++) {
    await delay(2000);
    const poll = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${model.apiKey}` },
    });
    if (!poll.ok) throw new Error(`Wanx task polling failed (${poll.status})`);
    const body = await poll.json() as { output?: { task_status?: string; results?: { url?: string }[] } };
    if (body.output?.task_status === 'SUCCEEDED') return body.output.results?.flatMap(item => item.url ? [item.url] : []) ?? [];
    if (body.output?.task_status === 'FAILED' || body.output?.task_status === 'CANCELED') throw new Error('Wanx image edit failed');
  }
  throw new Error('Wanx image edit timed out');
}

export async function failThemeJob(database: pg.Pool, jobId: string): Promise<void> {
  await transaction(database, async client => {
    const job = await lockCreditJob(client, { kind: 'theme', id: jobId });
    if (!job || job.status === 'succeeded' || job.status === 'partially_succeeded') return;
    await client.query(
      `UPDATE theme_jobs SET status = 'failed', phase = NULL, updated_at = now()
       WHERE id = $1 RETURNING id`, [jobId],
    );
    await releaseJobCredits(client, { kind: 'theme', id: jobId });
  });
}

export async function processThemeJob(
  database: pg.Pool,
  jobId: string,
  config: ThemeConfig,
  storage?: ReturnType<typeof createStorage>,
  publish: (jobId: string, event: unknown) => Promise<void> = async () => {},
): Promise<void> {
  const assetStorage = storage ?? {
    putBuffer: async () => {},
    signDownload: async (key: string) => `stored://${key}`,
  } as unknown as ReturnType<typeof createStorage>;
  const job = (await database.query<ThemeJob>(
    `SELECT requested_count AS "requestedCount", source_asset_id AS "sourceAssetId", scheme_code AS "schemeCode", input,
             unit_credits AS "unitCredits", user_id AS "userId", status, generation_snapshot AS snapshot FROM theme_jobs WHERE id = $1`, [jobId]
  )).rows[0];
  if (!job) throw new Error(`Theme job ${jobId} not found`);
  const started = await transaction(database, async client => {
    const current = await lockCreditJob(client, { kind: 'theme', id: jobId });
    if (!current || terminalCreditJob(current.status)) return false;
    await client.query(`UPDATE theme_jobs SET status = 'running', phase = 'provider_submitting', updated_at = now() WHERE id = $1`, [jobId]);
    return true;
  });
  if (!started) return;
  await publish(jobId, { status: 'running', phase: 'provider_submitting' }).catch(() => {});

  const urls: string[] = [];
  const savedUrls = await database.query<{ ordinal: number; url: string }>(
    'SELECT ordinal, url FROM theme_job_generated_urls WHERE job_id = $1 ORDER BY ordinal', [jobId],
  );
  if (savedUrls.rows.length === 0) try {
    let prompt = job.snapshot?.prompt;
    if (prompt === undefined) {
      const labels = await database.query<{ id: string; label: string }>(
        `SELECT i.id::text AS id, i.item_label AS label FROM dictionary_items i
         WHERE i.id IN ($1, $2)`, [job.input.industryId, job.input.styleId]
      );
      const industryLabel = labels.rows.find(row => row.id === job.input.industryId)?.label;
      const styleLabel = labels.rows.find(row => row.id === job.input.styleId)?.label;
      if (!industryLabel || !styleLabel) throw new Error('Theme dictionary labels not found');
      const template = await getActivePromptTemplate(database, 'theme', job.input.industryId, job.input.styleId);
      prompt = buildThemePrompt(normalizeThemeInput(job.input), industryLabel, styleLabel, template?.body);
    }
    const maskBuffer = job.snapshot && !job.snapshot.mask ? null :
      await fetchMaskBuffer(database, job.sourceAssetId, config, job.snapshot?.mask?.objectKey);
    if (job.snapshot?.mask && !maskBuffer) throw new Error('Theme snapshot mask unavailable');
    const activeModels = await activeAiModels(database, 'theme', config.aiModelEncryptionKey);
    const models = job.snapshot ? job.snapshot.models.flatMap(snapshot => {
      const model = activeModels.find(active => active.provider === snapshot.provider && active.model === snapshot.model && active.revision === snapshot.revision);
      return model ? [model] : [];
    }) : activeModels;
    const imageUrls = await fetchSourceImageUrls(database, job.sourceAssetId, config, job.snapshot?.source.objectKey);
    for (const model of models) {
      for (let attempt = 0; attempt < 3 && urls.length < job.requestedCount; attempt++) {
        try {
          const remaining = job.requestedCount - urls.length;
          let generated: string[];
          switch (model.provider) {
            case 'openai': generated = await generateWithOpenAI(model, imageUrls.internal, prompt, remaining, maskBuffer ?? undefined); break;
            case 'gemini': generated = await generateWithGemini(model, imageUrls.internal, prompt, remaining); break;
            case 'wanx': generated = await generateWithWanx(model, imageUrls.public, prompt, remaining); break;
            default: continue;
          }
          urls.push(...generated.slice(0, remaining).filter(Boolean));
          if (generated.length === 0) throw new Error('Image provider returned no images');
          if (urls.length === job.requestedCount) break;
        } catch (error) {
          console.error(`Theme job ${jobId} provider ${model.provider} attempt ${attempt + 1} failed`, error);
        }
      }
      if (urls.length === job.requestedCount) break;
    }
  } catch (error) {
    console.error(`Theme job ${jobId} failed before settlement`, error);
  }

  if (urls.length > 0) {
    await transaction(database, async client => {
      for (const [index, url] of urls.entries()) {
        await client.query(
          `INSERT INTO theme_job_generated_urls (job_id, ordinal, url) VALUES ($1, $2, $3) ON CONFLICT (job_id, ordinal) DO NOTHING`,
          [jobId, index + 1, url]
        );
      }
    });
  }

  const persistedUrlsResult = await database.query<{ ordinal: number; url: string }>(
    `SELECT ordinal, url FROM theme_job_generated_urls WHERE job_id = $1 ORDER BY ordinal`,
    [jobId]
  );
  const settleUrls = persistedUrlsResult.rows.length > 0
    ? persistedUrlsResult.rows.map(r => r.url)
    : urls;

  if (settleUrls.length === 0) {
    const failed = await transaction(database, async client => {
      const current = await lockCreditJob(client, { kind: 'theme', id: jobId });
      if (!current || terminalCreditJob(current.status)) return false;
      await settleJobCredits(client, { kind: 'theme', id: jobId }, 0);
      await client.query(`UPDATE theme_jobs SET status = 'failed', phase = NULL, usable_count = 0, updated_at = now() WHERE id = $1`, [jobId]);
      return true;
    });
    if (failed) await publish(jobId, { status: 'failed', results: [] }).catch(() => {});
    return;
  }

  const alreadySettled = await database.query<{ status: string }>(
    `SELECT status FROM theme_jobs WHERE id = $1`,
    [jobId],
  );
  if (alreadySettled.rows[0] && terminalCreditJob(alreadySettled.rows[0].status)) return;

  const uploadedResults: UploadedResult[] = [];
  for (const [index, url] of settleUrls.entries()) {
    const resultId = randomUUID();
    const assetId = randomUUID();
    const image = await generatedImage(url);
    const objectKey = `theme-results/${jobId}/${assetId}.png`;
    const checksum = createHash('sha256').update(image.bytes).digest('hex');
    await assetStorage.putBuffer(objectKey, image.bytes, image.mimeType);
    uploadedResults.push({
      resultId,
      assetId,
      versionId: randomUUID(),
      objectKey,
      checksum,
      byteSize: image.bytes.byteLength,
      mimeType: image.mimeType,
      ordinal: index + 1,
      previewUrl: await assetStorage.signDownload(objectKey, 900),
    });
  }

  await publish(jobId, { status: 'settling', phase: 'credit_settling' }).catch(() => {});
  const settled = await transaction(database, async client => {
    const currentJob = await lockCreditJob(client, { kind: 'theme', id: jobId });
    if (!currentJob || terminalCreditJob(currentJob.status)) return false;
    await client.query(
      `UPDATE theme_jobs SET status = 'settling', phase = 'credit_settling', updated_at = now() WHERE id = $1`,
      [jobId],
    );
    for (const result of uploadedResults) {
      await client.query(
        `INSERT INTO scheme_assets (id, scheme_id, type, name, sort_order, metadata)
         SELECT $1, s.id, 'artwork', $2, $3, $4
         FROM schemes s WHERE s.code = $5`,
        [result.assetId, `AI 换主题结果 ${result.ordinal}`, result.ordinal - 1, JSON.stringify({ themeJobId: jobId }), job.schemeCode],
      );
      await client.query(
        `INSERT INTO asset_versions (id, asset_id, object_key, original_filename, mime_type, byte_size, checksum, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
        [result.versionId, result.assetId, result.objectKey, `${result.assetId}.png`, result.mimeType, result.byteSize, result.checksum],
      );
      await client.query(
        `INSERT INTO theme_job_results (id, job_id, ordinal, asset_id, preview_url, asset_version_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [result.resultId, jobId, result.ordinal, result.assetId, result.previewUrl, result.versionId],
      );
    }
    const usableCount = uploadedResults.length;
    if (currentJob.unitCredits === null) throw new Error('Theme job has no unit credit price');
    await settleJobCredits(client, { kind: 'theme', id: jobId }, usableCount * currentJob.unitCredits);
    await client.query(
      `UPDATE theme_jobs SET status = $1, phase = NULL, usable_count = $2, updated_at = now() WHERE id = $3`,
      [usableCount === currentJob.requestedCount ? 'succeeded' : 'partially_succeeded', usableCount, jobId],
    );
    return true;
  });
  if (!settled) return;
  const usableCount = uploadedResults.length;
  await publish(jobId, {
    status: usableCount === job.requestedCount ? 'succeeded' : 'partially_succeeded',
    results: uploadedResults.map(result => ({ resultId: result.resultId, previewUrl: result.previewUrl })),
  }).catch(() => {});
}
