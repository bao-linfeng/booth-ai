import type pg from 'pg';

export interface PromptTemplate {
  id: string;
  purpose: 'theme' | 'artwork';
  industryId: string | null;
  styleId: string | null;
  body: string;
  variables: string[];
  enabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  purpose: 'theme' | 'artwork';
  industryId?: string | null;
  styleId?: string | null;
  body: string;
  variables?: string[];
}

export interface UpdateTemplateInput {
  body?: string;
  variables?: string[];
  enabled?: boolean;
  expectedRevision: number;
}

type TemplateRow = Omit<PromptTemplate, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };

const columns = `id, purpose, industry_id AS "industryId", style_id AS "styleId", body, variables,
  enabled, revision, created_at AS "createdAt", updated_at AS "updatedAt"`;

function toTemplate(row: TemplateRow): PromptTemplate {
  const { id, purpose, industryId, styleId, body, variables, enabled, revision, createdAt, updatedAt } = row;
  return { id, purpose, industryId, styleId, body, variables, enabled, revision,
    createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

export async function listPromptTemplates(pool: pg.Pool, filters: { purpose?: string; enabled?: boolean; page: number; pageSize: number }): Promise<{ items: PromptTemplate[]; total: number }> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters.purpose !== undefined) {
    values.push(filters.purpose);
    where.push(`purpose = $${values.length}`);
  }
  if (filters.enabled !== undefined) {
    values.push(filters.enabled);
    where.push(`enabled = $${values.length}`);
  }
  const condition = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = await pool.query<{ total: string }>(`SELECT count(*) AS total FROM prompt_templates${condition}`, values);
  const items = await pool.query<TemplateRow>(
    `SELECT ${columns} FROM prompt_templates${condition} ORDER BY created_at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, filters.pageSize, (filters.page - 1) * filters.pageSize]
  );
  return { items: items.rows.map(toTemplate), total: Number(total.rows[0]?.total ?? 0) };
}

export async function createPromptTemplate(pool: pg.Pool, input: CreateTemplateInput, adminId: string): Promise<PromptTemplate> {
  const result = await pool.query<TemplateRow>(
    `INSERT INTO prompt_templates (purpose, industry_id, style_id, body, variables, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING ${columns}`,
    [input.purpose, input.industryId ?? null, input.styleId ?? null, input.body, input.variables ?? [], adminId]
  );
  return toTemplate(result.rows[0]!);
}

export async function getPromptTemplate(pool: pg.Pool, id: string): Promise<PromptTemplate | null> {
  const result = await pool.query<TemplateRow>(`SELECT ${columns} FROM prompt_templates WHERE id = $1`, [id]);
  return result.rows[0] ? toTemplate(result.rows[0]) : null;
}

export async function updatePromptTemplate(pool: pg.Pool, id: string, input: UpdateTemplateInput, adminId: string): Promise<PromptTemplate> {
  try {
    const result = await pool.query<TemplateRow>(
      `UPDATE prompt_templates SET body = COALESCE($1, body), variables = COALESCE($2, variables),
       enabled = COALESCE($3, enabled), revision = revision + 1, updated_by = $4, updated_at = now()
       WHERE id = $5 AND revision = $6 RETURNING ${columns}`,
      [input.body ?? null, input.variables ?? null, input.enabled ?? null, adminId, id, input.expectedRevision]
    );
    if (result.rows[0]) return toTemplate(result.rows[0]);
  } catch (error) {
    if ((error as { code?: string; constraint?: string }).code === '23505' &&
      (error as { constraint?: string }).constraint === 'prompt_templates_active_unique') {
      throw Object.assign(new Error('An active template already exists for this combination'), { statusCode: 409 });
    }
    throw error;
  }
  if (!await getPromptTemplate(pool, id)) throw Object.assign(new Error('Prompt template not found'), { statusCode: 404 });
  throw Object.assign(new Error('Prompt template revision conflict'), { statusCode: 409 });
}

export async function getActivePromptTemplate(pool: pg.Pool, purpose: 'theme' | 'artwork', industryId?: string | null, styleId?: string | null): Promise<PromptTemplate | null> {
  const result = await pool.query<TemplateRow>(
    `SELECT ${columns} FROM prompt_templates
     WHERE purpose = $1 AND enabled = true
       AND (industry_id = $2::uuid OR industry_id IS NULL)
       AND (style_id = $3::uuid OR style_id IS NULL)
     ORDER BY (industry_id IS NOT NULL)::int + (style_id IS NOT NULL)::int DESC,
       (industry_id IS NOT NULL) DESC, id ASC LIMIT 1`,
    [purpose, industryId ?? null, styleId ?? null]
  );
  return result.rows[0] ? toTemplate(result.rows[0]) : null;
}
