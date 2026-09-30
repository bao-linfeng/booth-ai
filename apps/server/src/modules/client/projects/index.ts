import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { createStorage } from '../../../infra/storage.js';
import { requireProjectUser } from '../quote-requests/index.js';
import { getProject,listProjects,type ProjectRecord,type ProjectQuery } from '../../projects/repository.js';
import { projectParams,queryProperties } from '../../admin/projects/schema.js';

export function publicProject(project:ProjectRecord) {
  const request=project.request;
  const snapshot=project.schemeSnapshot;
  return {projectId:project.projectId,projectNo:project.projectNo,requestNo:project.requestNo,sourceType:project.sourceType,status:project.status,schemeCode:project.schemeCode,
    request:{exhibition:request.exhibition ?? null,contact:{name:request.contact.name,email:request.contact.email,phone:request.contact.phone,legacyDetail:request.contact.legacyDetail},
      company:request.company,customerType:request.customerType,scopeCodes:request.scopeCodes ?? [],scopeNotes:request.scopeNotes,materialBudget:request.materialBudget ?? null,
      notes:request.notes,originalDescription:request.originalDescription ?? request.requirementContext?.originalDescription,
      confirmedRequirements:request.confirmedRequirements ?? request.requirementContext?.confirmedRequirements,unresolvedQuestions:request.unresolvedQuestions ?? [],legacyIncomplete:request.legacyIncomplete ?? false},
    schemeSnapshot:snapshot?{code:snapshot.code,name:snapshot.name,revision:snapshot.revision,lengthMm:snapshot.lengthMm,widthMm:snapshot.widthMm,heightMm:snapshot.heightMm,openingCount:snapshot.openingCount}:null,
    materialsStatus:{bom:project.materials.bom?.status ?? 'missing',drawings:project.materials.drawings?.status ?? 'missing',artworks:project.materials.artworks?.status ?? 'missing'},
    selectedThemeSummary:snapshot?.selectedTheme?{resultId:snapshot.selectedTheme.resultId,selectionRevision:snapshot.selectedTheme.selectionRevision}:null,
    publicResult:project.publicResult,createdAt:project.createdAt,updatedAt:project.updatedAt};
}
export async function registerClientProjectRoutes(app:FastifyInstance,pool:pg.Pool,redis:Redis,storage:ReturnType<typeof createStorage>) {
  app.get<{Querystring:ProjectQuery}>('/me/projects',{schema:{querystring:{type:'object',additionalProperties:false,properties:queryProperties}}},async(request,reply)=>{
    reply.header('Cache-Control','private, no-store');
    const userId=await requireProjectUser(request.headers.authorization,pool,redis);
    const result=await listProjects(pool,request.query,userId);
    return {code:0,data:{...result,items:result.items.map(project=>({projectId:project.projectId,projectNo:project.projectNo,schemeCode:project.schemeCode,sourceType:project.sourceType,
      exhibition:project.request.exhibition ?? null,status:project.status,createdAt:project.createdAt,updatedAt:project.updatedAt}))}};
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
