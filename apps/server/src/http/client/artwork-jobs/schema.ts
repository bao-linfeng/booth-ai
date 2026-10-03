const uuid = { type: 'string', format: 'uuid' };
const contextProperties = { schemeCode: { type: 'string', minLength: 1, maxLength: 200 }, themeJobId: uuid, resultId: uuid, selectionRevision: { type: 'integer', minimum: 1 } };
const contextRequired = ['schemeCode', 'themeJobId', 'resultId', 'selectionRevision'];
const contextSchema = { type: 'object', additionalProperties: false, required: contextRequired, properties: contextProperties };
const jobParams = { type: 'object', required: ['jobId'], properties: { jobId: uuid } };

export const artworkJobSchema = { params: jobParams };
export const artworkEventsSchema = {
  params: jobParams,
  querystring: { type: 'object', additionalProperties: false, required: ['ticket'], properties: { ticket: uuid } },
};
export const artworkOfferSchema = { body: contextSchema };
export const artworkSubmissionSchema = { body: {
  type: 'object', additionalProperties: false, required: [...contextRequired, 'requestKey', 'offerId'],
  properties: { ...contextProperties, requestKey: uuid, offerId: uuid },
} };
export const artworkListSchema = { querystring: contextSchema };
export const artworkAssetSchema = { params: {
  type: 'object', required: ['jobId', 'assetId'], properties: { jobId: uuid, assetId: uuid },
} };
