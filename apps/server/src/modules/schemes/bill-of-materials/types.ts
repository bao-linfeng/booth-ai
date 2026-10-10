import type pg from 'pg';

export type BomStatus = 'pending_verification' | 'verified' | 'rejected';
export type MeasurementKind = 'count' | 'length' | 'area';
export type ImportStatus = 'ready' | 'invalid' | 'committed' | 'expired';
export type DbClient = pg.Pool | pg.PoolClient;

export interface BomItem {
  id: string;
  bomId: string;
  ordinal: number;
  productName: string;
  productModel: string | null;
  specificationMm: string | null;
  sourceQuantity: string;
  sourceUnit: string;
  measurementKind: MeasurementKind;
  quantity: string;
  erpCode: string | null;
  unitPrice: string | null;
  totalPrice: string | null;
  totalWeightKg: string | null;
  sourceSheet: string | null;
  sourceRow: number | null;
  diffNote: string | null;
}

export interface BomRecord {
  id: string;
  schemeId: string;
  revision: number;
  status: BomStatus;
  sourceAssetId: string | null;
  contentHash: string | null;
  verifiedAt: string | null;
  items: BomItem[];
  createdAt: string;
  updatedAt: string;
}

export interface BomItemInput {
  id?: string;
  productName: string;
  productModel?: string | null;
  specificationMm?: string | null;
  sourceQuantity: string;
  sourceUnit: string;
  measurementKind: MeasurementKind;
  erpCode?: string | null;
  unitPrice?: string | null;
  totalPrice?: string | null;
  totalWeightKg?: string | null;
  sourceSheet?: string | null;
  sourceRow?: number | null;
  diffNote?: string | null;
}

export interface ImportIssue {
  code: string;
  sheet?: string;
  row?: number;
  field?: string;
  message: string;
}
export interface ParsedBom {
  items: BomItemInput[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

export interface BomVerificationInput {
  requestKey: string;
  expectedRevision: number;
  decision: 'pass' | 'reject';
  notes?: string;
}

export interface CommitResult {
  schemeCode: string;
  revision: number;
  status: BomStatus;
  itemCount: number;
  unpublished: boolean;
}

export interface BomImportRecord {
  id: string;
  schemeId: string;
  sourceHash: string;
  sourceFilename: string;
  sourceObjectKey: string | null;
  sourceByteSize: number | null;
  baseRevision: number;
  mappingRevision: number;
  preview: ParsedBom;
  errors: ParsedBom['errors'];
  warnings: ParsedBom['warnings'];
  canCommit: boolean;
  status: ImportStatus;
  committedRevision: number | null;
  commitRequestHash: string | null;
  committedResult: CommitResult | null;
  expiresAt: string;
}

export interface SchemeRow {
  id: string;
  publishStatus: string;
}
