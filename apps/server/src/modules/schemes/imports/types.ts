export interface ImportRow {
  code: string;
  name: string;
  parentCode: string | null;
  widthMm: number | null;
  lengthMm: number | null;
  areaM2: number | null;
  heightMm: number | null;
  openingCount: number | null;
  productSystemId: string | null;
  styleId: string | null;
  industryIds: string[] | null;
  budgetTierId: string | null;
  zoneIds: string[] | null;
  featureIds: string[] | null;
  description: string | null;
  keywords: string[] | null;
  verificationStatus: 'unverified' | 'verified' | 'failed';
  notes: string | null;
}

export interface ImportSummary {
  total: number;
  valid: number;
  duplicate: number;
  error: number;
  skipped: number;
}

export interface ImportPreviewRow {
  rowNumber: number;
  code: string;
  name: string;
  status: 'valid' | 'duplicate' | 'error';
  reason?: string;
  data?: ImportRow;
  snapshotRevision?: number;
}

export interface PreviewImportResult {
  importId: string;
  rows: ImportPreviewRow[];
  summary: ImportSummary;
}

export interface CommitImportOptions {
  duplicateStrategy: 'skip' | 'update';
  selectedRows?: number[];
}

export interface CommitImportResult {
  created: number;
  updated: number;
  dictionaryItemsCreated: number;
  failed: { rowNumber: number; code: string; reason: string }[];
}
