import { requirementSchema } from '../selection/domain.js';
import { currencyScales, scopeCodes } from '../../projects/domain.js';

export const text = (maxLength: number, minLength = 0) => ({ type: 'string', minLength, maxLength, ...(minLength ? { pattern: '\\S' } : {}) });
export const keySchema = { type: 'string', minLength: 8, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' };
export const revisionSchema = { type: 'integer', minimum: 1 };
export const quoteSchema = { type: 'object', additionalProperties: false,
  required: ['requestKey','schemeCode','entryPoint','exhibition','scopeCodes','materialBudget','customerType','contact'], properties: {
    requestKey: keySchema, schemeCode: text(200,1), schemeRevision: revisionSchema, bomRevision: revisionSchema, drawingRevision: revisionSchema, artworkRevision: revisionSchema,
    artworkJobId: { type: 'string', format: 'uuid' },
    entryPoint: { type: 'string', enum: ['scheme_detail','bill_of_materials','theme_result','matching_results','su'] },
    exhibition: { type: 'object', additionalProperties: false, required: ['name','countryCode','city','startDate','endDate'], properties: {
      name: text(200,1), countryCode: { type: 'string', pattern: '^[A-Z]{2}$' }, city: text(100,1), startDate: { type: 'string', format: 'date' }, endDate: { type: 'string', format: 'date' },
    } },
    scopeCodes: { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: { type: 'string', enum: scopeCodes } }, scopeNotes: text(2000),
    materialBudget: { type: 'object', additionalProperties: false, required: ['currency','amount'], properties: {
      currency: { type: 'string', enum: Object.keys(currencyScales) }, amount: { type: 'string', pattern: '^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,6})?$' },
    } },
    customerType: { type: 'string', enum: ['individual','company'] }, company: text(200),
    contact: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: text(100,1), email: text(254), phone: text(30) } }, notes: text(2000),
    themeSelection: { type: 'object', additionalProperties: false, required: ['themeJobId','resultId','selectionRevision'], properties: {
      themeJobId: { type: 'string', format: 'uuid' }, resultId: { type: 'string', format: 'uuid' }, selectionRevision: revisionSchema,
    } },
    requirementContext: { type: 'object', additionalProperties: false, required: ['originalDescription','confirmedRequirements'], properties: {
      originalDescription: text(5000), confirmedRequirements: requirementSchema,
    } },
  } };
