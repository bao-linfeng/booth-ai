import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { createStorage } from '../../../infra/storage.js';
import { adminUserId } from '../../authentication.js';
import {
  assignProject, followUpProject, linkProjectScheme, quotationRevision, saveQuotation, saveAssignmentConfig, statusTransitions,
  type AssignmentInput, type FollowUpInput, type SchemeLinkInput, type AssignmentConfigInput,
} from '../../../modules/projects/admin-service.js';
import { findProjectAssetVersion, getProject, listProjects, projectEvents, requirementOptionLabels, type ProjectQuery } from '../../../modules/projects/repository.js';
import { quotationWorkbook } from '../../../modules/projects/quotation-workbook.js';
import { projectError } from '../../../modules/projects/domain.js';
import type { QuotationInput } from '../../../modules/projects/quotation.js';
import { assignmentSchema, followUpSchema, linkSchema, projectParams, queryProperties, quotationSchema, uuid } from '../../../modules/projects/schema.js';
import { getAssignmentConfig, listAssignableAdmins } from '../../../modules/projects/assignment.js';

interface ProjectParams { projectId: string }

const assignmentConfigSchema = {
  type: 'object', additionalProperties: false, required: ['defaultAssigneeAdminId', 'expectedRevision'],
  properties: { defaultAssigneeAdminId: { anyOf: [uuid, { type: 'null' }] }, expectedRevision: { type: 'integer', minimum: 0 } },
};
const listQuerySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    ...queryProperties,
    city: { type: 'string', maxLength: 100 }, customerName: { type: 'string', maxLength: 200 }, customerUserId: uuid, assigneeAdminId: uuid,
    exhibitionStartFrom: { type: 'string', format: 'date' }, exhibitionStartTo: { type: 'string', format: 'date' },
  },
};
const revisionProperty = { revision: { type: 'integer', minimum: 1 } };
const assetVersionParams = { ...projectParams, required: ['projectId', 'versionId'], properties: { ...projectParams.properties, versionId: uuid } };

export async function registerAdminProjectRoutes(app: FastifyInstance, pool: pg.Pool, _redis: Redis, storage: ReturnType<typeof createStorage>) {
  await app.register(async routes => {
    routes.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      adminUserId(request);
    });

    routes.get('/project-assignees', { config: { permissions: ['projects.assign'] } },
      async () => ({ code: 0, data: await listAssignableAdmins(pool) }));
    routes.get('/project-assignment-config', { config: { permissions: ['projects.read'] } },
      async () => ({ code: 0, data: await getAssignmentConfig(pool) }));
    routes.put<{ Body: AssignmentConfigInput }>('/project-assignment-config', {
      config: { permissions: ['projects.assign'] }, schema: { body: assignmentConfigSchema },
    }, async request => ({ code: 0, data: await saveAssignmentConfig(pool, adminUserId(request), request.body) }));

    routes.get<{ Querystring: ProjectQuery }>('/projects', {
      config: { permissions: ['projects.read'] }, schema: { querystring: listQuerySchema },
    }, async request => ({ code: 0, data: await listProjects(pool, request.query) }));

    routes.get<{ Params: ProjectParams }>('/projects/:projectId', {
      config: { permissions: ['projects.read'] }, schema: { params: projectParams },
    }, async request => {
      const project = await getProject(pool, request.params.projectId);
      return { code: 0, data: {
        ...project,
        statusTransitions: statusTransitions(project.status),
        requirementOptionLabels: await requirementOptionLabels(pool, project.request),
        events: await projectEvents(pool, project.projectId),
        quotation: await quotationRevision(pool, project.projectId),
      } };
    });

    routes.get<{ Params: ProjectParams }>('/projects/:projectId/events', {
      config: { permissions: ['projects.read'] }, schema: { params: projectParams, querystring: { type: 'object', additionalProperties: false, properties: {} } },
    }, async request => {
      await getProject(pool, request.params.projectId);
      return { code: 0, data: await projectEvents(pool, request.params.projectId) };
    });

    routes.put<{ Params: ProjectParams; Body: AssignmentInput }>('/projects/:projectId/assignee', {
      config: { permissions: ['projects.assign'] }, schema: { params: projectParams, body: assignmentSchema },
    }, async request => ({ code: 0, data: await assignProject(pool, request.params.projectId, adminUserId(request), request.body) }));

    routes.post<{ Params: ProjectParams; Body: FollowUpInput }>('/projects/:projectId/follow-ups', {
      config: { permissions: ['projects.follow-up'] }, schema: { params: projectParams, body: followUpSchema },
    }, async request => ({ code: 0, data: await followUpProject(pool, request.params.projectId, adminUserId(request), request.body) }));

    routes.put<{ Params: ProjectParams; Body: SchemeLinkInput }>('/projects/:projectId/scheme', {
      config: { permissions: ['projects.link-scheme'] }, schema: { params: projectParams, body: linkSchema },
    }, async request => ({ code: 0, data: await linkProjectScheme(pool, request.params.projectId, adminUserId(request), request.body) }));

    routes.get<{ Params: ProjectParams; Querystring: { revision?: number } }>('/projects/:projectId/quotation', {
      config: { permissions: ['projects.read'] },
      schema: { params: projectParams, querystring: { type: 'object', additionalProperties: false, properties: revisionProperty } },
    }, async request => {
      const project = await getProject(pool, request.params.projectId);
      return { code: 0, data: {
        projectId: project.projectId, projectRevision: project.revision,
        quotation: await quotationRevision(pool, project.projectId, request.query.revision),
      } };
    });

    routes.put<{ Params: ProjectParams; Body: QuotationInput }>('/projects/:projectId/quotation', {
      config: { permissions: ['projects.quotation'] }, bodyLimit: 32 * 1024 * 1024, schema: { params: projectParams, body: quotationSchema },
    }, async request => ({ code: 0, data: await saveQuotation(pool, request.params.projectId, adminUserId(request), request.body) }));

    routes.get<{ Params: ProjectParams; Querystring: { revision: number } }>('/projects/:projectId/quotation/download', {
      config: { permissions: ['projects.quotation-download'] },
      schema: { params: projectParams, querystring: { type: 'object', additionalProperties: false, required: ['revision'], properties: revisionProperty } },
    }, async (request, reply) => {
      const project = await getProject(pool, request.params.projectId);
      const quotation = await quotationRevision(pool, project.projectId, request.query.revision);
      if (!quotation) throw projectError('RESOURCE_NOT_FOUND', 404);
      const buffer = await quotationWorkbook({
        projectNo: project.projectNo, schemeCode: project.schemeCode, contact: project.request.contact, company: project.request.company,
      }, quotation);
      return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${project.projectNo}-quotation-r${quotation.revision}.xlsx"`)
        .send(buffer);
    });

    routes.get<{ Params: ProjectParams & { versionId: string } }>('/projects/:projectId/assets/:versionId/download', {
      config: { permissions: ['projects.asset-download'] }, schema: { params: assetVersionParams },
    }, async request => {
      await getProject(pool, request.params.projectId);
      const asset = await findProjectAssetVersion(pool, request.params.projectId, request.params.versionId);
      return { code: 0, data: { filename: asset.filename, downloadUrl: await storage.signDownloadWithName(asset.objectKey, asset.filename, 300) } };
    });
  });
}
