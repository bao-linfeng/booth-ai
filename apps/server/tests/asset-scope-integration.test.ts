import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { getSchemeReadiness, publishScheme } from '../src/modules/schemes/reviews.js';
import { loadCandidatePool, loadCatalog } from '../src/modules/selection/repository.js';
import { deliverableAvailability, listDeliverables, signDeliverable } from '../src/modules/assets/deliverables.js';
import { addAssetVersion, createAssetWithVersion, deleteAsset, getAsset, listAssets, listSchemeAssets, updateAsset } from '../src/modules/assets/service.js';
import { createQuoteRequest } from '../src/modules/projects/service.js';
import type { QuoteInput } from '../src/modules/projects/domain.js';
import { findCachedThemeJob, loadGenerationSnapshot } from '../src/modules/generation/theme/service.js';

test('asset scope migration and all baseline consumers isolate generated assets without changing historical references', {
  skip: !process.env.ASSET_TEST_DATABASE_URL,
}, async t => {
  const schema = `asset_scope_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new pg.Pool({ connectionString: process.env.ASSET_TEST_DATABASE_URL });
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.ASSET_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA ${schema} CASCADE`); await adminPool.end(); });
  for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter(n => /^\d+_.+\.sql$/.test(n) && !n.startsWith('050_')).sort()) {
    await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const user = randomUUID(); const other = randomUUID(); const admin = randomUUID(); const scheme = randomUUID();
  const code = 'ASSET-SCOPE';
  for (const [index, id] of [user, other].entries()) await pool.query('INSERT INTO users(id,external_user_id,username) VALUES($1,$2,$3)', [id, index + 1, id]);
  await pool.query("INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,1,'test',ARRAY['ROLE_ADMIN'])", [admin]);
  const product = (await pool.query<{ id: string }>("SELECT i.id FROM dictionary_items i JOIN dictionaries d ON d.id=i.dictionary_id WHERE d.code='product_system' AND d.enabled AND i.enabled LIMIT 1")).rows[0]!.id;
  await pool.query(`INSERT INTO schemes(id,code,name,length_mm,width_mm,height_mm,area_sqm,opening_count,product_system_id,industry_ids,zone_ids,feature_ids,applicable_conditions)
    VALUES($1,$2,$2,6000,6000,3000,36,2,$3,'{}','{}','{}','{"status":"confirmed","labelsConfirmed":true,"rules":[]}')`, [scheme, code, product]);
  async function asset(type: string, metadata: Record<string, unknown> = {}, order = 0, related: string | null = null, active = true) {
    const id = randomUUID();
    await pool.query('INSERT INTO scheme_assets(id,scheme_id,type,name,metadata,sort_order,related_asset_id,is_active) VALUES($1,$2,$3,$3,$4,$5,$6,$7)', [id, scheme, type, metadata, order, related, active]);
    const version = (await pool.query<{ id: string }>(`INSERT INTO asset_versions(asset_id,object_key,original_filename,mime_type,byte_size,checksum,width_px,height_px)
      VALUES($1,$2,$3,'image/png',10,$4,1600,900) RETURNING id`, [id, `scope/${id}`, `${id}.png`, 'a'.repeat(64)])).rows[0]!.id;
    return { id, version };
  }
  const baseline = new Map<string, Awaited<ReturnType<typeof asset>>>();
  for (const type of ['model', 'checklist', 'drawing', 'artwork']) baseline.set(type, await asset(type));
  const images: Awaited<ReturnType<typeof asset>>[] = [];
  for (let order = 0; order < 3; order++) {
    const image = await asset('rendering', {}, order); images.push(image);
    await asset('mask', {}, order, image.id);
  }
  const bom = (await pool.query<{ id: string }>("INSERT INTO scheme_boms(scheme_id,status,source_asset_id,content_hash,verified_at) VALUES($1,'verified',$2,'bom',now()) RETURNING id", [scheme, baseline.get('checklist')!.id])).rows[0]!.id;
  await pool.query("INSERT INTO scheme_bom_items(bom_id,ordinal,product_name,source_quantity,source_unit,quantity,measurement_kind) VALUES($1,1,'杆件',2500,'mm',2.5,'length')", [bom]);
  async function job(kind: 'theme' | 'artwork', owner = user) {
    const id = randomUUID();
    await pool.query(`INSERT INTO ${kind}_jobs(id,user_id,scheme_code,source_asset_id,offer_id,request_key,input,requested_count,status,usable_count)
      VALUES($1,$2,$3,$4,'test',$5,'{}',1,'succeeded',1)`, [id, owner, code, images[0]!.id, randomUUID()]);
    return id;
  }
  const themeJob = await job('theme'); const cachedJob = await job('theme'); const artworkJob = await job('artwork');
  const theme = await asset('rendering');
  const artwork = await asset('artwork', { artworkJobId: artworkJob });
  const metadataOnly = await asset('artwork', { themeJobId: themeJob });
  const orphan = await asset('artwork', { artworkJobId: 'invalid-deleted-job' }, 0, null, false);
  const conflicted = await asset('artwork');
  for (const owner of [user, other]) {
    const id = await job('theme', owner);
    await pool.query('INSERT INTO theme_job_results(job_id,ordinal,asset_id,asset_version_id) VALUES($1,1,$2,$3)', [id, conflicted.id, conflicted.version]);
  }
  for (const id of [themeJob, cachedJob]) await pool.query('INSERT INTO theme_job_results(job_id,ordinal,asset_id,asset_version_id) VALUES($1,1,$2,$3)', [id, theme.id, theme.version]);
  await pool.query('INSERT INTO artwork_job_results(job_id,ordinal,asset_id,asset_version_id) VALUES($1,1,$2,$3)', [artworkJob, artwork.id, artwork.version]);
  const historicalProject = randomUUID();
  const historicalSnapshot = { selectedTheme: { assetId: theme.id, versionId: theme.version }, renderings: [] };
  await pool.query(`INSERT INTO projects(id,request_no,source_type,customer_user_id,assignee_admin_id,request_snapshot,scheme_snapshot)
    VALUES($1,$2,'quote_request',$3,$4,'{}',$5)`, [historicalProject, randomUUID(), user, admin, historicalSnapshot]);
  await pool.query('INSERT INTO project_asset_versions(project_id,asset_version_id) VALUES($1,$2)', [historicalProject, theme.version]);
  const assetsBefore = (await pool.query('SELECT id,revision,created_at,updated_at FROM scheme_assets ORDER BY id')).rows;
  const versionsBefore = (await pool.query('SELECT * FROM asset_versions ORDER BY id')).rows;
  await pool.query(await readFile(new URL('../migrations/050_asset_scope.sql', import.meta.url), 'utf8'));

  await t.test('backfill recognizes result links, cache reuse, metadata-only and orphaned inactive assets', async () => {
    for (const [item, source, owner] of [
      [theme, 'theme_generation', user], [artwork, 'artwork_generation', user],
      [metadataOnly, 'theme_generation', user], [orphan, 'artwork_generation', null], [conflicted, 'theme_generation', null],
    ] as const) {
      assert.deepEqual((await pool.query('SELECT source,owner_user_id,visibility FROM scheme_assets WHERE id=$1', [item.id])).rows[0],
        { source, owner_user_id: owner, visibility: 'private' });
    }
    assert.equal((await pool.query('SELECT id FROM scheme_baseline_assets')).rowCount, 10);
    assert.deepEqual((await pool.query('SELECT id,revision,created_at,updated_at FROM scheme_assets ORDER BY id')).rows, assetsBefore);
    assert.deepEqual((await pool.query('SELECT * FROM asset_versions ORDER BY id')).rows, versionsBefore);
    assert.deepEqual((await pool.query('SELECT scheme_snapshot FROM projects WHERE id=$1', [historicalProject])).rows[0]!.scheme_snapshot, historicalSnapshot);
    assert.equal((await pool.query('SELECT asset_version_id FROM project_asset_versions WHERE project_id=$1', [historicalProject])).rows[0]!.asset_version_id, theme.version);
    await assert.rejects(pool.query("UPDATE scheme_assets SET visibility='public' WHERE id=$1", [theme.id]), { code: '23514' });
    await assert.rejects(pool.query('UPDATE scheme_assets SET owner_user_id=$1 WHERE id=$2', [user, images[0]!.id]), { code: '23514' });
  });

  await pool.query("INSERT INTO scheme_reviews(scheme_id,request_key,scheme_revision,phase,decision) VALUES($1,$2,1,'overall','pass')", [scheme, randomUUID()]);
  await pool.query("UPDATE scheme_assets SET metadata='{}',updated_at=now() + interval '1 second' WHERE id=ANY($1::uuid[])", [[theme.id, artwork.id, metadataOnly.id]]);
  await t.test('private changes do not affect readiness and cannot fill missing baseline material', async () => {
    const ready = await getSchemeReadiness(pool, code);
    assert.equal(ready.canPublish, true, ready.blockers.join(','));
    assert.equal(ready.assets.rendering.count, 3);
    assert.equal(ready.assets.artwork.count, 1);
    await pool.query('UPDATE scheme_assets SET is_active=false WHERE id=$1', [baseline.get('artwork')!.id]);
    assert.ok((await getSchemeReadiness(pool, code)).blockers.includes('缺少平面素材资产'));
    await pool.query('UPDATE scheme_assets SET is_active=true WHERE id=$1', [baseline.get('artwork')!.id]);
    assert.equal((await publishScheme(pool, code, admin)).publishStatus, 'published');
  });

  const input: QuoteInput = { requestKey: randomUUID(), schemeCode: code, schemeRevision: 1, entryPoint: 'scheme_detail',
    exhibition: { name: '展会', countryCode: 'CN', city: '上海', startDate: '2026-11-10', endDate: '2026-11-12' },
    scopeCodes: ['materials'], materialBudget: { currency: 'CNY', amount: '30000' }, customerType: 'company',
    company: '测试公司', contact: { name: '联系人', email: 'test@example.com' } };
  await t.test('selection, anonymous downloads and quote snapshots use the same baseline', async () => {
    const catalog = await loadCatalog(pool);
    const candidates = await loadCandidatePool(pool, catalog, { signDownload: async key => key }, code);
    assert.equal(candidates.candidates.length, 1);
    assert.deepEqual(new Set(candidates.candidates[0]!.images.map(image => image.assetId)), new Set(images.map(image => image.id)));
    assert.deepEqual((await listDeliverables(pool, code, 'artwork')).map(item => item.assetId), [baseline.get('artwork')!.id]);
    assert.deepEqual(await deliverableAvailability(pool, code), { model: true, drawing: true, artwork: true });
    await assert.rejects(signDeliverable(pool, { signDownload: async () => '', signDownloadWithName: async () => '' }, code, 'artwork', artwork.id), { statusCode: 404 });
    const quote = await createQuoteRequest(pool, user, input);
    const saved = (await pool.query('SELECT scheme_snapshot,materials_snapshot FROM projects WHERE id=$1', [quote.receipt.projectId])).rows[0]!;
    assert.equal(saved.scheme_snapshot.renderings.length, 3);
    assert.deepEqual(saved.materials_snapshot.artworks.assets.map((item: { assetId: string }) => item.assetId), [baseline.get('artwork')!.id]);
    assert.equal((await pool.query('SELECT asset_version_id FROM project_asset_versions WHERE project_id=$1', [quote.receipt.projectId])).rowCount, 10);
    await pool.query('UPDATE theme_jobs SET selected_result_id=(SELECT id FROM theme_job_results WHERE job_id=$1),selection_revision=1 WHERE id=$1', [cachedJob]);
    const resultId = (await pool.query<{ id: string }>('SELECT id FROM theme_job_results WHERE job_id=$1', [cachedJob])).rows[0]!.id;
    const themedInput = { ...input, requestKey: randomUUID(), themeSelection: { themeJobId: cachedJob, resultId, selectionRevision: 1 } };
    const themed = await createQuoteRequest(pool, user, themedInput);
    assert.equal((await pool.query('SELECT scheme_snapshot FROM projects WHERE id=$1', [themed.receipt.projectId])).rows[0]!.scheme_snapshot.selectedTheme.asset.versionId, theme.version);
    await assert.rejects(createQuoteRequest(pool, other, { ...themedInput, requestKey: randomUUID() }), { reason: 'THEME_SELECTION_CHANGED' });
    await pool.query("UPDATE theme_jobs SET cache_key='scope-cache' WHERE id=$1", [themeJob]);
    assert.equal(await findCachedThemeJob(pool, user, 'scope-cache', 1), themeJob);
    assert.equal(await findCachedThemeJob(pool, other, 'scope-cache', 1), null);
    await assert.rejects(loadGenerationSnapshot(pool, { schemeCode: code, sourceAssetId: theme.id, input: { industryId: randomUUID(), styleId: randomUUID() }, requestedCount: 1, cacheMode: 'reuse' }), { reason: 'SOURCE_UNAVAILABLE' });
    await pool.query('UPDATE scheme_assets SET is_active=false WHERE id=$1', [baseline.get('artwork')!.id]);
    assert.equal((await loadCandidatePool(pool, catalog, { signDownload: async () => '' }, code)).candidates.length, 0);
    assert.deepEqual(await listDeliverables(pool, code, 'artwork'), []);
    assert.equal((await deliverableAvailability(pool, code)).artwork, false);
    await assert.rejects(createQuoteRequest(pool, user, { ...input, requestKey: randomUUID() }), { reason: 'SCHEME_UNAVAILABLE' });
    await pool.query('UPDATE scheme_assets SET is_active=true WHERE id=$1', [baseline.get('artwork')!.id]);
  });

  await t.test('admin baseline operations cannot list, edit, version, delete or relate private assets', async () => {
    assert.equal((await listAssets(pool, { page: 1, pageSize: 100 })).total, 10);
    assert.equal((await listSchemeAssets(pool, code)).length, 10);
    await assert.rejects(getAsset(pool, code, artwork.id), { statusCode: 404 });
    await assert.rejects(updateAsset(pool, admin, code, artwork.id, { name: 'changed' }, 1), { statusCode: 404 });
    await assert.rejects(deleteAsset(pool, admin, code, artwork.id, 1), { statusCode: 404 });
    const version = { objectKey: 'new', originalFilename: 'new.png', mimeType: 'image/png', byteSize: 10, checksum: 'b'.repeat(64) };
    await assert.rejects(addAssetVersion(pool, admin, code, artwork.id, version, 1), { statusCode: 404 });
    await assert.rejects(updateAsset(pool, admin, code, baseline.get('artwork')!.id, { relatedAssetId: theme.id }, 1), { statusCode: 400 });
    assert.equal((await pool.query('SELECT publish_status FROM schemes WHERE id=$1', [scheme])).rows[0]!.publish_status, 'published');
    const created = await createAssetWithVersion(pool, admin, { schemeCode: code, type: 'artwork', name: 'public', metadata: { themeJobId: 'descriptive-only' } }, version);
    assert.equal(created.sortOrder, 1);
    assert.deepEqual((await pool.query('SELECT source,owner_user_id,visibility FROM scheme_assets WHERE id=$1', [created.id])).rows[0],
      { source: 'scheme', owner_user_id: null, visibility: 'public' });
    assert.equal((await pool.query('SELECT publish_status FROM schemes WHERE id=$1', [scheme])).rows[0]!.publish_status, 'draft');
    assert.equal((await listSchemeAssets(pool, code)).length, 11);
  });
});
