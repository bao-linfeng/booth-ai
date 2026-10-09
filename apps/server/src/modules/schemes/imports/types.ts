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

/** 来源位置：工作表名称与该表内的原始行号（表头为第 1 行）。 */
export interface ImportRowSource {
  sheetName: string;
  rowNumber: number;
}

export interface ParsedImportRow extends ImportRowSource {
  data: ImportRow;
}

export interface ImportSummary {
  total: number;
  valid: number;
  duplicate: number;
  error: number;
  skipped: number;
}

/** rowId 在单次导入内唯一，作为提交时的选择键；sheetName + rowNumber 仅用于定位原文件。 */
export interface ImportPreviewRow extends ImportRowSource {
  rowId: number;
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
  selectedRowIds?: number[];
}

export interface CommitImportResult {
  created: number;
  updated: number;
  dictionaryItemsCreated: number;
  failed: (ImportRowSource & { rowId: number; code: string; reason: string })[];
}
