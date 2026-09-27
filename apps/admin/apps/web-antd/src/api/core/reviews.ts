import { requestClient } from '#/api/request';

// 类型定义
export interface ReadinessAssets {
  model: { count: number; verified: boolean };
  checklist: { count: number; verified: boolean };
  rendering: { count: number };
  mask: { count: number };
  drawing: { count: number };
  artwork: { count: number };
}

export interface ReadinessResult {
  schemeCode: string;
  schemeRevision: number;
  publishStatus: string;
  verificationStatus: string;
  assets: ReadinessAssets;
  blockers: string[];
  canPublish: boolean;
}

export interface ReviewRecord {
  id: string;
  schemeId: string;
  requestKey: string;
  schemeRevision: number;
  phase: 'asset_verification' | 'overall';
  decision: 'pass' | 'reject';
  checks: Record<string, boolean>;
  notes: null | string;
  adminId: null | string;
  createdAt: string;
}

export interface PublishedScheme {
  id: string;
  code: string;
  revision: number;
  publishStatus: string;
  verificationStatus: string;
  updatedAt: string;
}

// API-042: 就绪检查
export async function getSchemeReadinessApi(schemeCode: string) {
  return requestClient.get<ReadinessResult>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/readiness`,
  );
}

// API-043: 创建审核记录
export async function createSchemeReviewApi(
  schemeCode: string,
  params: {
    requestKey: string;
    schemeRevision: number;
    phase: 'asset_verification' | 'overall';
    decision: 'pass' | 'reject';
    checks: Record<string, boolean>;
    notes?: null | string;
  },
) {
  return requestClient.post<ReviewRecord>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/reviews`,
    params,
  );
}

// API-044: 发布
export async function publishSchemeApi(schemeCode: string) {
  return requestClient.post<PublishedScheme>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/publish`,
    {},
  );
}

// API-045: 下架
export async function unpublishSchemeApi(schemeCode: string, reason?: string) {
  return requestClient.post<PublishedScheme>(
    `/v1/admin/schemes/${encodeURIComponent(schemeCode)}/unpublish`,
    reason ? { reason } : {},
  );
}
