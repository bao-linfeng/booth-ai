import { createHash } from 'node:crypto';
import type pg from 'pg';
import { supportsPurpose } from '../../infra/ai/protocols.js';
import { isTextPurpose, type AiPurpose, type ModelKind } from '../../infra/ai/types.js';
import { writeAuditLog } from '../../infra/audit.js';
import { transaction } from '../../infra/database.js';
import { AI_PURPOSES, MAX_ASSIGNMENTS, requestError } from './_shared.js';

export interface AssignmentItem {
  modelId: string;
  unitCredits: number | null;
}

function assignmentVersion(items: AssignmentItem[]) {
  return createHash('sha256')
    .update(JSON.stringify(items.map(({ modelId, unitCredits }) => [modelId, unitCredits])))
    .digest('hex')
    .slice(0, 16);
}

async function purposeItems(database: Pick<pg.Pool, 'query'>, purpose: AiPurpose) {
  return (
    await database.query<AssignmentItem>(
      `SELECT model_id AS "modelId", unit_credits AS "unitCredits"
    FROM ai_model_assignments WHERE purpose = $1 ORDER BY position`,
      [purpose],
    )
  ).rows;
}

export async function listAssignments(pool: Pick<pg.Pool, 'query'>) {
  return Promise.all(
    AI_PURPOSES.map(async purpose => {
      const items = await purposeItems(pool, purpose);
      return { purpose, version: assignmentVersion(items), items };
    }),
  );
}

/** Replaces the ordered model list of one purpose; position 1 is the primary model. */
export async function replaceAssignments(
  pool: pg.Pool,
  purpose: AiPurpose,
  input: { expectedVersion: string; items: AssignmentItem[] },
  adminId: string,
) {
  const { items } = input;
  if (items.length > MAX_ASSIGNMENTS || new Set(items.map(item => item.modelId)).size !== items.length)
    throw requestError('Invalid assignment list');
  if (
    items.some(item =>
      isTextPurpose(purpose)
        ? item.unitCredits !== null
        : !Number.isInteger(item.unitCredits) || item.unitCredits! < 1 || item.unitCredits! > 100000,
    )
  ) {
    throw requestError('Image purposes need credits per unit; text purposes take none', 400, 'CREDITS_INVALID');
  }
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ai_model_assignments:${purpose}`]);
    if (assignmentVersion(await purposeItems(client, purpose)) !== input.expectedVersion)
      throw requestError('Assignments changed', 409, 'REVISION_CONFLICT');
    const models = (
      await client.query<{ id: string; kind: ModelKind; protocol: string }>(
        'SELECT m.id, m.kind, p.protocol FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id WHERE m.id = ANY($1::uuid[]) FOR SHARE OF m',
        [items.map(item => item.modelId)],
      )
    ).rows;
    for (const item of items) {
      const model = models.find(candidate => candidate.id === item.modelId);
      if (!model) throw requestError('Model not found', 404);
      if (!supportsPurpose(model.protocol, model.kind, purpose))
        throw requestError('Model cannot serve this purpose', 400, 'PURPOSE_UNSUPPORTED');
    }
    await client.query('DELETE FROM ai_model_assignments WHERE purpose = $1', [purpose]);
    for (const [index, item] of items.entries()) {
      await client.query('INSERT INTO ai_model_assignments (purpose, model_id, position, unit_credits) VALUES ($1, $2, $3, $4)', [
        purpose,
        item.modelId,
        index + 1,
        item.unitCredits,
      ]);
    }
    await writeAuditLog(client, {
      adminId,
      action: 'ai_model_assignment.replace',
      targetType: 'ai_model_assignment',
      targetId: purpose,
      detail: { items, expectedVersion: input.expectedVersion },
    });
  });
  return { purpose, version: assignmentVersion(items), items };
}
