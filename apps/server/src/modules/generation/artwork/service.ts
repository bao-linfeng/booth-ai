import type pg from 'pg';
import { assignedAiModels } from '../../../infra/ai/config.js';
import { transaction } from '../../../infra/database.js';
import { digest } from '../../../lib/digest.js';
import { domainError as projectError } from '../../../lib/errors.js';
import { getActivePromptTemplate } from '../../prompts/service.js';
import { lockCreditUser } from '../../credits/service.js';
import { jobLedger } from '../credit-jobs.js';
import { buildArtworkPrompts } from './prompt.js';
import { artworkHash, assertThemeSelection, receipt } from './queries.js';
import { ARTWORK_QUALITY, DIRECTIONS, type ArtworkContext, type ArtworkOffer, type ArtworkSnapshot, type Database, type JobSummary } from './types.js';

export async function replayArtworkRequest(database: Database, userId: string, requestKey: string, context: ArtworkContext) {
  const job = (await database.query<JobSummary>(`SELECT id,status,delivery_status AS "deliveryStatus",unit_credits AS "unitCredits",
    usable_count AS "usableCount",request_hash AS "requestHash" FROM artwork_jobs WHERE user_id=$1 AND request_key=$2`, [userId, requestKey])).rows[0];
  if (!job) return null;
  if (job.requestHash !== artworkHash(context)) throw projectError('REQUEST_CONFLICT');
  return receipt(job, true);
}
export async function loadArtworkSnapshot(pool: pg.Pool, userId: string, context: ArtworkContext): Promise<ArtworkSnapshot> {
  const selected = await assertThemeSelection(pool, userId, context);
  // Artwork pins the primary assigned model; there is no cross-model fallback once the offer is made.
  const model = (await assignedAiModels(pool, 'artwork'))[0];
  if (!model) throw projectError('MODEL_UNAVAILABLE');
  const labels = (await pool.query<{ id: string; label: string }>(`SELECT id::text AS id,item_label AS label FROM dictionary_items WHERE id=ANY($1::uuid[])`,
    [[selected.input.industryId, selected.input.styleId]])).rows;
  const industryLabel = labels.find(r => r.id === selected.input.industryId)?.label ?? '';
  const styleLabel = labels.find(r => r.id === selected.input.styleId)?.label ?? '';
  const template = await getActivePromptTemplate(pool, 'artwork', selected.input.industryId, selected.input.styleId);
  const { prompt, directionPrompts } = buildArtworkPrompts(selected.input, industryLabel, styleLabel, template?.body);
  return { source: { assetId: selected.sourceAssetId, versionId: selected.versionId, objectKey: selected.objectKey, checksum: selected.checksum }, input: selected.input,
    template: template ? { id: template.id, revision: template.revision, body: template.body } : null, prompt, directionPrompts,
    model: { id: model.id, model: model.model, revision: model.revision, unitCredits: model.unitCredits }, quality: ARTWORK_QUALITY, pipelineRevision: 5 };
}
export async function createArtworkJob(pool: pg.Pool, userId: string, requestKey: string, offerId: string, context: ArtworkContext, offer: ArtworkOffer,
  requestId: string | null = null) {
  if (offer.userId !== userId || artworkHash(context) !== artworkHash(offer)) throw projectError('OFFER_MISMATCH');
  const snapshot = await loadArtworkSnapshot(pool, userId, context);
  if (digest(snapshot) !== digest(offer.snapshot)) throw projectError('OFFER_STALE');
  return transaction(pool, async client => {
    await lockCreditUser(client, userId);
    const replay = await replayArtworkRequest(client, userId, requestKey, context);
    if (replay) return replay;
    await assertThemeSelection(client, userId, context, true);
    const currentModel = await client.query(`SELECT 1 FROM ai_model_assignments a JOIN ai_models m ON m.id=a.model_id JOIN ai_providers p ON p.id=m.provider_id
      WHERE a.purpose='artwork' AND a.model_id=$1 AND m.revision=$2 AND a.unit_credits=$3
        AND m.enabled AND p.enabled AND p.credential_ciphertext IS NOT NULL FOR SHARE OF a, m`, [snapshot.model.id, snapshot.model.revision, offer.unitCredits]);
    if (!currentModel.rowCount) throw projectError('OFFER_STALE');
    if (snapshot.template) {
      const currentTemplate = await client.query('SELECT id FROM prompt_templates WHERE id=$1 AND revision=$2 AND enabled FOR SHARE', [snapshot.template.id, snapshot.template.revision]);
      if (!currentTemplate.rowCount) throw projectError('OFFER_STALE');
    }
    const job = (await client.query<JobSummary>(`INSERT INTO artwork_jobs(user_id,scheme_code,source_asset_id,offer_id,request_key,input,requested_count,
      unit_credits,theme_job_id,theme_result_id,theme_selection_revision,request_hash,generation_snapshot,delivery_status,request_id)
      VALUES($1,$2,$3,$4,$5,$6,4,$7,$8,$9,$10,$11,$12,'pending',$13)
      RETURNING id,status,delivery_status AS "deliveryStatus",unit_credits AS "unitCredits",usable_count AS "usableCount",request_hash AS "requestHash"`,
      [userId, context.schemeCode, snapshot.source.assetId, offerId, requestKey, JSON.stringify(snapshot.input), offer.unitCredits,
        context.themeJobId, context.resultId, context.selectionRevision, artworkHash(context), JSON.stringify(snapshot), requestId])).rows[0];
    if (!job) throw new Error('Artwork task creation failed');
    for (const direction of DIRECTIONS) await client.query('INSERT INTO artwork_job_directions(job_id,direction) VALUES($1,$2)', [job.id, direction]);
    await jobLedger.reserve(client, { kind: 'artwork', id: job.id }, userId, offer.unitCredits * 4);
    await client.query('INSERT INTO artwork_job_outbox(job_id) VALUES($1)', [job.id]);
    return receipt(job, false);
  });
}
