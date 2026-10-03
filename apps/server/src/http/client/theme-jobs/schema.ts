const uuid = { type: 'string', format: 'uuid' };
const jobParams = { type: 'object', required: ['jobId'], properties: { jobId: uuid } };
const generationProperties = {
  schemeCode: { type: 'string', minLength: 1, maxLength: 200 },
  sourceAssetId: { type: 'string', minLength: 1, maxLength: 200 },
  input: {
    type: 'object',
    required: ['industryId', 'styleId'],
    additionalProperties: false,
    properties: {
      industryId: { type: 'string', minLength: 1, maxLength: 200 },
      styleId: { type: 'string', minLength: 1, maxLength: 200 },
      brandColors: { type: 'array', maxItems: 3, items: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' } },
      brandKeywords: { type: 'string', maxLength: 200 },
    },
  },
  requestedCount: { type: 'integer', minimum: 1, maximum: 4 },
  cacheMode: { type: 'string', enum: ['reuse', 'refresh'] },
  searchId: uuid,
};

export const themeEventsSchema = {
  querystring: { type: 'object', required: ['ticket'], additionalProperties: false, properties: { ticket: uuid } },
};
export const themeModelsSchema = { tags: ['AI 换主题'], summary: '可选择的图像模型及每张图积分' };
export const themeOfferSchema = {
  tags: ['AI 换主题'],
  summary: '获取可生成能力及费用提议（API-092）',
  body: { type: 'object', required: ['schemeCode', 'sourceAssetId'], additionalProperties: false, properties: generationProperties },
};
export const themeSubmissionSchema = {
  tags: ['AI 换主题'],
  summary: '创建换主题生成任务（API-006）',
  body: {
    type: 'object',
    required: ['requestKey', 'offerId', 'schemeCode', 'sourceAssetId', 'input', 'requestedCount'],
    additionalProperties: false,
    properties: { requestKey: uuid, offerId: { type: 'string', minLength: 1 }, ...generationProperties },
  },
};
export const themeJobSchema = { tags: ['AI 换主题'], summary: '查询换主题任务状态（API-007）', params: jobParams };
export const themeSelectionSchema = {
  tags: ['AI 换主题'],
  summary: '保存最终效果选择（API-008）',
  params: jobParams,
  body: {
    type: 'object',
    required: ['resultId', 'expectedRevision'],
    additionalProperties: false,
    properties: { resultId: uuid, expectedRevision: { type: 'integer', minimum: 0 } },
  },
};
