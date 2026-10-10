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

/** 数据工作表表头与模板不一致的首个列，随 IMPORT_TEMPLATE_MISMATCH 返回。 */
export interface ImportTemplateMismatch {
  sheetName: string;
  column: string;
  expected: string;
  actual: string;
}

export interface ParsedImportRow extends ImportRowSource {
  data: ImportRow;
}

export interface ImportSummary {
  total: number;
  valid: number;
  /** 已存在且文件内容与当前方案有差异的行 */
  duplicate: number;
  /** 已存在且与当前方案完全一致、无需更新的行 */
  unchanged: number;
  error: number;
  skipped: number;
  /** 覆盖更新时将从已发布退回草稿的方案数（仅改备注的不计入） */
  unpublish: number;
}

/** 导入覆盖可写入的方案字段（ImportRow 去掉编号与核验状态）。 */
export type ImportChangedField = Exclude<keyof ImportRow, 'code' | 'verificationStatus'>;

/** 字典字段映射后的中文标签，供预览核对；键与 ImportRow 的字典字段一致。 */
export type ImportDictionaryLabels = Partial<
  Record<'productSystemId' | 'styleId' | 'industryIds' | 'budgetTierId' | 'zoneIds' | 'featureIds', string[]>
>;

/** rowId 在单次导入内唯一，作为提交时的选择键；sheetName + rowNumber 仅用于定位原文件。 */
export interface ImportPreviewRow extends ImportRowSource {
  rowId: number;
  code: string;
  name: string;
  status: 'valid' | 'duplicate' | 'unchanged' | 'error';
  reason?: string;
  data?: ImportRow;
  dictionaryLabels?: ImportDictionaryLabels;
  snapshotRevision?: number;
  /** 仅 duplicate / unchanged：当前方案是否已发布，以及文件相对当前方案变化与将清空的字段 */
  published?: boolean;
  changedFields?: ImportChangedField[];
  clearedFields?: ImportChangedField[];
}

export interface PreviewImportResult {
  importId: string;
  /** 预览失效时间（ISO 8601），过期后须重新上传预览。 */
  expiresAt: string;
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
  /** 与当前方案一致而未写入的重复行 */
  unchanged: number;
  dictionaryItemsCreated: number;
  failed: (ImportRowSource & { rowId: number; code: string; reason: string })[];
}
