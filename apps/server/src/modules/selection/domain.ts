export const rulesVersion = 'selection-2026-10-06';

export interface MatchDiagnostics {
  reviewedPublished: number;
  ready: number;
  exclusions: {
    unverifiedChecklist: number;
    incompleteAssets: number;
    invalidData: number;
    productSystem: number;
    height: number;
    tags: number;
    dimensions: number;
  };
}

export interface Requirement {
  boothSpaceId: string | null;
  lengthMm: number | null;
  widthMm: number | null;
  maxHeightMm: number | null;
  areaM2: number | null;
  openingCount: number | null;
  productSystemId: string | null;
  styleIds: string[];
  industryIds: string[];
  budgetTierId: string | null;
  zoneIds: string[];
  featureIds: string[];
  keywords: string[];
  requiredZoneIds: string[];
  requiredFeatureIds: string[];
  excludedZoneIds: string[];
  excludedFeatureIds: string[];
}

export interface Option { id: string; label: string; value?: string; labels?: Record<string, string>; aliases?: { locale: string; text: string }[]; }
export interface BoothSpace { id: string; label: string; lengthMm: number; widthMm: number; heightMm: number; }

export interface Catalog {
  boothSpaces: BoothSpace[];
  openingCounts: Option[];
  productSystems: Option[];
  styles: Option[];
  industries: Option[];
  budgetTiers: Option[];
  zones: Option[];
  features: Option[];
}

export interface Specifications {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  areaM2: number;
  openingCount: number;
  productSystemId: string;
  productSystemLabel: string;
}

/** Unsigned rendering reference; URLs are signed only for the items actually returned. */
export interface CandidateImage {
  assetId: string;
  objectKey: string;
  order: number;
  width: number;
  height: number;
}

export interface PublicImage {
  assetId: string;
  url: string;
  thumbnailUrl: string;
  order: number;
  width: number;
  height: number;
}

export interface Candidate {
  code: string;
  specifications: Specifications;
  images: CandidateImage[];
  styleId: string | null;
  industryIds: string[];
  budgetTierId: string | null;
  zoneIds: string[];
  featureIds: string[];
  keywords: string[];
  description: string;
}

export interface PendingConfirmation {
  type: 'missing_field';
  field?: string;
  message: string;
}

export interface MatchItem<Image = CandidateImage> {
  code: string;
  matchType: 'direct' | 'reference' | 'random';
  images: Image[];
  specifications: Specifications;
  reasons: string[];
  differences: { field: string; requested: string; actual: string; reason: string; }[];
  pendingConfirmations: PendingConfirmation[];
  preferenceMisses: string[];
}

export function emptyRequirement(): Requirement {
  return {
    boothSpaceId: null,
    lengthMm: null, widthMm: null, maxHeightMm: null, areaM2: null,
    openingCount: null, productSystemId: null,
    styleIds: [], industryIds: [], budgetTierId: null, zoneIds: [], featureIds: [], keywords: [],
    requiredZoneIds: [], requiredFeatureIds: [], excludedZoneIds: [], excludedFeatureIds: []
  };
}

export function isEmpty(requirement: Requirement): boolean {
  return Object.values(requirement).every(value => value === null || (Array.isArray(value) && value.length === 0));
}

export function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

export function validateRequirement(input: Requirement, catalog: Catalog): Requirement {
  const r = structuredClone(input);
  if (r.boothSpaceId !== null) {
    const size = catalog.boothSpaces.find(space => space.id === r.boothSpaceId);
    if (!size) invalid('Unknown booth size');
    if ((r.lengthMm !== null && r.lengthMm !== size.lengthMm) || (r.widthMm !== null && r.widthMm !== size.widthMm)) invalid('Selected size conflicts with dimensions');
    r.lengthMm = size.lengthMm;
    r.widthMm = size.widthMm;
  }
  if (r.lengthMm && r.widthMm) {
    const area = r.lengthMm * r.widthMm / 1_000_000;
    if (r.areaM2 !== null && Math.abs(area - r.areaM2) > 0.0000001) invalid('Area conflicts with dimensions');
    r.areaM2 = area;
  }
  if (r.openingCount !== null && !catalog.openingCounts.some(option => option.id === String(r.openingCount))) invalid('Unknown catalog option');
  
  const groups = [
    [r.productSystemId ? [r.productSystemId] : [], catalog.productSystems],
    [r.styleIds, catalog.styles],
    [r.industryIds, catalog.industries],
    [r.budgetTierId ? [r.budgetTierId] : [], catalog.budgetTiers],
    [[...r.zoneIds, ...r.requiredZoneIds, ...r.excludedZoneIds], catalog.zones],
    [[...r.featureIds, ...r.requiredFeatureIds, ...r.excludedFeatureIds], catalog.features],
  ] as const;
  
  for (const [ids, options] of groups) {
    if (ids.some(id => !options.some(option => option.id === id))) invalid('Unknown catalog option');
  }
  
  if (r.requiredZoneIds.some(id => r.excludedZoneIds.includes(id)) || r.requiredFeatureIds.some(id => r.excludedFeatureIds.includes(id))) {
    invalid('Contradictory required and excluded tags');
  }
  
  return r;
}

const nullableDimension = { anyOf: [{ type: 'integer', minimum: 1, maximum: 1_000_000 }, { type: 'null' }] };
const id = { type: 'string', minLength: 1, maxLength: 100 };
const ids = { type: 'array', maxItems: 50, uniqueItems: true, items: id };
const nullableId = { anyOf: [id, { type: 'null' }] };

export const requirementSchema = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(emptyRequirement()),
  properties: {
    boothSpaceId: nullableId,
    lengthMm: nullableDimension,
    widthMm: nullableDimension,
    maxHeightMm: nullableDimension,
    areaM2: { anyOf: [{ type: 'number', exclusiveMinimum: 0, maximum: 1_000_000, multipleOf: 0.000001 }, { type: 'null' }] },
    openingCount: { anyOf: [{ type: 'integer', minimum: 1, maximum: 4 }, { type: 'null' }] },
    productSystemId: nullableId,
    styleIds: ids,
    industryIds: ids,
    budgetTierId: nullableId,
    zoneIds: ids,
    featureIds: ids,
    keywords: ids,
    requiredZoneIds: ids,
    requiredFeatureIds: ids,
    excludedZoneIds: ids,
    excludedFeatureIds: ids,
  },
};
