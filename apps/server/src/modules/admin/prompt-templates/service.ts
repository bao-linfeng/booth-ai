import type pg from 'pg';
import { assertPrompt, type PromptPurpose } from '../../prompts/template.js';

export interface PromptTemplate {
  id: string;
  purpose: PromptPurpose;
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
  purpose: PromptPurpose;
  industryId?: string | null;
  styleId?: string | null;
  body: string;
}

export interface UpdateTemplateInput {
  body?: string;
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

export async function listPromptTemplates(pool: pg.Pool, filters: { purpose?: string; industryId?: string; styleId?: string; enabled?: boolean; page: number; pageSize: number }): Promise<{ items: PromptTemplate[]; total: number }> {
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
  for (const [column, value] of [['industry_id', filters.industryId], ['style_id', filters.styleId]] as const) {
    if (value) {
      values.push(value);
      where.push(`${column} = $${values.length}`);
    }
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
  const variables = assertPrompt(input.purpose, input.body);
  await validateTemplateScope(pool, input);
  const result = await pool.query<TemplateRow>(
    `INSERT INTO prompt_templates (purpose, industry_id, style_id, body, variables, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING ${columns}`,
    [input.purpose, input.industryId ?? null, input.styleId ?? null, input.body.trim(), variables, adminId]
  );
  return toTemplate(result.rows[0]!);
}

export async function getPromptTemplate(pool: pg.Pool, id: string): Promise<PromptTemplate | null> {
  const result = await pool.query<TemplateRow>(`SELECT ${columns} FROM prompt_templates WHERE id = $1`, [id]);
  return result.rows[0] ? toTemplate(result.rows[0]) : null;
}

export async function updatePromptTemplate(pool: pg.Pool, id: string, input: UpdateTemplateInput, adminId: string): Promise<PromptTemplate> {
  const current = await getPromptTemplate(pool, id);
  if (!current) throw Object.assign(new Error('Prompt template not found'), { statusCode: 404 });
  if (current.revision !== input.expectedRevision) throw Object.assign(new Error('Prompt template revision conflict'), { statusCode: 409, reason: 'PROMPT_REVISION_CONFLICT' });
  const variables = input.body !== undefined || input.enabled === true ? assertPrompt(current.purpose, input.body ?? current.body) : null;
  if (input.enabled === true) await validateTemplateScope(pool, current);
  try {
    const result = await pool.query<TemplateRow>(
      `UPDATE prompt_templates SET body = COALESCE($1, body), variables = COALESCE($2, variables),
       enabled = COALESCE($3, enabled), revision = revision + 1, updated_by = $4, updated_at = now()
       WHERE id = $5 AND revision = $6 RETURNING ${columns}`,
      [input.body?.trim() ?? null, variables, input.enabled ?? null, adminId, id, input.expectedRevision]
    );
    if (result.rows[0]) return toTemplate(result.rows[0]);
  } catch (error) {
    if ((error as { code?: string; constraint?: string }).code === '23505' &&
      (error as { constraint?: string }).constraint === 'prompt_templates_active_unique') {
      throw Object.assign(new Error('An active template already exists for this combination'), { statusCode: 409, reason: 'PROMPT_ACTIVE_CONFLICT' });
    }
    throw error;
  }
  if (!await getPromptTemplate(pool, id)) throw Object.assign(new Error('Prompt template not found'), { statusCode: 404 });
  throw Object.assign(new Error('Prompt template revision conflict'), { statusCode: 409 });
}

async function validateTemplateScope(pool: pg.Pool, input: Pick<CreateTemplateInput, 'purpose' | 'industryId' | 'styleId'>) {
  if (input.purpose === 'filter' && (input.industryId || input.styleId)) {
    throw Object.assign(new Error('Selection templates must be global'), { statusCode: 400, reason: 'INVALID_PROMPT_SCOPE' });
  }
  for (const [code, id] of [['industry', input.industryId], ['style', input.styleId]] as const) {
    if (!id) continue;
    const result = await pool.query(`SELECT i.id FROM dictionary_items i JOIN dictionaries d ON d.id=i.dictionary_id
      WHERE i.id=$1 AND d.code=$2 AND i.enabled AND d.enabled`, [id, code]);
    if (!result.rows[0]) throw Object.assign(new Error('Invalid prompt dictionary scope'), { statusCode: 400, reason: 'INVALID_PROMPT_SCOPE' });
  }
}
