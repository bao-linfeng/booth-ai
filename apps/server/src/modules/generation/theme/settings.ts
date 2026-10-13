import type pg from 'pg';
import { writeAuditLog } from '../../../infra/audit.js';
import { transaction } from '../../../infra/database.js';

/** 换主题流水线选项；提交任务时冻结进快照，worker 只读快照。 */
export type ThemePipelineOptions = {
  /** 把蒙版发给支持蒙版的供应商（其余供应商忽略）。 */
  sendMask: boolean;
  /** 出图后对齐原图，只保留蒙版可编辑区域的新画面，其余（含透明背景）还原为原图。 */
  composite: boolean;
  /** 原图透明背景：保持透明发送，或铺纯色后发送。 */
  backgroundMode: 'transparent' | 'fill';
  /** `#RRGGBB`，仅 fill 时使用。 */
  backgroundColor: string;
};
export type ThemeGenerationSettings = ThemePipelineOptions & { revision: number; updatedAt: Date };

/** 引入设置前提交的任务快照没有 options，按当时的行为执行：发蒙版、不合成、透明原图直接发送。 */
export const LEGACY_THEME_OPTIONS: ThemePipelineOptions = {
  sendMask: true,
  composite: false,
  backgroundMode: 'transparent',
  backgroundColor: '#E8EAEE',
};

const columns = `send_mask AS "sendMask", composite, background_mode AS "backgroundMode",
  background_color AS "backgroundColor", revision, updated_at AS "updatedAt"`;

export async function getThemeGenerationSettings(database: Pick<pg.Pool, 'query'>): Promise<ThemeGenerationSettings> {
  const row = (await database.query<ThemeGenerationSettings>(`SELECT ${columns} FROM theme_generation_settings WHERE id = TRUE`)).rows[0];
  if (!row) throw new Error('Theme generation settings missing');
  return row;
}

export async function themePipelineOptions(database: Pick<pg.Pool, 'query'>): Promise<ThemePipelineOptions> {
  const { sendMask, composite, backgroundMode, backgroundColor } = await getThemeGenerationSettings(database);
  return { sendMask, composite, backgroundMode, backgroundColor };
}

export async function updateThemeGenerationSettings(
  pool: pg.Pool,
  input: ThemePipelineOptions & { expectedRevision: number },
  adminId: string,
): Promise<ThemeGenerationSettings> {
  const backgroundColor = input.backgroundColor.toUpperCase();
  return transaction(pool, async client => {
    const before = (
      await client.query<ThemeGenerationSettings>(`SELECT ${columns} FROM theme_generation_settings WHERE id = TRUE FOR UPDATE`)
    ).rows[0];
    if (!before) throw new Error('Theme generation settings missing');
    if (before.revision !== input.expectedRevision)
      throw Object.assign(new Error('Theme generation settings changed'), { statusCode: 409, reason: 'REVISION_CONFLICT' });
    const after = (
      await client.query<ThemeGenerationSettings>(
        `UPDATE theme_generation_settings SET send_mask = $1, composite = $2, background_mode = $3, background_color = $4,
        revision = revision + 1, updated_by = $5, updated_at = now() WHERE id = TRUE RETURNING ${columns}`,
        [input.sendMask, input.composite, input.backgroundMode, backgroundColor, adminId],
      )
    ).rows[0]!;
    const strip = ({ revision: _revision, updatedAt: _updatedAt, ...options }: ThemeGenerationSettings) => options;
    await writeAuditLog(client, {
      adminId,
      action: 'theme_generation_settings.update',
      targetType: 'theme_generation_settings',
      targetId: 'default',
      detail: { before: strip(before), after: strip(after) },
    });
    return after;
  });
}
