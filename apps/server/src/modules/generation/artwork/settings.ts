import type pg from 'pg';
import { writeAuditLog } from '../../../infra/audit.js';
import { transaction } from '../../../infra/database.js';
import { DIRECTIONS, type Direction } from './types.js';

/** 四向底图流水线选项；报价时冻结进快照，worker 只读快照。 */
export type ArtworkPipelineOptions = {
  /** 附带方案报馆图（俯视图 + 本方向立面，背面/右侧用正视图/左视图翻转）校正结构的方向；为空则不使用报馆图。 */
  drawingDirections: Direction[];
  /** 报馆图去色后发送，避免旧方案的品牌配色被带进结果。 */
  drawingGrayscale: boolean;
};
export type ArtworkGenerationSettings = ArtworkPipelineOptions & { revision: number; updatedAt: Date };

const columns = `drawing_directions AS "drawingDirections", drawing_grayscale AS "drawingGrayscale", revision, updated_at AS "updatedAt"`;

/** 去重并按固定方向顺序排列，使相同设置得到相同快照。 */
const normalizeDirections = (directions: readonly string[]) => DIRECTIONS.filter(direction => directions.includes(direction));

export async function getArtworkGenerationSettings(database: Pick<pg.Pool, 'query'>): Promise<ArtworkGenerationSettings> {
  const row = (await database.query<ArtworkGenerationSettings>(`SELECT ${columns} FROM artwork_generation_settings WHERE id = TRUE`))
    .rows[0];
  if (!row) throw new Error('Artwork generation settings missing');
  return { ...row, drawingDirections: normalizeDirections(row.drawingDirections) };
}

export async function artworkPipelineOptions(database: Pick<pg.Pool, 'query'>): Promise<ArtworkPipelineOptions> {
  const { drawingDirections, drawingGrayscale } = await getArtworkGenerationSettings(database);
  return { drawingDirections, drawingGrayscale };
}

export async function updateArtworkGenerationSettings(
  pool: pg.Pool,
  input: ArtworkPipelineOptions & { expectedRevision: number },
  adminId: string,
): Promise<ArtworkGenerationSettings> {
  const drawingDirections = normalizeDirections(input.drawingDirections);
  return transaction(pool, async client => {
    const before = (
      await client.query<ArtworkGenerationSettings>(`SELECT ${columns} FROM artwork_generation_settings WHERE id = TRUE FOR UPDATE`)
    ).rows[0];
    if (!before) throw new Error('Artwork generation settings missing');
    if (before.revision !== input.expectedRevision)
      throw Object.assign(new Error('Artwork generation settings changed'), { statusCode: 409, reason: 'REVISION_CONFLICT' });
    const after = (
      await client.query<ArtworkGenerationSettings>(
        `UPDATE artwork_generation_settings SET drawing_directions = $1, drawing_grayscale = $2,
        revision = revision + 1, updated_by = $3, updated_at = now() WHERE id = TRUE RETURNING ${columns}`,
        [drawingDirections, input.drawingGrayscale, adminId],
      )
    ).rows[0]!;
    const strip = ({ revision: _revision, updatedAt: _updatedAt, ...options }: ArtworkGenerationSettings) => options;
    await writeAuditLog(client, {
      adminId,
      action: 'artwork_generation_settings.update',
      targetType: 'artwork_generation_settings',
      targetId: 'default',
      detail: { before: strip(before), after: strip(after) },
    });
    return after;
  });
}
