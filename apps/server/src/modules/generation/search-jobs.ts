import type pg from 'pg';
import type { createStorage } from '../../infra/storage.js';

interface SearchTheme {
  jobId: string;
  status: string;
  createdAt: string;
  previewUrl: string | null;
}

interface SearchArtwork {
  jobId: string;
  status: string;
  deliveryStatus: string;
  createdAt: string;
  views: Array<{ direction: string; previewUrl: string }>;
}

interface SearchGeneration {
  theme: SearchTheme;
  artwork: SearchArtwork | null;
}

export async function listSearchJobs(pool: pg.Pool, storage: Pick<ReturnType<typeof createStorage>, 'signDownload'>,
  userId: string, searchIds: string[]): Promise<Map<string, Map<string, SearchGeneration>>> {
  const searches = new Map<string, Map<string, SearchGeneration>>();
  if (!searchIds.length) return searches;
  const result = await pool.query<{
    searchId: string; schemeCode: string; jobId: string; status: string; createdAt: string; objectKey: string | null;
    artworkJobId: string | null; artworkStatus: string; deliveryStatus: string; artworkCreatedAt: string;
    views: Array<{ direction: string; objectKey: string }>;
  }>(
    `WITH latest_theme AS (
       SELECT DISTINCT ON (search_id, scheme_code) * FROM theme_jobs
       WHERE user_id = $1 AND search_id = ANY($2::uuid[])
       ORDER BY search_id, scheme_code, created_at DESC, id DESC
     )
     SELECT t.search_id AS "searchId", t.scheme_code AS "schemeCode", t.id AS "jobId", t.status::text,
       t.created_at AS "createdAt", preview.object_key AS "objectKey", a.id AS "artworkJobId",
       a.status::text AS "artworkStatus", a.delivery_status AS "deliveryStatus", a.created_at AS "artworkCreatedAt",
       COALESCE(views.items, '[]'::jsonb) AS views
     FROM latest_theme t
     LEFT JOIN LATERAL (
       SELECT v.object_key FROM theme_job_results r JOIN asset_versions v ON v.id = r.asset_version_id AND v.asset_id = r.asset_id
       WHERE r.job_id = t.id AND (t.selected_result_id IS NULL OR r.id = t.selected_result_id)
       ORDER BY r.ordinal, r.id LIMIT 1
     ) preview ON true
     LEFT JOIN LATERAL (
       SELECT * FROM artwork_jobs WHERE user_id = $1 AND scheme_code = t.scheme_code AND theme_job_id = t.id
         AND theme_result_id = t.selected_result_id AND theme_selection_revision = t.selection_revision
       ORDER BY created_at DESC, id DESC LIMIT 1
     ) a ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object('direction', r.direction, 'objectKey', v.object_key)
         ORDER BY CASE r.direction WHEN 'front' THEN 1 WHEN 'back' THEN 2 WHEN 'left' THEN 3 WHEN 'right' THEN 4 END) AS items
       FROM artwork_job_results r JOIN asset_versions v ON v.id = r.asset_version_id AND v.asset_id = r.asset_id
       WHERE r.job_id = a.id AND r.direction IS NOT NULL
     ) views ON true`,
    [userId, searchIds],
  );
  await Promise.all(result.rows.map(async row => {
    const schemeJobs = searches.get(row.searchId) ?? new Map<string, SearchGeneration>();
    searches.set(row.searchId, schemeJobs);
    const theme = { jobId: row.jobId, status: row.status, createdAt: row.createdAt,
      previewUrl: row.objectKey ? await storage.signDownload(row.objectKey, 900) : null };
    const artwork = row.artworkJobId ? {
      jobId: row.artworkJobId, status: row.artworkStatus, deliveryStatus: row.deliveryStatus, createdAt: row.artworkCreatedAt,
      views: await Promise.all(row.views.map(async view => ({ direction: view.direction, previewUrl: await storage.signDownload(view.objectKey, 900) }))),
    } : null;
    schemeJobs.set(row.schemeCode, { theme, artwork });
  }));
  return searches;
}
