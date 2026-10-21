import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { createStorage } from '../../../infra/storage.js';
import type { TypeProvider } from '../../type-provider.js';
import { adminUserId } from '../../authentication.js';
import { fileResponse, successResponse } from '../../schemas.js';
import {
  assignProject,
  claimProject,
  followUpProject,
  linkProjectScheme,
  listQuotationRevisions,
  quotationRevision,
  saveQuotation,
  saveAssignmentConfig,
  statusTransitions,
  updatePublicResult,
} from '../../../modules/projects/admin-service.js';
import { signImageLinks } from '../../../modules/media/links.js';
import {
  findProjectAssetVersion,
  getProject,
  listProjectImageVersions,
  listProjects,
  projectEvents,
  requirementOptionLabels,
} from '../../../modules/projects/repository.js';
import { quotationWorkbook } from '../../../modules/projects/quotation-workbook.js';
import { projectError } from '../../../modules/projects/domain.js';
import {
  assignmentSchema,
  claimSchema,
  followUpSchema,
  linkSchema,
  projectParams,
  publicResultSchema,
  queryProperties,
  quotationSchema,
  statuses,
  uuid,
} from '../../../modules/projects/schema.js';
import { getAssignmentConfig, listAssignableAdmins } from '../../../modules/projects/assignment.js';

const assignmentConfigBody = {
  type: 'object',
  additionalProperties: false,
  required: ['defaultAssigneeAdminId', 'expectedRevision'],
  properties: { defaultAssigneeAdminId: { anyOf: [uuid, { type: 'null' }] }, expectedRevision: { type: 'integer', minimum: 0 } },
} as const;
const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...queryProperties,
    city: { type: 'string', maxLength: 100 },
    customerName: { type: 'string', maxLength: 200 },
    customerUserId: uuid,
    assigneeAdminId: uuid,
    exhibitionStartFrom: { type: 'string', format: 'date' },
    exhibitionStartTo: { type: 'string', format: 'date' },
    assignment: {
      type: 'string',
      enum: ['unassigned', 'needs_assignment'],
      description: 'unassigned：待分配；needs_assignment：待分配或承接人失效且未结束',
    },
    mine: { type: 'boolean', description: '只看当前登录管理员负责的项目（优先于 assigneeAdminId）' },
    followUp: { type: 'string', enum: ['overdue', 'today'], description: '未结束项目中下次跟进已逾期 / 今天到期（上海时区）' },
  },
} as const;
const revisionProperty = { revision: { type: 'integer', minimum: 1 } } as const;
const assetVersionParams = {
  ...projectParams,
  required: ['projectId', 'versionId'],
  properties: { ...projectParams.properties, versionId: uuid },
} as const;

const string = { type: 'string' } as const;
const integer = { type: 'integer' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const nullableInteger = { type: ['integer', 'null'] } as const;
const dateTime = { type: 'string', format: 'date-time' } as const;
const projectStatus = { type: 'string', enum: statuses } as const;
const assigneeStatus = { type: 'string', enum: ['active', 'disabled', 'permission_revoked', 'unassigned'] } as const;
// 受理时冻结的需求、方案、物料与报价快照，结构随版本演进，原样返回
const frozen = (description: string) => ({ description }) as const;
const materialsStatus = {
  type: 'object',
  additionalProperties: false,
  properties: { bom: string, drawings: string, artworks: string },
} as const;

const projectProperties = {
  projectId: string,
  projectNo: string,
  requestNo: string,
  sourceType: { type: 'string', enum: ['quote_request', 'manual_request'] },
  customerUserId: nullableString,
  assigneeAdminId: { ...nullableString, description: '待分配项目为 null' },
  assigneeName: nullableString,
  assigneeStatus,
  status: projectStatus,
  revision: integer,
  schemeCode: nullableString,
  request: frozen('提交时冻结的需求与联系人'),
  schemeSnapshot: frozen('关联方案的冻结快照'),
  materials: frozen('物料（清单、报馆图、平面素材）冻结快照'),
  publicResult: nullableString,
  nextFollowUpAt: { type: ['string', 'null'], format: 'date-time', description: '最新一条跟进记录约定的下次跟进时间' },
  createdAt: dateTime,
  updatedAt: dateTime,
} as const;
const projectRequired = Object.keys(projectProperties) as (keyof typeof projectProperties)[];

const eventSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'actorAdminId', 'actorName', 'assigneeName', 'fromAssigneeName', 'payload', 'createdAt'],
  properties: {
    id: string,
    kind: string,
    actorAdminId: nullableString,
    actorName: nullableString,
    assigneeName: nullableString,
    fromAssigneeName: nullableString,
    payload: frozen('事件载荷，结构随 kind 变化'),
    createdAt: dateTime,
  },
} as const;
const events = { type: 'array', items: eventSchema } as const;
const quotation = frozen('报价修订快照（含明细与合计）；没有报价时为 null');

const assignmentConfigSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['defaultAssigneeAdminId', 'assigneeName', 'status', 'revision', 'updatedAt'],
  properties: {
    defaultAssigneeAdminId: nullableString,
    assigneeName: nullableString,
    status: { type: 'string', enum: ['active', 'disabled', 'permission_revoked', 'unconfigured'] },
    revision: integer,
    updatedAt: string,
  },
} as const;

// 以下写操作支持幂等重放，重放返回保存的历史回执，因此回执字段不设 required
const assignmentReceipt = {
  type: 'object',
  additionalProperties: false,
  properties: { projectId: string, revision: integer, assigneeAdminId: string },
} as const;
const followUpReceipt = {
  type: 'object',
  additionalProperties: false,
  properties: { followUpId: string, projectId: string, revision: integer, status: projectStatus, createdAt: string },
} as const;
const linkReceipt = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectId: string,
    revision: integer,
    schemeCode: string,
    bomRevision: nullableInteger,
    drawingRevision: nullableInteger,
    materialsStatus,
  },
} as const;
const quotationReceipt = {
  type: 'object',
  additionalProperties: false,
  properties: { projectId: string, projectRevision: integer, status: projectStatus, quotation },
} as const;
const publicResultReceipt = {
  type: 'object',
  additionalProperties: false,
  properties: { projectId: string, revision: integer, publicResult: nullableString },
} as const;
const quotationRevisionSummary = {
  type: 'object',
  additionalProperties: false,
  required: ['revision', 'completeness', 'currency', 'totalAmount', 'validUntil', 'validityTimeZone', 'createdAt', 'createdByName'],
  properties: {
    revision: integer,
    completeness: { type: 'string', enum: ['incomplete', 'ready'] },
    currency: string,
    totalAmount: nullableString,
    validUntil: string,
    validityTimeZone: string,
    createdAt: dateTime,
    createdByName: nullableString,
  },
} as const;

export async function registerAdminProjectRoutes(app: FastifyInstance, pool: pg.Pool, storage: ReturnType<typeof createStorage>) {
  await app.register(async plugin => {
    const routes = plugin.withTypeProvider<TypeProvider>();
    routes.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      adminUserId(request);
    });

    routes.get(
      '/project-assignees',
      {
        config: { permissions: ['projects.assign'] },
        schema: {
          response: {
            200: successResponse({
              type: 'array',
              items: { type: 'object', additionalProperties: false, required: ['id', 'name'], properties: { id: string, name: string } },
            }),
          },
        },
      },
      async () => ({ code: 0, data: await listAssignableAdmins(pool) }) as const,
    );
    routes.get(
      '/project-assignment-config',
      { config: { permissions: ['projects.read'] }, schema: { response: { 200: successResponse(assignmentConfigSchema) } } },
      async () => ({ code: 0, data: await getAssignmentConfig(pool) }) as const,
    );
    routes.put(
      '/project-assignment-config',
      {
        config: { permissions: ['projects.assign'] },
        schema: { body: assignmentConfigBody, response: { 200: successResponse(assignmentConfigSchema) } },
      },
      async request => ({ code: 0, data: await saveAssignmentConfig(pool, adminUserId(request), request.body) }) as const,
    );

    routes.get(
      '/projects',
      {
        config: { permissions: ['projects.read'] },
        schema: {
          querystring: listQuerySchema,
          response: {
            200: successResponse({
              type: 'object',
              additionalProperties: false,
              required: ['items', 'total', 'page', 'pageSize'],
              properties: {
                items: {
                  type: 'array',
                  items: { type: 'object', additionalProperties: false, required: projectRequired, properties: projectProperties },
                },
                total: integer,
                page: integer,
                pageSize: integer,
              },
            }),
          },
        },
      },
      async request => {
        const { mine, ...query } = request.query;
        return {
          code: 0,
          data: await listProjects(pool, mine ? { ...query, assigneeAdminId: adminUserId(request) } : query),
        } as const;
      },
    );

    routes.get(
      '/projects/:projectId',
      {
        config: { permissions: ['projects.read'] },
        schema: {
          params: projectParams,
          response: {
            200: successResponse({
              type: 'object',
              additionalProperties: false,
              required: [...projectRequired, 'statusTransitions', 'requirementOptionLabels', 'events', 'quotation'],
              properties: {
                ...projectProperties,
                statusTransitions: { type: 'array', items: projectStatus },
                requirementOptionLabels: { type: 'object', additionalProperties: string, description: '确认条件中字典项 ID 对应的名称' },
                events,
                quotation,
              },
            }),
          },
        },
      },
      async request => {
        const project = await getProject(pool, request.params.projectId);
        return {
          code: 0,
          data: {
            ...project,
            statusTransitions: statusTransitions(project.status),
            requirementOptionLabels: await requirementOptionLabels(pool, project.request),
            events: await projectEvents(pool, project.projectId),
            quotation: await quotationRevision(pool, project.projectId),
          },
        } as const;
      },
    );

    routes.get(
      '/projects/:projectId/events',
      {
        config: { permissions: ['projects.read'] },
        schema: {
          params: projectParams,
          querystring: { type: 'object', additionalProperties: false, properties: {} },
          response: { 200: successResponse(events) },
        },
      },
      async request => {
        await getProject(pool, request.params.projectId);
        return { code: 0, data: await projectEvents(pool, request.params.projectId) } as const;
      },
    );

    routes.put(
      '/projects/:projectId/assignee',
      {
        config: { permissions: ['projects.assign'] },
        schema: { params: projectParams, body: assignmentSchema, response: { 200: successResponse(assignmentReceipt) } },
      },
      async request =>
        ({ code: 0, data: await assignProject(pool, request.params.projectId, adminUserId(request), request.body) }) as const,
    );

    routes.post(
      '/projects/:projectId/claim',
      {
        config: { permissions: ['projects.follow-up'] },
        schema: {
          description: '领取待分配项目（分配给自己）；已有承接人时返回 409 PROJECT_ALREADY_ASSIGNED',
          params: projectParams,
          body: claimSchema,
          response: { 200: successResponse(assignmentReceipt) },
        },
      },
      async request => ({ code: 0, data: await claimProject(pool, request.params.projectId, adminUserId(request), request.body) }) as const,
    );

    routes.post(
      '/projects/:projectId/follow-ups',
      {
        config: { permissions: ['projects.follow-up'] },
        schema: { params: projectParams, body: followUpSchema, response: { 200: successResponse(followUpReceipt) } },
      },
      async request =>
        ({ code: 0, data: await followUpProject(pool, request.params.projectId, adminUserId(request), request.body) }) as const,
    );

    routes.put(
      '/projects/:projectId/public-result',
      {
        config: { permissions: ['projects.follow-up'] },
        schema: {
          description: '更新客户可见结果（提交后客户可见），终态项目也可修改；空字符串表示撤下',
          params: projectParams,
          body: publicResultSchema,
          response: { 200: successResponse(publicResultReceipt) },
        },
      },
      async request =>
        ({ code: 0, data: await updatePublicResult(pool, request.params.projectId, adminUserId(request), request.body) }) as const,
    );

    routes.put(
      '/projects/:projectId/scheme',
      {
        config: { permissions: ['projects.link-scheme'] },
        schema: { params: projectParams, body: linkSchema, response: { 200: successResponse(linkReceipt) } },
      },
      async request =>
        ({ code: 0, data: await linkProjectScheme(pool, request.params.projectId, adminUserId(request), request.body) }) as const,
    );

    routes.get(
      '/projects/:projectId/quotation',
      {
        config: { permissions: ['projects.read'] },
        schema: {
          params: projectParams,
          querystring: { type: 'object', additionalProperties: false, properties: revisionProperty },
          response: {
            200: successResponse({
              type: 'object',
              additionalProperties: false,
              required: ['projectId', 'projectRevision', 'quotation'],
              properties: { projectId: string, projectRevision: integer, quotation },
            }),
          },
        },
      },
      async request => {
        const project = await getProject(pool, request.params.projectId);
        return {
          code: 0,
          data: {
            projectId: project.projectId,
            projectRevision: project.revision,
            quotation: await quotationRevision(pool, project.projectId, request.query.revision),
          },
        } as const;
      },
    );

    routes.get(
      '/projects/:projectId/quotation/revisions',
      {
        config: { permissions: ['projects.read'] },
        schema: {
          description: '报价修订列表，按修订号倒序',
          params: projectParams,
          response: { 200: successResponse({ type: 'array', items: quotationRevisionSummary }) },
        },
      },
      async request => {
        await getProject(pool, request.params.projectId);
        return { code: 0, data: await listQuotationRevisions(pool, request.params.projectId) } as const;
      },
    );

    routes.put(
      '/projects/:projectId/quotation',
      {
        config: { permissions: ['projects.quotation'] },
        bodyLimit: 32 * 1024 * 1024,
        schema: { params: projectParams, body: quotationSchema, response: { 200: successResponse(quotationReceipt) } },
      },
      async request =>
        ({ code: 0, data: await saveQuotation(pool, request.params.projectId, adminUserId(request), request.body) }) as const,
    );

    // 报价单为 xlsx 文件，不走类型化的 JSON 响应
    plugin.get<{ Params: { projectId: string }; Querystring: { revision: number } }>(
      '/projects/:projectId/quotation/download',
      {
        config: { permissions: ['projects.quotation-download'] },
        schema: {
          params: projectParams,
          querystring: { type: 'object', additionalProperties: false, required: ['revision'], properties: revisionProperty },
          response: fileResponse('xlsx'),
        },
      },
      async (request, reply) => {
        const project = await getProject(pool, request.params.projectId);
        const quotation = await quotationRevision(pool, project.projectId, request.query.revision);
        if (!quotation) throw projectError('RESOURCE_NOT_FOUND', 404);
        const buffer = await quotationWorkbook(
          {
            projectNo: project.projectNo,
            schemeCode: project.schemeCode,
            contact: project.request.contact,
            company: project.request.company,
          },
          quotation,
        );
        return reply
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .header('Content-Disposition', `attachment; filename="${project.projectNo}-quotation-r${quotation.revision}.xlsx"`)
          .send(buffer);
      },
    );

    // 工作区图片列表显示缩略图、点开看预览图，原图仍走下载接口
    routes.get(
      '/projects/:projectId/asset-images',
      {
        config: { permissions: ['projects.asset-download'] },
        schema: {
          params: projectParams,
          response: {
            200: successResponse({
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['versionId', 'thumbnailUrl', 'previewUrl'],
                properties: { versionId: string, thumbnailUrl: string, previewUrl: string },
              },
            }),
          },
        },
      },
      async request => {
        await getProject(pool, request.params.projectId);
        const images = await listProjectImageVersions(pool, request.params.projectId);
        const data = await Promise.all(
          images.map(async ({ versionId, ...image }) => ({ versionId, ...(await signImageLinks(storage, image, 600)) })),
        );
        return { code: 0, data } as const;
      },
    );

    routes.get(
      '/projects/:projectId/assets/:versionId/download',
      {
        config: { permissions: ['projects.asset-download'] },
        schema: {
          params: assetVersionParams,
          response: {
            200: successResponse({
              type: 'object',
              additionalProperties: false,
              required: ['filename', 'downloadUrl'],
              properties: { filename: string, downloadUrl: string },
            }),
          },
        },
      },
      async request => {
        await getProject(pool, request.params.projectId);
        const asset = await findProjectAssetVersion(pool, request.params.projectId, request.params.versionId);
        return {
          code: 0,
          data: { filename: asset.filename, downloadUrl: await storage.signDownloadWithName(asset.objectKey, asset.filename, 300) },
        } as const;
      },
    );
  });
}
