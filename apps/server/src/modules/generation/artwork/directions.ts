import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { downloadGeneratedImage, imageAdapter } from '../../../infra/ai/protocols.js';
import { activeAiModels } from '../../../infra/ai/config.js';
import { ImageGenerationError, normalizeGeneratedImage } from '../../../infra/ai/image.js';
import type { ActiveAiModel } from '../../../infra/ai/types.js';
import { transaction } from '../../../infra/database.js';
import { ARTWORK_QUALITY, DIRECTIONS, DIRECTION_LABELS, type ArtworkSnapshot, type Direction } from './types.js';
import type { ArtworkRun } from './types.js';
import { prepareDrawing } from './drawings.js';
import { normalizeArtworkImage } from './image.js';
import { artworkDirectionConcurrency } from './settings.js';
import { lockRunningLease, publishGeneration, refreshGeneration, throwIfDraining } from '../execution.js';

/** 模型、参考图与报馆图只在第一个需要调用供应商的方向上加载，之后各方向（含并发的方向）共用。 */
type SharedInputs = {
  model(): Promise<ActiveAiModel | undefined>;
  reference(): Promise<Buffer>;
  drawings(direction: Direction): Promise<Buffer[]>;
};

const creditJob = (run: ArtworkRun) => ({ kind: 'artwork', id: run.jobId }) as const;
/** 各方向可能并发执行，任务只记一个总阶段；单方向耗时见供应商调用日志。 */
const GENERATING_PHASE = 'generating';

/** 并发调用共用同一次加载；加载失败时清除，之后的调用重新加载。 */
function memo<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      pending = load();
      pending.catch(() => (pending = undefined));
    }
    return pending;
  };
}

async function updateDirection(
  run: ArtworkRun,
  direction: Direction,
  status: string,
  url: string | null = null,
  reason: string | null = null,
) {
  await transaction(run.database, async client => {
    await lockRunningLease(client, creditJob(run), run.lease);
    await client.query(
      'UPDATE artwork_job_directions SET status=$3,generated_url=$4,reason=$5,updated_at=now() WHERE job_id=$1 AND direction=$2',
      [run.jobId, direction, status, url, reason],
    );
  });
}

async function failDirection(run: ArtworkRun, direction: Direction, reason: string) {
  await updateDirection(run, direction, 'failed', null, reason);
  await publishGeneration(run.publish, run.jobId, { direction, status: 'failed', reason });
}

/** 没有生成上下文快照的旧任务无法重放提示词与模型，未成功的方向直接判失败。 */
async function failLegacyDirections(database: pg.Pool, jobId: string) {
  await database.query(
    `UPDATE artwork_job_directions SET status='failed',reason='LEGACY_CONTEXT_UNAVAILABLE' WHERE job_id=$1 AND status<>'succeeded'`,
    [jobId],
  );
}

function sharedInputs(run: ArtworkRun, snapshot: ArtworkSnapshot): SharedInputs {
  // 同一张报馆图（如俯视图）会被多个方向共用，按版本与是否翻转缓存处理结果。
  const prepared = new Map<string, Promise<Buffer>>();
  const grayscale = snapshot.options?.drawingGrayscale ?? true;
  return {
    model: memo(async () =>
      (await activeAiModels(run.database, 'artwork', run.config.aiModelEncryptionKey)).find(
        m => m.id === snapshot.model.id && m.revision === snapshot.model.revision,
      ),
    ),
    reference: memo(async () => {
      const bytes = await run.storage.getBuffer(snapshot.source.objectKey, ARTWORK_QUALITY.maxBytes);
      if (createHash('sha256').update(bytes).digest('hex') !== snapshot.source.checksum)
        throw new Error('Artwork reference integrity mismatch');
      await normalizeGeneratedImage(bytes);
      return bytes;
    }),
    drawings(direction) {
      return Promise.all(
        (snapshot.drawings?.[direction] ?? []).map(drawing => {
          const key = `${drawing.versionId}:${drawing.mirrored}`;
          let image = prepared.get(key);
          if (!image) {
            image = prepareDrawing(run.storage, drawing, grayscale);
            image.catch(() => prepared.delete(key));
            prepared.set(key, image);
          }
          return image;
        }),
      );
    },
  };
}

/**
 * 调用供应商生成单个方向的底图，返回已落库的生成 URL；方向被判失败时返回 undefined。
 * 可重试且结果明确的错误会把方向退回 pending 并抛出，由任务重试；其余错误（含结果不明）直接判失败，不重复提交。
 */
async function generateDirectionUrl(
  run: ArtworkRun,
  snapshot: ArtworkSnapshot,
  direction: Direction,
  inputs: SharedInputs,
): Promise<string | undefined> {
  const { database, jobId, deadline, log, publish } = run;
  const model = await inputs.model();
  if (!model) {
    await failDirection(run, direction, 'MODEL_UNAVAILABLE');
    return undefined;
  }
  const reference = await inputs.reference();
  const references = await inputs.drawings(direction);
  await updateDirection(run, direction, 'submitting');
  await publishGeneration(publish, jobId, { direction, status: 'submitting' });
  let providerRequestId: string | undefined;
  let url: string;
  const started = Date.now();
  try {
    const prompt = snapshot.directionPrompts?.[direction] ?? snapshot.prompt.replaceAll('{{directionLabel}}', DIRECTION_LABELS[direction]);
    const generated = await imageAdapter(model).edit(model, {
      reference,
      ...(references.length ? { references } : {}),
      prompt,
      count: 1,
      deadline,
      onProviderRequest: async id => {
        providerRequestId = id;
        await database.query('UPDATE artwork_job_directions SET provider_request_id=$3 WHERE job_id=$1 AND direction=$2', [
          jobId,
          direction,
          id,
        ]);
      },
    });
    if (!generated[0]) throw new ImageGenerationError('PROVIDER_NO_IMAGE');
    url = generated[0];
    log.info(
      { direction, modelId: model.id, protocol: model.protocol, providerRequestId, ms: Date.now() - started },
      'Artwork provider request completed',
    );
  } catch (error) {
    const reason = error instanceof ImageGenerationError ? error.code : 'PROVIDER_OUTCOME_UNKNOWN';
    log.warn(
      { direction, modelId: model.id, protocol: model.protocol, providerRequestId, code: reason, ms: Date.now() - started },
      'Artwork provider request failed',
    );
    if (error instanceof ImageGenerationError && error.retryable && !error.outcomeUnknown) {
      await updateDirection(run, direction, 'pending');
      throw error;
    }
    await failDirection(run, direction, reason);
    return undefined;
  }
  await updateDirection(run, direction, 'generated', url);
  await publishGeneration(publish, jobId, { direction, status: 'generated' });
  return url;
}

/** 下载并校验方向图；确定性不合格时判该方向失败并返回 undefined，可重试错误抛出。 */
async function fetchDirectionImage(run: ArtworkRun, direction: Direction, url: string) {
  try {
    return await normalizeArtworkImage(await downloadGeneratedImage(url, run.deadline));
  } catch (error) {
    if (error instanceof ImageGenerationError && error.retryable) throw error;
    const reason =
      error instanceof ImageGenerationError
        ? error.code.replace(/^IMAGE_/, 'ARTWORK_')
        : error instanceof Error && error.message.startsWith('ARTWORK_')
          ? error.message
          : 'ARTWORK_IMAGE_INVALID';
    await failDirection(run, direction, reason);
    return undefined;
  }
}

/** 先上传对象，再在租约保护的事务内写入资产、版本、结果行并把方向置为 succeeded。 */
async function storeDirectionResult(
  run: ArtworkRun,
  direction: Direction,
  index: number,
  image: Awaited<ReturnType<typeof normalizeArtworkImage>>,
) {
  const { database, jobId, job, storage } = run;
  const assetId = randomUUID();
  const versionId = randomUUID();
  await refreshGeneration(database, creditJob(run), run.lease, GENERATING_PHASE);
  const objectKey = `artwork-results/${jobId}/${direction}.png`;
  const checksum = createHash('sha256').update(image.bytes).digest('hex');
  await storage.putBuffer(objectKey, image.bytes, 'image/png');
  await transaction(database, async client => {
    await lockRunningLease(client, creditJob(run), run.lease);
    await client.query(
      `INSERT INTO scheme_assets(id,scheme_id,type,name,sort_order,metadata,source,owner_user_id,visibility)
      SELECT $1,id,'artwork',$2,$3,$4,'artwork_generation',$6,'private' FROM schemes WHERE code=$5`,
      [
        assetId,
        `${DIRECTION_LABELS[direction]}方向底图`,
        index,
        JSON.stringify({ artworkJobId: jobId, direction, mappingStatus: 'unresolved', physicalDimensions: 'unverified' }),
        job.schemeCode,
        job.userId,
      ],
    );
    await client.query(
      `INSERT INTO asset_versions(id,asset_id,object_key,original_filename,mime_type,byte_size,checksum,width_px,height_px)
      VALUES($1,$2,$3,$4,'image/png',$5,$6,$7,$8)`,
      [versionId, assetId, objectKey, `${direction}.png`, image.bytes.length, checksum, image.width, image.height],
    );
    await client.query(
      `INSERT INTO artwork_job_results(job_id,ordinal,asset_id,asset_version_id,direction,width,height) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [jobId, index + 1, assetId, versionId, direction, image.width, image.height],
    );
    await client.query(
      "UPDATE artwork_job_directions SET status='succeeded',generated_url=NULL,reason=NULL,updated_at=now() WHERE job_id=$1 AND direction=$2",
      [jobId, direction],
    );
  });
}

/**
 * 推进单个方向：pending →（submitting → generated）→ succeeded / failed。
 * 状态落库后可从任意中断点续跑：已有生成 URL 的方向跳过供应商调用；停在 submitting 的方向
 * 无法确认供应商是否已受理，判结果不明失败而不重复提交。
 */
async function processDirection(run: ArtworkRun, snapshot: ArtworkSnapshot, direction: Direction, index: number, inputs: SharedInputs) {
  const { database, jobId, publish } = run;
  await refreshGeneration(database, creditJob(run), run.lease, GENERATING_PHASE);
  const state = (
    await database.query<{ status: string; url: string | null }>(
      'SELECT status,generated_url AS url FROM artwork_job_directions WHERE job_id=$1 AND direction=$2',
      [jobId, direction],
    )
  ).rows[0];
  if (!state || state.status === 'succeeded' || state.status === 'failed') return;
  if (state.status === 'submitting') {
    await failDirection(run, direction, 'PROVIDER_OUTCOME_UNKNOWN');
    return;
  }
  // Directions persist their state, so a draining worker stops before the next provider call and the job resumes here.
  if (!state.url) throwIfDraining(run.draining);
  const url = state.url ?? (await generateDirectionUrl(run, snapshot, direction, inputs));
  if (!url) return;
  const image = await fetchDirectionImage(run, direction, url);
  if (!image) return;
  await storeDirectionResult(run, direction, index, image);
  await publishGeneration(publish, jobId, { direction, status: 'succeeded' });
}

/**
 * 按后台设置的并发数生成各方向（1 即按固定顺序逐个生成）；无快照的旧任务直接判失败。
 * 某个方向抛错后不再开始新的方向，但要等进行中的方向跑完再抛出：抛错后任务会释放租约，
 * 进行中的方向一旦失去租约，供应商已经出的图就无法落库。
 */
export async function generateDirections(run: ArtworkRun) {
  const { snapshot } = run.job;
  if (!snapshot) {
    await failLegacyDirections(run.database, run.jobId);
    return;
  }
  const inputs = sharedInputs(run, snapshot);
  const concurrency = Math.min(DIRECTIONS.length, Math.max(1, await artworkDirectionConcurrency(run.database)));
  await refreshGeneration(run.database, creditJob(run), run.lease, GENERATING_PHASE);
  await publishGeneration(run.publish, run.jobId, { status: 'running', phase: GENERATING_PHASE });
  const queue = [...DIRECTIONS.entries()];
  const errors: unknown[] = [];
  const lane = async () => {
    while (!errors.length) {
      const next = queue.shift();
      if (!next) return;
      try {
        await processDirection(run, snapshot, next[1], next[0], inputs);
      } catch (error) {
        errors.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, lane));
  if (errors.length) throw errors[0];
}
