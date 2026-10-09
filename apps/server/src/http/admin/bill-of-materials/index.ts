import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { createStorage } from '../../../infra/storage.js';
import { adminUserId } from '../../authentication.js';
import { readUploadedFile, workbookUploadMaxBytes } from '../../uploads.js';
import type { Config } from '../../../config.js';
import { bomError } from '../../../modules/schemes/bill-of-materials/errors.js';
import { assertImportBaseline, createBomImport, createOrReplaceBomFromImport } from '../../../modules/schemes/bill-of-materials/imports.js';
import { deleteBom, deleteBomItem, updateBomItems } from '../../../modules/schemes/bill-of-materials/items.js';
import { getBom, listBoms } from '../../../modules/schemes/bill-of-materials/repository.js';
import type { BomItemInput, BomVerificationInput } from '../../../modules/schemes/bill-of-materials/types.js';
import { submitBomVerification } from '../../../modules/schemes/bill-of-materials/verification.js';
import { exportBomWorkbook, parseBomWorkbook } from '../../../modules/schemes/bill-of-materials/workbook.js';

interface CodeParams { code: string }
interface ImportParams extends CodeParams { importId: string }
interface ItemParams extends CodeParams { itemId: string }
interface CommitBody { expectedRevision: number }
interface ItemsBody { expectedRevision: number; changeReason: string; items: BomItemInput[] }
const params = { type:'object',required:['code'],properties:{ code:{type:'string',minLength:1} } };
const withImport = { type:'object',required:['code','importId'],properties:{code:{type:'string',minLength:1},importId:{type:'string',format:'uuid'}} };
const withItem = { type:'object',required:['code','itemId'],properties:{code:{type:'string',minLength:1},itemId:{type:'string',format:'uuid'}} };
const decimal = {type:'string',pattern:'^(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,6})?$'};
const reason = {type:'string',minLength:1,maxLength:1000};
const revision = {type:'integer',minimum:1};
const itemSchema = { type:'object',required:['productName','sourceQuantity','sourceUnit','measurementKind'],additionalProperties:false,properties:{
  id:{type:'string',format:'uuid'},productName:{type:'string',minLength:1,maxLength:500},productModel:{type:['string','null']},specificationMm:{type:['string','null']},sourceQuantity:decimal,sourceUnit:{type:'string',minLength:1},measurementKind:{type:'string',enum:['count','length','area']},erpCode:{type:['string','null']},unitPrice:{...decimal,type:['string','null']},totalPrice:{...decimal,type:['string','null']},totalWeightKg:{...decimal,type:['string','null']},diffNote:{type:['string','null']},sourceSheet:{type:['string','null']},sourceRow:{type:['integer','null'],minimum:1},
} };
function code(request: FastifyRequest): string { try { return decodeURIComponent((request.params as CodeParams).code); } catch { throw bomError('INVALID_INPUT',400); } }
function integer(value: unknown): number { const parsed = typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : NaN; if (!Number.isSafeInteger(parsed)) throw bomError('INVALID_INPUT',400); return parsed; }
export async function registerAdminBomRoutes(app: FastifyInstance, pool: pg.Pool, storage: ReturnType<typeof createStorage>, redis: Redis, config: Config): Promise<void> {
  app.get('/bill-of-materials',{schema:{tags:['admin-bill-of-materials'],querystring:{type:'object',additionalProperties:false,properties:{code:{type:'string'},page:{type:'integer',minimum:1,default:1},pageSize:{type:'integer',minimum:1,maximum:100,default:20}}}}},async request => {
    const query=request.query as {code?:string;page:number;pageSize:number};
    return {code:0,data:await listBoms(pool,query)};
  });
  app.post('/schemes/:code/bill-of-materials/imports',{ schema:{tags:['admin-bill-of-materials'],params} },async (request,reply) => {
    let file: Buffer | undefined; let filename = ''; let mime = ''; let expected: number | undefined;
    for await (const part of request.parts({ limits: { fileSize: workbookUploadMaxBytes } })) {
      if (part.type === 'file') {
        if (file || part.fieldname !== 'file') throw bomError('INVALID_INPUT',400);
        filename = basename(part.filename.replaceAll('\\','/')).replace(/[\x00-\x1f\x7f]/g,''); mime = part.mimetype.toLowerCase();
        file = await readUploadedFile(part);
      } else if (part.fieldname === 'expectedRevision' && expected === undefined) expected = integer(part.value);
      else throw bomError('INVALID_INPUT',400);
    }
    if (!file || expected === undefined) throw bomError('INVALID_INPUT',400);
    if (!/\.xls[xm]$/i.test(filename) || !['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel.sheet.macroenabled.12','application/octet-stream'].includes(mime) || file.subarray(0,4).toString('hex') !== '504b0304') throw bomError('INVALID_WORKBOOK',415);
    const schemeCode = code(request);
    await assertImportBaseline(pool,schemeCode,expected);
    const parsed = await parseBomWorkbook(file,schemeCode);
    const objectKey = `schemes/${encodeURIComponent(schemeCode)}/bom-imports/${randomUUID()}_${filename}`;
    await storage.putBuffer(objectKey,file,mime);
    try {
      const imported = await createBomImport(pool,adminUserId(request),schemeCode,filename,createHash('sha256').update(file).digest('hex'),objectKey,file.length,expected,parsed);
      return reply.code(201).send({code:0,data:{importId:imported.id,schemeCode,baseRevision:imported.baseRevision,mappingRevision:imported.mappingRevision,expiresAt:imported.expiresAt,status:imported.status,sourceFileName:filename,sourceHash:imported.sourceHash,canCommit:imported.canCommit,items:parsed.items.map((item,index)=>({ ...item,ordinal:index+1 })),errors:parsed.errors,warnings:parsed.warnings}});
    } catch (error) { await storage.deleteObject(objectKey).catch(() => {}); throw error; }
  });
  app.post('/schemes/:code/bill-of-materials/imports/:importId/commit',{schema:{tags:['admin-bill-of-materials'],params:withImport,body:{type:'object',required:['expectedRevision'],additionalProperties:false,properties:{expectedRevision:{type:'integer',minimum:0}}}}},async request => {
    const body=request.body as CommitBody;
    return {code:0,data:await createOrReplaceBomFromImport(pool,adminUserId(request),code(request),(request.params as ImportParams).importId,body.expectedRevision)};
  });
  app.get('/schemes/:code/bill-of-materials',{schema:{tags:['admin-bill-of-materials'],params}},async request => ({code:0,data:await getBom(pool,code(request)) ?? {schemeCode:code(request),revision:0,status:'absent',items:[]}}));
  app.delete('/schemes/:code/bill-of-materials',{schema:{tags:['admin-bill-of-materials'],params,querystring:{type:'object',required:['expectedRevision'],additionalProperties:false,properties:{expectedRevision:revision}}}},async request => {
    await deleteBom(pool,adminUserId(request),code(request),(request.query as {expectedRevision:number}).expectedRevision);
    return {code:0,data:null};
  });
  app.put('/schemes/:code/bill-of-materials/items',{schema:{tags:['admin-bill-of-materials'],params,body:{type:'object',required:['expectedRevision','changeReason','items'],additionalProperties:false,properties:{expectedRevision:revision,changeReason:reason,items:{type:'array',minItems:1,maxItems:10000,items:itemSchema}}}}},async request => {
    const body=request.body as ItemsBody; return {code:0,data:await updateBomItems(pool,adminUserId(request),code(request),body.expectedRevision,body.changeReason,body.items)};
  });
  app.delete('/schemes/:code/bill-of-materials/items/:itemId',{schema:{tags:['admin-bill-of-materials'],params:withItem,querystring:{type:'object',required:['expectedRevision'],additionalProperties:false,properties:{expectedRevision:revision}}}},async request => {
    return {code:0,data:await deleteBomItem(pool,adminUserId(request),code(request),(request.params as ItemParams).itemId,(request.query as {expectedRevision:number}).expectedRevision)};
  });
  app.post('/schemes/:code/bill-of-materials/verifications',{schema:{tags:['admin-bill-of-materials'],params,body:{type:'object',required:['requestKey','expectedRevision','decision'],additionalProperties:false,properties:{requestKey:{type:'string',minLength:1,maxLength:200},expectedRevision:revision,decision:{type:'string',enum:['pass','reject']},notes:{type:'string',maxLength:1000}}}}},async (request,reply) => {
    const {replayed,...result}=await submitBomVerification(pool,adminUserId(request),code(request),request.body as BomVerificationInput);
    return reply.code(replayed?200:201).send({code:0,data:result});
  });
  app.get('/schemes/:code/bill-of-materials/download',{schema:{tags:['admin-bill-of-materials'],params,querystring:{type:'object',required:['revision'],additionalProperties:false,properties:{revision}}}},async (request,reply) => {
    const schemeCode=code(request); const requested=(request.query as {revision:number}).revision;
    const bom=await getBom(pool,schemeCode);
    if (!bom || bom.status !== 'verified') throw bomError('BOM_NOT_AVAILABLE',409);
    if (bom.revision !== requested) throw bomError('BOM_REVISION_CHANGED',409);
    const file=await exportBomWorkbook(bom,schemeCode);
    const current=await getBom(pool,schemeCode);
    if (current?.revision !== requested || current.status !== 'verified') throw bomError('BOM_REVISION_CHANGED',409);
    const name=encodeURIComponent(`${schemeCode.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_')}@简化清单.xlsx`);
    return reply.header('Cache-Control','private, no-store').header('Content-Disposition',`attachment; filename*=UTF-8''${name}`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(file);
  });
}
