import type pg from 'pg';
import type { PromptPurpose } from './template.js';

export interface ActivePromptTemplate {
  id: string;
  purpose: PromptPurpose;
  industryId: string | null;
  styleId: string | null;
  body: string;
  variables: string[];
  enabled: boolean;
  revision: number;
}

export async function getActivePromptTemplate(
  pool: pg.Pool,
  purpose: PromptPurpose,
  industryId?: string | null,
  styleId?: string | null,
): Promise<ActivePromptTemplate | null> {
  const result = await pool.query<ActivePromptTemplate>(
    `SELECT id, purpose, industry_id AS "industryId", style_id AS "styleId", body, variables, enabled, revision
     FROM prompt_templates
     WHERE purpose = $1 AND enabled = true
       AND (industry_id = $2::uuid OR industry_id IS NULL)
       AND (style_id = $3::uuid OR style_id IS NULL)
     ORDER BY (industry_id IS NOT NULL)::int + (style_id IS NOT NULL)::int DESC,
       (industry_id IS NOT NULL) DESC, id ASC LIMIT 1`,
    [purpose, industryId ?? null, styleId ?? null],
  );
  return result.rows[0] ?? null;
}
