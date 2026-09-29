import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { Requirement } from '../selection/domain.js';

export interface ManualRequestInput {
  requestKey: string;
  contactName: string;
  contactDetail: string;
  originalText: string;
  requirement: Requirement;
  unresolvedQuestions: string[];
  schemeContext?: { code: string; differences: { field: string; requested: string; actual: string; reason: string }[]; pendingConfirmations: string[] };
}

interface CreatedRow { id: string; payloadHash: string; status: string; createdAt: Date | string }
const contactPattern = /^(?:1[3-9]\d{9}|\+[1-9]\d{7,14}|[^\s@]+@[^\s@]+\.[^\s@]+)$/;

function invalid(): never { throw Object.assign(new Error('Invalid manual request'), { statusCode: 400 }); }

export function normalizeManualRequest(input: ManualRequestInput): ManualRequestInput {
  const contactName = input.contactName.trim();
  const contactDetail = input.contactDetail.trim();
  if (!contactName || !contactDetail || !contactPattern.test(contactDetail)) invalid();
  const originalText = input.originalText.trim();
  const unresolvedQuestions = input.unresolvedQuestions.map(value => value.trim());
  if (unresolvedQuestions.some(value => !value)) invalid();
  return { ...input, contactName, contactDetail, originalText, unresolvedQuestions };
}

export async function createManualRequest(pool: pg.Pool, input: ManualRequestInput, userId: string | null) {
  const normalized = normalizeManualRequest(input);
  const hash = createHash('sha256').update(JSON.stringify({ ...normalized, requestKey: undefined, userId })).digest('hex');
  const existing = (await pool.query<CreatedRow>(`SELECT id,payload_hash AS "payloadHash",status,created_at AS "createdAt" FROM manual_requests WHERE request_key=$1`, [normalized.requestKey])).rows[0];
  if (existing) {
    if (existing.payloadHash !== hash) throw Object.assign(new Error('Request key already used'), { statusCode: 409 });
    return { id: existing.id, status: existing.status, createdAt: existing.createdAt instanceof Date ? existing.createdAt.toISOString() : existing.createdAt };
  }
  if (normalized.schemeContext) {
    const scheme = (await pool.query<{ id: string }>(`SELECT s.id FROM schemes s
      WHERE s.code=$1 AND s.publish_status='published'
        AND EXISTS (SELECT 1 FROM scheme_boms b WHERE b.scheme_id=s.id AND b.status='verified')
        AND (SELECT r.decision FROM scheme_reviews r WHERE r.scheme_id=s.id AND r.scheme_revision=s.revision
          AND r.phase='overall' ORDER BY r.created_at DESC,r.id DESC LIMIT 1)='pass'
        AND NOT EXISTS (SELECT 1 FROM scheme_assets a WHERE a.scheme_id=s.id AND a.updated_at >
          (SELECT max(r.created_at) FROM scheme_reviews r WHERE r.scheme_id=s.id AND r.scheme_revision=s.revision AND r.phase='overall'))
        AND s.applicable_conditions->>'labelsConfirmed'='true'`, [normalized.schemeContext.code])).rows[0];
    if (!scheme) invalid();
  }
  const values = [normalized.requestKey, hash, userId, normalized.contactName, normalized.contactDetail, normalized.originalText,
    JSON.stringify(normalized.requirement), JSON.stringify(normalized.unresolvedQuestions), normalized.schemeContext ? JSON.stringify(normalized.schemeContext) : null];
  const inserted = await pool.query<CreatedRow>(`INSERT INTO manual_requests (request_key,payload_hash,user_id,contact_name,contact_detail,original_text,requirement,unresolved_questions,scheme_context)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (request_key) DO NOTHING
    RETURNING id,payload_hash AS "payloadHash",status,created_at AS "createdAt"`, values);
  const row = inserted.rows[0] ?? (await pool.query<CreatedRow>(`SELECT id,payload_hash AS "payloadHash",status,created_at AS "createdAt" FROM manual_requests WHERE request_key=$1`, [normalized.requestKey])).rows[0];
  if (!row) throw new Error('Manual request missing after conflict');
  if (row.payloadHash !== hash) throw Object.assign(new Error('Request key already used'), { statusCode: 409 });
  return { id: row.id, status: row.status, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt };
}
