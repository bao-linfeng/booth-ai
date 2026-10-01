import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { createStorage } from '../../../infra/storage.js';
import { getSession } from '../../../infra/session.js';
import { requireProjectUser } from '../quote-requests/index.js';
import { getProject,listProjects,type ProjectRecord,type ProjectQuery } from '../../projects/repository.js';
import { projectParams,queryProperties } from '../../admin/projects/schema.js';
import { bindProjectArtworks, type BindArtworkInput } from '../../projects/artwork-delivery.js';
import { listUserSearches } from '../../selection-analytics/service.js';
import { listSearchJobs } from './search-jobs.js';

async function requireClientSession(authorization: string | undefined, redis: Redis): Promise<string> {
  const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim();
  const session = token ? await getSession(redis, token, 'client') : null;
  if (!session) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  return session.localId;
}

type SearchSnapshotItem = {
  code?: unknown;
  matchType?: unknown;
  specifications?: unknown;
  images?: unknown;
};

function asSnapshotItems(snapshot: unknown): SearchSnapshotItem[] {
  return Array.isArray(snapshot) ? snapshot.filter((item): item is SearchSnapshotItem => Boolean(item && typeof item === 'object')) : [];
}

function getFirstImageAssetId(item: SearchSnapshotItem): string | null {
  if (!Array.isArray(item.images)) return null;
  const image = item.images
    .map((image, index) => ({ image, index }))
    .filter((entry): entry is { image: Record<string, unknown>; index: number } => Boolean(entry.image && typeof entry.image === 'object'))
    .sort((left, right) => {
      const leftOrder = typeof left.image.order === 'number' ? left.image.order : left.index;
      const rightOrder = typeof right.image.order === 'number' ? right.image.order : right.index;
      return leftOrder - rightOrder;
    })[0]?.image;
  return typeof image?.assetId === 'string' ? image.assetId : null;
}

export function publicProject(project:ProjectRecord) {
  const request=project.request;
  const snapshot=project.schemeSnapshot;
  return {projectId:project.projectId,projectNo:project.projectNo,requestNo:project.requestNo,sourceType:project.sourceType,status:project.status,revision:project.revision,schemeCode:project.schemeCode,
    request:{exhibition:request.exhibition ?? null,contact:{name:request.contact.name,email:request.contact.email,phone:request.contact.phone,legacyDetail:request.contact.legacyDetail},
      company:request.company,customerType:request.customerType,scopeCodes:request.scopeCodes ?? [],scopeNotes:request.scopeNotes,materialBudget:request.materialBudget ?? null,
      notes:request.notes,originalDescription:request.originalDescription ?? request.requirementContext?.originalDescription,
      confirmedRequirements:request.confirmedRequirements ?? request.requirementContext?.confirmedRequirements,unresolvedQuestions:request.unresolvedQuestions ?? [],legacyIncomplete:request.legacyIncomplete ?? false},
    schemeSnapshot:snapshot?{code:snapshot.code,name:snapshot.name,revision:snapshot.revision,lengthMm:snapshot.lengthMm,widthMm:snapshot.widthMm,heightMm:snapshot.heightMm,openingCount:snapshot.openingCount}:null,
    materialsStatus:{bom:project.materials.bom?.status ?? 'missing',drawings:project.materials.drawings?.status ?? 'missing',artworks:project.materials.artworks?.status ?? 'missing'},
    artworkJobId:project.materials.artworks?.artworkJobId ?? null,
    selectedThemeSummary:snapshot?.selectedTheme?{themeJobId:snapshot.selectedTheme.themeJobId,resultId:snapshot.selectedTheme.resultId,selectionRevision:snapshot.selectedTheme.selectionRevision}:null,
    publicResult:project.publicResult,createdAt:project.createdAt,updatedAt:project.updatedAt};
}
export async function registerClientProjectRoutes(app:FastifyInstance,pool:pg.Pool,redis:Redis,storage:ReturnType<typeof createStorage>) {
  app.put<{Params:{projectId:string};Body:BindArtworkInput}>('/me/projects/:projectId/artworks',{schema:{params:projectParams,body:{type:'object',additionalProperties:false,
    required:['artworkJobId','requestKey','expectedRevision'],properties:{artworkJobId:{type:'string',format:'uuid'},requestKey:{type:'string',format:'uuid'},expectedRevision:{type:'integer',minimum:1}}}}},async(request,reply)=>{
    reply.header('Cache-Control','private, no-store');
    return {code:0,data:await bindProjectArtworks(pool,await requireProjectUser(request.headers.authorization,pool,redis),request.params.projectId,request.body)};
  });
  app.get<{Querystring:ProjectQuery}>('/me/projects',{schema:{querystring:{type:'object',additionalProperties:false,properties:queryProperties}}},async(request,reply)=>{
    reply.header('Cache-Control','private, no-store');
    const userId=await requireProjectUser(request.headers.authorization,pool,redis);
    const result=await listProjects(pool,request.query,userId);
    return {code:0,data:{...result,items:result.items.map(project=>({projectId:project.projectId,projectNo:project.projectNo,schemeCode:project.schemeCode,sourceType:project.sourceType,
       exhibition:project.request.exhibition ?? null,status:project.status,createdAt:project.createdAt,updatedAt:project.updatedAt}))}};
  });
  app.get<{Querystring:{page?:number;pageSize?:number}}>('/me/searches',{schema:{querystring:{type:'object',additionalProperties:false,properties:{
    page:{type:'integer',minimum:1,default:1},pageSize:{type:'integer',minimum:1,maximum:50,default:20},
  }}}},async(request,reply)=>{
    reply.header('Cache-Control','private, no-store');
    const userId=await requireClientSession(request.headers.authorization,redis);
    const page=request.query.page ?? 1;
    const pageSize=request.query.pageSize ?? 20;
    const result=await listUserSearches(pool,userId,{page,pageSize});
    const snapshotItems=result.data.flatMap(search=>asSnapshotItems(search.resultSnapshot));
    const jobs=await listSearchJobs(pool,storage,userId,result.data.map(search=>search.id));
    const assetIds=[...new Set(snapshotItems.map(getFirstImageAssetId).filter((assetId): assetId is string=>Boolean(assetId)))];
    const versions=assetIds.length===0?[]:(await pool.query<{assetId:string;objectKey:string}>(
      `SELECT DISTINCT ON (v.asset_id) v.asset_id::text AS "assetId",v.object_key AS "objectKey"
       FROM asset_versions v
       WHERE v.asset_id::text = ANY($1::text[])
       ORDER BY v.asset_id,v.created_at DESC,v.id DESC`,
      [assetIds],
    )).rows;
    const signedUrls=new Map(await Promise.all(versions.map(async version=>[version.assetId,await storage.signDownload(version.objectKey,270)] as const)));

    return {code:0,data:{
      items:result.data.map(search=>({
        id:search.id,status:search.status,mode:search.mode,inputText:search.inputText,finalRequirement:search.finalRequirement,
        counts:{direct:search.directCount,reference:search.referenceCount,random:search.randomCount,total:search.resultCount},
        items:asSnapshotItems(search.resultSnapshot).map(item=>({
          code:item.code,matchType:item.matchType,specifications:item.specifications,thumbnail:signedUrls.get(getFirstImageAssetId(item) ?? '') ?? '',
          theme:typeof item.code==='string'?jobs.get(search.id)?.get(item.code)?.theme ?? null:null,
          artwork:typeof item.code==='string'?jobs.get(search.id)?.get(item.code)?.artwork ?? null:null,
        })),
        createdAt:search.createdAt,
      })),
      total:result.total,page:result.page,pageSize:result.pageSize,
    }};
  });
  app.get<{Params:{projectId:string}}>('/me/projects/:projectId',{schema:{params:projectParams}},async(request,reply)=>{
    reply.header('Cache-Control','private, no-store');
    const userId=await requireProjectUser(request.headers.authorization,pool,redis);
    const project=await getProject(pool,request.params.projectId,userId);
    const data=publicProject(project);
    const theme=project.schemeSnapshot?.selectedTheme;
    return {code:0,data:{...data,selectedThemeSummary:theme?{...data.selectedThemeSummary,previewUrl:await storage.signDownload(theme.asset.objectKey,300)}:null}};
  });
}
