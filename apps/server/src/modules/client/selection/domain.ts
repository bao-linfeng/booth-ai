export const sides = ['front', 'right', 'back', 'left'] as const;
export type Side = typeof sides[number];
export const rulesVersion = 'selection-2026-09-27-preview';

export interface Requirement {
  lengthMm: number | null;
  widthMm: number | null;
  maxHeightMm: number | null;
  areaM2: number | null;
  openingCount: number | null;
  openSides: Side[] | null;
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
  applicabilityAnswers: Record<string, boolean>;
}

export interface Option { id: string; label: string; }

export interface Catalog {
  dimensions: { lengthMm: number[]; widthMm: number[]; maxHeightMm: number[]; areaM2: number[]; };
  productSystems: Option[];
  styles: Option[];
  industries: Option[];
  budgetTiers: Option[];
  zones: Option[];
  features: Option[];
  applicabilityQuestions: { id: string; label: string; helpText: string; }[];
}

export interface Specifications {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  areaM2: number;
  openingCount: number;
  openSides: Side[];
  productSystemId: string;
  productSystemLabel: string;
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
  images: PublicImage[];
  styleId: string | null;
  industryIds: string[];
  budgetTierId: string | null;
  zoneIds: string[];
  featureIds: string[];
  keywords: string[];
  labelsConfirmed: boolean;
  applicabilityRules: { id: string; expectedValue: boolean; }[];
  applicabilityNotes: string;
}

export interface MatchItem {
  code: string;
  matchType: 'direct' | 'reference' | 'random';
  images: PublicImage[];
  specifications: Specifications;
  reasons: string[];
  differences: { field: string; requested: string; actual: string; reason: string; }[];
  pendingConfirmations: string[];
  preferenceMisses: string[];
}

export function emptyRequirement(): Requirement {
  return {
    lengthMm: null, widthMm: null, maxHeightMm: null, areaM2: null,
    openingCount: null, openSides: null, productSystemId: null,
    styleIds: [], industryIds: [], budgetTierId: null, zoneIds: [], featureIds: [], keywords: [],
    requiredZoneIds: [], requiredFeatureIds: [], excludedZoneIds: [], excludedFeatureIds: [],
    applicabilityAnswers: {}
  };
}

export function isEmpty(requirement: Requirement): boolean {
  return Object.values(requirement).every(value => value === null || (Array.isArray(value) ? value.length === 0 : typeof value === 'object' && Object.keys(value).length === 0));
}

export function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

export function validateRequirement(input: Requirement, catalog: Catalog): Requirement {
  const r = structuredClone(input);
  if (r.lengthMm && r.widthMm) {
    const area = r.lengthMm * r.widthMm / 1_000_000;
    if (r.areaM2 !== null && Math.abs(area - r.areaM2) > 0.0000001) invalid('Area conflicts with dimensions');
    r.areaM2 = area;
  }
  if (r.openSides && (!r.openingCount || r.openSides.length !== r.openingCount)) invalid('Opening directions conflict with count');
  
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
  
  for (const id of Object.keys(r.applicabilityAnswers)) {
    if (!catalog.applicabilityQuestions.some(question => question.id === id)) invalid('Unknown applicability question');
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
    lengthMm: nullableDimension,
    widthMm: nullableDimension,
    maxHeightMm: nullableDimension,
    areaM2: { anyOf: [{ type: 'number', exclusiveMinimum: 0, maximum: 1_000_000, multipleOf: 0.000001 }, { type: 'null' }] },
    openingCount: { anyOf: [{ type: 'integer', minimum: 1, maximum: 4 }, { type: 'null' }] },
    openSides: { anyOf: [{ type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'string', enum: sides } }, { type: 'null' }] },
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
    applicabilityAnswers: { type: 'object', maxProperties: 50, propertyNames: { pattern: '^[a-zA-Z0-9_-]{1,100}$' }, additionalProperties: { type: 'boolean' } },
  },
};
