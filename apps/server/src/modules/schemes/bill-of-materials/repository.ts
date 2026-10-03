import type pg from 'pg';
import { bomError } from './errors.js';
import { iso } from './support.js';
import type { BomItem, BomRecord, BomStatus, DbClient, SchemeRow } from './types.js';

interface BomRow extends Omit<BomRecord, 'items' | 'createdAt' | 'updatedAt' | 'verifiedAt'> {
  createdAt: Date | string;
  updatedAt: Date | string;
  verifiedAt: Date | string | null;
  items: BomItem[];
}

export interface BomListItem {
  schemeCode: string;
  schemeName: string;
  revision: number;
  status: BomStatus;
  itemCount: number;
  updatedAt: string;
}

const snapshotSql = `
  SELECT
    b.id::text AS id,
    b.scheme_id::text AS "schemeId",
    b.revision,
    b.status,
    b.source_asset_id::text AS "sourceAssetId",
    b.content_hash AS "contentHash",
    b.verified_at AS "verifiedAt",
    b.created_at AS "createdAt",
    b.updated_at AS "updatedAt",
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id::text,
        'bomId', i.bom_id::text,
        'ordinal', i.ordinal,
        'productName', i.product_name,
        'productModel', i.product_model,
        'specificationMm', i.specification_mm,
        'sourceQuantity', i.source_quantity::text,
        'sourceUnit', i.source_unit,
        'measurementKind', i.measurement_kind,
        'quantity', i.quantity::text,
        'erpCode', i.erp_code,
        'unitPrice', i.unit_price::text,
        'totalPrice', i.total_price::text,
        'totalWeightKg', i.total_weight_kg::text,
        'sourceSheet', i.source_sheet,
        'sourceRow', i.source_row,
        'diffNote', i.diff_note
      ) ORDER BY i.ordinal)
      FROM scheme_bom_items i
      WHERE i.bom_id = b.id
    ), '[]'::jsonb) AS items
  FROM scheme_boms b
`;

function record(row: BomRow): BomRecord {
  return { ...row, verifiedAt: iso(row.verifiedAt), createdAt: iso(row.createdAt) ?? '', updatedAt: iso(row.updatedAt) ?? '' };
}

export async function findBom(client: DbClient, schemeId: string): Promise<BomRecord | null> {
  const row = (await client.query<BomRow>(`${snapshotSql} WHERE b.scheme_id = $1`, [schemeId])).rows[0];
  return row ? record(row) : null;
}

export async function schemeByCode(client: DbClient, code: string, lock = false): Promise<SchemeRow> {
  const row = (await client.query<SchemeRow>(
    `SELECT id::text AS id, publish_status AS "publishStatus" FROM schemes WHERE code = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [code],
  )).rows[0];
  if (!row) throw bomError('RESOURCE_NOT_FOUND', 404);
  return row;
}

/** 加锁读取清单并校验修订号；调用方需已持有方案行锁。 */
export async function lockedBom(client: pg.PoolClient, schemeId: string, expected: number): Promise<BomRecord> {
  const row = (await client.query<{ revision: number }>('SELECT revision FROM scheme_boms WHERE scheme_id = $1 FOR UPDATE', [schemeId])).rows[0];
  if (!row) throw bomError('BOM_NOT_AVAILABLE', 404);
  if (row.revision !== expected) throw bomError('BOM_REVISION_CHANGED', 409);
  const bom = await findBom(client, schemeId);
  if (!bom) throw bomError('BOM_NOT_AVAILABLE', 404);
  return bom;
}

export async function getBom(pool: DbClient, schemeCode: string): Promise<BomRecord | null> {
  const scheme = await schemeByCode(pool, schemeCode);
  return findBom(pool, scheme.id);
}

export async function listBoms(
  pool: pg.Pool,
  options: { code?: string; page: number; pageSize: number },
): Promise<{ data: BomListItem[]; total: number }> {
  const filter = options.code ? 'WHERE s.code ILIKE $1' : '';
  const args = options.code ? [`%${options.code}%`] : [];
  const total = Number((await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM scheme_boms b JOIN schemes s ON s.id = b.scheme_id ${filter}`,
    args,
  )).rows[0]?.count ?? 0);
  const rows = await pool.query<Omit<BomListItem, 'updatedAt'> & { updatedAt: Date | string }>(
    `SELECT s.code AS "schemeCode", s.name AS "schemeName", b.revision, b.status,
            (SELECT count(*)::integer FROM scheme_bom_items i WHERE i.bom_id = b.id) AS "itemCount",
            b.updated_at AS "updatedAt"
     FROM scheme_boms b JOIN schemes s ON s.id = b.scheme_id ${filter}
     ORDER BY b.updated_at DESC, b.id DESC
     LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, options.pageSize, (options.page - 1) * options.pageSize],
  );
  return { data: rows.rows.map(row => ({ ...row, updatedAt: iso(row.updatedAt)! })), total };
}
