import type pg from 'pg';
import type { ApplicabilityQuestionSummary } from './domain.js';

export interface ApplicabilityQuestion extends ApplicabilityQuestionSummary {
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQuestionInput {
  id: string;
  label: string;
  helpText?: string;
  sortOrder?: number;
}

export interface UpdateQuestionInput {
  label?: string;
  helpText?: string;
  sortOrder?: number;
  enabled?: boolean;
}

type QuestionRow = Omit<ApplicabilityQuestion, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };

const columns = `id, label, help_text AS "helpText", sort_order AS "sortOrder", enabled, created_at AS "createdAt", updated_at AS "updatedAt"`;

function toQuestion(row: QuestionRow): ApplicabilityQuestion {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function listQuestions(pool: pg.Pool, filters: { enabled?: boolean; page: number; pageSize: number }): Promise<{ items: ApplicabilityQuestion[]; total: number }> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters.enabled !== undefined) {
    values.push(filters.enabled);
    where.push(`enabled = $${values.length}`);
  }
  const condition = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = await pool.query<{ total: string }>(`SELECT count(*) AS total FROM applicability_questions${condition}`, values);
  const items = await pool.query<QuestionRow>(
    `SELECT ${columns} FROM applicability_questions${condition} ORDER BY sort_order, id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, filters.pageSize, (filters.page - 1) * filters.pageSize]
  );
  return { items: items.rows.map(toQuestion), total: Number(total.rows[0]?.total ?? 0) };
}

export async function createQuestion(pool: pg.Pool, input: CreateQuestionInput): Promise<ApplicabilityQuestion> {
  try {
    const result = await pool.query<QuestionRow>(
      `INSERT INTO applicability_questions (id, label, help_text, sort_order) VALUES ($1, $2, $3, $4) RETURNING ${columns}`,
      [input.id, input.label, input.helpText ?? '', input.sortOrder ?? 0]
    );
    return toQuestion(result.rows[0]!);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw Object.assign(new Error('Question ID already exists'), { statusCode: 409 });
    throw error;
  }
}

export async function getQuestion(pool: pg.Pool, id: string): Promise<ApplicabilityQuestion | null> {
  const result = await pool.query<QuestionRow>(`SELECT ${columns} FROM applicability_questions WHERE id = $1`, [id]);
  return result.rows[0] ? toQuestion(result.rows[0]) : null;
}

export async function updateQuestion(pool: pg.Pool, id: string, input: UpdateQuestionInput): Promise<ApplicabilityQuestion> {
  const result = await pool.query<QuestionRow>(
    `UPDATE applicability_questions SET
      label = COALESCE($1, label),
      help_text = COALESCE($2, help_text),
      sort_order = COALESCE($3, sort_order),
      enabled = COALESCE($4, enabled),
      updated_at = now()
     WHERE id = $5 RETURNING ${columns}`,
    [input.label ?? null, input.helpText ?? null, input.sortOrder ?? null, input.enabled ?? null, id]
  );
  if (!result.rows[0]) throw Object.assign(new Error('Question not found'), { statusCode: 404 });
  return toQuestion(result.rows[0]);
}

export async function deleteQuestion(pool: pg.Pool, id: string): Promise<void> {
  const result = await pool.query('DELETE FROM applicability_questions WHERE id = $1', [id]);
  if (result.rowCount === 0) throw Object.assign(new Error('Question not found'), { statusCode: 404 });
}
