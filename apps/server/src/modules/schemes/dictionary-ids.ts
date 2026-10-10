import type pg from 'pg';

type DbClient = pg.Pool | pg.PoolClient;

const fields = {
  productSystemId: 'product_system',
  styleId: 'style',
  industryIds: 'industry',
  budgetTierId: 'budget_tier',
  zoneIds: 'functional_zone',
  featureIds: 'key_feature',
} as const;

export async function validateSchemeDictionaryIds(
  client: DbClient,
  input: Partial<Record<keyof typeof fields, string | string[] | null>>,
): Promise<void> {
  for (const [field, code] of Object.entries(fields)) {
    const value = input[field as keyof typeof fields];
    if (value === undefined || value === null) continue;
    const ids = Array.isArray(value) ? value : [value];
    if (ids.length === 0) continue;
    if (ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) || new Set(ids).size !== ids.length)
      throw Object.assign(new Error(`Invalid ${field}`), { statusCode: 400 });
    const found = await client.query<{ id: string }>(
      `
      SELECT i.id::text AS id FROM dictionary_items i JOIN dictionaries d ON d.id = i.dictionary_id
      WHERE i.id = ANY($1::uuid[]) AND d.code = $2 AND d.enabled AND i.enabled`,
      [ids, code],
    );
    if (found.rows.length !== ids.length) throw Object.assign(new Error(`Invalid or disabled ${field}`), { statusCode: 400 });
  }
}
