import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { createStorage } from '../../../infra/storage.js';
import { adminUserId } from '../../authentication.js';
import { assignProject,followUpProject,linkProjectScheme,quotationRevision,saveQuotation,type AssignmentInput,type FollowUpInput,type SchemeLinkInput } from '../../../modules/projects/admin-service.js';
import { getProject,listProjects,projectEvents,type ProjectQuery } from '../../../modules/projects/repository.js';
import { quotationWorkbook } from '../../../modules/projects/quotation-workbook.js';
import { projectError } from '../../../modules/projects/domain.js';
import type { QuotationInput } from '../../../modules/projects/quotation.js';
import { assignmentSchema,followUpSchema,linkSchema,projectParams,queryProperties,quotationSchema,uuid } from '../../../modules/projects/schema.js';

export async function registerAdminProjectRoutes(app:FastifyInstance,pool:pg.Pool,redis:Redis,storage:ReturnType<typeof createStorage>) {
  await app.register(async routes=>{
    routes.addHook('onRequest',async(request,reply)=>{reply.header('Cache-Control','private, no-store');adminUserId(request);});
    routes.get('/project-assignees',async()=>({code:0,data:(await pool.query("SELECT id,coalesce(nickname,username) AS name FROM admins WHERE enabled AND ('ROLE_ADMIN'=ANY(roles) OR EXISTS (SELECT 1 FROM admin_roles r WHERE r.active AND r.name=ANY(admins.roles) AND 'projects.write'=ANY(r.permission_codes))) ORDER BY username,id")).rows}));
    routes.get<{Querystring:ProjectQuery}>('/projects',{schema:{querystring:{type:'object',additionalProperties:false,properties:{...queryProperties,city:{type:'string',maxLength:100},customerName:{type:'string',maxLength:200},customerUserId:uuid,assigneeAdminId:uuid,
      exhibitionStartFrom:{type:'string',format:'date'},exhibitionStartTo:{type:'string',format:'date'}}}}},async request=>({code:0,data:await listProjects(pool,request.query)}));
    routes.get<{Params:{projectId:string}}>('/projects/:projectId',{schema:{params:projectParams}},async request=>{
      const project=await getProject(pool,request.params.projectId);return {code:0,data:{...project,events:await projectEvents(pool,project.projectId),quotation:await quotationRevision(pool,project.projectId)}};
    });
    routes.get<{Params:{projectId:string};Querystring:{page:number;pageSize:number}}>('/projects/:projectId/events',{schema:{params:projectParams,querystring:{type:'object',additionalProperties:false,properties:{page:queryProperties.page,pageSize:queryProperties.pageSize}}}},async request=>{
      await getProject(pool,request.params.projectId);return {code:0,data:await projectEvents(pool,request.params.projectId,request.query.page,request.query.pageSize)};
    });
    routes.put<{Params:{projectId:string};Body:AssignmentInput}>('/projects/:projectId/assignee',{schema:{params:projectParams,body:assignmentSchema}},async request=>({code:0,data:await assignProject(pool,request.params.projectId,adminUserId(request),request.body)}));
    routes.post<{Params:{projectId:string};Body:FollowUpInput}>('/projects/:projectId/follow-ups',{schema:{params:projectParams,body:followUpSchema}},async request=>({code:0,data:await followUpProject(pool,request.params.projectId,adminUserId(request),request.body)}));
    routes.put<{Params:{projectId:string};Body:SchemeLinkInput}>('/projects/:projectId/scheme',{schema:{params:projectParams,body:linkSchema}},async request=>({code:0,data:await linkProjectScheme(pool,request.params.projectId,adminUserId(request),request.body)}));
    routes.get<{Params:{projectId:string};Querystring:{revision?:number}}>('/projects/:projectId/quotation',{schema:{params:projectParams,querystring:{type:'object',additionalProperties:false,properties:{revision:{type:'integer',minimum:1}}}}},async request=>{
      const project=await getProject(pool,request.params.projectId);return {code:0,data:{projectId:project.projectId,projectRevision:project.revision,quotation:await quotationRevision(pool,project.projectId,request.query.revision)}};
    });
    routes.put<{Params:{projectId:string};Body:QuotationInput}>('/projects/:projectId/quotation',{bodyLimit:32*1024*1024,schema:{params:projectParams,body:quotationSchema}},async request=>({code:0,data:await saveQuotation(pool,request.params.projectId,adminUserId(request),request.body)}));
    routes.get<{Params:{projectId:string};Querystring:{revision:number}}>('/projects/:projectId/quotation/download',{schema:{params:projectParams,querystring:{type:'object',additionalProperties:false,required:['revision'],properties:{revision:{type:'integer',minimum:1}}}}},async(request,reply)=>{
      const project=await getProject(pool,request.params.projectId);const quotation=await quotationRevision(pool,project.projectId,request.query.revision);
      if(!quotation)throw projectError('RESOURCE_NOT_FOUND',404);
      const buffer=await quotationWorkbook({projectNo:project.projectNo,schemeCode:project.schemeCode,contact:project.request.contact,company:project.request.company},quotation);
      return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition',`attachment; filename="${project.projectNo}-quotation-r${quotation.revision}.xlsx"`).send(buffer);
    });
    routes.get<{Params:{projectId:string;versionId:string}}>('/projects/:projectId/assets/:versionId/download',{schema:{params:{...projectParams,required:['projectId','versionId'],properties:{...projectParams.properties,versionId:uuid}}}},async request=>{
      await getProject(pool,request.params.projectId);
      const asset=(await pool.query<{objectKey:string;filename:string}>(`SELECT v.object_key AS "objectKey",v.original_filename AS filename FROM project_asset_versions p JOIN asset_versions v ON v.id=p.asset_version_id WHERE p.project_id=$1 AND v.id=$2`,[request.params.projectId,request.params.versionId])).rows[0];
      if(!asset)throw projectError('RESOURCE_NOT_FOUND',404);
      return {code:0,data:{filename:asset.filename,downloadUrl:await storage.signDownloadWithName(asset.objectKey,asset.filename,300)}};
    });
  });
}
