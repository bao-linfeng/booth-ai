// 清单响应 schema，管理端与参展商端共用；数量与金额以字符串返回，避免精度丢失
const nullableString = { type: ['string', 'null'] } as const;

export const measurementKindSchema = { type: 'string', enum: ['count', 'length', 'area'] } as const;

export const bomItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'bomId',
    'ordinal',
    'productName',
    'productModel',
    'specificationMm',
    'sourceQuantity',
    'sourceUnit',
    'measurementKind',
    'quantity',
    'erpCode',
    'unitPrice',
    'totalPrice',
    'totalWeightKg',
    'sourceSheet',
    'sourceRow',
    'diffNote',
  ],
  properties: {
    id: { type: 'string' },
    bomId: { type: 'string' },
    ordinal: { type: 'integer' },
    productName: { type: 'string' },
    productModel: nullableString,
    specificationMm: nullableString,
    sourceQuantity: { type: 'string' },
    sourceUnit: { type: 'string' },
    measurementKind: measurementKindSchema,
    quantity: { type: 'string' },
    erpCode: nullableString,
    unitPrice: nullableString,
    totalPrice: nullableString,
    totalWeightKg: nullableString,
    sourceSheet: nullableString,
    sourceRow: { type: ['integer', 'null'] },
    diffNote: nullableString,
  },
} as const;

export const bomRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'schemeId', 'revision', 'status', 'sourceAssetId', 'contentHash', 'verifiedAt', 'items', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    schemeId: { type: 'string' },
    revision: { type: 'integer' },
    status: { type: 'string', enum: ['pending_verification', 'verified', 'rejected'] },
    sourceAssetId: nullableString,
    contentHash: nullableString,
    verifiedAt: nullableString,
    items: { type: 'array', items: bomItemSchema },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const;
