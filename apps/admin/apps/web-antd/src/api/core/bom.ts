import { requestClient } from '#/api/request';

export type BomStatus =
  | 'absent'
  | 'pending_verification'
  | 'rejected'
  | 'verified';
export type MeasurementKind = 'area' | 'count' | 'length';
export type ConversionCode = 'identity' | 'mm2_to_m2' | 'mm_to_m';

export interface BomUnitRule {
  id: string;
  bomId: string;
  measurementKind: MeasurementKind;
  sourceUnit: string;
  pricingUnit: string;
  conversionCode: ConversionCode;
}

export interface BomItem {
  id: string;
  bomId: string;
  ordinal: number;
  productName: string;
  productModel: null | string;
  specificationMm: null | string;
  sourceQuantity: string;
  sourceUnit: string;
  quantity: string;
  unitRuleId: null | string;
  erpCode: null | string;
  sourceSheet: null | string;
  sourceRow: null | number;
  diffNote: null | string;
}

export interface BomRecord {
  id?: string;
  schemeCode?: string;
  schemeId?: string;
  revision: number;
  status: BomStatus;
  sourceAssetId?: null | string;
  contentHash?: null | string;
  modelAssetId?: null | string;
  verifiedAt?: null | string;
  items: BomItem[];
  unitRules: BomUnitRule[];
  createdAt?: string;
  updatedAt?: string;
}

export interface BomImportResult {
  importId: string;
  schemeCode: string;
  baseRevision: number;
  expiresAt: string;
  status: string;
  sourceFileName: string;
  sourceHash: string;
  canCommit: boolean;
  mappingRevision: number;
  unitRules: Array<Omit<BomUnitRule, 'bomId' | 'id'> & { id?: string }>;
  items: BomPreviewItem[];
  errors: Array<{
    code: string;
    sheet?: string;
    row?: number;
    field?: string;
    message: string;
  }>;
  warnings: Array<{
    code: string;
    sheet?: string;
    row?: number;
    field?: string;
    message: string;
  }>;
}

export interface BomPreviewItem {
  ordinal: number;
  productName: string;
  productModel?: null | string;
  specificationMm?: null | string;
  sourceQuantity: string;
  sourceUnit: string;
  erpCode?: null | string;
  sourceSheet?: null | string;
  sourceRow?: null | number;
  diffNote?: null | string;
}

export interface BomVerificationResult {
  verificationId: string;
  revision: number;
  status: BomStatus;
  verifiedAt: null | string;
}

// API-053: 查看清单
export async function getBomApi(schemeCode: string) {
  return requestClient.get<BomRecord>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/bill-of-materials`,
  );
}

// API-051: 上传导入预览
export async function uploadBomImportApi(
  schemeCode: string,
  file: File,
  expectedRevision: number,
) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('expectedRevision', String(expectedRevision));
  return requestClient.post<BomImportResult>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/bill-of-materials/imports`,
    formData,
    { headers: { 'Content-Type': undefined } },
  );
}

// API-052: 确认导入
export async function commitBomImportApi(
  schemeCode: string,
  importId: string,
  params: {
    expectedRevision: number;
    confirmedWarningCodes?: string[];
    changeReason: string;
  },
) {
  return requestClient.post<{
    schemeCode: string;
    revision: number;
    status: string;
    itemCount: number;
    unpublished: boolean;
  }>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/bill-of-materials/imports/${importId}/commit`,
    params,
  );
}

// API-054: 修正条目
export async function updateBomItemsApi(
  schemeCode: string,
  params: {
    expectedRevision: number;
    changeReason: string;
    items: Array<{
      id?: string;
      productName: string;
      productModel?: null | string;
      specificationMm?: null | string;
      sourceQuantity: string;
      sourceUnit: string;
      unitRuleId?: string;
      erpCode?: null | string;
      diffNote?: null | string;
      sourceSheet?: null | string;
      sourceRow?: null | number;
    }>;
  },
) {
  return requestClient.put<BomRecord>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/bill-of-materials/items`,
    params,
  );
}

// API-055: 保存计量规则
export async function updateBomUnitRulesApi(
  schemeCode: string,
  params: {
    expectedRevision: number;
    changeReason: string;
    unitRules: Array<{
      id?: string;
      measurementKind: MeasurementKind;
      sourceUnit: string;
      pricingUnit: string;
      conversionCode: ConversionCode;
    }>;
  },
) {
  return requestClient.put<BomRecord>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/bill-of-materials/unit-rules`,
    params,
  );
}

// API-056: 提交核验
export async function submitBomVerificationApi(
  schemeCode: string,
  params: {
    requestKey: string;
    expectedRevision: number;
    decision: 'pass' | 'reject';
    checks: {
      sourceExtraction: boolean;
      modelCrossCheck: boolean;
      supportingParts: boolean;
      unitConsistency: boolean;
    };
    modelAssetId?: string;
    notes?: string;
  },
) {
  return requestClient.post<BomVerificationResult>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/bill-of-materials/verifications`,
    params,
  );
}

// API-057: 后台导出
export async function downloadBomApi(schemeCode: string, revision: number) {
  return requestClient.get<Blob>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/bill-of-materials/download`,
    { params: { revision }, responseType: 'blob', responseReturn: 'body' },
  );
}
