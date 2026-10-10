import type { TypeProvider } from '../../type-provider.js';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getGenerationJob, listGenerationJobs } from '../../../modules/generation/queries.js';
import { writeAuditLog } from '../../../infra/audit.js';
import { adminUserId } from '../../authentication.js';
import { pageSchema, successResponse } from '../../schemas.js';
import type { Redis } from 'ioredis';

const string = { type: 'string' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const integer = { type: 'integer' } as const;
const nullableInteger = { type: ['integer', 'null'] } as const;
const dateTime = { type: 'string', format: 'date-time' } as const;
const nullableDateTime = { type: ['string', 'null'], format: 'date-time' } as const;

// 列表与详情共有的任务字段（主题与四向图合并展示）
const jobProperties = {
  jobType: { type: 'string', enum: ['theme', 'artwork'] },
  id: string,
  userId: string,
  username: nullableString,
  schemeCode: string,
  status: string,
  phase: nullableString,
  requestedCount: integer,
  usableCount: integer,
  unitCredits: nullableInteger,
  cacheHit: { type: 'boolean' },
  input: { description: '提交时的生成参数（行业、风格、品牌色等）' },
  creditIssue: nullableString,
  creditIssueAt: nullableDateTime,
  aiModels: { type: 'array', items: string },
  createdAt: dateTime,
  updatedAt: dateTime,
  completedAt: nullableDateTime,
  totalCreditsConsumed: nullableInteger,
  durationMs: nullableInteger,
} as const;
const jobRequired = Object.keys(jobProperties) as (keyof typeof jobProperties)[];

const creditLedgerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reservation', 'charge'],
  properties: {
    reservation: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'amount', 'createdAt', 'updatedAt'],
          properties: {
            status: { type: 'string', enum: ['reserved', 'settled', 'released'] },
            amount: integer,
            createdAt: dateTime,
            updatedAt: dateTime,
          },
        },
        { type: 'null' },
      ],
    },
    charge: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'amount', 'createdAt'],
          properties: { id: string, amount: integer, createdAt: dateTime },
        },
        { type: 'null' },
      ],
    },
  },
} as const;

const jobDetailSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    ...jobRequired,
    'sourceAssetId',
    'offerId',
    'requestKey',
    'results',
    'isSelected',
    'industryLabel',
    'styleLabel',
    'sourcePreviewUrl',
    'credits',
  ],
  properties: {
    ...jobProperties,
    sourceAssetId: string,
    offerId: string,
    requestKey: string,
    cacheMode: string,
    selectionRevision: integer,
    selectedResultId: nullableString,
    isSelected: { type: 'boolean' },
    industryLabel: nullableString,
    styleLabel: nullableString,
    sourcePreviewUrl: nullableString,
    credits: creditLedgerSchema,
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'ordinal', 'assetId', 'width', 'height', 'previewUrl', 'createdAt'],
        properties: {
          id: string,
          ordinal: integer,
          direction: string,
          assetId: string,
          width: nullableInteger,
          height: nullableInteger,
          previewUrl: nullableString,
          createdAt: dateTime,
        },
      },
    },
    // 以下仅四向图任务
    deliveryStatus: string,
    themeJobId: string,
    themeResultId: string,
    themeSelectionRevision: integer,
    generationSnapshot: { description: '四向图生成时冻结的模型、模板、提示词与质量参数' },
    themeSelection: {
      type: 'object',
      additionalProperties: false,
      required: ['themeJobId', 'resultId', 'selectionRevision'],
      properties: { themeJobId: string, resultId: string, selectionRevision: integer },
    },
    directions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['direction', 'status', 'reason'],
        properties: { direction: string, status: string, reason: nullableString },
      },
    },
    missingDirections: { type: 'array', items: string },
    mappingStatus: string,
  },
} as const;

export async function registerAdminGenerationJobRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  storage: { signDownload: (key: string, expiresIn: number) => Promise<string> },
  redis?: Redis,
): Promise<void> {
  const routes = app.withTypeProvider<TypeProvider>();
  routes.get(
    '/generation-jobs',
    {
      config: { permissions: ['generation.read'] },
      schema: {
        tags: ['admin-generation-jobs'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
            jobType: { type: 'string', enum: ['theme', 'artwork'] },
            status: { type: 'string', enum: ['pending', 'queued', 'running', 'settling', 'succeeded', 'partially_succeeded', 'failed'] },
            userId: { type: 'string', format: 'uuid' },
            schemeCode: { type: 'string' },
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
            creditIssue: { type: 'boolean' },
          },
        },
        response: {
          200: successResponse(
            pageSchema({ type: 'object', additionalProperties: false, required: jobRequired, properties: jobProperties }),
          ),
        },
      },
    },
    async request => ({ code: 0, data: await listGenerationJobs(pool, request.query) }) as const,
  );

  routes.get(
    '/generation-jobs/:jobId',
    {
      config: { permissions: ['generation.detail'] },
      schema: {
        tags: ['admin-generation-jobs'],
        params: {
          type: 'object',
          required: ['jobId'],
          additionalProperties: false,
          properties: { jobId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: successResponse(jobDetailSchema) },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const jobId = request.params.jobId;
      if (redis)
        await writeAuditLog(pool, {
          adminId: adminUserId(request),
          action: 'generation_job.view',
          targetType: 'generation_job',
          targetId: jobId,
        });
      return { code: 0, data: await getGenerationJob(pool, jobId, storage) } as const;
    },
  );
}
