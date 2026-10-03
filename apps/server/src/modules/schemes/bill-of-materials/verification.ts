import type pg from 'pg';
import { transaction } from '../../../infra/database.js';
import { bomError } from './errors.js';
import { contentHashOf } from './items.js';
import { findBom, lockedBom, schemeByCode } from './repository.js';
import { assertBomEditable, audit, digest, iso, unpublish } from './support.js';
import type { BomStatus, BomVerificationInput } from './types.js';

export interface BomVerificationResult {
  verificationId: string;
  revision: number;
  status: BomStatus;
  verifiedAt: string | null;
  replayed: boolean;
}

interface ExistingVerification {
  id: string;
  bomId: string;
  requestHash: string;
  resultingRevision: number;
  decision: 'pass' | 'reject';
  verifiedAt: Date | string | null;
}

export async function submitBomVerification(
  pool: pg.Pool,
  adminId: string,
  code: string,
  input: BomVerificationInput,
): Promise<BomVerificationResult> {
  return transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.requestKey]);
    const scheme = await schemeByCode(client, code, true);
    const notes = input.decision === 'reject' ? input.notes?.trim() : undefined;
    if (input.decision === 'reject' && !notes) throw bomError('VERIFICATION_INCOMPLETE', 400);
    const requestHash = digest([scheme.id, input.expectedRevision, input.decision, notes ?? null]);
    const existing = (await client.query<ExistingVerification>(
      `SELECT id::text AS id, bom_id::text AS "bomId", request_hash AS "requestHash",
              resulting_revision AS "resultingRevision", decision, verified_at AS "verifiedAt"
       FROM bom_verifications WHERE request_key = $1 FOR UPDATE`,
      [input.requestKey],
    )).rows[0];
    if (existing) {
      const target = await findBom(client, scheme.id);
      if (target?.id !== existing.bomId || existing.requestHash !== requestHash) throw bomError('IDEMPOTENCY_CONFLICT', 409);
      return {
        verificationId: existing.id,
        revision: existing.resultingRevision,
        status: existing.decision === 'pass' ? 'verified' : 'rejected',
        verifiedAt: iso(existing.verifiedAt),
        replayed: true,
      };
    }
    const bom = await lockedBom(client, scheme.id, input.expectedRevision);
    assertBomEditable(bom);
    const contentHash = contentHashOf(bom.items);
    const status: BomStatus = input.decision === 'pass' ? 'verified' : 'rejected';
    const row = (await client.query<{ id: string; verifiedAt: Date | string | null }>(
      `INSERT INTO bom_verifications (
         bom_id, request_key, request_hash, content_revision, resulting_revision,
         content_hash, decision, notes, admin_id, verified_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $7 = 'pass' THEN now() ELSE NULL END)
       RETURNING id::text AS id, verified_at AS "verifiedAt"`,
      [bom.id, input.requestKey, requestHash, bom.revision, bom.revision + 1, contentHash, input.decision, notes ?? null, adminId],
    )).rows[0];
    if (!row) throw bomError('INTERNAL_ERROR', 500);
    await client.query(
      'UPDATE scheme_boms SET revision = revision + 1, status = $2, verified_at = $3, content_hash = $4, updated_by = $5, updated_at = now() WHERE id = $1',
      [bom.id, status, row.verifiedAt, contentHash, adminId],
    );
    if (status === 'rejected') await unpublish(client, scheme, adminId);
    await audit(client, bom.id, bom.revision, 'verification', notes ?? '核验通过', adminId, { decision: input.decision });
    return { verificationId: row.id, revision: bom.revision + 1, status, verifiedAt: iso(row.verifiedAt), replayed: false };
  });
}
