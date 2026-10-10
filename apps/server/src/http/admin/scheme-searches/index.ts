import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { TypeProvider } from '../../type-provider.js';
import { getSearch, listSearchVisitors, listSearches } from '../../../modules/selection/analytics/queries.js';
import { getStatistics } from '../../../modules/selection/analytics/statistics.js';
import { pageSchema, successResponse } from '../../schemas.js';

const string = { type: 'string' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const integer = { type: 'integer' } as const;
const nullableInteger = { type: ['integer', 'null'] } as const;
const dateTime = { type: 'string', format: 'date-time' } as const;
// 检索与解析时冻结的结构化结果，字段随智选版本变化，原样返回
const recorded = (description: string) => ({ description }) as const;

const searchListItem = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'attemptId',
    'parseId',
    'visitorId',
    'loggedIn',
    'username',
    'mode',
    'status',
    'inputText',
    'directCount',
    'referenceCount',
    'randomCount',
    'resultCount',
    'schemeCodes',
    'degradedParse',
    'durationMs',
    'createdAt',
  ],
  properties: {
    id: string,
    attemptId: nullableString,
    parseId: nullableString,
    visitorId: string,
    loggedIn: { type: 'boolean' },
    username: nullableString,
    mode: string,
    status: string,
    inputText: string,
    directCount: integer,
    referenceCount: integer,
    randomCount: integer,
    resultCount: integer,
    schemeCodes: { type: 'array', items: nullableString },
    degradedParse: { type: 'boolean' },
    durationMs: nullableInteger,
    createdAt: dateTime,
  },
} as const;

const searchDetail = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'attemptId',
    'parseId',
    'visitorId',
    'loggedIn',
    'mode',
    'status',
    'inputText',
    'finalRequirement',
    'directCount',
    'referenceCount',
    'randomCount',
    'resultCount',
    'zeroMatchReasons',
    'matchDiagnostics',
    'demandTerms',
    'resultSnapshot',
    'rulesVersion',
    'dictionaryVersion',
    'degradedParse',
    'durationMs',
    'createdAt',
    'parser',
    'parseDegraded',
    'fieldSources',
    'overrides',
    'clarifications',
    'unhandledText',
    'warnings',
    'parsedAt',
    'promptSnapshot',
  ],
  properties: {
    id: string,
    attemptId: nullableString,
    parseId: nullableString,
    visitorId: string,
    loggedIn: { type: 'boolean' },
    mode: string,
    status: string,
    inputText: string,
    finalRequirement: recorded('提交匹配时的需求条件'),
    directCount: integer,
    referenceCount: integer,
    randomCount: integer,
    resultCount: integer,
    zeroMatchReasons: recorded('无匹配时的原因'),
    matchDiagnostics: recorded('候选池过滤统计'),
    demandTerms: recorded('从需求中提取的热词'),
    resultSnapshot: recorded('返回给用户的方案列表快照'),
    rulesVersion: nullableString,
    dictionaryVersion: nullableString,
    degradedParse: { type: 'boolean' },
    durationMs: nullableInteger,
    createdAt: dateTime,
    // 以下来自关联的解析记录，没有解析时为 null
    parser: nullableString,
    parseDegraded: { type: ['boolean', 'null'] },
    fieldSources: recorded('各字段的来源'),
    overrides: recorded('文本覆盖表单的字段'),
    clarifications: recorded('需要用户澄清的问题'),
    unhandledText: recorded('规则未识别的文本'),
    warnings: recorded('解析告警'),
    parsedAt: { anyOf: [dateTime, { type: 'null' }] },
    promptSnapshot: recorded('解析时使用的提示词快照'),
  },
} as const;

const statisticsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'trend', 'popularTerms', 'conversion'],
  properties: {
    overview: {
      type: 'object',
      additionalProperties: false,
      required: [
        'searches',
        'uniqueVisitors',
        'matchedSearches',
        'noMatchSearches',
        'directMatches',
        'referenceMatches',
        'randomMatches',
        'loggedInSearches',
        'avgDurationMs',
        'p95DurationMs',
        'degradedParseRate',
        'schemeCount',
        'conversionRate',
      ],
      properties: {
        searches: integer,
        uniqueVisitors: integer,
        matchedSearches: integer,
        noMatchSearches: integer,
        directMatches: integer,
        referenceMatches: integer,
        randomMatches: integer,
        loggedInSearches: integer,
        avgDurationMs: integer,
        p95DurationMs: integer,
        degradedParseRate: { type: 'number' },
        schemeCount: integer,
        conversionRate: { type: 'number' },
      },
    },
    trend: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'searches', 'matched', 'noMatch', 'loggedIn', 'direct', 'reference', 'random'],
        properties: {
          date: string,
          searches: integer,
          matched: integer,
          noMatch: integer,
          loggedIn: integer,
          direct: nullableInteger,
          reference: nullableInteger,
          random: nullableInteger,
        },
      },
    },
    popularTerms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'term', 'count'],
        properties: { date: string, term: string, count: integer },
      },
    },
    conversion: {
      type: 'object',
      additionalProperties: false,
      required: ['anonymousVisitors', 'convertedVisitors', 'rate'],
      properties: { anonymousVisitors: integer, convertedVisitors: integer, rate: { type: 'number' } },
    },
  },
} as const;

export async function registerAdminSchemeSearchesRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  const routes = app.withTypeProvider<TypeProvider>();
  routes.get(
    '/scheme-searches',
    {
      config: { permissions: ['searches.read'] },
      schema: {
        tags: ['admin-scheme-searches'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
            status: { type: 'string', enum: ['matched', 'no_match', 'needs_clarification'] },
            mode: { type: 'string', enum: ['random', 'filtered'] },
            visitorId: { type: 'string', minLength: 1, maxLength: 128 },
            userId: { type: 'string', format: 'uuid' },
            schemeCode: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
        response: { 200: successResponse(pageSchema(searchListItem)) },
      },
    },
    async request =>
      ({
        code: 0,
        data: await listSearches(pool, { ...request.query, page: request.query.page ?? 1, pageSize: request.query.pageSize ?? 20 }),
      }) as const,
  );

  routes.get(
    '/scheme-searches/visitors',
    {
      config: { permissions: ['searches.read'] },
      schema: {
        tags: ['admin-scheme-searches'],
        response: {
          200: successResponse({
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['visitorId', 'searchCount'],
              properties: { visitorId: string, searchCount: integer },
            },
          }),
        },
      },
    },
    async () => ({ code: 0, data: await listSearchVisitors(pool) }) as const,
  );

  routes.get(
    '/scheme-searches/statistics',
    {
      config: { permissions: ['search-analytics.read'] },
      schema: {
        tags: ['admin-scheme-searches'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
            granularity: { type: 'string', enum: ['date', 'hour'] },
          },
        },
        response: { 200: successResponse(statisticsSchema) },
      },
    },
    async request => ({ code: 0, data: await getStatistics(pool, request.query) }) as const,
  );

  routes.get(
    '/scheme-searches/:id',
    {
      config: { permissions: ['searches.detail'] },
      schema: {
        tags: ['admin-scheme-searches'],
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', format: 'uuid' } } },
        response: { 200: successResponse(searchDetail) },
      },
    },
    async request => ({ code: 0, data: await getSearch(pool, request.params.id) }) as const,
  );
}
