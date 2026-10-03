import { createHash } from 'node:crypto';
import type pg from 'pg';
import { invalidatePublication } from '../publication.js';
import { bomError } from './errors.js';
import type { BomRecord, SchemeRow } from './types.js';

export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const iso = (value: Date | string | null) => value === null ? null : value instanceof Date ? value.toISOString() : value;

export function assertBomEditable(bom: BomRecord | null): void {
  if (bom?.status === 'verified') throw bomError('BOM_ALREADY_VERIFIED', 409);
}

export function validateReason(reason: string): void {
  if (!reason.trim() || reason.length > 1000) throw bomError('INVALID_INPUT', 400);
}

export function unpublish(client: pg.PoolClient, scheme: SchemeRow, adminId: string): Promise<boolean> {
  return invalidatePublication(client, scheme.id, adminId);
}

export async function audit(
  client: pg.PoolClient,
  bomId: string,
  before: number,
  action: string,
  reason: string,
  adminId: string,
  summary: object,
): Promise<void> {
  await client.query(
    `INSERT INTO bom_change_logs (bom_id, before_revision, after_revision, action, change_reason, admin_id, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [bomId, before, before + 1, action, reason, adminId, JSON.stringify(summary)],
  );
}
