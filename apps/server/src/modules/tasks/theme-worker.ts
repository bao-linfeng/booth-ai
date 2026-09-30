import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type pg from 'pg';
import type { Config } from '../../config.js';
import { activeAiModels, type ActiveAiModel } from '../../infra/ai-models.js';
import { transaction } from '../../infra/database.js';
import { getActivePromptTemplate } from '../admin/prompt-templates/service.js';
import type { createStorage } from '../../infra/storage.js';

type ThemeConfig = Pick<Config, 'aiModelEncryptionKey' | 's3'>;
type ThemeInput = { industryId: string; styleId: string; brandColors?: string[]; brandKeywords?: string };
type ThemeJob = { requestedCount: number; sourceAssetId: string; schemeCode: string; input: ThemeInput; unitCredits: number | null; userId: string; status: string };

async function fetchSourceImageUrls(database: pg.Pool, sourceAssetId: string, config: ThemeConfig): Promise<{ internal: string; public: string }> {
  const result = await database.query<{ objectKey: string }>(
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

async function generateWithOpenAI(model: ActiveAiModel, sourceImageUrl: string, prompt: string, count: number): Promise<string[]> {
  const image = await sourceImage(sourceImageUrl);
  const form = new FormData();
  form.set('model', model.model);
  form.set('image', new Blob([image.bytes], { type: image.mimeType }), 'source.png');
  form.set('prompt', prompt);
  form.set('n', String(count));
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
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${encodeURIComponent(model.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
            unit_credits AS "unitCredits", user_id AS "userId", status FROM theme_jobs WHERE id = $1`, [jobId]
  )).rows[0];
  if (!job) throw new Error(`Theme job ${jobId} not found`);
  const started = await database.query(
    `UPDATE theme_jobs SET status = 'running', phase = 'provider_submitting', updated_at = now()
     WHERE id = $1 AND status IN ('pending', 'queued', 'running') RETURNING id`, [jobId]
  );
  if (started.rowCount === 0) return;
  await publish(jobId, { status: 'running', phase: 'provider_submitting' });

  const urls: string[] = [];
  try {
    const labels = await database.query<{ id: string; label: string }>(
      `SELECT i.id::text AS id, i.item_label AS label FROM dictionary_items i
       WHERE i.id IN ($1, $2)`, [job.input.industryId, job.input.styleId]
    );
    const industryLabel = labels.rows.find(row => row.id === job.input.industryId)?.label;
    const styleLabel = labels.rows.find(row => row.id === job.input.styleId)?.label;
    if (!industryLabel || !styleLabel) throw new Error('Theme dictionary labels not found');
    const template = await getActivePromptTemplate(database, 'theme', job.input.industryId, job.input.styleId);
    const prompt = template ? template.body.replace(/{{(brandColors|brandKeywords|industryLabel|styleLabel)}}/g, (_match, variable: string) => ({
      brandColors: job.input.brandColors?.join(', ') ?? '无', brandKeywords: job.input.brandKeywords ?? '无',
      industryLabel, styleLabel,
    })[variable] ?? '') :
      `请根据以下要求对展台展位图进行AI换主题处理：\n行业：${industryLabel}，风格：${styleLabel}，品牌色：${job.input.brandColors?.join('、') ?? '无'}，关键词：${job.input.brandKeywords ?? '无'}\n保持展台结构不变，仅替换主题风格、色彩和装饰元素。`;
    const models = await activeAiModels(database, 'theme', config.aiModelEncryptionKey);
    const imageUrls = await fetchSourceImageUrls(database, job.sourceAssetId, config);
    for (const model of models) {
      for (let attempt = 0; attempt < 3 && urls.length < job.requestedCount; attempt++) {
        try {
          const remaining = job.requestedCount - urls.length;
          let generated: string[];
          switch (model.provider) {
            case 'openai': generated = await generateWithOpenAI(model, imageUrls.internal, prompt, remaining); break;
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

  const persistedResults: { resultId: string; previewUrl: string }[] = [];
  await publish(jobId, { status: 'settling', phase: 'credit_settling' });
  await transaction(database, async client => {
    await client.query(`UPDATE theme_jobs SET status = 'settling', phase = 'credit_settling', updated_at = now() WHERE id = $1`, [jobId]);
    for (const [index, url] of urls.entries()) {
      const resultId = randomUUID();
      const assetId = randomUUID();
      const image = await generatedImage(url);
      const objectKey = `theme-results/${jobId}/${assetId}.png`;
      const checksum = createHash('sha256').update(image.bytes).digest('hex');
      await assetStorage.putBuffer(objectKey, image.bytes, image.mimeType);
      await client.query(
        `INSERT INTO scheme_assets (id, scheme_id, type, name, sort_order, metadata)
         SELECT $1, s.id, 'artwork', $2, $3, $4
         FROM schemes s WHERE s.code = $5`,
        [assetId, `AI 换主题结果 ${index + 1}`, index, JSON.stringify({ themeJobId: jobId }), job.schemeCode]
      );
      await client.query(
        `INSERT INTO asset_versions (id, asset_id, object_key, original_filename, mime_type, byte_size, checksum, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
        [randomUUID(), assetId, objectKey, `${assetId}.png`, image.mimeType, image.bytes.byteLength, checksum]
      );
      await client.query(
        `INSERT INTO theme_job_results (id, job_id, ordinal, asset_id, preview_url)
         VALUES ($1, $2, $3, $4, NULL)`, [resultId, jobId, index + 1, assetId]
      );
      persistedResults.push({ resultId, previewUrl: await assetStorage.signDownload(objectKey, 900) });
    }
    const usableCount = urls.length;
    if (usableCount > 0) {
      if (job.unitCredits === null) throw new Error('Theme job has no unit credit price');
      await client.query(
        `INSERT INTO credit_transactions (user_id, kind, amount, note) VALUES ($1, 'theme_consume', $2, $3)`,
        [job.userId, -(usableCount * job.unitCredits), `theme_job:${jobId}`]
      );
    }
    await client.query(
      `UPDATE theme_jobs SET status = $1, phase = NULL, usable_count = $2, updated_at = now() WHERE id = $3`,
      [usableCount === 0 ? 'failed' : usableCount === job.requestedCount ? 'succeeded' : 'partially_succeeded', usableCount, jobId]
    );
  });
  const usableCount = persistedResults.length;
  await publish(jobId, { status: usableCount === 0 ? 'failed' : usableCount === job.requestedCount ? 'succeeded' : 'partially_succeeded', results: persistedResults });
}
