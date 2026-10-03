import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../../../infra/database.js';
import { bomError } from './errors.js';
import { canonicalDecimal, quantityFor, validateItems } from './quantity.js';
import { findBom, lockedBom, schemeByCode } from './repository.js';
import { assertBomEditable, audit, digest, unpublish, validateReason } from './support.js';
import type { BomItem, BomItemInput, BomRecord, SchemeRow } from './types.js';

const insertItemSql = `
  INSERT INTO scheme_bom_items (
    id, bom_id, ordinal, product_name, product_model, specification_mm,
    source_quantity, source_unit, quantity, measurement_kind, erp_code,
    source_sheet, source_row, diff_note, unit_price, total_price, total_weight_kg
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
`;

const optionalDecimal = (value: string | null | undefined) => value == null ? null : canonicalDecimal(value);

export function contentHashOf(items: BomItem[]): string {
  const normalizedItems = [...items].sort((a, b) => a.ordinal - b.ordinal).map(item => [
    item.ordinal,
    item.productName,
    item.productModel,
    item.specificationMm,
    canonicalDecimal(item.sourceQuantity),
    item.sourceUnit,
    item.measurementKind,
    canonicalDecimal(item.quantity),
    item.erpCode,
    item.unitPrice,
    item.totalPrice,
    item.totalWeightKg,
    item.sourceSheet,
    item.sourceRow,
    item.diffNote,
  ]);
  return digest(normalizedItems);
}

export async function persistContentHash(client: pg.PoolClient, schemeId: string): Promise<void> {
  const bom = await findBom(client, schemeId);
  if (!bom) throw bomError('BOM_NOT_AVAILABLE', 404);
  await client.query('UPDATE scheme_boms SET content_hash = $1 WHERE id = $2', [contentHashOf(bom.items), bom.id]);
}

/** 整体替换清单条目：校验输入、沿用已有条目 id，并按提交顺序重排序号。 */
export async function saveItems(client: pg.PoolClient, bom: Pick<BomRecord, 'id' | 'items'>, items: BomItemInput[]): Promise<void> {
  validateItems(items);
  const originalIds = new Set(bom.items.map(item => item.id));
  const submittedIds = new Set<string>();
  for (const item of items) {
    if (!item.id) continue;
    if (!originalIds.has(item.id) || submittedIds.has(item.id)) throw bomError('INVALID_INPUT', 400);
    submittedIds.add(item.id);
  }
  await client.query('DELETE FROM scheme_bom_items WHERE bom_id = $1', [bom.id]);
  for (const [index, item] of items.entries()) {
    await client.query(insertItemSql, [
      item.id ?? randomUUID(),
      bom.id,
      index + 1,
      item.productName,
      item.productModel ?? null,
      item.specificationMm ?? null,
      canonicalDecimal(item.sourceQuantity),
      item.sourceUnit,
      quantityFor(item.sourceQuantity, item.measurementKind, item.sourceUnit),
      item.measurementKind,
      item.erpCode ?? null,
      item.sourceSheet ?? null,
      item.sourceRow ?? null,
      item.diffNote ?? null,
      optionalDecimal(item.unitPrice),
      optionalDecimal(item.totalPrice),
      optionalDecimal(item.totalWeightKg),
    ]);
  }
}

async function replaceItems(
  client: pg.PoolClient,
  scheme: SchemeRow,
  bom: BomRecord,
  adminId: string,
  reason: string,
  items: BomItemInput[],
): Promise<BomRecord> {
  await saveItems(client, bom, items);
  await client.query(
    "UPDATE scheme_boms SET revision = revision + 1, status = 'pending_verification', verified_at = NULL, updated_by = $2, updated_at = now() WHERE id = $1",
    [bom.id, adminId],
  );
  await persistContentHash(client, scheme.id);
  await unpublish(client, scheme, adminId);
  await audit(client, bom.id, bom.revision, 'items', reason, adminId, { itemCount: items.length });
  return (await findBom(client, scheme.id))!;
}

export async function updateBomItems(
  pool: pg.Pool,
  adminId: string,
  code: string,
  expected: number,
  reason: string,
  items: BomItemInput[],
): Promise<BomRecord> {
  validateReason(reason);
  return transaction(pool, async client => {
    const scheme = await schemeByCode(client, code, true);
    const bom = await lockedBom(client, scheme.id, expected);
    assertBomEditable(bom);
    return replaceItems(client, scheme, bom, adminId, reason, items);
  });
}

export async function deleteBomItem(pool: pg.Pool, adminId: string, code: string, itemId: string, expected: number): Promise<BomRecord> {
  return transaction(pool, async client => {
    const scheme = await schemeByCode(client, code, true);
    const bom = await lockedBom(client, scheme.id, expected);
    assertBomEditable(bom);
    const item = bom.items.find(entry => entry.id === itemId);
    if (!item) throw bomError('RESOURCE_NOT_FOUND', 404);
    if (bom.items.length === 1) throw bomError('LAST_BOM_ITEM', 409);
    return replaceItems(client, scheme, bom, adminId, `删除条目：${item.productName}`, bom.items.filter(entry => entry.id !== itemId));
  });
}

export async function deleteBom(pool: pg.Pool, adminId: string, code: string, expected: number): Promise<void> {
  await transaction(pool, async client => {
    const scheme = await schemeByCode(client, code, true);
    const bom = await lockedBom(client, scheme.id, expected);
    assertBomEditable(bom);
    await unpublish(client, scheme, adminId);
    await client.query('DELETE FROM scheme_boms WHERE id = $1', [bom.id]);
  });
}
