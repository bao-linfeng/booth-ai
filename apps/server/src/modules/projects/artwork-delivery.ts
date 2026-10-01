import type pg from 'pg';
import { transaction } from '../../infra/database.js';
import { digest, projectError } from './domain.js';
import type { MaterialsSnapshot, SchemeSnapshot } from './snapshot.js';
import { operationReceipt, saveOperation } from './service.js';
import { readyArtworkFiles } from '../client/artwork-jobs/service.js';

export type BindArtworkInput = { artworkJobId: string; requestKey: string; expectedRevision: number };
export async function bindProjectArtworks(pool: pg.Pool, userId: string, projectId: string, input: BindArtworkInput) {
  const hash = digest({ artworkJobId: input.artworkJobId, expectedRevision: input.expectedRevision });
  return transaction(pool, async client => {
    const replay = await operationReceipt<{ projectId: string; revision: number; artworkJobId: string; status: string }>(client, 'client', userId, 'artworks.bind', projectId, input.requestKey, hash);
    if (replay) return replay;
    const project = (await client.query<{ revision: number; status: string; schemeCode: string; snapshot: SchemeSnapshot; materials: MaterialsSnapshot }>(
      `SELECT revision,status,scheme_code AS "schemeCode",scheme_snapshot AS snapshot,materials_snapshot AS materials
       FROM projects WHERE id=$1 AND customer_user_id=$2 FOR UPDATE`, [projectId, userId])).rows[0];
    if (!project) throw projectError('PROJECT_NOT_FOUND', 404);
    if (!project.snapshot?.selectedTheme) throw projectError('ARTWORK_CONTEXT_MISMATCH');
    if (project.materials.artworks.artworkJobId === input.artworkJobId) {
      const receipt = { projectId, revision: project.revision, artworkJobId: input.artworkJobId, status: 'available' };
      await saveOperation(client, 'client', userId, 'artworks.bind', projectId, input.requestKey, hash, receipt);
      return receipt;
    }
    if (project.revision !== input.expectedRevision) throw projectError('PROJECT_REVISION_CHANGED');
    if (['won', 'lost', 'closed'].includes(project.status)) throw projectError('PROJECT_CLOSED');
    if (project.materials.artworks.status === 'available') throw projectError('ARTWORK_ALREADY_DELIVERED');
    const files = await readyArtworkFiles(client, userId, input.artworkJobId, { schemeCode: project.schemeCode, ...project.snapshot.selectedTheme });
    const materials = { ...project.materials, artworks: { status: 'available', revision: null, artworkJobId: input.artworkJobId, mappingStatus: 'unresolved', assets: files } };
    const revision = project.revision + 1;
    await client.query('UPDATE projects SET materials_snapshot=$2,revision=$3,updated_at=now() WHERE id=$1', [projectId, JSON.stringify(materials), revision]);
    for (const file of files) await client.query('INSERT INTO project_asset_versions(project_id,asset_version_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [projectId, file.versionId]);
    const event = (await client.query<{ id: string }>(`INSERT INTO project_events(project_id,kind,payload) VALUES($1,'artworks',$2) RETURNING id`,
      [projectId, JSON.stringify({ artworkJobId: input.artworkJobId, revision, mappingStatus: 'unresolved' })])).rows[0]!;
    await client.query('INSERT INTO project_notification_outbox(project_id,event_id) VALUES($1,$2)', [projectId, event.id]);
    const receipt = { projectId, revision, artworkJobId: input.artworkJobId, status: 'available' };
    await saveOperation(client, 'client', userId, 'artworks.bind', projectId, input.requestKey, hash, receipt);
    return receipt;
  });
}
