import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { projectTestPool } from '../helpers/project-fixtures.js';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import { registerQuoteRequestRoutes } from '../../src/http/client/quote-requests/index.js';
import { registerAuthentication } from '../../src/http/authentication.js';
import { createManualProject, createQuoteRequest } from '../../src/modules/projects/service.js';
import { linkProjectScheme, type SchemeLinkInput } from '../../src/modules/projects/admin-service.js';
import { getProject } from '../../src/modules/projects/repository.js';
import type { ManualInput, QuoteInput } from '../../src/modules/projects/domain.js';
import { emptyRequirement } from '../../src/modules/selection/domain.js';
import { listDeliverables, signDeliverable } from '../../src/modules/assets/deliverables.js';

test(
  'quote transaction: concurrent retries, immutable snapshots, revision conflict and rollback',
  { skip: !process.env.PROJECT_TEST_DATABASE_URL },
  async t => {
    const pool = await projectTestPool(t);
    const id = randomUUID();
    const admin = randomUUID();
    const user = randomUUID();
    const other = randomUUID();
    const code = `project-test-${id}`;
    const projects: string[] = [];
    await pool.query("INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,$2,$3,ARRAY['ROLE_ADMIN'])", [
      admin,
      Math.floor(Math.random() * 1e12),
      code,
    ]);
    await pool.query('UPDATE project_assignment_config SET default_assignee_admin_id=$1', [admin]);
    for (const uid of [user, other])
      await pool.query('INSERT INTO users(id,external_user_id,username) VALUES($1,$2,$3)', [uid, Math.floor(Math.random() * 1e12), uid]);
    const productSystem = (
      await pool.query<{ id: string }>(
        "SELECT i.id FROM dictionary_items i JOIN dictionaries d ON d.id=i.dictionary_id WHERE d.code='product_system' AND d.enabled AND i.enabled LIMIT 1",
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO schemes(id,code,name,publish_status,length_mm,width_mm,height_mm,area_sqm,opening_count,product_system_id,industry_ids,zone_ids,feature_ids)
    VALUES($1,$2,$2,'published',6000,6000,3000,36,2,$3,'{}','{}','{}')`,
      [id, code, productSystem],
    );
    const sourceChecklist = randomUUID();
    for (const type of ['model', 'checklist', 'drawing', 'artwork']) {
      const asset = type === 'checklist' ? sourceChecklist : randomUUID();
      await pool.query('INSERT INTO scheme_assets(id,scheme_id,type,name) VALUES($1,$2,$3,$3)', [asset, id, type]);
      await pool.query(
        "INSERT INTO asset_versions(asset_id,object_key,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,'test.png','image/png',10,'fixed-hash')",
        [asset, `project-tests/${randomUUID()}`],
      );
    }
    for (let order = 0; order < 3; order++) {
      const image = randomUUID();
      const mask = randomUUID();
      await pool.query("INSERT INTO scheme_assets(id,scheme_id,type,name,sort_order) VALUES($1,$2,'rendering','效果图',$3)", [
        image,
        id,
        order,
      ]);
      await pool.query("INSERT INTO scheme_assets(id,scheme_id,type,name,sort_order,related_asset_id) VALUES($1,$2,'mask','蒙版',$3,$4)", [
        mask,
        id,
        order,
        image,
      ]);
      for (const asset of [image, mask])
        await pool.query(
          "INSERT INTO asset_versions(asset_id,object_key,original_filename,mime_type,byte_size,checksum,width_px,height_px) VALUES($1,$2,'test.png','image/png',10,'fixed-hash',1600,900)",
          [asset, `project-tests/${randomUUID()}`],
        );
    }
    const bom = (
      await pool.query<{ id: string }>(
        "INSERT INTO scheme_boms(scheme_id,status,revision,source_asset_id,content_hash,verified_at) VALUES($1,'verified',3,$2,'bom-hash',now()) RETURNING id",
        [id, sourceChecklist],
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO scheme_bom_items(bom_id,ordinal,product_name,source_quantity,source_unit,quantity,measurement_kind) VALUES($1,1,'杆件',2500,'mm',2.5,'length')",
      [bom],
    );
    await pool.query("INSERT INTO scheme_reviews(scheme_id,request_key,scheme_revision,phase,decision) VALUES($1,$2,1,'overall','pass')", [
      id,
      randomUUID(),
    ]);
    const input: QuoteInput = {
      requestKey: randomUUID(),
      schemeCode: code,
      schemeRevision: 1,
      bomRevision: 3,
      entryPoint: 'scheme_detail',
      exhibition: { name: '测试展会', countryCode: 'CN', city: '上海', startDate: '2026-11-10', endDate: '2026-11-12' },
      scopeCodes: ['materials'],
      materialBudget: { currency: 'CNY', amount: '30000' },
      customerType: 'company',
      company: '测试公司',
      contact: { name: '联系人', email: 'test@example.com' },
    };
    const results = await Promise.all(Array.from({ length: 4 }, () => createQuoteRequest(pool, user, input)));
    const receipt = results[0]!.receipt;
    projects.push(receipt.projectId);
    assert.ok(results.every(result => result.receipt.projectId === receipt.projectId));
    assert.equal(results.filter(result => !result.replayed).length, 1);
    assert.equal((await pool.query('SELECT id FROM project_notification_outbox WHERE project_id=$1', [receipt.projectId])).rowCount, 1);
    await pool.query('UPDATE project_assignment_config SET default_assignee_admin_id=null');
    await assert.rejects(createQuoteRequest(pool, user, { ...input, requestKey: randomUUID() }), {
      reason: 'ASSIGNMENT_UNAVAILABLE',
      statusCode: 503,
    });
    assert.deepEqual((await createQuoteRequest(pool, user, input)).receipt, receipt);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM projects')).rows[0].count, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM project_notification_outbox')).rows[0].count, 1);
    await pool.query('UPDATE project_assignment_config SET default_assignee_admin_id=$1', [admin]);
    const redis = {
      get: async () =>
        JSON.stringify({ site: 'client', localId: user, sessionVersion: 1, expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
      eval: async () => 1,
    } as unknown as Redis;
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    registerAuthentication(app, pool, redis, 'client');
    t.after(() => app.close());
    await registerQuoteRequestRoutes(app, pool, redis);
    const headers = { authorization: 'Bearer test-token' };
    const replay = await app.inject({ method: 'POST', url: '/quote-requests', headers, payload: input });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().data.projectId, receipt.projectId);
    const created = await app.inject({ method: 'POST', url: '/quote-requests', headers, payload: { ...input, requestKey: randomUUID() } });
    assert.equal(created.statusCode, 201);
    const createdId = created.json<{ data: { projectId: string } }>().data.projectId;
    projects.push(createdId);
    assert.notEqual(createdId, receipt.projectId);
    await assert.rejects(createQuoteRequest(pool, user, { ...input, notes: '异体' }), { reason: 'IDEMPOTENCY_CONFLICT' });
    const second = await createQuoteRequest(pool, other, input);
    projects.push(second.receipt.projectId);
    assert.notEqual(second.receipt.projectId, receipt.projectId);
    const manualInput: ManualInput = {
      requestKey: randomUUID(),
      entryPoint: 'matching_results',
      originalDescription: '需要人工确认展台方案',
      confirmedRequirements: emptyRequirement(),
      exhibition: input.exhibition,
      scopeCodes: input.scopeCodes,
      materialBudget: input.materialBudget,
      customerType: input.customerType,
      company: input.company,
      contact: input.contact,
    };
    const manual = await createManualProject(pool, other, manualInput);
    const manualId = String(manual.receipt.projectId);
    projects.push(manualId);
    const unlinked = await getProject(pool, manualId);
    assert.equal(unlinked.sourceType, 'manual_request');
    assert.equal(unlinked.schemeCode, null);
    assert.equal(unlinked.schemeSnapshot, null);
    assert.deepEqual(unlinked.materials, {});
    const linkInput: SchemeLinkInput = {
      requestKey: randomUUID(),
      expectedRevision: 1,
      schemeCode: code,
      bomRevision: 3,
      drawingRevision: 1,
      confirmationNote: '客户已确认该方案和资料修订',
    };
    const linked = await linkProjectScheme(pool, manualId, admin, linkInput);
    assert.deepEqual(linked, {
      projectId: manualId,
      revision: 2,
      schemeCode: code,
      bomRevision: 3,
      drawingRevision: 1,
      materialsStatus: { bom: 'available', drawings: 'available', artworks: 'available' },
    });
    const linkedProject = await getProject(pool, manualId);
    assert.equal(linkedProject.sourceType, 'manual_request');
    assert.equal(linkedProject.schemeCode, code);
    assert.equal(linkedProject.revision, 2);
    assert.equal(linkedProject.status, 'pending');
    assert.deepEqual(linkedProject.request, unlinked.request);
    assert.deepEqual(linkedProject.schemeSnapshot, (await getProject(pool, receipt.projectId)).schemeSnapshot);
    assert.deepEqual(linkedProject.materials, (await getProject(pool, receipt.projectId)).materials);
    assert.equal(linkedProject.materials.bom?.items[0]?.productName, '杆件');
    const pinnedVersions = async (projectId: string) =>
      (
        await pool.query<{ asset_version_id: string }>(
          'SELECT asset_version_id FROM project_asset_versions WHERE project_id=$1 ORDER BY asset_version_id',
          [projectId],
        )
      ).rows;
    const linkedVersions = await pinnedVersions(manualId);
    assert.equal(linkedVersions.length, 10);
    assert.deepEqual(linkedVersions, await pinnedVersions(receipt.projectId));
    assert.deepEqual(await linkProjectScheme(pool, manualId, admin, linkInput), linked);
    await assert.rejects(linkProjectScheme(pool, manualId, admin, { ...linkInput, confirmationNote: '客户确认内容已变更' }), {
      reason: 'IDEMPOTENCY_CONFLICT',
    });
    await assert.rejects(linkProjectScheme(pool, manualId, admin, { ...linkInput, requestKey: randomUUID(), expectedRevision: 2 }), {
      reason: 'SCHEME_ALREADY_LINKED',
    });
    await assert.rejects(linkProjectScheme(pool, receipt.projectId, admin, { ...linkInput, requestKey: randomUUID() }), {
      reason: 'SCHEME_ALREADY_LINKED',
    });
    assert.equal((await pool.query("SELECT id FROM project_events WHERE project_id=$1 AND kind='scheme'", [manualId])).rowCount, 1);
    assert.equal(
      (
        await pool.query("SELECT request_key FROM project_operations WHERE actor_id=$1 AND operation='scheme' AND target=$2", [
          admin,
          manualId,
        ])
      ).rowCount,
      1,
    );
    assert.equal((await getProject(pool, manualId)).revision, 2);
    assert.deepEqual(await pinnedVersions(manualId), linkedVersions);
    const job = randomUUID();
    const result = randomUUID();
    const themedAsset = randomUUID();
    await pool.query(
      "INSERT INTO theme_jobs(id,user_id,scheme_code,source_asset_id,offer_id,request_key,input,requested_count,status,selected_result_id,selection_revision) VALUES($1,$2,$3,$4,'test',$5,'{}',1,'succeeded',$6,1)",
      [job, user, code, randomUUID(), randomUUID(), result],
    );
    await pool.query(
      `INSERT INTO scheme_assets(id,scheme_id,type,name,metadata,source,owner_user_id,visibility) VALUES($1,$2,'artwork','私有主题',$3,'theme_generation',$4,'private')`,
      [themedAsset, id, JSON.stringify({ themeJobId: job }), user],
    );
    const themeVersion = (
      await pool.query<{ id: string }>(
        "INSERT INTO asset_versions(asset_id,object_key,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,'theme.png','image/png',10,'theme-hash') RETURNING id",
        [themedAsset, `project-tests/${randomUUID()}`],
      )
    ).rows[0]!.id;
    await pool.query('INSERT INTO theme_job_results(id,job_id,ordinal,asset_id,asset_version_id) VALUES($1,$2,1,$3,$4)', [
      result,
      job,
      themedAsset,
      themeVersion,
    ]);
    assert.ok((await listDeliverables(pool, code, 'artwork')).every(asset => asset.assetId !== themedAsset));
    await assert.rejects(
      signDeliverable(pool, { signDownload: async () => '', signDownloadWithName: async () => '' }, code, 'artwork', themedAsset),
      { statusCode: 404 },
    );
    const themeInput = { ...input, requestKey: randomUUID(), themeSelection: { themeJobId: job, resultId: result, selectionRevision: 1 } };
    const themed = await createQuoteRequest(pool, user, themeInput);
    projects.push(themed.receipt.projectId);
    assert.equal(themed.receipt.materialsStatus.artworks, 'pending');
    await assert.rejects(
      createQuoteRequest(pool, other, {
        ...input,
        requestKey: randomUUID(),
        themeSelection: { themeJobId: job, resultId: result, selectionRevision: 1 },
      }),
      { reason: 'THEME_SELECTION_CHANGED' },
    );
    await pool.query('UPDATE theme_jobs SET selection_revision=2 WHERE id=$1', [job]);
    assert.equal((await createQuoteRequest(pool, user, themeInput)).receipt.projectId, themed.receipt.projectId);
    await assert.rejects(
      createQuoteRequest(pool, user, {
        ...input,
        requestKey: randomUUID(),
        themeSelection: { themeJobId: job, resultId: result, selectionRevision: 1 },
      }),
      { reason: 'THEME_SELECTION_CHANGED' },
    );
    await pool.query('DELETE FROM theme_job_results WHERE job_id=$1', [job]);
    await pool.query('DELETE FROM theme_jobs WHERE id=$1', [job]);
    await assert.rejects(createQuoteRequest(pool, user, { ...input, requestKey: randomUUID(), bomRevision: 2 }), {
      reason: 'BOM_REVISION_CHANGED',
    });
    await pool.query("UPDATE scheme_bom_items SET product_name='已修改' WHERE bom_id=$1", [bom]);
    await pool.query("UPDATE schemes SET publish_status='unpublished',revision=revision+1 WHERE id=$1", [id]);
    assert.deepEqual((await createQuoteRequest(pool, user, input)).receipt, receipt);
    assert.deepEqual(await linkProjectScheme(pool, manualId, admin, linkInput), linked);
    const fixedManual = await getProject(pool, manualId);
    assert.equal(fixedManual.revision, 2);
    assert.deepEqual(fixedManual.schemeSnapshot, linkedProject.schemeSnapshot);
    assert.deepEqual(fixedManual.materials, linkedProject.materials);
    assert.deepEqual(await pinnedVersions(manualId), linkedVersions);
    const saved = (
      await pool.query<{
        materials_snapshot: {
          bom: {
            status: string;
            revision: number;
            verifiedAt: string;
            items: { productName: string; quantity: string; pricingUnit: string }[];
          };
        };
        assignee_admin_id: string;
      }>('SELECT materials_snapshot,assignee_admin_id FROM projects WHERE id=$1', [receipt.projectId])
    ).rows[0]!;
    assert.equal(saved.materials_snapshot.bom.status, 'available');
    assert.equal(saved.materials_snapshot.bom.revision, 3);
    assert.ok(Number.isFinite(Date.parse(saved.materials_snapshot.bom.verifiedAt)));
    assert.equal(saved.materials_snapshot.bom.items[0]?.productName, '杆件');
    assert.equal(saved.materials_snapshot.bom.items[0]?.quantity, '2.500000');
    assert.equal(saved.materials_snapshot.bom.items[0]?.pricingUnit, 'm');
    assert.ok(saved.assignee_admin_id);
    await assert.rejects(createQuoteRequest(pool, user, { ...input, requestKey: randomUUID() }), { reason: 'SCHEME_REVISION_CHANGED' });
    await assert.rejects(createQuoteRequest(pool, user, { ...input, schemeRevision: 2, requestKey: randomUUID() }), {
      reason: 'SCHEME_UNAVAILABLE',
    });
    assert.equal((await pool.query('SELECT id FROM projects WHERE customer_user_id=$1', [user])).rowCount, 3);
  },
);
