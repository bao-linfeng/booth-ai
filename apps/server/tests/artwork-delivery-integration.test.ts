import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import pg from 'pg';
import sharp from 'sharp';
import JSZip from 'jszip';
import { encryptCredential } from '../src/infra/ai-models.js';
import type { createStorage } from '../src/infra/storage.js';
import { registerArtworkJobRoutes } from '../src/modules/client/artwork-jobs/index.js';
import { artworkArchive, artworkFiles, getArtworkJob, readyArtworkFiles, DIRECTIONS, DIRECTION_LABELS, type ArtworkSnapshot } from '../src/modules/generation/artwork/service.js';
import { processArtworkJob, settleArtworkJob } from '../src/modules/tasks/artwork-worker.js';
import { bindProjectArtworks } from '../src/modules/projects/artwork-delivery.js';
import { createQuoteRequest } from '../src/modules/projects/service.js';
import { getGenerationJob, listGenerationJobs } from '../src/modules/admin/generation-jobs/service.js';
import { listDeliverables } from '../src/modules/client/schemes/service.js';
import type { QuoteInput } from '../src/modules/projects/domain.js';

test('four-direction delivery: real SQL, reservations, provider recovery, ownership, PNG/ZIP and immutable projects',
  { skip: !process.env.ARTWORK_TEST_DATABASE_URL }, async t => {
    const schema = `artwork_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.ARTWORK_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.ARTWORK_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA ${schema} CASCADE`); await adminPool.end(); });
    for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter(n => /^\d+_.+\.sql$/.test(n)).sort()) {
      await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    }
    const user = randomUUID(); const other = randomUUID(); const scheme = randomUUID(); const admin = randomUUID();
    const themeJob = randomUUID(); const result = randomUUID(); const source = randomUUID();
    const industry = (await pool.query<{ id: string }>("SELECT i.id FROM dictionary_items i JOIN dictionaries d ON d.id=i.dictionary_id WHERE d.code='industry' LIMIT 1")).rows[0]!.id;
    const style = (await pool.query<{ id: string }>("SELECT i.id FROM dictionary_items i JOIN dictionaries d ON d.id=i.dictionary_id WHERE d.code='style' LIMIT 1")).rows[0]!.id;
    const productSystem = (await pool.query<{ id: string }>("SELECT i.id FROM dictionary_items i JOIN dictionaries d ON d.id=i.dictionary_id WHERE d.code='product_system' LIMIT 1")).rows[0]!.id;
    const code = 'ARTWORK-TEST';
    for (const [index, id] of [user, other].entries()) await pool.query('INSERT INTO users(id,external_user_id,username) VALUES($1,$2,$3)', [id, index + 1, id]);
    await pool.query("INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,1,'test',ARRAY['ROLE_ADMIN'])", [admin]);
    await pool.query(`INSERT INTO schemes(id,code,name,publish_status,applicable_conditions,length_mm,width_mm,height_mm,area_sqm,opening_count,product_system_id,industry_ids,zone_ids,feature_ids)
      VALUES($1,$2,$2,'published','{"labelsConfirmed":true,"status":"confirmed","rules":[]}',6000,6000,3000,36,2,$3,'{}','{}','{}')`, [scheme, code, productSystem]);
    const jpeg = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#345678' } }).jpeg().toBuffer();
    const small = await sharp(jpeg).resize(512, 342).png().toBuffer();
    const sourceChecksum = createHash('sha256').update(jpeg).digest('hex');
    const buffers = new Map<string, Buffer>([['selected-theme.jpg', jpeg]]);
    const storage = { getBuffer: async (key: string) => {
      const bytes = buffers.get(key); if (!bytes) throw new Error('Missing storage object'); return bytes;
    }, putBuffer: async (key: string, bytes: Buffer, mime: string) => { assert.equal(mime, 'image/png'); buffers.set(key, bytes); },
    signDownload: async (key: string) => `https://assets.example.test/${key}` } as unknown as ReturnType<typeof createStorage>;
    async function addAsset(type: string, order = 0, related?: string) {
      const id = randomUUID();
      const width = type === 'rendering' || type === 'mask' ? 1600 : 1536;
      const height = type === 'rendering' || type === 'mask' ? 900 : 1024;
      await pool.query('INSERT INTO scheme_assets(id,scheme_id,type,name,sort_order,related_asset_id) VALUES($1,$2,$3,$3,$4,$5)', [id, scheme, type, order, related ?? null]);
      await pool.query("INSERT INTO asset_versions(asset_id,object_key,original_filename,mime_type,byte_size,checksum,width_px,height_px) VALUES($1,$2,'base.png','image/png',10,'base',$3,$4)", [id, `base/${id}`, width, height]);
      return id;
    }
    const checklist = await addAsset('checklist');
    for (const type of ['model', 'drawing', 'artwork']) await addAsset(type);
    for (let order = 0; order < 3; order++) await addAsset('mask', order, await addAsset('rendering', order));
    const bom = (await pool.query<{ id: string }>("INSERT INTO scheme_boms(scheme_id,status,revision,source_asset_id,content_hash,verified_at) VALUES($1,'verified',1,$2,'bom',now()) RETURNING id", [scheme, checklist])).rows[0]!.id;
    await pool.query("INSERT INTO scheme_bom_items(bom_id,ordinal,product_name,source_quantity,source_unit,quantity,measurement_kind) VALUES($1,1,'杆件',2500,'mm',2.5,'length')", [bom]);
    await pool.query("INSERT INTO scheme_reviews(scheme_id,request_key,scheme_revision,phase,decision) VALUES($1,$2,1,'overall','pass')", [scheme, randomUUID()]);
    await pool.query("INSERT INTO scheme_assets(id,scheme_id,type,name,metadata) VALUES($1,$2,'rendering','selected',$3)", [source, scheme, JSON.stringify({ themeJobId: themeJob })]);
    const version = (await pool.query<{ id: string }>("INSERT INTO asset_versions(asset_id,object_key,original_filename,mime_type,byte_size,checksum,width_px,height_px) VALUES($1,'selected-theme.jpg','theme.jpg','image/jpeg',$2,$3,1536,1024) RETURNING id", [source, jpeg.length, sourceChecksum])).rows[0]!.id;
    await pool.query(`INSERT INTO theme_jobs(id,user_id,scheme_code,source_asset_id,offer_id,request_key,input,requested_count,status,usable_count,selected_result_id,selection_revision)
      VALUES($1,$2,$3,$4,'test',$5,$6,1,'succeeded',1,$7,1)`, [themeJob, user, code, source, randomUUID(), JSON.stringify({ industryId: industry, styleId: style, brandColors: ['#123456'], brandKeywords: '统一品牌' }), result]);
    await pool.query('INSERT INTO theme_job_results(id,job_id,ordinal,asset_id,asset_version_id) VALUES($1,$2,1,$3,$4)', [result, themeJob, source, version]);
    const encryptionKey = 'a'.repeat(64);
    await pool.query("UPDATE ai_model_configs SET enabled=true,unit_credits=10,credential_ciphertext=$1 WHERE purpose='artwork' AND provider='openai'", [encryptCredential('test-key', 'openai', encryptionKey)]);
    await pool.query("INSERT INTO credit_transactions(user_id,kind,amount) VALUES($1,'recharge',500)", [user]);
    const redisData = new Map<string, string>();
    for (const [token, id] of [['user', user], ['other', other]]) redisData.set(`session:${createHash('sha256').update(token!).digest('hex').slice(0, 32)}`, JSON.stringify({ site: 'client', localId: id, expiresAt: Math.floor(Date.now() / 1000) + 3600 }));
    const redis = { get: async (key: string) => redisData.get(key) ?? null, set: async (key: string, value: string) => { redisData.set(key, value); return 'OK'; } } as unknown as Redis;
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    await registerArtworkJobRoutes(app, pool, redis, storage); t.after(() => app.close());
    const context = { schemeCode: code, themeJobId: themeJob, resultId: result, selectionRevision: 1 };
    const headers = { authorization: 'Bearer user' };
    async function submission() {
      const offer = await app.inject({ method: 'POST', url: '/artwork-offers', headers, payload: context });
      assert.equal(offer.statusCode, 200, offer.body);
      assert.equal(offer.json().data.offer.maxCredits, 40);
      return { ...context, requestKey: randomUUID(), offerId: offer.json().data.offer.id as string };
    }
    async function accept(body: Awaited<ReturnType<typeof submission>>) {
      const accepted = await app.inject({ method: 'POST', url: '/artwork-jobs', headers, payload: body });
      assert.equal(accepted.statusCode, 202, accepted.body); return accepted.json().data.jobId as string;
    }
    const request = await submission();
    const parallel = await Promise.all([1, 2, 3].map(() => app.inject({ method: 'POST', url: '/artwork-jobs', headers, payload: request })));
    assert.equal(parallel.filter(r => r.statusCode === 202).length, 1);
    const jobId = parallel[0]!.json().data.jobId as string;
    assert.ok(parallel.every(r => r.json().data.jobId === jobId));
    assert.equal((await pool.query('SELECT reserved_amount FROM credit_reservations WHERE artwork_job_id=$1', [jobId])).rows[0].reserved_amount, 40);
    assert.equal((await pool.query('SELECT * FROM artwork_job_directions WHERE job_id=$1', [jobId])).rowCount, 4);
    assert.equal((await pool.query('SELECT * FROM artwork_job_outbox WHERE job_id=$1', [jobId])).rowCount, 1);
    assert.equal((await app.inject({ method: 'POST', url: '/artwork-jobs', headers, payload: { ...request, selectionRevision: 2 } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: '/artwork-offers', headers: { authorization: 'Bearer other' }, payload: context })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: '/artwork-offers', payload: context })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/artwork-offers', headers, payload: { ...context, sourceUrl: 'https://example.test' } })).statusCode, 400);
    const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
    let calls = 0; let mode: 'complete' | 'partial' | 'storage' = 'complete';
    const prompts: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('https://api.openai.com/')) return new Response(new Uint8Array(jpeg), { headers: { 'Content-Type': 'image/jpeg' } });
      calls++;
      const form = init!.body as FormData; const prompt = String(form.get('prompt')); prompts.push(prompt);
      assert.equal(form.get('n'), '1'); assert.equal(form.get('size'), '1536x1024');
      const sent = await (form.get('image') as Blob).arrayBuffer(); assert.equal(createHash('sha256').update(Buffer.from(sent)).digest('hex'), sourceChecksum);
      const data = mode === 'partial' && prompt.includes('背面正交') ? small : jpeg;
      return Response.json({ data: [{ b64_json: data.toString('base64') }] });
    }) as typeof fetch;
    const config = { aiModelEncryptionKey: encryptionKey, s3: { endpoint: 'http://storage.test', publicEndpoint: 'http://public.test', region: 'us-east-1', bucket: 'test', accessKeyId: 'test', secretAccessKey: 'test' } };
    const notifications: { direction?: string; status: string; deliveryStatus?: string }[] = [];
    const observedStates: { status: string; deliveryStatus?: string; reservationStatus?: string }[] = [];
    await processArtworkJob(pool, jobId, config, storage, async (id, event) => {
      const update = event as typeof notifications[number];
      if (update.direction) {
        const state = (await pool.query('SELECT status FROM artwork_job_directions WHERE job_id=$1 AND direction=$2', [id, update.direction])).rows[0];
        notifications.push(update);
        observedStates.push({ status: state.status });
      } else if (update.deliveryStatus) {
        const state = (await pool.query('SELECT status,delivery_status FROM artwork_jobs WHERE id=$1', [id])).rows[0];
        const reservation = (await pool.query('SELECT status FROM credit_reservations WHERE artwork_job_id=$1', [id])).rows[0];
        notifications.push(update);
        observedStates.push({ status: state.status, deliveryStatus: state.delivery_status, reservationStatus: reservation.status });
      }
    });
    for (const direction of DIRECTIONS) assert.deepEqual(notifications.filter(e => e.direction === direction).map(e => e.status), ['submitting', 'generated', 'succeeded']);
    assert.deepEqual(notifications.at(-1), { status: 'succeeded', deliveryStatus: 'ready', phase: null });
    assert.deepEqual(observedStates, notifications.map(event => event.direction ? { status: event.status } : { status: event.status, deliveryStatus: event.deliveryStatus, reservationStatus: 'settled' }));
    assert.equal(calls, 4); assert.equal(new Set(prompts).size, 4);
    const frozen = (await pool.query<{ snapshot: ArtworkSnapshot }>('SELECT generation_snapshot AS snapshot FROM artwork_jobs WHERE id=$1', [jobId])).rows[0]!.snapshot;
    assert.equal(frozen.pipelineRevision, 4);
    for (const [index, direction] of DIRECTIONS.entries()) {
      const prompt = prompts[index]!;
      assert.equal(prompt, frozen.directionPrompts?.[direction]);
      assert.ok(prompt.includes(`本次只输出${DIRECTION_LABELS[direction]}一张，不输出其他方向`));
      assert.ok(prompt.includes(`最终核对：本次目标是${DIRECTION_LABELS[direction]}。`));
      assert.equal(prompt.match(/【本次相机：/g)?.length, 1);
      assert.ok(prompt.includes(`【本次相机：${DIRECTION_LABELS[direction]} / ${direction.toUpperCase()}`));
      assert.ok(!prompt.includes('{{'));
    }
    assert.match(prompts[2]!, /前部\/入口在画面右侧，展台后部\/后墙在画面左侧/);
    assert.match(prompts[3]!, /前部\/入口在画面左侧，展台后部\/后墙在画面右侧/);
    const ready = await getArtworkJob(pool, storage, user, jobId);
    assert.equal(ready.deliveryStatus, 'ready'); assert.equal(ready.credits.chargedCredits, 40); assert.equal(ready.credits.heldCredits, 0);
    assert.ok(ready.directions.every(d => d.width === 1536 && d.height === 1024));
    await processArtworkJob(pool, jobId, config, storage); await settleArtworkJob(pool, jobId);
    assert.equal(calls, 4); assert.equal((await pool.query('SELECT * FROM credit_transactions WHERE artwork_job_id=$1', [jobId])).rowCount, 1);
    const zip = await JSZip.loadAsync((await artworkArchive(pool, storage, user, jobId)).buffer);
    assert.deepEqual(Object.keys(zip.files).sort(), ['back.png', 'front.png', 'left.png', 'right.png']);
    for (const direction of DIRECTIONS) assert.equal((await sharp(await zip.file(`${direction}.png`)!.async('nodebuffer')).metadata()).format, 'png');
    const files = await artworkFiles(pool, jobId);
    assert.equal((await app.inject({ url: `/artwork-jobs/${jobId}/assets/${files[0]!.assetId}/download`, headers })).statusCode, 200);
    assert.equal((await app.inject({ url: `/artwork-jobs/${jobId}`, headers: { authorization: 'Bearer other' } })).statusCode, 404);
    assert.equal((await app.inject({ url: `/artwork-jobs/${jobId}/download`, headers: { authorization: 'Bearer other' } })).statusCode, 404);
    assert.equal((await app.inject({ url: `/artwork-jobs/${jobId}/assets/${source}/download`, headers })).statusCode, 404);
    const brokenFile = files[0]!; const correctBytes = buffers.get(brokenFile.objectKey)!; buffers.set(brokenFile.objectKey, Buffer.from('broken'));
    assert.equal((await app.inject({ url: `/artwork-jobs/${jobId}/download`, headers })).statusCode, 503); buffers.set(brokenFile.objectKey, correctBytes);
    const adminList = await listGenerationJobs(pool, { jobType: 'artwork' }); assert.equal(adminList.total, 1); assert.equal(adminList.data[0]?.jobType, 'artwork');
    assert.equal((await listGenerationJobs(pool, {})).total, 2);
    const adminDetail = await getGenerationJob(pool, jobId, storage); assert.equal(adminDetail.jobType, 'artwork'); assert.equal(adminDetail.results.length, 4);
    assert.ok('generationSnapshot' in adminDetail);
    assert.deepEqual(adminDetail.generationSnapshot?.directionPrompts, frozen.directionPrompts);
    assert.equal(JSON.stringify(adminDetail).includes('"objectKey"'), false);
    assert.equal((await listDeliverables(pool, code, 'artwork')).length, 1);
    const quote: QuoteInput = { requestKey: randomUUID(), schemeCode: code, schemeRevision: 1, bomRevision: 1, entryPoint: 'theme_result', themeSelection: { themeJobId: themeJob, resultId: result, selectionRevision: 1 },
      exhibition: { name: '测试展会', countryCode: 'CN', city: '上海', startDate: '2026-11-10', endDate: '2026-11-12' }, scopeCodes: ['materials'], materialBudget: { currency: 'CNY', amount: '30000' }, customerType: 'company', company: '测试公司', contact: { name: '客户', email: 'test@example.com' } };
    const withFiles = await createQuoteRequest(pool, user, { ...quote, artworkJobId: jobId }); assert.equal(withFiles.receipt.materialsStatus.artworks, 'available');
    const project = await createQuoteRequest(pool, user, { ...quote, requestKey: randomUUID() }); assert.equal(project.receipt.materialsStatus.artworks, 'pending');
    const projectId = project.receipt.projectId;
    await assert.rejects(bindProjectArtworks(pool, other, projectId, { artworkJobId: jobId, requestKey: randomUUID(), expectedRevision: 1 }), { statusCode: 404 });
    await assert.rejects(bindProjectArtworks(pool, user, projectId, { artworkJobId: jobId, requestKey: randomUUID(), expectedRevision: 2 }), { reason: 'PROJECT_REVISION_CHANGED' });
    await pool.query('UPDATE theme_jobs SET selection_revision=2 WHERE id=$1', [themeJob]);
    redisData.delete(`artwork-offer:${request.offerId}`);
    const replay = await app.inject({ method: 'POST', url: '/artwork-jobs', headers, payload: request }); assert.equal(replay.statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/artwork-offers', headers, payload: context })).statusCode, 409);
    assert.equal((await app.inject({ url: `/artwork-jobs/${jobId}/download`, headers })).statusCode, 200);
    const bindInput = { artworkJobId: jobId, requestKey: randomUUID(), expectedRevision: 1 };
    const deliveries = await Promise.all([1, 2].map(() => bindProjectArtworks(pool, user, projectId, bindInput)));
    assert.equal(deliveries[0]!.revision, 2); assert.deepEqual(deliveries[0], deliveries[1]);
    assert.equal((await pool.query("SELECT id FROM project_events WHERE project_id=$1 AND kind='artworks'", [projectId])).rowCount, 1);
    const pinned = (await pool.query('SELECT materials_snapshot FROM projects WHERE id=$1', [projectId])).rows[0].materials_snapshot;
    for (const file of files) await pool.query("INSERT INTO asset_versions(asset_id,object_key,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,'new.png','image/png',10,'new')", [file.assetId, `new/${file.assetId}.png`]);
    assert.deepEqual((await artworkFiles(pool, jobId)).map(f => f.versionId), files.map(f => f.versionId));
    assert.deepEqual((await pool.query('SELECT materials_snapshot FROM projects WHERE id=$1', [projectId])).rows[0].materials_snapshot, pinned);
    await pool.query('UPDATE theme_jobs SET selection_revision=1 WHERE id=$1', [themeJob]);
    mode = 'partial'; const partialId = await accept(await submission());
    const partialEvents: unknown[] = [];
    await processArtworkJob(pool, partialId, config, storage, async (_id, event) => { partialEvents.push(event); });
    assert.ok(partialEvents.some(event => (event as { direction?: string; status: string }).direction === 'back' && (event as { status: string }).status === 'failed'));
    assert.deepEqual(partialEvents.at(-1), { status: 'partially_succeeded', deliveryStatus: 'incomplete', phase: null });
    const partial = await getArtworkJob(pool, storage, user, partialId); assert.equal(partial.status, 'partially_succeeded'); assert.equal(partial.deliveryStatus, 'incomplete');
    assert.equal(partial.credits.chargedCredits, 30); assert.equal(partial.credits.releasedCredits, 10); assert.deepEqual(partial.missingDirections, ['back']);
    await assert.rejects(readyArtworkFiles(pool, user, partialId, context), { reason: 'ARTWORK_INCOMPLETE' });
    await assert.rejects(createQuoteRequest(pool, user, { ...quote, requestKey: randomUUID(), artworkJobId: partialId }), { reason: 'ARTWORK_INCOMPLETE' });
    mode = 'storage'; const retryId = await accept(await submission()); const beforeRetry = calls;
    let failStorage = true;
    const retryStorage = { ...storage, putBuffer: async (key: string, bytes: Buffer, mime: string) => { if (failStorage) { failStorage = false; throw new Error('Storage outage'); } await storage.putBuffer(key, bytes, mime); } } as ReturnType<typeof createStorage>;
    await assert.rejects(processArtworkJob(pool, retryId, config, retryStorage), /Storage outage/);
    assert.equal(calls, beforeRetry + 1); await processArtworkJob(pool, retryId, config, retryStorage); assert.equal(calls, beforeRetry + 4);
    assert.equal((await getArtworkJob(pool, storage, user, retryId)).deliveryStatus, 'ready');
    const uncertainId = await accept(await submission());
    const historicalPrompt = '历史任务：{{directionLabel}}正交立面，只生成{{directionLabel}}。';
    await pool.query(`UPDATE artwork_jobs SET generation_snapshot=(generation_snapshot-'directionPrompts') || $2::jsonb WHERE id=$1`,
      [uncertainId, JSON.stringify({ prompt: historicalPrompt, pipelineRevision: 2 })]);
    await pool.query("UPDATE artwork_job_directions SET status='submitting' WHERE job_id=$1 AND direction='front'", [uncertainId]);
    const beforeUnknown = calls; await processArtworkJob(pool, uncertainId, config, storage); assert.equal(calls, beforeUnknown + 3);
    assert.deepEqual(prompts.slice(beforeUnknown), DIRECTIONS.slice(1).map(direction => historicalPrompt.replaceAll('{{directionLabel}}', DIRECTION_LABELS[direction])));
    assert.equal((await getArtworkJob(pool, storage, user, uncertainId)).directions[0]?.reason, 'PROVIDER_OUTCOME_UNKNOWN');
    const abandonedId = await accept(await submission());
    await pool.query("UPDATE artwork_jobs SET status='running',lease_until=now()-interval '20 minutes' WHERE id=$1", [abandonedId]);
    await settleArtworkJob(pool, abandonedId); const abandoned = await getArtworkJob(pool, storage, user, abandonedId);
    assert.equal(abandoned.status, 'failed'); assert.equal(abandoned.credits.releasedCredits, 40);
    await pool.query("INSERT INTO credit_transactions(user_id,kind,amount) SELECT $1,'recharge',-SUM(amount)+30 FROM credit_transactions WHERE user_id=$1", [user]);
    const insufficient = await submission();
    const blocked = await app.inject({ method: 'POST', url: '/artwork-jobs', headers, payload: insufficient }); assert.equal(blocked.statusCode, 402);
    assert.equal((await pool.query('SELECT id FROM artwork_jobs WHERE request_key=$1', [insufficient.requestKey])).rowCount, 0);
  });
