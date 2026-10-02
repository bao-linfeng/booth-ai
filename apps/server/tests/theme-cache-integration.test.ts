import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import pg from 'pg';
import sharp from 'sharp';
import { encryptCredential } from '../src/infra/ai-models.js';
import type { createStorage } from '../src/infra/storage.js';
import { registerThemeModelRoutes } from '../src/http/client/theme-jobs/index.js';
import { processThemeJob } from '../src/modules/generation/theme/execution.js';

test('theme result cache: actual SQL, provider calls, free reuse, isolation, refresh and invalidation',
  { skip: !process.env.THEME_TEST_DATABASE_URL }, async t => {
    const schema = `theme_cache_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.THEME_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.THEME_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    t.after(async () => {
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    });
    for (const name of ['002_auth', '003_schemes', '004_assets', '009_dictionaries', '024_ai_model_configs',
      '025_ai_model_credentials', '029_openai_theme_model', '030_credits', '031_theme_jobs', '032_theme_job_results',
      '033_prompt_templates', '034_theme_result_assets', '038_credit_reservations_and_generated_urls', '039_credit_idempotency']) {
      await pool.query(await readFile(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'));
    }
    const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer();
    const user = randomUUID(); const other = randomUUID(); const scheme = randomUUID(); const source = randomUUID();
    const industry = randomUUID(); const style = randomUUID(); const template = randomUUID();
    for (const [index, id] of [user, other].entries()) {
      await pool.query('INSERT INTO users(id, external_user_id, username) VALUES ($1::uuid,$2,$1::text)', [id, index + 1]);
    }
    await pool.query("INSERT INTO schemes(id,code,name,publish_status) VALUES ($1,'S-1','Test','published')", [scheme]);
    await pool.query("INSERT INTO scheme_assets(id,scheme_id,type,name) VALUES ($1,$2,'rendering','source')", [source, scheme]);
    await pool.query("INSERT INTO asset_versions(asset_id,object_key,original_filename,mime_type,byte_size,checksum) VALUES ($1,'source-v1.png','source.png','image/png',$2,$3)", [source, image.length, createHash('sha256').update(image).digest('hex')]);
    const legacy = randomUUID(); const legacyAsset = randomUUID();
    await pool.query("INSERT INTO theme_jobs(id,user_id,scheme_code,source_asset_id,offer_id,request_key,input,requested_count,status,usable_count) VALUES ($1,$2,'S-1',$3,'old','old','{}',1,'succeeded',1)", [legacy, user, source]);
    await pool.query("INSERT INTO scheme_assets(id,scheme_id,type,name) VALUES ($1,$2,'artwork','legacy')", [legacyAsset, scheme]);
    const legacyVersion = (await pool.query<{ id: string }>("INSERT INTO asset_versions(asset_id,object_key,original_filename,mime_type,byte_size,checksum) VALUES ($1,'legacy.png','legacy.png','image/png',10,'legacy-hash') RETURNING id", [legacyAsset])).rows[0]!.id;
    await pool.query('INSERT INTO theme_job_results(job_id,ordinal,asset_id) VALUES ($1,1,$2)', [legacy, legacyAsset]);
    await pool.query(await readFile(new URL('../migrations/040_theme_result_cache.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../migrations/027_selection_analytics.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../migrations/044_theme_job_search.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../migrations/048_theme_worker_lease.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../migrations/037_artwork_jobs.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../migrations/049_generation_recovery.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../migrations/050_asset_scope.sql', import.meta.url), 'utf8'));
    assert.equal((await pool.query('SELECT asset_version_id FROM theme_job_results WHERE job_id=$1', [legacy])).rows[0].asset_version_id, legacyVersion);
    assert.equal((await pool.query('SELECT cache_key FROM theme_jobs WHERE id=$1', [legacy])).rows[0].cache_key, null);
    for (const [code, item] of [['industry', industry], ['style', style]]) {
      const dictionary = (await pool.query<{ id: string }>('INSERT INTO dictionaries(code,name) VALUES ($1,$1) RETURNING id', [code])).rows[0]!.id;
      await pool.query('INSERT INTO dictionary_items(id,dictionary_id,item_value,item_label) VALUES ($1,$2,$3,$3)', [item, dictionary, code]);
    }
    const encryptionKey = 'a'.repeat(64);
    await pool.query("UPDATE ai_model_configs SET enabled=true,unit_credits=10,priority=1,credential_ciphertext=$1 WHERE provider='openai'", [encryptCredential('test-key', 'openai', encryptionKey)]);
    await pool.query("INSERT INTO prompt_templates(id,purpose,industry_id,style_id,body,enabled) VALUES ($1,'theme',$2,$3,'{{brandColors}}/{{brandKeywords}}',true)", [template, industry, style]);
    await pool.query("INSERT INTO credit_transactions(user_id,kind,amount) VALUES ($1,'recharge',100)", [user]);
    const offers = new Map<string, string>();
    const sessionKeys = new Map([['user', user], ['other', other]].map(([token, id]) => [
      `session:${createHash('sha256').update(token!).digest('hex').slice(0, 32)}`, id,
    ]));
    const redis = {
      get: async (key: string) => sessionKeys.has(key) ? JSON.stringify({ site: 'client', localId: sessionKeys.get(key), expiresAt: Math.floor(Date.now() / 1000) + 3600 }) : offers.get(key) ?? null,
      set: async (key: string, value: string) => { offers.set(key, value); return 'OK'; },
    } as unknown as Redis;
    const storage = { getBuffer: async () => image, putBuffer: async () => {}, signDownload: async (key: string) => `https://assets.example/${key}` } as unknown as ReturnType<typeof createStorage>;
    const app = Fastify();
    await registerThemeModelRoutes(app, pool, redis, storage);
    t.after(() => app.close());
    const parameters = { schemeCode: 'S-1', sourceAssetId: source, input: { industryId: industry, styleId: style, brandColors: ['#aabbcc'], brandKeywords: ' brand ' }, requestedCount: 1, cacheMode: 'reuse' };
    async function offerFor(body = parameters, token = 'user') {
      const response = await app.inject({ method: 'POST', url: '/theme-offers', headers: { authorization: `Bearer ${token}` }, payload: body });
      assert.equal(response.statusCode, 200, response.body);
      return response.json().data.offer as { id: string; cacheHit: boolean; maxCredits: number };
    }
    async function submit(offerId: string, body = parameters, token = 'user', requestKey = randomUUID()) {
      return app.inject({ method: 'POST', url: '/theme-jobs', headers: { authorization: `Bearer ${token}` }, payload: { ...body, offerId, requestKey } });
    }
    const offer = await offerFor();
    assert.equal(offer.cacheHit, false);
    const initial = await submit(offer.id);
    assert.equal(initial.statusCode, 202, initial.body);
    const jobId = initial.json().data.jobId as string;
    const acceptedPrompt = (await pool.query('SELECT generation_snapshot FROM theme_jobs WHERE id=$1', [jobId])).rows[0].generation_snapshot.prompt as string;
    assert.match(acceptedPrompt, /#AABBCC\/brand/);
    assert.deepEqual(JSON.parse(acceptedPrompt.split('\n')[2]!), {
      行业: 'industry', 风格: 'style', 品牌色: '#AABBCC', 品牌关键词及补充要求: 'brand',
    });
    await pool.query("UPDATE prompt_templates SET body='changed after acceptance' WHERE id=$1", [template]);
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      assert.equal(url, 'https://api.openai.com/v1/images/edits');
      assert.equal((init?.body as FormData).get('prompt'), acceptedPrompt);
      providerCalls++;
      return Response.json({ data: [{ b64_json: image.toString('base64') }] });
    };
    t.after(() => { globalThis.fetch = originalFetch; });
    await processThemeJob(pool, jobId, { aiModelEncryptionKey: encryptionKey, s3: {
      endpoint: 'http://silo:9000', publicEndpoint: 'http://localhost:19000', region: 'us-east-1', bucket: 'booth-assets', accessKeyId: 'test', secretAccessKey: 'test',
    } }, storage);
    assert.equal(providerCalls, 1);
    const persistedResults = await pool.query('SELECT id FROM theme_job_results WHERE job_id=$1', [jobId]);
    await processThemeJob(pool, jobId, { aiModelEncryptionKey: encryptionKey, s3: {
      endpoint: 'http://silo:9000', publicEndpoint: 'http://localhost:19000', region: 'us-east-1', bucket: 'booth-assets', accessKeyId: 'test', secretAccessKey: 'test',
    } }, storage);
    assert.equal(providerCalls, 1, 'redelivery must not call the provider again');
    assert.deepEqual((await pool.query('SELECT id FROM theme_job_results WHERE job_id=$1', [jobId])).rows, persistedResults.rows);
    assert.equal((await pool.query('SELECT id FROM credit_transactions WHERE theme_job_id=$1', [jobId])).rowCount, 1);
    assert.equal((await pool.query('SELECT status FROM credit_reservations WHERE theme_job_id=$1', [jobId])).rows[0].status, 'settled');
    await pool.query("UPDATE prompt_templates SET body='{{brandColors}}/{{brandKeywords}}' WHERE id=$1", [template]);
    assert.equal((await pool.query('SELECT sum(amount)::int AS balance FROM credit_transactions WHERE user_id=$1', [user])).rows[0].balance, 90);
    const normalized = { ...parameters, input: { ...parameters.input, brandColors: ['#AABBCC'], brandKeywords: 'brand' } };
    const cachedOffer = await offerFor(normalized);
    assert.equal(cachedOffer.cacheHit, true);
    assert.equal(cachedOffer.maxCredits, 0);
    await pool.query("INSERT INTO credit_transactions(user_id,kind,amount) VALUES ($1,'recharge',-90)", [user]);
    const requestKey = randomUUID();
    const concurrent = await Promise.all([submit(cachedOffer.id, normalized, 'user', requestKey), submit(cachedOffer.id, normalized, 'user', requestKey)]);
    assert.ok(concurrent.every(response => response.statusCode === 200), concurrent.map(response => response.body).join('\n'));
    const cachedId = concurrent[0]!.json().data.jobId as string;
    assert.equal(concurrent[1]!.json().data.jobId, cachedId);
    assert.notEqual(cachedId, jobId);
    assert.equal(concurrent.filter(response => response.json().data.reusedRequest).length, 1);
    assert.equal(concurrent[0]!.json().data.credits.status, 'not_charged');
    assert.equal((await pool.query('SELECT sum(amount)::int AS balance FROM credit_transactions WHERE user_id=$1', [user])).rows[0].balance, 0);
    await pool.query("INSERT INTO credit_transactions(user_id,kind,amount) VALUES ($1,'recharge',90)", [user]);
    assert.equal((await pool.query('SELECT id FROM theme_job_outbox WHERE job_id=$1', [cachedId])).rowCount, 0);
    assert.equal((await pool.query('SELECT id FROM credit_reservations WHERE theme_job_id=$1', [cachedId])).rowCount, 0);
    assert.equal((await pool.query('SELECT id FROM credit_transactions WHERE theme_job_id=$1', [cachedId])).rowCount, 0);
    const sourceResult = (await pool.query('SELECT * FROM theme_job_results WHERE job_id=$1', [jobId])).rows[0];
    const cachedResult = (await pool.query('SELECT * FROM theme_job_results WHERE job_id=$1', [cachedId])).rows[0];
    assert.equal(sourceResult.asset_id, cachedResult.asset_id);
    assert.equal(sourceResult.asset_version_id, cachedResult.asset_version_id);
    assert.notEqual(sourceResult.id, cachedResult.id);
    const details = await app.inject({ method: 'GET', url: `/theme-jobs/${cachedId}`, headers: { authorization: 'Bearer user' } });
    assert.equal(details.json().data.cacheHit, true);
    assert.equal(details.json().data.credits.status, 'not_charged');
    offers.delete(`theme-offer:${cachedOffer.id}`);
    const replay = await submit(cachedOffer.id, normalized, 'user', requestKey);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().data.reusedRequest, true);
    const changed = { ...parameters, input: { ...parameters.input, brandKeywords: 'different' } };
    assert.equal((await submit(offer.id, changed, 'user', requestKey)).statusCode, 409);
    assert.equal((await offerFor(changed)).cacheHit, false);
    assert.equal((await offerFor(parameters, 'other')).cacheHit, false);
    assert.equal((await submit(offer.id, parameters, 'other')).statusCode, 409);
    const otherOffer = await offerFor(parameters, 'other');
    assert.equal((await submit(otherOffer.id, parameters, 'other')).statusCode, 402);
    const refresh = { ...parameters, cacheMode: 'refresh' };
    const refreshOffer = await offerFor(refresh);
    assert.equal(refreshOffer.cacheHit, false);
    assert.equal(refreshOffer.maxCredits, 10);
    const refreshed = await submit(refreshOffer.id, refresh);
    assert.equal(refreshed.statusCode, 202, refreshed.body);
    assert.equal((await pool.query('SELECT reserved_amount FROM credit_reservations WHERE theme_job_id=$1', [refreshed.json().data.jobId])).rows[0].reserved_amount, 10);
    await pool.query("UPDATE theme_jobs SET status='partially_succeeded' WHERE id=$1", [jobId]);
    assert.equal((await offerFor()).cacheHit, false);
    await pool.query("UPDATE theme_jobs SET status='succeeded' WHERE id=$1", [jobId]);
    await pool.query('UPDATE scheme_assets SET is_active=false WHERE id=$1', [sourceResult.asset_id]);
    assert.equal((await offerFor()).cacheHit, false);
    await pool.query('UPDATE scheme_assets SET is_active=true WHERE id=$1', [sourceResult.asset_id]);
    const staleOffer = await offerFor();
    await pool.query('UPDATE prompt_templates SET revision=revision+1 WHERE id=$1', [template]);
    assert.equal((await submit(staleOffer.id)).statusCode, 409);
    assert.equal((await offerFor()).cacheHit, false);
    await pool.query('UPDATE prompt_templates SET revision=revision-1 WHERE id=$1', [template]);
    await pool.query("UPDATE ai_model_configs SET revision=revision+1 WHERE provider='openai'");
    assert.equal((await offerFor()).cacheHit, false);
    await pool.query("UPDATE ai_model_configs SET revision=revision-1 WHERE provider='openai'");
    await pool.query("INSERT INTO asset_versions(asset_id,object_key,original_filename,mime_type,byte_size,checksum) VALUES ($1,'source-v2.png','source.png','image/png',10,'changed-hash')", [source]);
    assert.equal((await offerFor()).cacheHit, false);
    const pinned = await app.inject({ method: 'GET', url: `/theme-jobs/${cachedId}`, headers: { authorization: 'Bearer user' } });
    assert.equal(pinned.json().data.original.previewUrl, 'https://assets.example/source-v1.png');
    assert.equal(providerCalls, 1);
  });
