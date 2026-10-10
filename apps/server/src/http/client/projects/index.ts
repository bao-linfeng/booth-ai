import type { JsonSchemaToTsProvider } from '@fastify/type-provider-json-schema-to-ts';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { createStorage } from '../../../infra/storage.js';
import { clientUserId } from '../../authentication.js';
import { successResponse } from '../../schemas.js';
import { getProject, listProjects, type ProjectRecord } from '../../../modules/projects/repository.js';
import { projectParams, queryProperties } from '../../../modules/projects/schema.js';
import { bindProjectArtworks } from '../../../modules/projects/artwork-delivery.js';

export function publicProject(project: ProjectRecord) {
  const request = project.request;
  const snapshot = project.schemeSnapshot;
  return {
    projectId: project.projectId,
    projectNo: project.projectNo,
    requestNo: project.requestNo,
    sourceType: project.sourceType,
    status: project.status,
    revision: project.revision,
    schemeCode: project.schemeCode,
    request: {
      exhibition: request.exhibition ?? null,
      contact: {
        name: request.contact.name,
        email: request.contact.email,
        phone: request.contact.phone,
        legacyDetail: request.contact.legacyDetail,
      },
      company: request.company,
      customerType: request.customerType,
      scopeCodes: request.scopeCodes ?? [],
      scopeNotes: request.scopeNotes,
      materialBudget: request.materialBudget ?? null,
      notes: request.notes,
      originalDescription: request.originalDescription ?? request.requirementContext?.originalDescription,
      confirmedRequirements: request.confirmedRequirements ?? request.requirementContext?.confirmedRequirements,
      unresolvedQuestions: request.unresolvedQuestions ?? [],
      legacyIncomplete: request.legacyIncomplete ?? false,
    },
    schemeSnapshot: snapshot
      ? {
          code: snapshot.code,
          name: snapshot.name,
          revision: snapshot.revision,
          lengthMm: snapshot.lengthMm,
          widthMm: snapshot.widthMm,
          heightMm: snapshot.heightMm,
          openingCount: snapshot.openingCount,
        }
      : null,
    materialsStatus: {
      bom: project.materials.bom?.status ?? 'missing',
      drawings: project.materials.drawings?.status ?? 'missing',
      artworks: project.materials.artworks?.status ?? 'missing',
    },
    artworkJobId: project.materials.artworks?.artworkJobId ?? null,
    selectedThemeSummary: snapshot?.selectedTheme
      ? {
          themeJobId: snapshot.selectedTheme.themeJobId,
          resultId: snapshot.selectedTheme.resultId,
          selectionRevision: snapshot.selectedTheme.selectionRevision,
        }
      : null,
    publicResult: project.publicResult,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}
const nullableString = { type: ['string', 'null'] } as const;
const dateTime = { type: 'string', format: 'date-time' } as const;
// 历史快照里的展会、预算与需求结构随版本变化，按原样透传，不在响应 schema 中裁剪
const snapshotValue = { description: '提交时冻结的快照，结构随提交版本变化，原样返回' } as const;
const materialsStatus = {
  type: 'object',
  additionalProperties: false,
  required: ['bom', 'drawings', 'artworks'],
  properties: { bom: { type: 'string' }, drawings: { type: 'string' }, artworks: { type: 'string' } },
} as const;
const themeSummary = {
  type: 'object',
  additionalProperties: false,
  required: ['themeJobId', 'resultId', 'selectionRevision'],
  properties: {
    themeJobId: { type: 'string' },
    resultId: { type: 'string' },
    selectionRevision: { type: 'integer' },
    previewUrl: { type: 'string' },
  },
} as const;

const projectDetailSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'projectId',
    'projectNo',
    'requestNo',
    'sourceType',
    'status',
    'revision',
    'schemeCode',
    'request',
    'schemeSnapshot',
    'materialsStatus',
    'artworkJobId',
    'selectedThemeSummary',
    'publicResult',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    projectId: { type: 'string' },
    projectNo: { type: 'string' },
    requestNo: { type: 'string' },
    sourceType: { type: 'string', enum: ['quote_request', 'manual_request'] },
    status: { type: 'string' },
    revision: { type: 'integer' },
    schemeCode: nullableString,
    request: {
      type: 'object',
      additionalProperties: false,
      required: ['exhibition', 'contact', 'scopeCodes', 'materialBudget', 'unresolvedQuestions', 'legacyIncomplete'],
      properties: {
        exhibition: snapshotValue,
        contact: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, legacyDetail: { type: 'string' } },
        },
        company: { type: 'string' },
        customerType: { type: 'string' },
        scopeCodes: { type: 'array', items: { type: 'string' } },
        scopeNotes: { type: 'string' },
        materialBudget: snapshotValue,
        notes: { type: 'string' },
        originalDescription: { type: 'string' },
        confirmedRequirements: snapshotValue,
        unresolvedQuestions: { type: 'array', items: { type: 'string' } },
        legacyIncomplete: { type: 'boolean' },
      },
    },
    schemeSnapshot: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'name', 'revision'],
          properties: {
            code: { type: 'string' },
            name: { type: 'string' },
            revision: { type: 'integer' },
            lengthMm: { type: ['integer', 'null'] },
            widthMm: { type: ['integer', 'null'] },
            heightMm: { type: ['integer', 'null'] },
            openingCount: { type: ['integer', 'null'] },
          },
        },
        { type: 'null' },
      ],
    },
    materialsStatus,
    artworkJobId: nullableString,
    selectedThemeSummary: { anyOf: [themeSummary, { type: 'null' }] },
    publicResult: nullableString,
    createdAt: dateTime,
    updatedAt: dateTime,
  },
} as const;

const projectListSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'total', 'page', 'pageSize'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['projectId', 'projectNo', 'schemeCode', 'sourceType', 'exhibition', 'status', 'createdAt', 'updatedAt'],
        properties: {
          projectId: { type: 'string' },
          projectNo: { type: 'string' },
          schemeCode: nullableString,
          sourceType: { type: 'string', enum: ['quote_request', 'manual_request'] },
          exhibition: snapshotValue,
          status: { type: 'string' },
          createdAt: dateTime,
          updatedAt: dateTime,
        },
      },
    },
    total: { type: 'integer' },
    page: { type: 'integer' },
    pageSize: { type: 'integer' },
  },
} as const;

const bindReceiptSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['projectId', 'revision', 'artworkJobId', 'status'],
  properties: {
    projectId: { type: 'string' },
    revision: { type: 'integer' },
    artworkJobId: { type: 'string' },
    status: { type: 'string' },
  },
} as const;

export async function registerClientProjectRoutes(app: FastifyInstance, pool: pg.Pool, storage: ReturnType<typeof createStorage>) {
  const routes = app.withTypeProvider<JsonSchemaToTsProvider>();
  routes.put(
    '/me/projects/:projectId/artworks',
    {
      schema: {
        params: projectParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['artworkJobId', 'requestKey', 'expectedRevision'],
          properties: {
            artworkJobId: { type: 'string', format: 'uuid' },
            requestKey: { type: 'string', format: 'uuid' },
            expectedRevision: { type: 'integer', minimum: 1 },
          },
        },
        response: { 200: successResponse(bindReceiptSchema) },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      return { code: 0, data: await bindProjectArtworks(pool, clientUserId(request), request.params.projectId, request.body) } as const;
    },
  );
  routes.get(
    '/me/projects',
    {
      schema: {
        querystring: { type: 'object', additionalProperties: false, properties: queryProperties },
        response: { 200: successResponse(projectListSchema) },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const userId = clientUserId(request);
      const result = await listProjects(pool, request.query, userId);
      return {
        code: 0,
        data: {
          ...result,
          items: result.items.map(project => ({
            projectId: project.projectId,
            projectNo: project.projectNo,
            schemeCode: project.schemeCode,
            sourceType: project.sourceType,
            exhibition: project.request.exhibition ?? null,
            status: project.status,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
          })),
        },
      } as const;
    },
  );
  routes.get(
    '/me/projects/:projectId',
    { schema: { params: projectParams, response: { 200: successResponse(projectDetailSchema) } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const userId = clientUserId(request);
      const project = await getProject(pool, request.params.projectId, userId);
      const data = publicProject(project);
      const theme = project.schemeSnapshot?.selectedTheme;
      return {
        code: 0,
        data: {
          ...data,
          selectedThemeSummary: theme
            ? { ...data.selectedThemeSummary!, previewUrl: await storage.signDownload(theme.asset.objectKey, 300) }
            : null,
        },
      } as const;
    },
  );
}
